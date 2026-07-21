// Cloud Functions 2nd gen — Node.js 20 (codebase unique). BUILD_KIT §9, §10, §11, §14.
const { onObjectFinalized } = require("firebase-functions/v2/storage");
const { onCall, onRequest, HttpsError } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { logger } = require("firebase-functions/v2");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { getStorage } = require("firebase-admin/storage");
const { getAuth } = require("firebase-admin/auth");
// Lecture/écriture de classeurs via exceljs (remplace xlsx@0.18 — CVE-2023-30533). readWorkbook est ASYNC.
const { readWorkbook, aoaToXlsxBase64 } = require("./lib/xlsxRead");

const { getApp } = require("firebase-admin/app");
const { IMPORTS_BUCKET, FIRESTORE_DB, BACKUP_BUCKET } = require("./lib/config");
const { buildWrites, fiscalYearFromOrders } = require("./lib/ingest");
const { applyWrites, stripLiveOpps, resolveLogisticsFx } = require("./lib/apply");
const { parseBuffer, reingestBucket } = require("./lib/reingest");
const { defineSecret } = require("firebase-functions/params");
// Token API ClickUp (Secret Manager) — utilisé seulement par les fonctions d'intégration ClickUp.
const CLICKUP_TOKEN = defineSecret("CLICKUP_TOKEN");
// Clé API Anthropic (Secret Manager) — utilisée seulement par la CURATION de la veille (curateNews).
// Absente → la curation no-op proprement (pas d'échec du scheduler). À provisionner avant activation.
const ANTHROPIC_API_KEY = defineSecret("ANTHROPIC_API_KEY");
// Secret client de l'app Azure AD (Office 365 / Microsoft Graph) pour l'envoi d'emails. Absent → les
// notifications email no-op proprement (pas d'échec des schedulers). À provisionner avant activation.
const GRAPH_CLIENT_SECRET = defineSecret("GRAPH_CLIENT_SECRET");
// Défauts d'intégration ClickUp (surchargés par config/clickup) : workspace + liste « Côte d'Ivoire ».
const CLICKUP_TEAM = "90121503678";
const CLICKUP_LIST_CI = "901215917683";
// Listes pays de l'espace « Gestion de Projets » — scannées ENSEMBLE pour l'anti-doublon (une tâche
// BF/GN ne doit pas être dupliquée dans CI). CI / Burkina Faso / Guinée.
const CLICKUP_LISTS_ALL = ["901215917683", "901215918697", "901215918699"];
// Liste dédiée au suivi des commandes fournisseurs (espace « Gestion Commandes Frns »). Une tâche =
// UN bon de commande (N° BC), les lignes bcLines de même N° BC étant agrégées (montant sommé).
const CLICKUP_LIST_BC = "901215953602";

initializeApp();
// Base Firestore nommée nt360 (projet partagé) — isole données et règles.
const db = getFirestore(getApp(), FIRESTORE_DB);
// Filet de sécurité global : un seul champ `undefined` dans un document écrit fait échouer
// TOUT le batch (« Cannot use undefined as a Firestore value »), donc tout le recompute. On
// demande à Firestore d'ignorer les champs undefined (ils sont simplement omis) — les défauts
// explicites côté domaine restent la 1re ligne de défense ; ceci évite qu'un oubli ne brique
// à nouveau un recalcul entier.
db.settings({ ignoreUndefinedProperties: true });

// Garde-fou des scans pleins de collection (R1 scalabilité) — borne mémoire/latence des callables
// d'administration qui lisent une collection entière. Lecture bornée à MAX_SCAN+1 pour DÉTECTER un
// dépassement, puis troncature SIGNALÉE (jamais silencieuse) via `sliceCapped` + auditLog côté appelant.
const { MAX_SCAN, sliceCapped } = require("./domain/scan");

// --- F2 : Ingestion SheetJS idempotente (Storage trigger sur gs://nt360) ---
// Le déclencheur Storage doit être dans la MÊME région que le bucket. gs://nt360 est en
// dual-region eur4 (non déployable comme région de fonction). Le trigger n'est donc exporté
// que si INGEST_REGION est défini (région alignée sur le bucket) ; sinon l'ingestion passe
// par seed/loadData.js (Admin SDK, sans contrainte de région).
// `applyWrites(db, writes)` (upsert idempotent + nettoyage des lignes BC de fiche orphelines) est
// extrait dans ./lib/apply — partagé par le trigger Storage, importDelta et reingest.

async function ingestHandler(event) {
  const { bucket, name } = event.data;
  if (!name || name.endsWith("/")) return; // dossier
  // OBSERVABILITÉ : le trigger Storage gen2 NE réessaie PAS par défaut ; une exception (ex. recompute qui
  // échoue) était perdue SANS trace queryable → docs sources écrits mais summaries périmés en silence. On
  // encadre donc le corps d'un try/catch qui journalise ok/erreur dans opsLog (comme les callables/planifiés).
  try {
    const [buf] = await getStorage().bucket(bucket).file(name).download();
    const wb = await readWorkbook(buf); // exceljs : dates → Date, cellules fusionnées gérées (parité §18.4)

    const { kinds, writes, report } = buildWrites(wb);
    // LIVE écarté du canal ingest (cf. stripLiveOpps) : les opps passent EXCLUSIVEMENT par la synchro
    // snapshot (staling) → pas de doublon de pipeline. Le classeur d'inventaire doit alimenter la synchro
    // Sales_DATA (sync/sales_data.xlsx), seul écrivain LIVE.
    const { writes: deltaWrites, skipped: liveSkipped } = stripLiveOpps(writes);
    if (liveSkipped) report.liveSkipped = liveSkipped;
    // Applique les taux paramétrés (config/fxRates) aux lignes logistics « à saisir » sans écraser une
    // correction manuelle (cf. resolveLogisticsFx) — la conversion USD/GBP se fait à l'ingestion.
    const fxConverted = await resolveLogisticsFx(db, deltaWrites);
    if (fxConverted) report.fxConverted = fxConverted;
    logger.info("ingest", { name, kinds, liveSkipped, fxConverted, ...report });

    await applyWrites(db, deltaWrites); // upsert + nettoyage des orphelins de fiche (voir applyWrites)

    await db.collection("imports").add({
      uid: null, kinds, filename: name, objectKey: `${bucket}/${name}`,
      rowsIn: report.rowsIn ?? 0, rowsOk: report.rowsOk ?? 0, rowsSkipped: report.rowsSkipped ?? 0,
      report, ts: FieldValue.serverTimestamp(),
    });

    // Post-traitement BEST-EFFORT (blindage imports) : les données sont DÉJÀ écrites (applyWrites) — un échec
    // du fisc/recompute ne doit PAS marquer l'ingestion en erreur (le prochain recompute — trigger différé,
    // mutation, ou planifié — rattrape). Un échec d'ÉCRITURE des données, lui, reste remonté par le catch externe.
    try {
      if (kinds.includes("pnl") || kinds.includes("fiche")) await updateFiscalYearFromOrders();
      await recomputeSummaries(); // F3 : recalcul des agrégats impactés
    } catch (re) {
      logger.error("ingest : recompute post-écriture échoué — données ingérées, agrégats au prochain recompute", { name, message: re && re.message });
    }
    await logOps({ kind: "ingest", action: "ingest", status: "ok", detail: { name, kinds, rowsOk: report.rowsOk ?? 0 } });
  } catch (e) {
    logger.error("ingest a échoué", { name, message: e && e.message, stack: e && e.stack });
    await logOps({ kind: "ingest", action: "ingest", status: "error", detail: { name }, error: (e && e.message) || String(e) });
    throw e; // re-propage pour la visibilité côté logs/monitoring (event non réessayé par défaut)
  }
}

if (process.env.INGEST_REGION) {
  exports.ingest = onObjectFinalized(
    { bucket: IMPORTS_BUCKET, region: process.env.INGEST_REGION, memoryMiB: 1024, timeoutSeconds: 300 },
    ingestHandler
  );
}

// --- Recompute DIFFÉRÉ : trigger Firestore sur config/recomputeRequest (déposé par requestRecompute).
// Lance le recompute HORS du chemin de réponse des mutations, via le verrou/coalescing existant. Opt-in :
// exporté SEULEMENT si RECOMPUTE_REGION est défini — un trigger Firestore doit être co-localisé à sa base
// NOMMÉE (database: FIRESTORE_DB), la région ne peut donc pas être devinée ici. retry:false = pas de boucle
// (le prochain recompute — mutation suivante ou planifié 05:00 — rattrape un échec). Aucune BOUCLE : le
// recompute écrit summaries/* + config/periods + config/recomputeLock, JAMAIS config/recomputeRequest. ---
if (process.env.RECOMPUTE_REGION) {
  const { onDocumentWritten } = require("firebase-functions/v2/firestore");
  exports.onRecomputeRequest = onDocumentWritten(
    { document: "config/recomputeRequest", database: FIRESTORE_DB, region: process.env.RECOMPUTE_REGION, memoryMiB: 1024, timeoutSeconds: 540, retry: false },
    async (event) => {
      const after = event.data && event.data.after && event.data.after.data();
      if (!after) return; // suppression du doc → rien à faire
      const scope = Array.isArray(after.scope) ? after.scope : null; // null/absent = recompute complet
      const t0 = Date.now();
      try {
        await recomputeSummaries(scope); // passe par runSerialized (verrou + coalescing)
        await logOps({ kind: "recompute", trigger: "différé", status: "ok", ms: Date.now() - t0, detail: { scope: scope || "complet" } });
      } catch (e) {
        logger.error("onRecomputeRequest a échoué", { message: e && e.message, stack: e && e.stack });
        await logOps({ kind: "recompute", trigger: "différé", status: "error", ms: Date.now() - t0, error: (e && e.message) || String(e) });
      }
    }
  );
}

// Application de l'EFFET d'une décision d'approbation de contrat de maintenance (audit m4, ADR-022) : quand une
// demande `approvals` de kind renouvellement/résiliation passe à `approved`, on MUTE le contrat (statut resilie,
// ou dateFin repoussée d'un terme). Sans ce trigger, la validation humaine restait SANS effet sur les données.
// Trigger co-localisé à la base NOMMÉE (database: FIRESTORE_DB) → gaté sur RECOMPUTE_REGION comme
// onRecomputeRequest (la région d'une base nommée ne peut pas être devinée). retry:false = pas de boucle.
if (process.env.RECOMPUTE_REGION) {
  const { onDocumentWritten } = require("firebase-functions/v2/firestore");
  exports.onMntApprovalDecided = onDocumentWritten(
    { document: "approvals/{id}", database: FIRESTORE_DB, region: process.env.RECOMPUTE_REGION, memoryMiB: 256, timeoutSeconds: 120, retry: false },
    async (event) => {
      const before = event.data && event.data.before && event.data.before.data();
      const after = event.data && event.data.after && event.data.after.data();
      if (!after) return; // suppression du doc → rien à faire
      // Étanchéité du drapeau (invariant C10 : drapeau éteint ⇒ AUCUNE écriture mnt_*). Le module peut être
      // éteint ENTRE la soumission de l'approbation et sa décision → sans cette garde, décider une approbation
      // mnt_ en attente muterait quand même mnt_astreintes/mnt_contrats + auditLog(module:maintenance).
      // Cohérent avec submitAstreinte / la décision de contrat, déjà gâtées par le drapeau (ADR-009).
      const { isMntEnabled } = require("./domain/mntFeature");
      if (!isMntEnabled((await db.doc("config/mntFeature").get()).data())) return; // module éteint → rien
      // ASTREINTES (ADR-035) — comptabilisation à la décision : approuvée → l'astreinte devient « validee »
      // (elle pèse alors en charge dans la rentabilité), rejetée → « rejetee ». On agit à la TRANSITION vers
      // un état DÉCIDÉ (idempotence : les ré-écritures ultérieures — note, etc. — ne re-mutent pas).
      if (after.entityType === "astreinte") {
        const decided = after.status === "approved" || after.status === "rejected";
        const wasDecided = before && (before.status === "approved" || before.status === "rejected");
        if (decided && !wasDecided && after.entityId) {
          try {
            const statut = after.status === "approved" ? "validee" : "rejetee";
            const ref = db.doc(`mnt_astreintes/${after.entityId}`);
            const snap = await ref.get();
            if (snap.exists) {
              await ref.set({ statut, decidedBy: after.decidedBy || null, decidedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
              await db.collection("auditLog").add({ uid: after.decidedBy || null, action: "astreinte_decide", module: "maintenance", entity: "astreinte", entityId: after.entityId, detail: { statut, approvalId: event.params.id }, ts: FieldValue.serverTimestamp() });
              if (statut === "validee") await requestRecompute(["maintenance"]); // la charge validée modifie le score de risque / la marge
            }
          } catch (e) { logger.error("onMntApprovalDecided (astreinte) a échoué", { message: e && e.message, stack: e && e.stack }); }
        }
        return; // astreinte traitée — ce n'est pas une décision de contrat
      }
      // On n'agit QU'À LA TRANSITION vers `approved` (idempotence : les ré-écritures ultérieures — note, etc.
      // — ne re-mutent pas le contrat). Seules les décisions de contrat de maintenance sont concernées.
      if (after.status !== "approved" || (before && before.status === "approved")) return;
      if (after.entityType !== "mnt_contrat") return;
      if (!["renouvellement_contrat", "resiliation_contrat"].includes(after.kind)) return;
      const contratId = after.entityId;
      if (!contratId) return;
      try {
        const { applyMntDecision } = require("./domain/mntDecision");
        const ref = db.doc(`mnt_contrats/${contratId}`);
        const snap = await ref.get();
        if (!snap.exists) return; // contrat supprimé entre-temps
        const res = applyMntDecision(after.kind, snap.data() || {});
        if (!res.applied || !res.patch) return; // rien d'applicable (déjà résilié, renouvellement sans date de fin…)
        await ref.set({ ...res.patch, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
        await db.collection("auditLog").add({ uid: after.decidedBy || null, action: "mnt_decision_apply", module: "maintenance", entity: "mnt_contrat", entityId: contratId, detail: { kind: after.kind, approvalId: event.params.id, patch: res.patch, reason: res.reason }, ts: FieldValue.serverTimestamp() });
        await requestRecompute(["maintenance"]); // le changement de statut (résilié/renouvelé) modifie le score de risque
      } catch (e) {
        logger.error("onMntApprovalDecided a échoué", { message: e && e.message, stack: e && e.stack });
      }
    }
  );
}

/** Recalcule config/fiscal.currentFy = max(yearPo) des commandes (§7). */
async function updateFiscalYearFromOrders() {
  const snap = await db.collection("orders").select("yearPo").get();
  const currentFy = fiscalYearFromOrders(snap.docs.map((d) => d.data()));
  if (currentFy > 0) await db.doc("config/fiscal").set({ currentFy }, { merge: true });
}

// Recalcul des agrégats — implémenté en F3 (lib/aggregate). Sans-op si absent.
async function recomputeSummaries(only) {
  try {
    const { recomputeAll } = require("./lib/aggregate");
    await recomputeAll(db, only);
  } catch (e) {
    if (e.code !== "MODULE_NOT_FOUND") throw e;
  }
}

// Portée de recompute CIBLÉE pour une mutation d'OPPORTUNITÉ NON GAGNÉE (saisie/board/import). Elle ne
// nourrit que les summaries réellement dérivés des opportunités — pipeline (+ funnel), ams, atterrissage
// (le pondéré nourrit le projeté CAS), overview (certitudes/conversion), news, alerts, dataQuality (compte
// + « gagnées sans FP/P&L ») — et saute commandes/backlog/rentabilité/clients/domaines/fournisseurs/cash.
// + "partenariats" : le pipeline SOURCÉ PARTENAIRE (summaries/par_pipeline, PAR-L1) dérive des opps
// taguées parPartnerId — sans ce scope, taguer/gagner une opp laisserait le sourcé figé. Coût nul drapeau
// éteint (le bloc par_ d'aggregate sort immédiatement).
const OPP_RECOMPUTE = ["pipeline", "ams", "atterrissage", "overview", "news", "alerts", "dataQuality", "partenariats"];

// MAIS une opp GAGNÉE (stage 6) dont le N° FP matche une ligne P&L RÉCONCILIE la commande dans
// mergeCommandes (domain/commandes.js) — c'est un AGRÉGAT, pas une jointure d'affichage : elle écrase
// CAS/client/BU/AM/affaire de l'`order`. On élargit alors la portée aux summaries dérivés des orders
// (carnet Commandes, backlog, rentabilité, clients, domaines, fournisseurs, cash indicatif) — sinon le
// carnet resterait périmé et CONTREDIRAIT l'en-tête (overview/atterrissage/AM, eux recalculés sur les
// nouveaux orders) jusqu'au recompute nocturne. On ne paie ce surcoût QUE quand une opp gagnée est en jeu.
// + "recognition" : une opp GAGNÉE réconcilie le CAS des orders → les taux FAE/PCA de summaries/recognition
// en dérivent (gate want("recognition")) ; sans ce scope ils restaient périmés jusqu'au recompute nocturne.
const OPP_RECOMPUTE_WON = [...OPP_RECOMPUTE, "commandes", "backlog", "rentabilite", "clients", "domaines", "suppliers", "cashflow", "recognition"];

// Portée d'une mutation d'opp : élargie DÈS QUE l'étape « Gagné » (6) est impliquée AVANT ou APRÈS la
// mutation (passage à gagné, sortie de gagné, ou édition/suppression d'une opp déjà gagnée) — tous les
// cas où la réconciliation commande change. Sinon portée étroite (le cas courant : édition d'opps ouvertes).
function oppScope(prevStage, nextStage) {
  return (Number(prevStage) === 6 || Number(nextStage) === 6) ? OPP_RECOMPUTE_WON : OPP_RECOMPUTE;
}

// Recompute DIFFÉRÉ (opt-in) — au lieu d'attendre le recompute (plusieurs secondes) AVANT de répondre,
// une mutation dépose une DEMANDE (config/recomputeRequest) et répond en ~ms ; le trigger Firestore
// `onRecomputeRequest` (ci-dessous) lance le recompute HORS du chemin de réponse, via le même verrou/
// coalescing. Le front lit les summaries en temps réel → rafraîchis quelques secondes plus tard
// (cohérence différée, déjà assumée par le coalescing). ACTIVÉ UNIQUEMENT si `RECOMPUTE_REGION` est défini
// (région alignée sur la base Firestore NOMMÉE — un trigger Firestore doit être co-localisé à sa base) :
// sinon REPLI SYNCHRONE = comportement historique inchangé → jamais de recompute perdu. Même schéma opt-in
// que le trigger Storage `ingest` (INGEST_REGION). L'activation (ops) : définir RECOMPUTE_REGION + déployer.
async function requestRecompute(scope) {
  if (process.env.RECOMPUTE_REGION) {
    await db.doc("config/recomputeRequest").set({ scope: scope || null, ts: FieldValue.serverTimestamp() });
  } else {
    await recomputeSummaries(scope); // repli : recompute synchrone (comportement par défaut, inchangé)
  }
}

// Recompute SYNCHRONE best-effort pour les mutations du CARNET (audit backlog, constat H1) : en prod le
// canal DIFFÉRÉ est inerte (RECOMPUTE_REGION posé côté runtime mais trigger onRecomputeRequest absent du
// déploiement) → une demande déposée n'est JAMAIS traitée et backlog_fy/commandesRows/alertes contredisent
// l'action (« Solder ») pendant des heures, alors que le toast promet « recalcul lancé ». On force donc le
// recompute DANS le chemin de réponse (verrou/coalescing inclus), BEST-EFFORT : la donnée est DÉJÀ écrite,
// un échec du recompute est tracé (opsLog), jamais remonté en faux « internal » (patron refreshParBestEffort,
// handlers/partenariats.js). Si le différé est un jour réellement déployé, repasser ces sites à
// requestRecompute (ADR-060).
async function refreshNowBestEffort(action, scope) {
  const t0 = Date.now();
  try { await recomputeSummaries(scope); }
  catch (e) {
    logger.error("refreshNowBestEffort : recompute en échec (mutation déjà écrite)", { action, message: e && e.message });
    await logOps({ kind: "recompute", trigger: action, status: "error", ms: Date.now() - t0, error: (e && e.message) || String(e) });
  }
}

// Journal d'EXPLOITATION : trace persistante des recomputes (manuels/planifiés) et de leurs
// échecs, pour l'observabilité (surfacé en Admin). N'échoue jamais l'action appelante.
async function logOps(entry) {
  try {
    await db.collection("opsLog").add({ ...entry, ts: FieldValue.serverTimestamp() });
  } catch (e) {
    logger.error("opsLog: écriture impossible", { message: e && e.message });
  }
}

// Rejette un id destiné à un chemin de document s'il est vide ou contient « / » (segments imbriqués
// inattendus). Défense en profondeur sur les callables construisant db.doc(`collection/${id}`) à partir
// d'une entrée client (Firestore traite déjà les segments littéralement, mais on refuse tôt et clair).
function assertPlainId(id, label = "id") {
  const s = String(id == null ? "" : id);
  if (!s || s.includes("/")) throw new HttpsError("invalid-argument", `${label} invalide`);
  return s;
}

// Limiteur de débit par (uid, type) — best-effort, transactionnel sur rateLimits/{kind}_{uid} avec une
// fenêtre glissante. Renvoie true si l'action est AUTORISÉE, false si le quota est dépassé (l'appelant
// abandonne alors silencieusement). Anti-flood des journaux écrits par tout compte authentifié (errorLog).
async function rateLimit(uid, kind, maxPerWindow, windowMs) {
  if (!uid) return false;
  const ref = db.doc(`rateLimits/${kind}_${uid}`);
  try {
    return await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const now = Date.now();
      const d = snap.exists ? snap.data() : null;
      const within = d && typeof d.windowStartMs === "number" && (now - d.windowStartMs) < windowMs;
      const count = within ? (Number(d.count) || 0) : 0;
      if (count >= maxPerWindow) return false;
      tx.set(ref, { windowStartMs: within ? d.windowStartMs : now, count: count + 1, updatedMs: now }, { merge: true });
      return true;
    });
  } catch (e) {
    logger.warn("rateLimit: transaction échouée (fail-open)", { kind, message: e && e.message });
    return true; // en cas d'erreur d'infra, ne pas bloquer l'action légitime
  }
}

// --- setUserRole : pose du rôle (custom claim), admin uniquement (§8) ---
const ROLES = ["direction", "commercial_dir", "commercial", "pmo", "achats", "assistante", "lecture", "finance", "directeur_contrats", "data_steward"];

exports.setUserRole = onCallG("setUserRole", async (req) => {
  if (req.auth?.token?.nt360Role !== "direction") throw new HttpsError("permission-denied", "admin requis");
  await requireStrongAuth(req); // MFA sur les octrois de privilège (parité avec setManager/setRecordAccess)
  const { uid, role } = req.data || {};
  if (!uid || !ROLES.includes(role)) throw new HttpsError("invalid-argument", "uid et role (profil valide) requis");
  // Claim NAMESPACÉ (nt360Role) : le projet Firebase est PARTAGÉ avec une autre app → un claim
  // générique `role` serait commun aux deux (un `role:direction` posé par l'app sœur escaladerait ici).
  // On lit/écrit exclusivement nt360Role et on purge un éventuel legacy `role` du même compte.
  const existing = (await getAuth().getUser(uid).catch(() => null))?.customClaims || {};
  const { role: _legacy, ...keep } = existing;
  await getAuth().setCustomUserClaims(uid, { ...keep, nt360Role: role });
  // Reflète le rôle courant dans l'annuaire users/ (le rôle « source de vérité » reste le custom
  // claim ; ce miroir sert l'affichage de l'écran Habilitations et évite un rôle invisible).
  await db.collection("users").doc(uid).set({ role }, { merge: true });
  await db.collection("auditLog").add({
    uid: req.auth.uid, action: "perm_change", module: "habilitations",
    entity: "user", entityId: uid, detail: { role }, ts: FieldValue.serverTimestamp(),
  });
  return { ok: true };
});

// --- createUser : provisionne un compte (Auth) + rôle (custom claim) + fiche users/, admin
// uniquement. Aucune création d'utilisateur n'existait dans l'app (seul le seed d'amorçage) ;
// ce callable comble le manque. Le mot de passe initial est fixé par l'admin (communiqué hors
// bande) ; l'utilisateur pourra le changer. Un email déjà pris est REFUSÉ (jamais de
// réinitialisation silencieuse d'un compte existant). ---
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

exports.createUser = onCallG("createUser", async (req) => {
  if (req.auth?.token?.nt360Role !== "direction") throw new HttpsError("permission-denied", "admin requis");
  await requireStrongAuth(req); // MFA sur la création de compte (octroi de privilège)
  const d = req.data || {};
  const email = String(d.email || "").trim().toLowerCase();
  const role = d.role;
  const password = String(d.password || "");
  const name = String(d.name || "").trim() || email.split("@")[0];
  if (!EMAIL_RE.test(email)) throw new HttpsError("invalid-argument", "email invalide");
  if (!ROLES.includes(role)) throw new HttpsError("invalid-argument", "rôle (profil valide) requis");
  if (password.length < 8) throw new HttpsError("invalid-argument", "mot de passe : 8 caractères minimum");
  const auth = getAuth();
  let existing = null;
  try { existing = await auth.getUserByEmail(email); } catch (e) { if (e.code !== "auth/user-not-found") throw e; }
  if (existing) throw new HttpsError("already-exists", "un compte existe déjà pour cet email");
  const user = await auth.createUser({ email, password, displayName: name, emailVerified: true });
  await auth.setCustomUserClaims(user.uid, { nt360Role: role }); // claim NAMESPACÉ (projet Firebase partagé)
  await db.collection("users").doc(user.uid).set(
    { email, name, active: true, role, createdBy: req.auth.uid, createdAt: FieldValue.serverTimestamp() },
    { merge: true },
  );
  await db.collection("auditLog").add({
    uid: req.auth.uid, action: "user_create", module: "habilitations",
    entity: "user", entityId: user.uid, detail: { email, role }, ts: FieldValue.serverTimestamp(),
  });
  return { ok: true, uid: user.uid };
});

// --- attachUser : RATTACHE un compte Firebase DÉJÀ EXISTANT (créé par une autre application du même
// projet — l'authentification Firebase est partagée à l'échelle du projet) à cette app : pose le rôle
// (custom claim, FUSIONNÉ pour ne pas écraser les claims d'une autre app) + crée/actualise la fiche
// users/{uid}. Ne recrée PAS le compte et NE TOUCHE PAS au mot de passe. Direction uniquement, audité. ---
exports.attachUser = onCallG("attachUser", async (req) => {
  if (req.auth?.token?.nt360Role !== "direction") throw new HttpsError("permission-denied", "admin requis");
  await requireStrongAuth(req); // MFA sur le rattachement d'un compte (octroi de rôle)
  const d = req.data || {};
  const email = String(d.email || "").trim().toLowerCase();
  const role = d.role;
  if (!EMAIL_RE.test(email)) throw new HttpsError("invalid-argument", "email invalide");
  if (!ROLES.includes(role)) throw new HttpsError("invalid-argument", "rôle (profil valide) requis");
  const auth = getAuth();
  let user;
  try { user = await auth.getUserByEmail(email); }
  catch (e) { if (e.code === "auth/user-not-found") throw new HttpsError("not-found", "aucun compte Firebase pour cet email (ni dans ce projet, ni dans ses autres apps)"); throw e; }
  const name = String(d.name || "").trim() || user.displayName || email.split("@")[0];
  // FUSION des claims : préserve d'éventuels claims d'une autre app du projet, pose nt360Role (namespacé)
  // et purge un éventuel legacy `role` du même compte (sinon il resterait exploitable côté nt360).
  const { role: _legacy, ...keep } = user.customClaims || {};
  await auth.setCustomUserClaims(user.uid, { ...keep, nt360Role: role });
  await db.collection("users").doc(user.uid).set(
    { email, name, active: true, role, attachedBy: req.auth.uid, updatedAt: FieldValue.serverTimestamp() },
    { merge: true },
  );
  await db.collection("auditLog").add({
    uid: req.auth.uid, action: "user_attach", module: "habilitations",
    entity: "user", entityId: user.uid, detail: { email, role }, ts: FieldValue.serverTimestamp(),
  });
  // Le compte devant rafraîchir sa session pour voir le nouveau claim (comme setUserRole).
  return { ok: true, uid: user.uid, attached: true };
});

// --- setUserActive : active/désactive un compte (Auth `disabled` + fiche users.active), admin
// uniquement. Un compte désactivé ne peut plus se connecter (ses jetons existants cessent d'être
// rafraîchis, expiration ≤ 1 h). On interdit de désactiver son PROPRE compte (verrouillage). ---
exports.setUserActive = onCallG("setUserActive", async (req) => {
  if (req.auth?.token?.nt360Role !== "direction") throw new HttpsError("permission-denied", "admin requis");
  await requireStrongAuth(req); // MFA sur l'activation/désactivation d'un compte
  const { uid, active } = req.data || {};
  if (!uid || typeof active !== "boolean") throw new HttpsError("invalid-argument", "uid et active (booléen) requis");
  if (uid === req.auth.uid && active === false) throw new HttpsError("failed-precondition", "impossible de désactiver son propre compte");
  await getAuth().updateUser(uid, { disabled: !active });
  await db.collection("users").doc(uid).set({ active }, { merge: true });
  await db.collection("auditLog").add({
    uid: req.auth.uid, action: "user_active", module: "habilitations",
    entity: "user", entityId: uid, detail: { active }, ts: FieldValue.serverTimestamp(),
  });
  return { ok: true };
});

// --- Seuils d'alerte configurables (config/alerts) : édités par la direction, recompute des
// alertes + qualité des données pour appliquer immédiatement. Bornés pour éviter les valeurs absurdes. ---
exports.setAlertThresholds = onCallG("setAlertThresholds", async (req) => {
  if (req.auth?.token?.nt360Role !== "direction") throw new HttpsError("permission-denied", "admin requis");
  const d = req.data || {};
  const pct = (v, def) => { const n = Number(v); return Number.isFinite(n) && n >= 0 && n <= 1 ? n : def; };
  const years = (v, def) => { const n = Math.trunc(Number(v)); return Number.isFinite(n) && n >= 1 && n <= 10 ? n : def; };
  const days = (v, def) => { const n = Math.trunc(Number(v)); return Number.isFinite(n) && n >= 1 && n <= 365 ? n : def; };
  const cfg = {
    concentration: pct(d.concentration, 0.30),
    surfacturationPct: pct(d.surfacturationPct, 0.005),
    rafEcartPct: pct(d.rafEcartPct, 0.10),
    dormantYears: years(d.dormantYears, 2),
    valorisationEcartPct: pct(d.valorisationEcartPct, 0.30),
    nonFactureJours: days(d.nonFactureJours, 90),
  };
  await db.doc("config/alerts").set(cfg, { merge: true });
  await db.collection("auditLog").add({
    uid: req.auth.uid, action: "alert_thresholds", module: "habilitations",
    entity: "config", entityId: "alerts", detail: cfg, ts: FieldValue.serverTimestamp(),
  });
  await requestRecompute(["alerts", "dataQuality"]);
  return { ok: true, ...cfg };
});

// --- Objectifs d'occupation / TACE (config/staffingTargets, Lot 18 DirOps) : cibles globales +
// affinables par grade et par BU. Édité par la direction. Sert à détecter la dérive dans le cockpit
// d'activité (Lot 13). Pas de recompute (lu à la volée par activityKpis). ---
exports.setStaffingTargets = onCallG("setStaffingTargets", { memoryMiB: 256, timeoutSeconds: 60 }, async (req) => {
  if (req.auth?.token?.nt360Role !== "direction") throw new HttpsError("permission-denied", "admin requis");
  const { validateTargets } = require("./domain/staffingTarget");
  const cfg = validateTargets(req.data);
  await db.doc("config/staffingTargets").set(cfg, { merge: false });
  await db.collection("auditLog").add({ uid: req.auth.uid, action: "staffing_targets", module: "habilitations", entity: "config", entityId: "staffingTargets", detail: { occupancy: cfg.occupancy }, ts: FieldValue.serverTimestamp() });
  return { ok: true, ...cfg };
});

// --- Niveaux de PROJECTION configurables (config/projection) : activer/désactiver et pondérer
// chacun des 3 niveaux (Certitudes ≥90 · Forecast 70-90 · Pipe 50-70). Édité par la direction ;
// recompute COMPLET (overview, pipeline, atterrissage, AM 360° en dépendent). Poids bornés [0,1]. ---
// Budget aligné sur `recompute`/`importDelta` (512 MiB / 300 s) : recomputeSummaries() reconstruit
// TOUS les summaries — le défaut 256 MiB / 60 s provoquait timeout/OOM à l'échelle (cf. audit intégral
// O1), et un kill sur timeout bypasse la libération du verrou → agrégats figés ~10 min (lease).
exports.setProjectionConfig = onCallG("setProjectionConfig", { memoryMiB: 512, timeoutSeconds: 300 }, async (req) => {
  if (req.auth?.token?.nt360Role !== "direction") throw new HttpsError("permission-denied", "admin requis");
  const d = req.data || {};
  const w = (v, def) => { const n = Number(v); return Number.isFinite(n) && n >= 0 && n <= 1 ? n : def; };
  const tier = (k, dw) => ({ active: d?.[k]?.active === undefined ? true : !!d[k].active, weight: w(d?.[k]?.weight, dw) });
  const cfg = { certitudes: tier("certitudes", 1), forecast: tier("forecast", 0.2), pipe: tier("pipe", 0.05) };
  // Exclusion des opportunités DORMANTES (année de closing < exercice) de la prévision cumulée. Booléen ;
  // non fourni ⇒ inchangé (merge). Défaut métier (absent du doc) = ACTIVÉ, cf. aggregate/forecastRollup.
  if (d.excludeDormant !== undefined) cfg.excludeDormant = !!d.excludeDormant;
  // Seuil « Gelé » des phases amont (en MOIS) : au-delà, une opp non déposée est considérée enlisée.
  // Non fourni → inchangé (merge). Borné [1..36] mois ; défaut métier (absent) = 6 (cf. domain/pipeline).
  if (d.geleMonths !== undefined) {
    const gm = Number(d.geleMonths);
    cfg.geleMonths = Number.isFinite(gm) ? Math.max(1, Math.min(36, Math.round(gm))) : 6;
  }
  // Solde d'OUVERTURE de trésorerie (SOA global) : base de la position cash projetée. Peut être
  // négatif (découvert). Non fourni → champ inchangé (merge). Fourni → borné à un ordre de grandeur
  // raisonnable pour éviter une saisie aberrante.
  if (d.cashOpening !== undefined) {
    const co = Number(d.cashOpening);
    cfg.cashOpening = Number.isFinite(co) ? Math.max(-1e15, Math.min(1e15, co)) : 0;
  }
  await db.doc("config/projection").set(cfg, { merge: true });
  await db.collection("auditLog").add({
    uid: req.auth.uid, action: "projection_config", module: "habilitations",
    entity: "config", entityId: "projection", detail: cfg, ts: FieldValue.serverTimestamp(),
  });
  await requestRecompute(); // projection → overview / pipeline / atterrissage / ams : recompute complet
  return { ok: true, ...cfg };
});

// --- Table d'ALIAS de normalisation des noms de clients (config/clientAliases) : fusionne les
// graphies distinctes d'un même client (ex. « SGBCI » ↔ « Société Générale »). Édité par la
// direction ; recompute COMPLET (le nom canonique pilote tous les regroupements client). Remplace
// intégralement (merge:false) → retirer une paire la supprime réellement. Bornée à 500 paires. ---
// Budget 512 MiB / 300 s comme setProjectionConfig : recomputeSummaries() complet (cf. audit intégral O1).
exports.setClientAliases = onCallG("setClientAliases", { memoryMiB: 512, timeoutSeconds: 300 }, async (req) => {
  if (req.auth?.token?.nt360Role !== "direction") throw new HttpsError("permission-denied", "admin requis");
  const raw = Array.isArray(req.data && req.data.pairs) ? req.data.pairs : [];
  const pairs = [];
  for (const p of raw.slice(0, 500)) {
    const from = String((p && p.from) || "").trim();
    const to = String((p && p.to) || "").trim();
    if (from && to) pairs.push({ from, to });
  }
  await db.doc("config/clientAliases").set({ pairs, updatedAt: FieldValue.serverTimestamp() }, { merge: false });
  await db.collection("auditLog").add({
    uid: req.auth.uid, action: "client_aliases", module: "habilitations", entity: "config", entityId: "clientAliases",
    detail: { count: pairs.length }, ts: FieldValue.serverTimestamp(),
  });
  await requestRecompute(); // les noms canoniques pilotent byClient/concentration/EntityView/atterrissage
  return { ok: true, count: pairs.length };
});

// --- Alias FOURNISSEURS (config/supplierAliases) — normalisation MINIMALE (ADR-046). Fusionne au recompute
// les graphies fournisseur que `cleanName` ne rattrape pas (alias manuels déterministes, PAS d'IA). Overlay
// (survit aux ré-imports). Gâté sur le droit `fournisseurs` (même droit que le référentiel fournisseur) —
// PAS direction-only : la normalisation ne touche que des NOMS (aucune donnée confidentielle de coût).
exports.setSupplierAliases = onCallG("setSupplierAliases", { memoryMiB: 512, timeoutSeconds: 300 }, async (req) => {
  await requireWrite(req, "fournisseurs");
  const raw = Array.isArray(req.data && req.data.pairs) ? req.data.pairs : [];
  const pairs = [];
  for (const p of raw.slice(0, 500)) {
    const from = String((p && p.from) || "").trim();
    const to = String((p && p.to) || "").trim();
    if (from && to) pairs.push({ from, to });
  }
  await db.doc("config/supplierAliases").set({ pairs, updatedAt: FieldValue.serverTimestamp() }, { merge: false });
  await db.collection("auditLog").add({
    uid: req.auth.uid, action: "supplier_aliases", module: "fournisseurs", entity: "config", entityId: "supplierAliases",
    detail: { count: pairs.length }, ts: FieldValue.serverTimestamp(),
  });
  await requestRecompute(); // le SOA regroupe les fournisseurs par clé canonique (alias inclus) → summaries/suppliers
  return { ok: true, count: pairs.length };
});

// Inventaire des noms de FOURNISSEURS (atelier de normalisation) : comptes par nom brut regroupés par clé
// canonique effective (`cleanName` + alias). Lecture bornée (MAX_SCAN). Gâté `fournisseurs` (lecture).
exports.supplierNames = onCallG("supplierNames", { memoryMiB: 512, timeoutSeconds: 120 }, async (req) => {
  await requireRead(req, "fournisseurs");
  const { groupSupplierNames } = require("./domain/supplierName");
  const [ord, bc, inv, aliasDoc] = await Promise.all([
    db.collection("orders").select("suppliers").limit(MAX_SCAN + 1).get(),
    db.collection("bcLines").select("supplier").limit(MAX_SCAN + 1).get(),
    db.collection("supplierInvoices").select("supplier").limit(MAX_SCAN + 1).get(),
    db.doc("config/supplierAliases").get(),
  ]);
  const capped = ord.size > MAX_SCAN || bc.size > MAX_SCAN || inv.size > MAX_SCAN;
  // Comptes par nom BRUT (orders.suppliers[].name + bcLines.supplier + supplierInvoices.supplier).
  // Les noms fournisseurs ne sont pas record-level scopés (contrairement aux clients/opps).
  const counts = new Map();
  const bump = (raw) => { const c = String(raw || "").trim(); if (c) counts.set(c, (counts.get(c) || 0) + 1); };
  sliceCapped(ord.docs).docs.forEach((d) => { for (const s of (d.data().suppliers || [])) bump(s && s.name); });
  sliceCapped(bc.docs).docs.forEach((d) => bump(d.data().supplier));
  sliceCapped(inv.docs).docs.forEach((d) => bump(d.data().supplier));
  const names = [...counts.entries()].map(([name, count]) => ({ name, count }));
  const pairs = ((aliasDoc.data() || {}).pairs) || [];
  const groups = groupSupplierNames(names, pairs);
  return {
    ok: true, capped,
    distinctNames: names.length,
    distinctCanon: groups.length,
    toReview: groups.filter((g) => g.hasVariants).length, // groupes à ≥ 2 graphies (déjà fusionnées)
    aliasCount: pairs.length,
    groups: groups.slice(0, 400),
  };
});

// --- Jalons de facturation par projet (billingMilestones/{safeId(fp)}) : échéancier prévisionnel
// (≤ 15 jalons {date, montant}), SOURCE UNIQUE du report N+1 (Σ jalons après le 31/12). Édité par
// direction/PMO. La règle « Σ jalons = RAF » est validée à l'éditeur ; le serveur normalise (≤ 15,
// dates ISO, montants > 0) et borne le report dérivé au RAF (aucune incohérence même en cas de dérive). ---
exports.setBillingMilestones = onCallG("setBillingMilestones", { memoryMiB: 512, timeoutSeconds: 300 }, async (req) => {
  await requireWrite(req, "backlog"); // gouverné par la matrice (module « backlog »)
  const { fpKey } = require("./lib/ids");
  const { safeId } = require("./lib/sheets");
  const { normalizeMilestones } = require("./domain/milestones");
  const fp = fpKey(req.data?.fp);
  if (!fp) throw new HttpsError("invalid-argument", "N° FP de la commande requis");
  const milestones = normalizeMilestones(req.data?.milestones);
  // GARDE Σ jalons ≤ CAS/RAF (audit backlog M3) : la règle « Σ = RAF » n'était tenue qu'à l'ÉDITEUR — un
  // appel direct du callable persistait des jalons arbitraires qui gonflaient billingTrend/relancesJalons.
  // Bornes serveur : jamais au-delà du CAS de la commande, ni du RAF curaté s'il existe (tolérance 1 XOF
  // d'arrondi). Commande introuvable (jalons posés en avance d'un import) : tolérée, le recompute écarte
  // déjà les jalons sans commande active.
  {
    const ordSnap = await db.doc(`orders/${safeId(fp)}`).get();
    if (ordSnap.exists) {
      const o = ordSnap.data() || {};
      const total = milestones.reduce((s, m) => s + m.amount, 0);
      const cas = Number(o.cas);
      if (Number.isFinite(cas) && cas > 0 && total > cas + 1) throw new HttpsError("invalid-argument", `Σ jalons (${Math.round(total)}) supérieure au CAS de la commande (${Math.round(cas)})`);
      const raf = Number(o.raf);
      if (o.raf != null && Number.isFinite(raf) && raf >= 0 && total > raf + 1) throw new HttpsError("invalid-argument", `Σ jalons (${Math.round(total)}) supérieure au RAF curaté (${Math.round(raf)}) — réajustez le RAF d'abord`);
    }
  }
  await db.doc(`billingMilestones/${safeId(fp)}`).set({ fp, milestones, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  await db.collection("auditLog").add({
    uid: req.auth.uid, action: "billing_milestones", module: "backlog",
    entity: "milestones", entityId: fp, detail: { count: milestones.length, total: milestones.reduce((s, m) => s + m.amount, 0), firstDate: milestones[0] ? milestones[0].date : null, lastDate: milestones.length ? milestones[milestones.length - 1].date : null }, ts: FieldValue.serverTimestamp(),
  });
  // 'atterrissage' (report N+1 + tendance de facturation) ET 'news' : sinon l'Actualité (retard de
  // facturation vs jalons, trajectoire) ne se rafraîchissait pas après une édition de jalons.
  // 'relances' inclus (cf. audit cycle de vie) : les jalons pilotent summaries/relancesJalons (jalons échus
  // non facturés) ; sans lui, éditer les jalons ne rafraîchissait pas le plan de relance sur échéances.
  await refreshNowBestEffort("setBillingMilestones", ["atterrissage", "news", "relances"]);
  return { ok: true, fp, milestones };
});

// --- Objectifs annuels (CAS / Facturé / Marge, par périmètre global|bu|commercial|client). Écriture
// SERVEUR uniquement (règle Firestore objectives = write:false) : validation + audit + recompute, comme
// creditLines / billingMilestones. L'écriture directe SDK est fermée → plus de donnée d'objectif posée
// sans contrôle ni journal. Droit « objectifs ». Recompute des summaries qui lisent objectives (needObj :
// atterrissage / ams / pipeline / news / alerts) → R/O et écarts d'objectif se rafraîchissent. ---
// Objectifs (R/O CODIR) EXTRAITS dans handlers/objectives.js (patron R3). Deps injectées ; exports
// déclarés ici (garde-fou de déploiement par nom).
const { createObjectives } = require("./handlers/objectives");
const _objectives = createObjectives({ onCallG, HttpsError, db, FieldValue, requireWrite, assertPlainId, requestRecompute });
exports.upsertObjective = _objectives.upsertObjective;
exports.deleteObjective = _objectives.deleteObjective;

// --- Notifications d'alerte (webhook entrant Slack/Teams : POST JSON {text}). L'URL vit dans
// config/notifications (lecture réservée aux habilitations) ; sans URL/désactivé, tout no-op. ---
async function postWebhook(url, text) {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) });
  if (!res.ok) throw new Error(`webhook HTTP ${res.status}`);
}

// --- NOTIFICATIONS EMAIL (Office 365 / Microsoft Graph). config/emailNotify (direction) + secret client
// dans Secret Manager (GRAPH_CLIENT_SECRET). Envoi BEST-EFFORT (n'échoue jamais l'action appelante). ---
async function loadEmailCfg() {
  const { normalizeEmailConfig } = require("./domain/emailNotify");
  return normalizeEmailConfig((await db.doc("config/emailNotify").get()).data());
}
// Envoie un email via Graph si la config est prête ET le secret présent. Retourne un statut (jamais throw
// si `soft`). `to` : string|liste. Journalise les échecs dans opsLog (observabilité).
async function sendEmail(cfg, { to, subject, html, cc }, { soft = true } = {}) {
  const { canSend } = require("./domain/emailNotify");
  const secret = GRAPH_CLIENT_SECRET.value();
  if (!canSend(cfg) || !secret) return { ok: false, skipped: "not-configured" };
  const { sendMail } = require("./lib/graphMail");
  try {
    return await sendMail({ tenant: cfg.tenantId, clientId: cfg.clientId, clientSecret: secret, sender: cfg.sender, to, subject, html, cc });
  } catch (e) {
    logger.error("email: envoi échoué", { message: e && e.message });
    await logOps({ kind: "email", trigger: "envoi", status: "error", error: (e && e.message) || String(e) });
    if (soft) return { ok: false, error: (e && e.message) || String(e) };
    throw e;
  }
}

// Config des notifications email — DIRECTION uniquement. Ne stocke JAMAIS le secret client (Secret Manager).
exports.setEmailNotifyConfig = onCallG("setEmailNotifyConfig", { timeoutSeconds: 30 }, async (req) => {
  if (req.auth?.token?.nt360Role !== "direction") throw new HttpsError("permission-denied", "admin requis");
  await requireStrongAuth(req); // MFA sur la config des notifications (tenant/expéditeur email direction)
  const { normalizeEmailConfig } = require("./domain/emailNotify");
  const cfg = normalizeEmailConfig(req.data);
  await db.doc("config/emailNotify").set(cfg, { merge: true });
  await db.collection("auditLog").add({
    uid: req.auth.uid, action: "email_config", module: "habilitations", entity: "config", entityId: "emailNotify",
    detail: { enabled: cfg.enabled, sender: cfg.sender, tenant: !!cfg.tenantId, alerts: cfg.recipients.alerts.length, codir: cfg.recipients.codir.length }, ts: FieldValue.serverTimestamp(),
  });
  return { ok: true };
});

// Envoi d'un email de TEST (valide l'app Azure + le secret de bout en bout). Direction. Remonte l'échec.
exports.sendTestEmail = onCallG("sendTestEmail", { secrets: [GRAPH_CLIENT_SECRET], timeoutSeconds: 60 }, async (req) => {
  if (req.auth?.token?.nt360Role !== "direction") throw new HttpsError("permission-denied", "admin requis");
  const { isEmail } = require("./domain/emailNotify");
  const cfg = await loadEmailCfg();
  const to = String(req.data?.to || "").trim();
  if (!isEmail(to)) throw new HttpsError("invalid-argument", "adresse de test invalide");
  if (!cfg.tenantId || !cfg.clientId || !cfg.sender) throw new HttpsError("failed-precondition", "config incomplète (tenant / client / émetteur)");
  if (!GRAPH_CLIENT_SECRET.value()) throw new HttpsError("failed-precondition", "secret GRAPH_CLIENT_SECRET absent (Secret Manager)");
  const r = await sendEmail({ ...cfg, enabled: true }, { to, subject: "nt360 — test de notification email", html: "<p>✅ La configuration email Office 365 fonctionne. Cet email confirme que nt360 peut envoyer via Microsoft Graph.</p>" }, { soft: false });
  await db.collection("auditLog").add({ uid: req.auth.uid, action: "email_test", module: "habilitations", entity: "config", entityId: "emailNotify", detail: { to }, ts: FieldValue.serverTimestamp() });
  return { ok: true, ...r };
});

// Codes HttpsError « attendus » (rejets de validation/autorisation) : ne PAS les traiter comme des
// incidents. Tout le reste = échec inattendu → journalisé dans opsLog + alerte webhook.
const EXPECTED_ERR = new Set(["invalid-argument", "permission-denied", "unauthenticated", "failed-precondition", "not-found", "already-exists"]);

// Enveloppe un handler onCall : capture les échecs INATTENDUS (observabilité), les trace dans
// opsLog et, si un webhook est configuré, envoie une alerte de crash — puis re-propage l'erreur.
// Seuil de LATENCE au-delà duquel un callable est jugé « lent » et tracé (observabilité SLA — R5). Un
// Directeur des Opérations a besoin de voir les appels qui dérivent avant qu'ils ne deviennent des pannes.
const SLOW_CALLABLE_MS = 8_000;
function guarded(action, handler) {
  return async (req) => {
    const t0 = Date.now();
    try {
      const out = await handler(req);
      // Succès : on ne journalise QUE les appels anormalement lents (pas de bruit sur le chemin nominal),
      // avec leur durée → signal de latence exploitable dans Cloud Logging + collection ops.
      const ms = Date.now() - t0;
      if (ms >= SLOW_CALLABLE_MS) {
        logger.warn(`${action} lent`, { action, durationMs: ms, uid: (req.auth && req.auth.uid) || null });
        await logOps({ kind: "callable", action, status: "slow", uid: (req.auth && req.auth.uid) || null, durationMs: ms });
      }
      return out;
    } catch (e) {
      if (e && e.code && EXPECTED_ERR.has(e.code)) throw e; // rejet métier normal → pas un incident
      const msg = (e && e.message) || String(e);
      const durationMs = Date.now() - t0;
      logger.error(`${action} a échoué`, { action, message: msg, durationMs, stack: e && e.stack });
      await logOps({ kind: "callable", action, status: "error", uid: (req.auth && req.auth.uid) || null, error: msg, durationMs });
      try {
        const cfg = (await db.doc("config/notifications").get()).data();
        if (cfg && cfg.enabled && cfg.webhookUrl) await postWebhook(cfg.webhookUrl, `⚠️ nt360 — échec de « ${action} » : ${msg}`);
      } catch (_) { /* alerte best-effort */ }
      throw e;
    }
  };
}

// onCall enveloppé par guarded() (observabilité). Supporte onCall(handler) ET onCall(opts, handler).
// Fonction DÉCLARÉE (hoistée) car utilisée par des exports définis plus haut dans le fichier.
//
// App Check (F8) — ENFORCEMENT côté serveur, piloté par la variable d'environnement APPCHECK_ENFORCE.
// OFF par défaut : activer (APPCHECK_ENFORCE=true) UNIQUEMENT une fois la clé reCAPTCHA v3 déployée
// au client (VITE_APPCHECK_SITE_KEY) ET App Check enregistré dans la console Firebase — sinon TOUS
// les appels callables seraient rejetés. Le drapeau est lu au chargement, à l'enregistrement de
// chaque callable ; il permet de basculer par simple variable d'env, sans modifier le code.
function onCallG(action, opts, handler) {
  if (typeof opts === "function") { handler = opts; opts = {}; }
  // enforceAppCheck ajouté quand le drapeau est actif ; un opts explicite reste prioritaire.
  const merged = process.env.APPCHECK_ENFORCE === "true" ? { enforceAppCheck: true, ...opts } : opts;
  return onCall(merged, guarded(action, handler));
}

// Autorisation d'ÉCRITURE d'un callable, GOUVERNÉE PAR LA MATRICE OPPOSABLE (config/permissions) —
// même source que les Security Rules et le front. Révoquer un droit dans Habilitations a donc un
// effet RÉEL sur les mutations serveur. `direction` = superviseur (write partout). Lève sinon.
async function requireWrite(req, module) {
  if (!req.auth) throw new HttpsError("unauthenticated", "connexion requise");
  const role = req.auth.token?.nt360Role;
  if (role === "direction") return;
  const { canWrite } = require("./domain/authz");
  const matrix = ((await db.doc("config/permissions").get()).data() || {}).matrix || {};
  if (!canWrite(matrix, role, module)) throw new HttpsError("permission-denied", `droit d'écriture « ${module} » requis`);
}

// Autorisation de LECTURE d'un callable (même matrice opposable) : pour les callables qui ne mutent
// rien mais exposent des données gouvernées par un module (ex. dossier de rapprochement client).
async function requireRead(req, module) {
  if (!req.auth) throw new HttpsError("unauthenticated", "connexion requise");
  const role = req.auth.token?.nt360Role;
  if (role === "direction") return;
  const { canRead } = require("./domain/authz");
  const matrix = ((await db.doc("config/permissions").get()).data() || {}).matrix || {};
  if (!canRead(matrix, role, module)) throw new HttpsError("permission-denied", `droit de lecture « ${module} » requis`);
}

// --- Matrice de droits : édition via CALLABLE validé + audité (jamais en écriture directe). RÉSERVÉ
// À LA DIRECTION : réécrire la matrice = pouvoir s'auto-accorder « write » partout (escalade). On
// aligne donc sa garde sur les autres actions Habilitations (création de compte, rôle, configs), qui
// sont toutes direction-only — plutôt que sur requireWrite('habilitations') qui l'ouvrirait à un
// délégataire. Valide le schéma avant écriture (une matrice malformée casserait level() pour tous). ---
exports.setPermissions = onCallG("setPermissions", async (req) => {
  if (req.auth?.token?.nt360Role !== "direction") throw new HttpsError("permission-denied", "admin requis");
  await requireStrongAuth(req); // MFA sur la réécriture de la matrice de droits (octroi de privilège majeur)
  const { validateMatrix } = require("./domain/authz");
  const matrix = req.data?.matrix;
  const v = validateMatrix(matrix);
  if (!v.ok) throw new HttpsError("invalid-argument", `matrice invalide : ${v.error}`);
  await db.doc("config/permissions").set({ matrix }, { merge: true });
  await db.collection("auditLog").add({
    uid: req.auth.uid, action: "perm_matrix", module: "habilitations",
    entity: "config", entityId: "permissions", detail: { roles: Object.keys(matrix).length }, ts: FieldValue.serverTimestamp(),
  });
  return { ok: true };
});

exports.setNotificationConfig = onCallG("setNotificationConfig", { timeoutSeconds: 30 }, async (req) => {
  if (req.auth?.token?.nt360Role !== "direction") throw new HttpsError("permission-denied", "admin requis");
  const d = req.data || {};
  const url = String(d.webhookUrl || "").trim();
  if (url && !/^https:\/\//i.test(url)) throw new HttpsError("invalid-argument", "URL webhook invalide (https requis)");
  const cfg = { enabled: !!d.enabled, minSeverity: d.minSeverity === "medium" ? "medium" : "high", webhookUrl: url };
  await db.doc("config/notifications").set(cfg, { merge: true });
  await db.collection("auditLog").add({
    uid: req.auth.uid, action: "notif_config", module: "habilitations", entity: "config", entityId: "notifications",
    detail: { enabled: cfg.enabled, minSeverity: cfg.minSeverity, hasUrl: !!url }, ts: FieldValue.serverTimestamp(),
  });
  // Test immédiat (remonte l'échec à l'UI) — ne journalise jamais l'URL.
  if (d.test && url) await postWebhook(url, "✅ nt360 — test de notification : le webhook fonctionne.");
  return { ok: true };
});

// Digest quotidien : pousse les alertes ≥ seuil vers le webhook, dédupliqué (n'envoie que si
// l'ensemble des alertes a changé depuis le dernier envoi).
const SEV_RANK = { high: 0, medium: 1, low: 2 };
exports.alertDigest = onSchedule({ schedule: "every day 07:00", secrets: [GRAPH_CLIENT_SECRET], timeoutSeconds: 60 }, async () => {
  const cfg = (await db.doc("config/notifications").get()).data() || {};
  const al = (await db.doc("summaries/alerts").get()).data() || {};
  const emailCfg = await loadEmailCfg();
  const emailOn = emailCfg.enabled && emailCfg.triggers.alerts && emailCfg.recipients.alerts.length;
  // Rien à faire si NI webhook NI email ne sont configurés.
  if ((!cfg.enabled || !cfg.webhookUrl) && !emailOn) return;
  const minRank = (cfg.minSeverity === "medium") ? 1 : 0;
  const crit = (al.items || []).filter((a) => (SEV_RANK[a.severity] ?? 9) <= minRank);
  if (!crit.length) return;
  const hash = crit.map((a) => `${a.type}:${a.count}`).join("|");
  if (hash === cfg.lastHash) return; // déjà notifié (webhook ET email), rien de nouveau
  const text = `⚠️ nt360 — Alertes (exercice ${al.fy || ""})\n` + crit.map((a) => `• ${a.message}`).join("\n");
  let webhookOk = true;
  try {
    if (cfg.enabled && cfg.webhookUrl) await postWebhook(cfg.webhookUrl, text);
    await logOps({ kind: "notification", trigger: "planifié", status: "ok", detail: { count: crit.length } });
  } catch (e) {
    webhookOk = false;
    logger.error("alertDigest webhook a échoué", { message: e && e.message });
    await logOps({ kind: "notification", trigger: "planifié", status: "error", error: (e && e.message) || String(e) });
  }
  // Email direction (best-effort, indépendant du webhook).
  let emailOk = false;
  if (emailOn) {
    const { buildAlertsEmail } = require("./domain/emailNotify");
    const mail = buildAlertsEmail(crit, al.fy);
    const r = await sendEmail(emailCfg, { to: emailCfg.recipients.alerts, subject: mail.subject, html: mail.html });
    emailOk = !!(r && r.ok);
  }
  // On ne mémorise le hash (anti-répétition) que si un canal RÉELLEMENT tenté a RÉUSSI. Tester `emailOn`
  // (config présente) au lieu du succès d'envoi supprimait silencieusement les alertes : un échec transitoire
  // Graph mémorisait quand même le hash → l'email n'était jamais renvoyé tant que le jeu d'alertes ne changeait pas.
  const webhookAttempted = !!(cfg.enabled && cfg.webhookUrl);
  if ((webhookAttempted && webhookOk) || emailOk) await db.doc("config/notifications").set({ lastHash: hash, lastSentAt: FieldValue.serverTimestamp() }, { merge: true });
});

// Digest EMAIL des RELANCES (quotidien) : à chaque responsable (commercial), la liste de ses créances
// échues / BC en retard / jalons non facturés. Best-effort par destinataire. Nécessite l'annuaire (email).
exports.emailRelancesDigest = onSchedule({ schedule: "every day 07:15", secrets: [GRAPH_CLIENT_SECRET], timeoutSeconds: 120 }, async () => {
  const cfg = await loadEmailCfg();
  if (!cfg.enabled || !cfg.triggers.relances) return;
  const { buildRelancesEmail, emailForName } = require("./domain/emailNotify");
  const [cre, bc, jal] = await Promise.all([
    db.doc("summaries/relancesCreances").get(), db.doc("summaries/relancesBc").get(), db.doc("summaries/relancesJalons").get(),
  ]);
  // Regroupe par responsable via `byResp` (agrégats COMPLETS par `am`) et NON via `items` (tronqués à 200
  // par ancienneté) : sinon un responsable dont toutes les créances tombent au-delà du top-200 ne recevait
  // AUCUN email, et les présents avaient des compteurs/montants sous-évalués.
  const byWho = new Map();
  const ensure = (who) => { if (!byWho.has(who)) byWho.set(who, { creances: { count: 0, total: 0 }, bc: { count: 0, total: 0 }, jalons: { count: 0, total: 0 } }); return byWho.get(who); };
  const applyResp = (snap, key) => { for (const r of ((snap.data() || {}).byResp) || []) { const who = r.key; if (!who || who === "—") continue; ensure(who)[key] = { count: r.count || 0, total: r.total || 0 }; } };
  applyResp(cre, "creances"); applyResp(bc, "bc"); applyResp(jal, "jalons");
  if (!byWho.size) return;
  // Annuaire nom→email (normalisé).
  const usersByName = {};
  (await db.collection("users").select("name", "email").get()).forEach((d) => { const n = (d.data().name || "").toLowerCase().trim(); if (n) usersByName[n] = { email: d.data().email }; });
  let sent = 0, skipped = 0;
  for (const [who, g] of byWho) {
    const to = emailForName(who, usersByName);
    if (!to) { skipped++; continue; }
    const mail = buildRelancesEmail(who, g);
    const r = await sendEmail(cfg, { to, subject: mail.subject, html: mail.html });
    if (r.ok) sent++; else skipped++;
  }
  await logOps({ kind: "email", trigger: "relances", status: "ok", detail: { sent, skipped, responsables: byWho.size } });
});

// Digest EMAIL du bulletin CODIR (hebdomadaire, lundi) : faits marquants de la veille → direction.
exports.emailCodirDigest = onSchedule({ schedule: "every monday 08:00", secrets: [GRAPH_CLIENT_SECRET], timeoutSeconds: 120 }, async () => {
  const cfg = await loadEmailCfg();
  if (!cfg.enabled || !cfg.triggers.codir || !cfg.recipients.codir.length) return;
  const { buildCodirEmail } = require("./domain/emailNotify");
  const news = (await db.doc("summaries/news").get()).data() || {};
  const bulletins = (news.bulletins || []).filter((b) => b.severity !== "info"); // faits marquants (hors info)
  const mail = buildCodirEmail(bulletins, `Synthèse hebdomadaire — ${bulletins.length} fait(s) marquant(s).`);
  const r = await sendEmail(cfg, { to: cfg.recipients.codir, subject: mail.subject, html: mail.html });
  await logOps({ kind: "email", trigger: "codir", status: r.ok ? "ok" : "error", detail: { bulletins: bulletins.length, recipients: cfg.recipients.codir.length }, error: r.error });
});

// Digest QUOTIDIEN du RISQUE des contrats de maintenance (Lot 5) : direction (digest global via `codir`)
// + chaque AM (ses contrats à risque, nom→email via l'annuaire). VERROUILLÉ par le drapeau
// config/mntFeature : éteint (défaut) ⇒ no-op STRICT (aucune lecture mnt_*, aucun email) — « éteint =
// ERP d'avant » (C7/C8/C10). Planifié après le recompute + les autres digests (07:00–07:15).
exports.mntSlaSweep = onSchedule({ schedule: "every day 07:30", secrets: [GRAPH_CLIENT_SECRET], timeoutSeconds: 120 }, async () => {
  const { isMntEnabled } = require("./domain/mntFeature");
  const mntCfg = (await db.doc("config/mntFeature").get()).data();
  if (!isMntEnabled(mntCfg)) return; // module éteint → rien
  const cfg = await loadEmailCfg();
  if (!cfg.enabled || !cfg.triggers.maintenance) return;
  const risque = (await db.doc("summaries/mnt_risque").get()).data() || {};
  const items = (risque.items || []).filter((i) => i && i.niveau !== "vert"); // Ambre et plus
  if (!items.length) return;
  const { buildMntRisqueEmail, emailForName } = require("./domain/emailNotify");
  // Digest DIRECTION (global) — réutilise la liste de destinataires « codir » (direction/CODIR).
  let sentDir = 0;
  if (cfg.recipients.codir.length) {
    const mail = buildMntRisqueEmail(items, "direction");
    const r = await sendEmail(cfg, { to: cfg.recipients.codir, subject: mail.subject, html: mail.html });
    if (r.ok) sentDir += 1;
  }
  // Digest par AM — chacun reçoit SES contrats à risque (résolution nom→email via l'annuaire users).
  const usersByName = {};
  (await db.collection("users").select("name", "email").get()).forEach((d) => { const n = (d.data().name || "").toLowerCase().trim(); if (n) usersByName[n] = { email: d.data().email }; });
  const byAm = new Map();
  for (const it of items) { const who = it.am; if (!who) continue; if (!byAm.has(who)) byAm.set(who, []); byAm.get(who).push(it); }
  let sentAm = 0, skipped = 0;
  for (const [who, list] of byAm) {
    const to = emailForName(who, usersByName);
    if (!to) { skipped += 1; continue; }
    const mail = buildMntRisqueEmail(list, who);
    const r = await sendEmail(cfg, { to, subject: mail.subject, html: mail.html });
    if (r.ok) sentAm += 1; else skipped += 1;
  }
  await logOps({ kind: "email", trigger: "maintenance", status: "ok", detail: { direction: sentDir, am: sentAm, skipped, contrats: items.length } });
});

// --- RELANCES PARTENARIATS (par_) — digest quotidien : assignations de certification à relancer (par
// MANAGER, résolution managerUid→email) + renouvellements de certifs à venir (digest DIRECTION). DOUBLE
// gate d'extinction comme mntSlaSweep : drapeau config/parFeature ALLUMÉ, puis config/emailNotify activée
// + trigger `partenariats`. Éteint = no-op strict. Lit summaries/par_relances + par_alerts (produits au
// recompute 05:00 ; planifié après pour lire des summaries frais). Best-effort (sendEmail soft). ADR-P08.
exports.parRelancesSweep = onSchedule({ schedule: "every day 07:45", secrets: [GRAPH_CLIENT_SECRET], timeoutSeconds: 120 }, async () => {
  const { isParEnabled } = require("./domain/parFeature");
  const parCfg = (await db.doc("config/parFeature").get()).data();
  if (!isParEnabled(parCfg)) return; // module éteint → rien (aucune lecture par_*)
  const cfg = await loadEmailCfg();
  if (!cfg.enabled || !cfg.triggers.partenariats) return;
  const rel = (await db.doc("summaries/par_relances").get()).data() || {};
  const alerts = (await db.doc("summaries/par_alerts").get()).data() || {};
  const relItems = rel.items || [], alertItems = alerts.items || [];
  if (!relItems.length && !alertItems.length) return;
  const { buildParManagerEmail, buildParDirectionEmail, groupParRelancesByManager, groupParAlertsByManager } = require("./domain/emailNotify");
  // Digest DIRECTION — vue d'ensemble (relances + renouvellements), réutilise la liste « codir ».
  let sentDir = 0;
  if (cfg.recipients.codir.length) {
    const mail = buildParDirectionEmail(relItems, alertItems);
    const r = await sendEmail(cfg, { to: cfg.recipients.codir, subject: mail.subject, html: mail.html });
    if (r.ok) sentDir += 1;
  }
  // Digest par MANAGER — chacun reçoit SES assignations à relancer ET SES renouvellements de certif à venir
  // (PA4 : par_alerts porte désormais managerUid). Résolution uid→email (patron approbations). Union des
  // managers concernés par l'une OU l'autre liste → un seul email par manager.
  const byUid = {};
  (await db.collection("users").select("email", "name").get()).forEach((d) => { const e = d.data().email; if (e) byUid[d.id] = { email: e, name: d.data().name || "" }; });
  const relByMgr = new Map(groupParRelancesByManager(relItems).map((g) => [g.managerUid, g.items]));
  const alByMgr = new Map(groupParAlertsByManager(alertItems).map((g) => [g.managerUid, g.items]));
  let sentMgr = 0, skipped = 0;
  for (const managerUid of new Set([...relByMgr.keys(), ...alByMgr.keys()])) {
    const u = byUid[managerUid];
    if (!u || !u.email) { skipped += 1; continue; }
    const mail = buildParManagerEmail(u.name, relByMgr.get(managerUid) || [], alByMgr.get(managerUid) || []);
    const r = await sendEmail(cfg, { to: u.email, subject: mail.subject, html: mail.html });
    if (r.ok) sentMgr += 1; else skipped += 1;
  }
  await logOps({ kind: "email", trigger: "partenariats", status: "ok", detail: { direction: sentDir, managers: sentMgr, skipped, relances: relItems.length, renouvellements: alertItems.length } });
});

// --- CURATION DE LA VEILLE (agent LLM) — score la PERTINENCE de chaque TYPE de bulletin d'actualité
// pour filtrer le bruit « avant publication ». Confidentialité par CONSTRUCTION : on n'envoie à l'API
// QUE des signaux dé-identifiés (clé + libellé générique du catalogue + domaine + sévérité), jamais le
// texte réel (noms clients/AM/fournisseurs, N° FP/BC/facture, montants). Écrit un doc de SCORES par
// type (summaries/newsCuration, module overview) que le front joint au fil pour trier/masquer. ---
async function runNewsCuration(uid) {
  const apiKey = ANTHROPIC_API_KEY.value();
  if (!apiKey) {
    await logOps({ kind: "scheduled", action: "curateNews", status: "skipped", uid: uid || null, detail: { reason: "ANTHROPIC_API_KEY non configuré" } });
    return { ok: false, skipped: true };
  }
  const { buildSignals, CURATION_THRESHOLD } = require("./domain/newsCuration");
  const { scoreSignals } = require("./lib/anthropic");
  // Bulletins ACTIFS = union des 6 docs news* (cloisonnés). Sert à connaître les types en vigueur ;
  // buildSignals part du catalogue complet et enrichit avec ces bulletins (domaine/sévérité réels).
  const NEWS_DOCS = ["news", "newsFacturation", "newsFournisseurs", "newsBacklog", "newsBc", "newsPipeline"];
  const snaps = await Promise.all(NEWS_DOCS.map((d) => db.doc(`summaries/${d}`).get()));
  const bulletins = [];
  for (const s of snaps) { for (const b of ((s.data() || {}).bulletins || [])) bulletins.push(b); }
  const signals = buildSignals(bulletins);
  const activeIds = [...new Set(bulletins.map((b) => b && b.id).filter(Boolean))];
  const { scores, model, usage } = await scoreSignals(apiKey, signals, { threshold: CURATION_THRESHOLD });
  await db.doc("summaries/newsCuration").set({
    scoredAt: FieldValue.serverTimestamp(), model, threshold: CURATION_THRESHOLD,
    signalCount: signals.length, activeIds, scores,
  });
  await logOps({ kind: "scheduled", action: "curateNews", status: "ok", uid: uid || null, detail: { scored: Object.keys(scores).length, active: activeIds.length, model, usage } });
  return { ok: true, scored: Object.keys(scores).length, active: activeIds.length, model };
}

// Planifiée : quotidienne à 05:30 (après le recompute de 05:00 qui régénère les bulletins). Best-effort :
// n'échoue PAS le scheduler si l'API est indisponible (la curation est un raffinement, pas un bloquant).
exports.curateNews = onSchedule({ schedule: "every day 05:30", secrets: [ANTHROPIC_API_KEY], memoryMiB: 256, timeoutSeconds: 120 }, async () => {
  try { await runNewsCuration(); }
  catch (e) {
    logger.error("curateNews a échoué", { message: e && e.message, stack: e && e.stack });
    await logOps({ kind: "scheduled", action: "curateNews", status: "error", error: (e && e.message) || String(e) });
  }
});

// À la demande (Direction) : recalcule la curation immédiatement (test / rafraîchissement). Remonte
// une erreur explicite si le secret n'est pas configuré, pour guider le provisionnement.
exports.curateNewsNow = onCallG("curateNewsNow", { secrets: [ANTHROPIC_API_KEY], memoryMiB: 256, timeoutSeconds: 120 }, async (req) => {
  if (req.auth?.token?.nt360Role !== "direction") throw new HttpsError("permission-denied", "admin requis");
  const r = await runNewsCuration(req.auth.uid);
  if (r.skipped) throw new HttpsError("failed-precondition", "ANTHROPIC_API_KEY non configuré (Secret Manager) — curation indisponible.");
  return r;
});

// --- logLogin : audit de connexion (critère F1) ---
exports.logLogin = onCallG("logLogin", async (req) => {
  if (!req.auth) throw new HttpsError("unauthenticated", "connexion requise");
  // Projet PARTAGÉ : n'accepter QUE les utilisateurs provisionnés nt360 (claim namespacé) — sinon un
  // compte de l'app sœur pourrait injecter dans l'auditLog nt360.
  if (!req.auth.token?.nt360Role) throw new HttpsError("permission-denied", "compte nt360 requis");
  await db.collection("auditLog").add({
    uid: req.auth.uid, action: "login", module: "auth", entity: "session", entityId: req.auth.uid,
    detail: { role: req.auth.token.nt360Role || null, email: req.auth.token.email || null },
    ts: FieldValue.serverTimestamp(),
  });
  return { ok: true };
});

// --- Journal d'ERREURS CLIENT (observabilité front) : capture des erreurs JS non gérées et des
// crashs de rendu côté navigateur, remontées par le front (fenêtre onerror / unhandledrejection /
// ErrorBoundary) → collection errorLog, lisible en Admin. Réservé aux sessions AUTHENTIFIÉES
// (anti-abus). Champs bornés (garde-fou de taille / coût). N'échoue jamais côté client (best-effort). ---
exports.logClientError = onCallG("logClientError", { memoryMiB: 256, timeoutSeconds: 30 }, async (req) => {
  if (!req.auth) throw new HttpsError("unauthenticated", "connexion requise");
  if (!req.auth.token?.nt360Role) throw new HttpsError("permission-denied", "compte nt360 requis"); // projet partagé : pas d'injection par l'app sœur
  // Anti-flood SERVEUR (le plafond client d'errorReporter est contournable) : au-delà de 30 erreurs/min
  // par compte, on abandonne silencieusement (l'appel reste best-effort côté front, jamais bloquant).
  if (!(await rateLimit(req.auth.uid, "clientError", 30, 60_000))) return { ok: true, throttled: true };
  const d = req.data || {};
  const s = (v, n) => (v == null ? null : String(v).slice(0, n));
  await db.collection("errorLog").add({
    uid: req.auth.uid,
    role: req.auth.token.nt360Role || null,
    message: s(d.message, 1000) || "(sans message)",
    stack: s(d.stack, 4000),
    url: s(d.url, 500),
    module: s(d.module, 120),
    ua: s(d.ua, 300),
    ts: FieldValue.serverTimestamp(),
  });
  return { ok: true };
});

// --- F3 : recalcul des agrégats à la demande (admin) ---
// Ressources alignées sur importDelta : recomputeAll lit TOUTES les collections et reconstruit
// tous les summaries (boucle sur chaque période) — le défaut 256 MiB / 60 s provoquait un
// timeout/OOM sur un gros volume, surfacé en « Action refusée » côté UI, alors que le même
// recompute lancé APRÈS un import (512 MiB / 300 s) réussissait.
exports.recompute = onCallG("recompute", { secrets: [CLICKUP_TOKEN], memoryMiB: 1024, timeoutSeconds: 300 }, async (req) => {
  if (req.auth?.token?.nt360Role !== "direction") throw new HttpsError("permission-denied", "admin requis");
  if (!(await rateLimit(req.auth.uid, "heavy", 30, 60_000))) throw new HttpsError("resource-exhausted", "Trop d'opérations lourdes en peu de temps — patientez un instant.");
  const { recomputeAll } = require("./lib/aggregate");
  const t0 = Date.now();
  try {
    const res = await recomputeAll(db, req.data?.only);
    await logOps({ kind: "recompute", trigger: "manuel", status: "ok", ms: Date.now() - t0, uid: req.auth.uid, detail: { summaries: res.written.length, currentFy: res.currentFy } });
    await maybeSyncCaf("recompute"); // entretien CAF→ClickUp (best-effort, uniquement les CAF changés)
    return { ok: true, ...res };
  } catch (e) {
    // Sans ce wrap, une exception non-HttpsError est renvoyée au client en « internal » SANS
    // message (masqué par sécurité). On journalise la stack complète et on re-propage le motif
    // réel pour qu'il soit diagnosticable côté UI.
    logger.error("recompute a échoué", { message: e && e.message, stack: e && e.stack });
    await logOps({ kind: "recompute", trigger: "manuel", status: "error", ms: Date.now() - t0, uid: req.auth?.uid || null, error: (e && e.message) || String(e) });
    throw new HttpsError("internal", `recompute : ${(e && e.message) || e}`);
  }
});

// --- Recompute PLANIFIÉ quotidien : garantit des agrégats jamais datés, indépendamment des
// imports/sync. Trace succès et échecs dans opsLog (observabilité). ---
exports.scheduledRecompute = onSchedule({ schedule: "every day 05:00", secrets: [CLICKUP_TOKEN], memoryMiB: 512, timeoutSeconds: 300 }, async () => {
  const { recomputeAll } = require("./lib/aggregate");
  const t0 = Date.now();
  try {
    const res = await recomputeAll(db);
    await logOps({ kind: "recompute", trigger: "planifié", status: "ok", ms: Date.now() - t0, detail: { summaries: res.written.length, currentFy: res.currentFy } });
    await maybeSyncCaf("scheduledRecompute"); // entretien CAF→ClickUp (best-effort)
    // Automatisation déclarative (Lot 4b) : génère les tâches manquantes (best-effort, n'échoue pas le planifié).
    try { const a = await runAutomationsCore(null); if (a.created) await logOps({ kind: "automations", trigger: "planifié", status: "ok", detail: a }); }
    catch (e) { logger.warn("runAutomations (planifié) a échoué", { message: e && e.message }); }
  } catch (e) {
    logger.error("scheduledRecompute a échoué", { message: e && e.message, stack: e && e.stack });
    await logOps({ kind: "recompute", trigger: "planifié", status: "error", ms: Date.now() - t0, error: (e && e.message) || String(e) });
    throw e;
  }
});

// --- F6 : Sync Sales_DATA quotidien (Cloud Scheduler) ---
async function runSalesSync(objectKey) {
  const { applySalesSync } = require("./lib/sync");
  const key = objectKey || "sync/sales_data.xlsx";
  const file = getStorage().bucket(IMPORTS_BUCKET).file(key);
  const [exists] = await file.exists();
  if (!exists) { logger.warn("syncSalesData: fichier absent", { key }); return { skipped: true, key }; }
  const [buf] = await file.download();
  const wb = await readWorkbook(buf);
  const res = await applySalesSync(db, wb);
  // Recompute BEST-EFFORT (blindage) : la synchro (applySalesSync) a DÉJÀ écrit les opps — un échec du
  // recalcul ne doit pas faire échouer la synchro (le prochain recompute rattrape). Recalcul complet car une
  // opp gagnée peut devenir commande (CAS/backlog/rentabilité).
  try {
    const { recomputeAll } = require("./lib/aggregate");
    await recomputeAll(db);
  } catch (re) {
    logger.error("syncSalesData : recompute post-synchro échoué — opps synchronisées, agrégats au prochain recompute", { message: re && re.message });
  }
  logger.info("syncSalesData", res);
  return res;
}

// Forme-OBJET obligatoire pour porter le budget : runSalesSync() lance un recomputeAll COMPLET, que le
// défaut 60 s / 256 MiB de la forme-chaîne faisait échouer à l'échelle (timeout/OOM, cf. audit intégral O1).
exports.syncSalesData = onSchedule({ schedule: "every day 06:00", memoryMiB: 512, timeoutSeconds: 300 }, async () => {
  try {
    const res = await runSalesSync();
    // Trace de SUCCÈS queryable (comme scheduledFirestoreExport) : sans elle, seul l'échec laissait une
    // trace → un sync qui ne tourne plus était indétectable. Un dernier opsLog ok manquant/périmé = signal.
    await logOps({ kind: "scheduled", action: "syncSalesData", status: "ok", detail: res || {} });
  } catch (e) {
    logger.error("syncSalesData a échoué", { message: e && e.message, stack: e && e.stack });
    await logOps({ kind: "scheduled", action: "syncSalesData", status: "error", error: (e && e.message) || String(e) });
    throw e;
  }
});

// --- Import de delta à la demande : fichier XLSX (modèle Facturation DF / P&L / LIVE)
// envoyé en base64 par l'UI. Réutilise le parsing testé (buildWrites), upsert idempotent
// par ID déterministe (un delta partiel se fusionne), journalise puis recalcule. ---
// Capacité d'IMPORT / fiabilisation (importDelta, setInvoiceFp, patchOrder) gouvernée par le module
// « import » de la matrice opposable (requireWrite) — plus de liste de rôles figée.
// memoryMiB 2048 / timeout 540 : un ZIP de dizaines de classeurs parsés en mémoire (exceljs) dépasse
// 512 Mo → OOM remonté en « internal » côté client. On dimensionne pour un import en lot ; le plafond
// de payload (~22 Mo, ci-dessous) borne l'entrée, et un ZIP énorme reste à découper (import idempotent).
exports.importDelta = onCallG("importDelta", { memoryMiB: 2048, timeoutSeconds: 540 }, async (req) => {
  await requireWrite(req, "import");
  if (!(await rateLimit(req.auth.uid, "heavy", 30, 60_000))) throw new HttpsError("resource-exhausted", "Trop d'imports en peu de temps — patientez un instant.");
  const b64 = req.data?.fileB64;
  const filename = String(req.data?.filename || "delta.xlsx");
  if (!b64 || typeof b64 !== "string") throw new HttpsError("invalid-argument", "fichier requis (fileB64)");
  // Plafond de charge côté SERVEUR (défense en profondeur : le garde-fou UI ~20 Mo est contournable).
  // ~30 M caractères base64 ≈ 22 Mo bruts, sous la limite d'appel ~32 Mo et la mémoire allouée.
  if (b64.length > 30_000_000) throw new HttpsError("invalid-argument", "fichier trop volumineux (> ~22 Mo) — divise l'import (ex. ZIP par lots).");
  const buf = Buffer.from(b64, "base64");

  // Parsing partagé (XLSX ou ZIP de classeurs, gardes anti-OOM/anti-bombe) — cf. ./lib/reingest.
  // Une IngestError (entrée fatale) est remontée en HttpsError avec son code d'origine.
  let parsed;
  try { parsed = await parseBuffer(buf, filename); }
  catch (e) { throw new HttpsError(e.code || "invalid-argument", e.message || "fichier illisible"); }
  const { kinds, writes, files, rowsIn, rowsOk, rowsSkipped } = parsed;
  // Refus ACTIONNABLE (constat terrain : « l'import Commandes refuse toujours ») : nommer ce que le fichier
  // porte RÉELLEMENT (onglets + premiers en-têtes, joints par parseBuffer) et les signatures ATTENDUES.
  // Cas fréquent : un EXPORT de l'écran Commandes (colonnes FP/Client/CAS/RAF d'affichage) rejoué en
  // entrée — ce n'est PAS la source P&L (« Opp ID » + « CAS » + « RAF Total ») ; les exports de l'app ne
  // sont pas des sources d'import.
  if (!kinds.length) {
    const seen = (files || [])
      .flatMap((f) => (f.sheets || []).map((s) => `« ${s.sheet} » (${(s.headers || []).join(" · ") || "sans en-têtes"})`))
      .slice(0, 4).join(" ; ");
    throw new HttpsError("failed-precondition",
      `aucune source reconnue dans le fichier${seen ? ` — onglets vus : ${seen}` : ""}. Sources attendues : `
      + "P&L (en-têtes « Opp ID », « CAS », « RAF Total »), LIVE pipeline (« IdC » ou « Statut » + « D Prev »), "
      + "Facturation DF (« Numéro » + « Montant HT »), PO List BC (« N° BC » + « Fournisseur »), ou une Fiche d'affaire. "
      + "NB : un fichier EXPORTÉ depuis un écran de l'application n'est pas ré-importable — repartez du classeur source.");
  }

  // LIVE écarté du canal delta (cf. stripLiveOpps) : les opportunités ne sont écrites QUE par la synchro
  // Sales_DATA (staling des fantômes) → un ré-import delta ne peut plus créer de doublon de pipeline.
  const { writes: deltaWrites, skipped: liveSkipped } = stripLiveOpps(writes);
  // Fichier ne contenant QUE la feuille LIVE : après retrait des opps, il ne reste RIEN à écrire → au lieu
  // d'un no-op silencieux (l'utilisateur croit avoir importé), on l'oriente explicitement vers le bon canal.
  if (liveSkipped > 0 && deltaWrites.length === 0) {
    throw new HttpsError("failed-precondition", "Ce fichier ne contient que la feuille LIVE (pipeline), qui ne s'importe pas ici : utilisez la synchro Sales_DATA (bouton « Forcer la synchro »). Les opportunités sont mises à jour par ce canal (avec retrait des affaires disparues).");
  }
  // Taux paramétrés (config/fxRates) appliqués aux lignes logistics « à saisir » sans écraser de correction
  // manuelle (cf. resolveLogisticsFx) — conversion USD/GBP à l'import.
  const fxConverted = await resolveLogisticsFx(db, deltaWrites);
  await applyWrites(db, deltaWrites); // dédup par chemin + upsert + nettoyage des orphelins de fiche (voir applyWrites)

  const report = { kinds, files, rowsIn, rowsOk, rowsSkipped, ...(liveSkipped ? { liveSkipped } : {}), ...(fxConverted ? { fxConverted } : {}) };
  await db.collection("imports").add({
    uid: req.auth.uid, kinds, filename, objectKey: null, mode: "delta",
    rowsIn, rowsOk, rowsSkipped, report, ts: FieldValue.serverTimestamp(),
  });
  await db.collection("auditLog").add({
    uid: req.auth.uid, action: "import_delta", module: "facturation", entity: "delta", entityId: filename,
    detail: { kinds, rowsOk, files: files.length }, ts: FieldValue.serverTimestamp(),
  });

  // Post-traitement BEST-EFFORT (blindage imports) : les données sont DÉJÀ écrites (applyWrites ci-dessus) —
  // un échec du fisc/recompute ne doit PAS transformer un import RÉUSSI en « internal » (même piège que
  // createOrder, cf. recompute best-effort). Recompute DIFFÉRÉ (requestRecompute) comme les autres actions
  // → la réponse revient en quelques secondes quelle que soit la taille du classeur (plus de faux timeout
  // client), les agrégats se rafraîchissent via onRecomputeRequest. Un échec est journalisé, pas remonté.
  try {
    if (kinds.includes("pnl") || kinds.includes("fiche")) await updateFiscalYearFromOrders();
    await recomputeSummaries(); // SYNCHRONE (différé inerte en prod, cf. refreshNowBestEffort) — le try englobant reste best-effort
  } catch (e) {
    logger.error("importDelta : post-traitement (fisc/recompute) échoué — données importées, agrégats au prochain recompute", { message: e && e.message, stack: e && e.stack });
  }
  // `files` = détail PAR fichier (kinds reconnus, lignes OK, erreur éventuelle, byKind) — permet à
  // l'UI d'afficher précisément ce qui a été reconnu et la cause d'un éventuel échec par classeur.
  return { ok: true, kinds, rowsIn, rowsOk, rowsSkipped, fileCount: files.length, files };
});

// --- reingest : re-parse en masse les classeurs SOURCES déjà présents dans gs://nt360, SANS
// re-upload. Utile après une évolution de parseur (ex. nouvel en-tête « Description du Projet »
// reconnu) : l'upsert `merge:true` ÉCRASE les champs recalculés (désignation…) sur l'existant.
// Direction uniquement (opération lourde : lit tout le bucket + recompute complet). Le SA runtime
// des functions a déjà accès au bucket (indépendant du 403 constaté au DÉPLOIEMENT des Storage
// rules). `prefix` optionnel restreint le balayage à un sous-dossier. ---
exports.reingest = onCallG("reingest", { memoryMiB: 1024, timeoutSeconds: 540 }, async (req) => {
  if (req.auth?.token?.nt360Role !== "direction") throw new HttpsError("permission-denied", "admin requis");
  const prefix = req.data?.prefix ? String(req.data.prefix) : undefined;
  const r = await reingestBucket({ db, storage: getStorage(), bucketName: IMPORTS_BUCKET, prefix });
  await db.collection("imports").add({
    uid: req.auth.uid, kinds: r.kinds, filename: `reingest:${prefix || "*"}`, objectKey: `${IMPORTS_BUCKET}/${prefix || ""}`,
    mode: "reingest", rowsIn: r.rowsIn, rowsOk: r.rowsOk, rowsSkipped: r.rowsSkipped, report: r, ts: FieldValue.serverTimestamp(),
  });
  await db.collection("auditLog").add({
    uid: req.auth.uid, action: "reingest", module: "facturation", entity: "storage", entityId: prefix || "*",
    detail: { objectsScanned: r.objectsScanned, objectsIngested: r.objectsIngested, objectsFailed: r.objectsFailed, kinds: r.kinds }, ts: FieldValue.serverTimestamp(),
  });
  return { ok: true, ...r };
});

// --- Fiabilisation : rattacher une facture ORPHELINE à sa commande en corrigeant son N° FP.
// Recalcule ensuite (rattachement, taux de facturation, RAF dérivé des commandes opp/fiche). ---
exports.setInvoiceFp = onCallG("setInvoiceFp", { memoryMiB: 512, timeoutSeconds: 300 }, async (req) => {
  await requireWrite(req, "import");
  const { fpKey } = require("./lib/ids");
  const id = String(req.data?.id || "");
  if (!id) throw new HttpsError("invalid-argument", "id facture requis");
  assertPlainId(id, "id facture");
  const fp = fpKey(req.data?.fp) || null;
  if (!fp) throw new HttpsError("invalid-argument", "N° FP invalide (attendu FP/AAAA/NNNNN)");
  const ref = db.doc(`invoices/${id}`);
  if (!(await ref.get()).exists) throw new HttpsError("not-found", "facture introuvable");
  await ref.set({ fp, linked: true, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  await db.collection("auditLog").add({
    uid: req.auth.uid, action: "set_invoice_fp", module: "facturation", entity: "invoice", entityId: id,
    detail: { fp }, ts: FieldValue.serverTimestamp(),
  });
  await refreshNowBestEffort("setInvoiceFp");
  return { ok: true, id, fp };
});

// --- RÉCONCILIATION DE N° FP : déclare qu'un N° FP « source » (celui d'une opportunité) désigne la MÊME
// commande qu'un N° FP « cible » au P&L. Le FP P&L FAIT FOI (il porte la facturation) → on redirige la
// source vers la cible via un OVERLAY (config/fpAliases), NON destructif et qui SURVIT aux ré-imports LIVE
// (contrairement à une réécriture du FP de l'opp, que la synchro écraserait). L'agrégat applique l'alias
// avant la fusion du carnet (aggregate.js) : l'opp gagnée réconcilie alors la bonne ligne P&L, son CAS
// compte, et factures/BC/fiches saisis sous l'ancien FP se rattachent. `to` vide = SUPPRIME l'alias.
// Réservé au droit « import » (data-steward), audité, recompute complet (impacte tout le carnet). ---
exports.setFpAlias = onCallG("setFpAlias", { memoryMiB: 512, timeoutSeconds: 300 }, async (req) => {
  await requireWrite(req, "import");
  const { fpKey } = require("./lib/ids");
  const from = fpKey(req.data?.from);
  const rawTo = req.data?.to;
  const to = (rawTo === "" || rawTo == null) ? "" : fpKey(rawTo);
  if (!from) throw new HttpsError("invalid-argument", "N° FP source invalide (attendu FP/AAAA/NNNNN)");
  if (rawTo != null && rawTo !== "" && !to) throw new HttpsError("invalid-argument", "N° FP cible invalide (attendu FP/AAAA/NNNNN)");
  const ref = db.doc("config/fpAliases");
  const map = { ...(((await ref.get()).data() || {}).map || {}) };
  if (!to) {
    if (!(from in map)) throw new HttpsError("not-found", "aucun alias sur ce N° FP source");
    delete map[from];
  } else {
    if (to === from) throw new HttpsError("invalid-argument", "N° FP source et cible identiques");
    // Pas de CHAÎNE ni de cible ambiguë : la cible ne doit pas être elle-même redirigée, et la source ne
    // doit pas être déjà une cible (sinon l'ordre de résolution deviendrait ambigu / non idempotent).
    if (map[to]) throw new HttpsError("failed-precondition", `le N° FP cible ${to} est lui-même réconcilié vers ${map[to]} — indiquez le N° FP P&L définitif`);
    if (Object.values(map).includes(from)) throw new HttpsError("failed-precondition", `le N° FP ${from} est déjà la cible d'une réconciliation — il ne peut pas devenir une source`);
    map[from] = to;
  }
  // merge:FALSE (audit intégrité) : `map` est un OBJET ; avec merge:true Firestore fusionne récursivement et
  // les clés retirées en mémoire SURVIVENT en base — un alias « supprimé » continuait d'être appliqué au
  // recompute. Le doc ne contient que {map, updatedAt} → remplacement complet, la suppression prend effet.
  await ref.set({ map, updatedAt: FieldValue.serverTimestamp() }, { merge: false });
  await db.collection("auditLog").add({
    uid: req.auth.uid, action: "set_fp_alias", module: "import", entity: "fpAlias", entityId: from,
    detail: { from, to: to || null }, ts: FieldValue.serverTimestamp(),
  });
  await refreshNowBestEffort("setFpAlias");
  return { ok: true, from, to: to || null, aliasCount: Object.keys(map).length };
});

// --- RAPPROCHEMENT DC → N° FP (BC fournisseur Odoo) : overlay config/dcAliases (ADR-054), MÊME esprit que
// setFpAlias mais keyé par le DC (identifiant propre du BC côté Odoo). Filet quand Odoo envoie un BC sans FP
// résoluble mais avec un DC connu → le handler odooWebhook rattache alors le BC à l'affaire (resolveBcFp).
// NON destructif, survit aux ré-imports. `from` = DC (chaîne libre, on ne canonise pas — format DC inconnu,
// on ne l'invente pas) ; `to` = N° FP (fpKey). `to` vide = SUPPRIME l'alias. Droit « import » (data-steward),
// audité, recompute complet (un BC nouvellement rattaché peut alimenter le carnet coût/SOA). ---
exports.setDcAlias = onCallG("setDcAlias", { memoryMiB: 512, timeoutSeconds: 300 }, async (req) => {
  await requireWrite(req, "import");
  const { fpKey } = require("./lib/ids");
  const from = String(req.data?.from == null ? "" : req.data.from).trim();
  const rawTo = req.data?.to;
  const to = (rawTo === "" || rawTo == null) ? "" : fpKey(rawTo);
  if (!from) throw new HttpsError("invalid-argument", "DC source requis");
  if (rawTo != null && rawTo !== "" && !to) throw new HttpsError("invalid-argument", "N° FP cible invalide (attendu FP/AAAA/NNNNN)");
  const ref = db.doc("config/dcAliases");
  const map = { ...(((await ref.get()).data() || {}).map || {}) };
  if (!to) {
    if (!(from in map)) throw new HttpsError("not-found", "aucun rapprochement sur ce DC");
    delete map[from];
  } else {
    map[from] = to;
  }
  // merge:FALSE (audit intégrité, cf. setFpAlias) : sinon la clé retirée survivrait au merge récursif du champ map.
  await ref.set({ map, updatedAt: FieldValue.serverTimestamp() }, { merge: false });
  await db.collection("auditLog").add({
    uid: req.auth.uid, action: "set_dc_alias", module: "import", entity: "dcAlias", entityId: from,
    detail: { from, to: to || null }, ts: FieldValue.serverTimestamp(),
  });
  await refreshNowBestEffort("setDcAlias");
  return { ok: true, from, to: to || null, aliasCount: Object.keys(map).length };
});

// --- DOSSIER CLIENT (rapprochement) : regroupe Opportunités / Commandes P&L / Factures par CLIENT
// canonique puis par N° FP (alias appliqués), et propose des rapprochements (FP facture prioritaire).
// LECTURE SEULE (aucune mutation) — gouverné par le module « import » (data-steward). Sans `client`,
// renvoie la liste de triage (clients ayant un écart, tri par nb de propositions). Avec `client`,
// renvoie le détail (clusters + propositions). Calcul À LA DEMANDE (pas de recompute) : n'impacte
// pas les agrégats et ne tourne que quand un data-steward ouvre l'écran. ---
exports.reconClient = onCallG("reconClient", { memoryMiB: 512, timeoutSeconds: 120 }, async (req) => {
  await requireRead(req, "import");
  const { reconcileClients } = require("./domain/reconcile");
  const { fpKey } = require("./lib/ids");
  const { buildFpAliasResolver } = require("./lib/ids");
  const { buildClientResolver } = require("./domain/clientName");
  // Lecture ciblée (projection des seuls champs utiles) — payload et mémoire réduits. Scans BORNÉS
  // (R1) sur les TROIS collections (orders/invoices désormais plafonnés comme opps) → mémoire/latence
  // bornées même sur gros volumes ; `capped` remonté pour l'observabilité (troncature JAMAIS silencieuse).
  const { isAgedLost } = require("./domain/oppLifecycle");
  const { safeId } = require("./lib/sheets");
  const [ordSnap, invSnap, oppSnap, aliasDoc, clientDoc, cxlODoc, cxlIDoc] = await Promise.all([
    db.collection("orders").select("fp", "client", "cas", "raf", "source", "affaire", "designation").limit(MAX_SCAN + 1).get(),
    db.collection("invoices").select("fp", "client", "amountHt", "date", "numero", "linked").limit(MAX_SCAN + 1).get(),
    // stale/source/ageDays/probability : requis pour exclure fantômes/périmées et dédupliquer inter-source
    // (assiette ALIGNÉE sur le recompute/correctionQueue — sinon le Dossier client sur-compterait, audit intégrité).
    db.collection("opportunities").select("fp", "client", "amount", "stage", "stageLabel", "designation", "am", "visibleTo", "stale", "source", "ageDays", "probability").limit(MAX_SCAN + 1).get(),
    db.doc("config/fpAliases").get(),
    db.doc("config/clientAliases").get(),
    db.doc("config/cancelOrders").get(),
    db.doc("config/cancelInvoices").get(),
  ]);
  const oCap = sliceCapped(ordSnap.docs), iCap = sliceCapped(invSnap.docs), pCap = sliceCapped(oppSnap.docs);
  let orders = oCap.docs.map((d) => ({ id: d.id, ...d.data() }));
  let invoices = iCap.docs.map((d) => ({ id: d.id, ...d.data() }));
  let opps = pCap.docs.map((d) => d.data());
  const capped = oCap.capped || iCap.capped || pCap.capped;
  // Sécurité par enregistrement : sous OWD « private », un data-steward non-administrateur ne rapproche
  // que les opps de sa ligne hiérarchique (même filtre que les autres lecteurs d'opps — re-audit). Ce
  // filtrage PAR UTILISATEUR interdit un précalcul en summary partagé (fuite hiérarchique) → calcul à la demande.
  if ((await recordAccessOwd("opportunities")) === "private" && !(await isRecordAdmin(req))) {
    opps = opps.filter((o) => Array.isArray(o.visibleTo) && o.visibleTo.includes(req.auth.uid));
  }
  const aliasResolver = buildFpAliasResolver((aliasDoc.data() || {}).map || {});
  const fpKeyOf = (fp) => fpKey(aliasResolver(fp)); // clé FP canonique, alias de réconciliation appliqués
  const normClient = buildClientResolver((clientDoc.data() || {}).pairs || []);
  // ASSIETTE ALIGNÉE sur le recompute (aggregate.js) / le Centre de correction (correctionQueue) — sinon le
  // Dossier client proposait de rapprocher vers un FP ANNULÉ et comptait des opps fantômes/périmées/doublons
  // que le reste du système ignore (audit intégrité, systèmes de correction). Ordre identique : dédup inter-
  // source, puis exclusion fantômes(stale)/périmées(aged), puis annulations (commandes par safeId(fp), factures par id).
  const salesFps = new Set(opps.filter((o) => o.source === "salesData" && fpKeyOf(o.fp)).map((o) => fpKeyOf(o.fp)));
  opps = opps.filter((o) => !(o.source === "saisie" && fpKeyOf(o.fp) && salesFps.has(fpKeyOf(o.fp))));
  opps = opps.filter((o) => o.stale !== true && !isAgedLost(o));
  const itemsOf = (snap) => new Set((((snap.data() || {}).items) || []).map((e) => e && e.id).filter(Boolean));
  const cancelledOrders = itemsOf(cxlODoc), cancelledInvoices = itemsOf(cxlIDoc);
  orders = orders.filter((o) => !cancelledOrders.has(safeId(o.fp)));
  invoices = invoices.filter((i) => !cancelledInvoices.has(i.id));

  const wanted = String(req.data?.client || "").trim();
  if (wanted) {
    // DÉTAIL : on ne rapproche QUE le client demandé (filtrage AMONT par nom canonique) au lieu de
    // construire tous les dossiers pour n'en renvoyer qu'un → coût O(1 client) par ouverture de fiche.
    const target = normClient(wanted);
    const inClient = (r) => normClient(r.client) === target;
    const dossiers = reconcileClients({ orders: orders.filter(inClient), invoices: invoices.filter(inClient), opps: opps.filter(inClient), fpKeyOf, normClient });
    const d = dossiers.find((x) => x.client === target) || dossiers[0] || null;
    return { ok: true, mode: "detail", dossier: d, capped };
  }
  // Triage : uniquement les clients porteurs d'un écart (proposition ou opp gagnée orpheline), plafonné.
  const dossiers = reconcileClients({ orders, invoices, opps, fpKeyOf, normClient });
  const clients = dossiers
    .filter((d) => d.suggestions.length || d.wonNoPnl)
    .slice(0, 300)
    .map((d) => ({ client: d.client, counts: d.counts, suggestions: d.suggestions.length, wonNoPnl: d.wonNoPnl }));
  return {
    ok: true, mode: "list", clients,
    totalSuggestions: dossiers.reduce((s, d) => s + d.suggestions.length, 0),
    scanned: { orders: orders.length, invoices: invoices.length, opps: opps.length }, capped,
  };
});

// --- CENTRE DE CORRECTION : renvoie, PAR TYPE d'anomalie, les enregistrements CONCRETS à corriger
// (pas seulement un compte + 10 réfs comme summaries/dataQuality). Réutilise `issueDefs` — la SOURCE
// UNIQUE des prédicats de qualité — pour garantir l'alignement avec le score/les bulletins. Lecture
// seule, gouvernée « import » (l'action de correction, elle, reste gouvernée par le module de chaque
// donnée via son callable dédié : setInvoiceFp, patchOrder, patchOpportunity, patchBcLine…). Plafonné
// par type pour borner le payload ; `count` reste le total réel. ---
exports.correctionQueue = onCallG("correctionQueue", { memoryMiB: 1024, timeoutSeconds: 120 }, async (req) => {
  await requireRead(req, "import");
  const { issueDefs } = require("./domain/dataQuality");
  const { isAgedLost } = require("./domain/oppLifecycle");
  // TOUS les scans sont BORNÉS (MAX_SCAN) — pas seulement les opps : sur un carnet volumineux, charger
  // orders/invoices/bcLines/sheets sans limite pouvait saturer la mémoire (OOM → « INTERNAL »). Mémoire
  // portée à 1 GiB pour la marge. Une troncature éventuelle est signalée (`capped`) plutôt que silencieuse.
  const [ordSnap, invSnap, oppSnap, bcSnap, shSnap, thrDoc, aliasDoc, cxlODoc, cxlIDoc, casOvrDoc, dcAliasDoc] = await Promise.all([
    // raf/designation : requis par mergeCommandes (RAF curaté + affaire) pour aligner l'assiette « commandes ».
    db.collection("orders").select("fp", "client", "am", "yearPo", "cas", "raf", "designation", "source").limit(MAX_SCAN + 1).get(),
    db.collection("invoices").select("fp", "client", "numero", "amountHt", "date", "dueDate", "linked").limit(MAX_SCAN + 1).get(),
    // source/ageDays/probability : requis par isAgedLost (sinon opps_agees toujours vide). expenseType :
    // composante de la clé de doublon BC (sinon bc_doublons sur-compté). Alignement avec dataQuality.
    db.collection("opportunities").select("fp", "client", "am", "amount", "stage", "stageLabel", "closingDate", "designation", "stale", "source", "ageDays", "probability", "visibleTo").limit(MAX_SCAN + 1).get(),
    // dc : requis pour le rapprochement DC → N° FP (ADR-054), aligné sur le recompute (aggregate.js).
    db.collection("bcLines").select("fp", "dc", "bcNumber", "supplier", "currency", "amount", "amountXof", "expenseType", "status").limit(MAX_SCAN + 1).get(),
    // commercial : mergeCommandes en dérive l'AM d'une commande enrichie par fiche (sinon commandes_sans_am divergerait).
    db.collection("projectSheets").select("fp", "client", "affaire", "saleTotal", "commercial").limit(MAX_SCAN + 1).get(),
    db.doc("config/alerts").get(),
    db.doc("config/fpAliases").get(),
    db.doc("config/cancelOrders").get(),
    db.doc("config/cancelInvoices").get(),
    db.doc("config/orderCasOverride").get(),
    db.doc("config/dcAliases").get(),
  ]);
  let scanCapped = false;
  const withId = (snap) => { const s = sliceCapped(snap.docs); if (s.capped) scanCapped = true; return s.docs.map((d) => ({ id: d.id, ...d.data() })); };
  const orders = withId(ordSnap), invoices = withId(invSnap), bcLines = withId(bcSnap), sheets = withId(shSnap);
  let allOpps = sliceCapped(oppSnap.docs).docs.map((d) => ({ id: d.id, ...d.data() })); // scan borné (R1)
  // RÉCONCILIATION DE N° FP (overlay config/fpAliases) — MÊME canonisation que le recompute
  // (aggregate.js) : sans elle, une opp gagnée réconciliée via alias apparaîtrait à tort « sans P&L »
  // et des factures/BC saisis sous l'ancien FP passeraient pour « non rattachés » DANS LE CENTRE DE
  // CORRECTION lui-même (faux positifs signalés au terrain). Non destructif (en mémoire, avant issueDefs).
  const fpAliasMap = ((aliasDoc.data() || {}).map) || {};
  if (Object.keys(fpAliasMap).length) {
    const { buildFpAliasResolver } = require("./lib/ids"); // require LOCAL (les autres requires de ce module sont fn-scoped) — sinon ReferenceError « buildFpAliasResolver is not defined »
    const canonFp = buildFpAliasResolver(fpAliasMap);
    for (const rows of [orders, invoices, allOpps, bcLines, sheets]) {
      for (const r of rows) if (r && r.fp != null && r.fp !== "") r.fp = canonFp(r.fp);
    }
  }
  // RAPPROCHEMENT DC → N° FP (overlay config/dcAliases, ADR-054) — MÊME résolution que le recompute : un BC
  // sans FP mais portant un DC connu est rattaché à l'affaire, sinon il compterait à tort « bc_fp_inconnu »
  // DANS LE CENTRE DE CORRECTION alors que le cockpit Qualité (aggregate) l'aura rattaché → divergence.
  const dcAliasMap = ((dcAliasDoc.data() || {}).map) || {};
  if (Object.keys(dcAliasMap).length) {
    const { resolveBcFp } = require("./domain/odooSync"); // require LOCAL (module fn-scoped, cf. buildFpAliasResolver)
    for (const b of bcLines) { if (b && (b.fp == null || b.fp === "") && b.dc) { const fp = resolveBcFp(b, dcAliasMap); if (fp) b.fp = fp; } }
  }
  // Sécurité par enregistrement : sous OWD « private », un data-steward non-administrateur ne corrige
  // que les opps de sa ligne hiérarchique (seul le flux opportunités est protégé par OWD — re-audit).
  if ((await recordAccessOwd("opportunities")) === "private" && !(await isRecordAdmin(req))) {
    allOpps = allOpps.filter((o) => Array.isArray(o.visibleTo) && o.visibleTo.includes(req.auth.uid));
  }
  // MÊME dédup que le recompute — via la SOURCE UNIQUE domain/liveOpps (audit 40 axes, axe 27) : dédup
  // INTRA-live (salesData+odoo, le plus récent par FP) PUIS masquage des « saisie » couvertes par un FP
  // live. L'ancienne ré-implémentation locale ignorait Odoo et ne dédupliquait pas les live entre elles →
  // buckets opp du Centre de correction SUR-COMPTÉS vs cockpit Qualité dès qu'Odoo était actif.
  const { fpKey: fpKeyCorr } = require("./lib/ids"); // aussi utilisé plus bas (recommandations par FP)
  {
    const { dedupeLiveOpps, maskSaisieCovered } = require("./domain/liveOpps");
    const { oppsDedup, liveFps } = dedupeLiveOpps(allOpps);
    allOpps = maskSaisieCovered(oppsDedup, liveFps);
  }
  const thr = thrDoc.data() || {};
  // MÊME préparation des opportunités que le recompute (aggregate.js) → les compteurs du Centre de
  // correction collent au score/aux bulletins : fantômes (stale) et périmées (aged) sont sortis de
  // l'assiette « active », et signalés via leurs buckets dédiés (opps_fantomes / opps_agees).
  const staleOpps = allOpps.filter((o) => o.stale === true);
  const agedOpps = allOpps.filter((o) => o.stale !== true && isAgedLost(o));
  const opps = allOpps.filter((o) => o.stale !== true && !isAgedLost(o));
  // ASSIETTE « COMMANDES » IDENTIQUE AU RECOMPUTE (source unique) : issueDefs doit voir les MÊMES commandes
  // que le cockpit Qualité / le score, sinon les compteurs divergent (« non cohérent »). On reconstruit donc
  // la source de vérité fusionnée — mergeCommandes (fiche > opp gagnée > P&L) + surcharge CAS (config/
  // orderCasOverride) + exclusion des annulations — au lieu de scanner les lignes P&L brutes. Ainsi
  // surfacturation (CAS fusionné), commandes_sans_client/am (client/AM hérités de l'opp/fiche) et
  // factures_orphelines (commandes annulées écartées) donnent le MÊME nombre que la Vue Qualité.
  const { mergeCommandes } = require("./domain/commandes");
  const { safeId: safeIdCorr } = require("./lib/sheets");
  const itemsOfCorr = (snap) => new Set((((snap.data() || {}).items) || []).map((e) => e && e.id).filter(Boolean));
  const cancelledOrders = itemsOfCorr(cxlODoc), cancelledInvoices = itemsOfCorr(cxlIDoc);
  const casOverrideMap = ((casOvrDoc.data() || {}).map) || {};
  // Factures annulées EXCLUES AVANT la fusion (comme le recompute, aggregate.js) → o.facture/o.raf(derive)
  // portés par les commandes fusionnées n'incluent jamais d'annulée (assiette strictement alignée).
  const invoicesDq = invoices.filter((i) => !cancelledInvoices.has(i.id));
  const mergedOrders = mergeCommandes(orders, opps, sheets, invoicesDq);
  for (const o of mergedOrders) {
    const ov = Number(casOverrideMap[safeIdCorr(o.fp)]);
    if (Number.isFinite(ov) && ov >= 0) { o.cas = ov; if (o.rafSource === "derive") o.raf = Math.max(ov - (o.facture || 0), 0); }
  }
  const ordersDq = mergedOrders.filter((o) => !cancelledOrders.has(safeIdCorr(o.fp)));
  // `orders` (P&L BRUTS, avant fusion) passés en dernier → détection des commandes au N° FP illisible.
  const defs = issueDefs(ordersDq, invoicesDq, opps, bcLines, sheets, thr, staleOpps, agedOpps, orders);
  const CAP = 100; // borne de payload par type ; `count` = total réel (le steward corrige, on rescanne)
  // RECOMMANDATIONS CONCRÈTES (au-delà de la détection) : valeur chiffrée déductible d'un enregistrement
  // rattaché (jamais inventée). ctx = commande fusionnée par fpKey (cas/casPnl) + Σ factures par fpKey.
  const { recommendCorrection, remediationPlan } = require("./domain/remediation");
  const orderByFp = new Map(ordersDq.map((o) => [fpKeyCorr(o.fp), o]).filter(([k]) => k));
  const billedByFp = new Map();
  for (const i of invoicesDq) { const k = fpKeyCorr(i.fp); if (k) billedByFp.set(k, (billedByFp.get(k) || 0) + (Number(i.amountHt) || 0)); }
  const recCtx = { orderByFp, billedByFp };
  const buckets = defs.filter((d) => d.records.length).map((d) => ({
    type: d.type, severity: d.severity, label: d.label, count: d.records.length,
    items: d.records.slice(0, CAP).map((it) => { const rec = recommendCorrection(d.type, it, recCtx); return rec ? { ...it, rec } : it; }),
  }));
  // SOURCE UNIQUE — on rapatrie ICI les incohérences ClickUp ↔ app (statut « facturé » sans CAF, « clôturé »
  // avec RAF) : MÊME calcul que le cockpit Qualité (clickupSignals sur l'assiette commandes fusionnée), pour
  // que le Centre de correction couvre TOUTES les anomalies (plus de liste dupliquée ailleurs). Ces cas ne se
  // corrigent pas en une valeur → buckets « drill-through » (la ligne renvoie à l'écran commandes pré-filtré).
  const cuSyncMap = ((await db.doc("config/clickupSync").get()).data() || {}).map || {};
  if (Object.keys(cuSyncMap).length) {
    const { clickupSignals } = require("./domain/clickupSignals");
    const asOf = new Date().toISOString().slice(0, 10);
    const clientByFp = new Map(ordersDq.map((o) => [o.fp, o.client || ""]));
    for (const iss of clickupSignals(ordersDq, cuSyncMap, safeIdCorr, asOf).issues) {
      buckets.push({ type: iss.type, severity: iss.severity, label: iss.label, count: iss.count, items: (iss.refs || []).map((fp) => ({ fp, client: clientByFp.get(fp) || "" })) });
    }
  }
  // Plan d'assainissement PRIORISÉ (par impact FCFA) — « par où commencer ». Calculé sur les buckets finaux
  // (y compris les incohérences ClickUp rapatriées ci-dessus) après enrichissement des recommandations.
  const plan = remediationPlan(buckets);
  return { ok: true, buckets, plan, cap: CAP, capped: scanCapped, total: buckets.reduce((s, b) => s + b.count, 0) };
});

// ASSISTANT IA DU CENTRE DE CORRECTION — « l'IA PROPOSE, l'humain VALIDE ». Reçoit un lot d'anomalies
// d'un même type (déjà affiché par le Centre de correction) et renvoie des PROPOSITIONS de correction
// { ref, action, fields, confidence, rationale } que le front applique UNIQUEMENT sur clic, via les mêmes
// écritures gouvernées (setInvoiceFp, patchOrder…). Ce callable N'ÉCRIT RIEN. Gouverné « import » (write) :
// il transmet des données à une API externe (Claude) → réservé aux data-stewards. Confidentialité : seuls
// les champs de la liste blanche (domain/aiCorrection) partent à l'API, jamais d'objet Firestore brut.
// La sortie du modèle est TOUJOURS re-validée (normalizeSuggestions) — aucune confiance dans le brut.
exports.aiSuggestCorrections = onCallG(
  "aiSuggestCorrections",
  // 300 s : deux passes Opus SÉQUENTIELLES (analyse + vérification adverse) avec réflexion adaptative
  // peuvent frôler 120 s sur un lot de ~60 ; on aligne sur les autres callables lourds pour éviter un
  // timeout qui couperait la vérification (sinon perte du travail malgré le best-effort côté lib).
  { secrets: [ANTHROPIC_API_KEY], memoryMiB: 512, timeoutSeconds: 300 },
  async (req) => {
    await requireWrite(req, "import");
    // Limite anti-abus/coût même pour un utilisateur AUTORISÉ : chaque appel = 2 requêtes Opus (analyse +
    // vérification adverse). 20 lots/min/compte suffisent au travail humain et plafonnent le coût API.
    if (!(await rateLimit(req.auth.uid, "ai", 20, 60_000))) throw new HttpsError("resource-exhausted", "Trop d'analyses IA en peu de temps — patientez un instant.");
    const apiKey = ANTHROPIC_API_KEY.value();
    if (!apiKey) throw new HttpsError("failed-precondition", "ANTHROPIC_API_KEY non configuré (Secret Manager) — assistant IA indisponible.");

    const type = String(req.data?.type || "").trim().slice(0, 60);
    if (!type) throw new HttpsError("invalid-argument", "type d'anomalie requis");
    const records = Array.isArray(req.data?.records) ? req.data.records : [];
    if (!records.length) throw new HttpsError("invalid-argument", "aucun enregistrement à analyser");
    // Lot BORNÉ (coût + latence + garde-fou d'exfiltration) : au-delà, on analyse les 60 premiers et on le
    // SIGNALE (truncated) plutôt que d'envoyer un volume non borné à l'API. Le steward relance après correction.
    const MAX_AI_RECORDS = 60;
    const truncated = records.length > MAX_AI_RECORDS;
    const batch = records.slice(0, MAX_AI_RECORDS);

    // Contexte de RAPPROCHEMENT (candidats) — chargé uniquement pour les types où une correspondance FP/
    // client aide le modèle. Borné, dé-identifié au strict nécessaire ({ fp, client, cas }).
    const FP_MATCH_TYPES = new Set(["factures_orphelines", "opps_gagnees_sans_fp", "bc_sans_fp", "commandes_sans_client"]);
    let context = {};
    if (FP_MATCH_TYPES.has(type)) {
      const ordSnap = await db.collection("orders").select("fp", "client", "cas").limit(800).get();
      context = { orders: ordSnap.docs.map((d) => { const o = d.data() || {}; return { fp: o.fp, client: o.client, cas: o.cas }; }).filter((o) => o.fp) };
    }

    const { suggestCorrections } = require("./lib/aiCorrection");
    let out;
    try {
      out = await suggestCorrections(apiKey, { type, records: batch, context });
    } catch (e) {
      if (e && e.code === "ai_refusal") throw new HttpsError("failed-precondition", "Le modèle a refusé de traiter ce lot.");
      logger.error("aiSuggestCorrections a échoué", { message: e && e.message, type });
      throw new HttpsError("internal", "L'assistant IA n'a pas pu produire de propositions (réessayez).");
    }

    // Audit : on journalise l'USAGE (type, tailles, modèle, vérifiées) — jamais le contenu des enregistrements.
    await logOps({
      kind: "ai", action: "suggestCorrections", status: "ok", uid: req.auth.uid,
      detail: { type, records: batch.length, suggestions: out.suggestions.length, actionable: out.suggestions.filter((s) => s.action !== "review").length, verified: out.verifiedCount, model: out.model, usage: out.usage, usageVerify: out.usageVerify },
    });
    return { ok: true, type, suggestions: out.suggestions, model: out.model, verified: out.verified, verifiedCount: out.verifiedCount, truncated, analyzed: batch.length, total: records.length };
  },
);

// ASSISTANT IA — NORMALISATION DES NOMS CLIENTS : l'IA juge quelles graphies désignent la MÊME entité et
// propose des fusions `variant → canonique` (attrape ce que le fuzzy Levenshtein rate : abréviations, mots
// manquants, formes juridiques). « L'IA propose, l'humain valide » : renvoie des propositions AJOUTABLES à la
// table d'alias (config/clientAliases), AUCUNE écriture. L'application reste `setClientAliases` (direction).
exports.aiSuggestClientMerges = onCallG(
  "aiSuggestClientMerges",
  { secrets: [ANTHROPIC_API_KEY], memoryMiB: 512, timeoutSeconds: 300 },
  async (req) => {
    await requireWrite(req, "import");
    if (!(await rateLimit(req.auth.uid, "ai", 20, 60_000))) throw new HttpsError("resource-exhausted", "Trop d'analyses IA en peu de temps — patientez un instant.");
    const apiKey = ANTHROPIC_API_KEY.value();
    if (!apiKey) throw new HttpsError("failed-precondition", "ANTHROPIC_API_KEY non configuré (Secret Manager) — assistant IA indisponible.");
    // Inventaire fourni par le front (graphies vues à l'écran → parité), borné + assaini. On ne reçoit que
    // le nécessaire (graphie + fréquence) ; on re-borne côté serveur (garde-fou coût/exfiltration).
    const rawNames = Array.isArray(req.data?.names) ? req.data.names : [];
    if (!rawNames.length) throw new HttpsError("invalid-argument", "aucun nom à analyser");
    const CAP = 400; // borne coût/latence (un lot Opus)
    const truncated = rawNames.length > CAP;
    const names = rawNames.slice(0, CAP)
      .map((n) => ({ name: String((n && n.name) != null ? n.name : n || "").slice(0, 120), count: Number(n && n.count) || 0 }))
      .filter((n) => n.name);
    if (!names.length) throw new HttpsError("invalid-argument", "aucun nom exploitable");
    const { aiSuggestClientMerges: runAi } = require("./lib/aiClientNorm");
    let out;
    try {
      out = await runAi(apiKey, names);
    } catch (e) {
      if (e && e.code === "ai_refusal") throw new HttpsError("failed-precondition", "Le modèle a refusé de traiter ce lot.");
      logger.error("aiSuggestClientMerges a échoué", { message: e && e.message });
      throw new HttpsError("internal", "L'assistant IA n'a pas pu produire de suggestions (réessayez).");
    }
    await logOps({ kind: "ai", action: "suggestClientMerges", status: "ok", uid: req.auth.uid, detail: { names: names.length, suggestions: out.suggestions.length, model: out.model, usage: out.usage } });
    return { ok: true, suggestions: out.suggestions, model: out.model, truncated, analyzed: names.length, total: rawNames.length };
  },
);

// === CONSULTANTS / RESSOURCES (Lot 11 « 20/10 DirOps ») — annuaire des ressources délivrantes de l'ESN,
// fondation du plan de charge (Lot 12) et des KPI d'activité (Lot 13). ACCÈS 100% PAR CALLABLE (Admin
// SDK) : consultants/* est read:false+write:false côté rules. Lecture gouvernée « overview » (le DirOps
// et les managers voient l'annuaire) ; le COÛT (CJM) est CONFIDENTIEL → masqué sauf droit « rentabilite »
// (même règle que la marge). Écriture (gestion du staffing) gouvernée « pipeline ». Audité.
// Consultants (Lot 11) + Plan de charge / staffing (Lot 12) EXTRAITS dans handlers/staffing.js
// (patron R3). Deps injectées ; exports déclarés ici (garde-fou de déploiement par nom).
const { createStaffing } = require("./handlers/staffing");
const _staffing = createStaffing({ onCallG, HttpsError, db, FieldValue, requireWrite, requireRead, assertPlainId, recomputeNow: recomputeSummaries, logOps });
exports.upsertConsultant = _staffing.upsertConsultant;
exports.deleteConsultant = _staffing.deleteConsultant;
exports.listConsultants = _staffing.listConsultants;
exports.upsertAssignment = _staffing.upsertAssignment;
exports.deleteAssignment = _staffing.deleteAssignment;
exports.staffingPlan = _staffing.staffingPlan;

// CONTRATS DE MAINTENANCE (module mnt_, Lot 1) — contrat adossé au N° FP + engagements SLA embarqués.
// Callable-only ; double garde requireWrite('maintenance') + drapeau config/mntFeature (module éteint
// par défaut → aucune écriture). Extraction dans handlers/maintenance.js (patron d'injection).
const { createMaintenance } = require("./handlers/maintenance");
const _maintenance = createMaintenance({ onCallG, HttpsError, db, FieldValue, requireWrite, requireRead, assertPlainId, loadUsersMap, anyDirectionUid, ANTHROPIC_API_KEY, rateLimit, logOps, requestRecompute });
exports.upsertMntContrat = _maintenance.upsertMntContrat;
exports.importMntContrats = _maintenance.importMntContrats;
exports.aiSuggestMntContrats = _maintenance.aiSuggestMntContrats;
exports.aiMntLignees = _maintenance.aiMntLignees;
exports.applyMntLignee = _maintenance.applyMntLignee;
exports.aiAnalyzeChurn = _maintenance.aiAnalyzeChurn;
exports.mntContratPnl = _maintenance.mntContratPnl;
exports.deleteMntContrat = _maintenance.deleteMntContrat;
exports.setMntContratStatut = _maintenance.setMntContratStatut;
exports.aiMntContratStatut = _maintenance.aiMntContratStatut;
exports.revertMntAutoStatut = _maintenance.revertMntAutoStatut;
exports.setMntWatch = _maintenance.setMntWatch;
exports.upsertMntTicket = _maintenance.upsertMntTicket;
exports.deleteMntTicket = _maintenance.deleteMntTicket;
exports.upsertMntIntervention = _maintenance.upsertMntIntervention;
exports.deleteMntIntervention = _maintenance.deleteMntIntervention;
exports.submitMntDecision = _maintenance.submitMntDecision;
exports.submitAstreinte = _maintenance.submitAstreinte;
exports.listAstreintes = _maintenance.listAstreintes;

// PARTENARIATS & CERTIFICATIONS (par_) — Lot 1 : référentiel partenaire (par_partners). Même patron
// d'injection que maintenance. Collections par_* callable-only ; double garde (requireWrite + drapeau
// config/parFeature). Exports déclarés ici (déploiement par nom).
const { createPartenariats } = require("./handlers/partenariats");
const _partenariats = createPartenariats({ onCallG, HttpsError, db, FieldValue, requireWrite, requireRead, requestRecompute, recomputeNow: recomputeSummaries, ANTHROPIC_API_KEY, CLICKUP_TOKEN, rateLimit, logOps });
exports.upsertParPartner = _partenariats.upsertParPartner;
exports.deleteParPartner = _partenariats.deleteParPartner;
exports.upsertParCertification = _partenariats.upsertParCertification;
exports.deleteParCertification = _partenariats.deleteParCertification;
exports.setParPartnerMap = _partenariats.setParPartnerMap;
exports.upsertParAssignment = _partenariats.upsertParAssignment;
exports.setParAssignmentStatus = _partenariats.setParAssignmentStatus;
exports.deleteParAssignment = _partenariats.deleteParAssignment;
exports.pushParAssignmentToClickup = _partenariats.pushParAssignmentToClickup;
exports.generateParActionPlan = _partenariats.generateParActionPlan;
exports.generateParQbr = _partenariats.generateParQbr;
exports.suggestParPartnerMap = _partenariats.suggestParPartnerMap;
exports.importParCertifications = _partenariats.importParCertifications;
exports.importParCertificationsFile = _partenariats.importParCertificationsFile;

// KPI D'ACTIVITÉ (Lot 13 « 20/10 DirOps ») — taux d'occupation, intercontrat, jours facturables, CA staffé
// et marge prévisionnels, agrégés global + par BU + par consultant. Calcul serveur (source unique
// domain/activityKpi). Le COÛT/MARGE ne sont exposés qu'avec le droit « rentabilite » (confidentialité).
exports.activityKpis = onCallG("activityKpis", { memoryMiB: 256, timeoutSeconds: 60 }, async (req) => {
  await requireRead(req, "overview");
  const { monthsRange } = require("./domain/assignment");
  const { computeActivity } = require("./domain/activityKpi");
  const { canRead } = require("./domain/authz");
  const role = req.auth.token?.nt360Role;
  const matrix = ((await db.doc("config/permissions").get()).data() || {}).matrix || {};
  const canCost = canRead(matrix, role, "rentabilite");
  const now = new Date();
  const curYm = req.data?.fromMonth && /^\d{4}-\d{2}$/.test(req.data.fromMonth)
    ? req.data.fromMonth : `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const span = Math.min(18, Math.max(1, Number(req.data?.months) || 6));
  let [ey, em] = curYm.split("-").map(Number); em += span - 1; while (em > 12) { em -= 12; ey += 1; }
  const months = monthsRange(curYm, `${ey}-${String(em).padStart(2, "0")}`);
  const [cSnap, aSnap, tgtDoc] = await Promise.all([
    db.collection("consultants").select("name", "status", "bu", "grade", "cjm").limit(MAX_SCAN + 1).get(),
    db.collection("assignments").select("consultantId", "startMonth", "endMonth", "allocationPct", "tjmBilled").limit(MAX_SCAN + 1).get(),
    db.doc("config/staffingTargets").get(),
  ]);
  const consultants = sliceCapped(cSnap.docs).docs.map((d) => ({ id: d.id, ...d.data() }));
  const assignments = sliceCapped(aSnap.docs).docs.map((d) => ({ id: d.id, ...d.data() }));
  const costById = {};
  for (const c of consultants) if (c.cjm != null) costById[c.id] = Number(c.cjm);
  const kpi = computeActivity(consultants, assignments, months, costById, canCost);
  // Objectifs d'occupation (Lot 18) : cible par ressource (grade > BU > global) + détection de dérive.
  const { validateTargets, evaluate, targetFor } = require("./domain/staffingTarget");
  const targets = validateTargets(tgtDoc.data() || {});
  const ev = evaluate(kpi.rows, targets);
  kpi.rows = ev.rows;
  return { ok: true, months, canCost, targets, occupancyTargetPct: targetFor(targets, {}), belowTargetCount: ev.belowCount, ...kpi };
});

// CAPACITÉ ⇄ PIPELINE (Lot 14 « 20/10 DirOps ») — ai-je la capacité de délivrance pour honorer le pipeline
// qui va se signer ? Compare capacité disponible (jours-homme non staffés des actifs) et demande pipeline
// pondérée (Σ montant×proba ÷ TJM moyen). Le GAP = besoin de recrutement (négatif) ou banc à risque
// (positif). Les opportunités sont lues via scopedOpps (sécurité par enregistrement respectée).
exports.capacityPlan = onCallG("capacityPlan", { memoryMiB: 256, timeoutSeconds: 60 }, async (req) => {
  await requireRead(req, "overview");
  const { monthsRange, buildLoad } = require("./domain/assignment");
  const { capacityVsPipeline } = require("./domain/capacity");
  const now = new Date();
  const curYm = req.data?.fromMonth && /^\d{4}-\d{2}$/.test(req.data.fromMonth)
    ? req.data.fromMonth : `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const span = Math.min(18, Math.max(1, Number(req.data?.months) || 6));
  let [ey, em] = curYm.split("-").map(Number); em += span - 1; while (em > 12) { em -= 12; ey += 1; }
  const months = monthsRange(curYm, `${ey}-${String(em).padStart(2, "0")}`);
  const [cSnap, aSnap] = await Promise.all([
    db.collection("consultants").select("name", "status", "bu", "tjmTarget").limit(MAX_SCAN + 1).get(),
    db.collection("assignments").select("consultantId", "startMonth", "endMonth", "allocationPct").limit(MAX_SCAN + 1).get(),
  ]);
  const consultants = sliceCapped(cSnap.docs).docs.map((d) => ({ id: d.id, ...d.data() }));
  const assignments = sliceCapped(aSnap.docs).docs.map((d) => ({ id: d.id, ...d.data() }));
  const { isWorkforce } = require("./domain/consultant");
  // Effectif EN ACTIVITÉ (staffé + intercontrat) : le banc compte dans la capacité disponible.
  const activeIds = consultants.filter((c) => isWorkforce(c.status)).map((c) => c.id);
  const { byConsultant } = buildLoad(assignments, months, activeIds);
  // Opportunités OUVERTES (étapes 1..5) pondérées — record-level respecté via scopedOpps. On calcule le
  // pondéré TIÉRÉ (`pw`, source unique du « pondéré » — CLAUDE.md) et on le passe à la capacité, au lieu de
  // laisser lire le `weighted` linéaire persisté (interdit à l'affichage).
  const { projectionWeight, normalizeTiers } = require("./domain/projection");
  const { isAgedLost } = require("./domain/oppLifecycle");
  const tiers = normalizeTiers((await db.doc("config/projection").get()).data() || undefined);
  // Population alignée pipeline/vélocité : ouvertes (1-5), NON `stale`, NON périmées par âge (`isAgedLost`),
  // DÉDUPLIQUÉE par FP (parité aggregate.js — une 'saisie' ré-importée en salesData doublait sinon la demande
  // → gap de recrutement surévalué). `fp`/`updatedAt` requis par la dédup ; dormantes CONSERVÉES à dessein
  // (une affaire ouverte qui a glissé reste à STAFFER — plan de capacité = liste d'action, pas prévision de CA).
  const { dedupOppsByFp } = require("./domain/oppPipeline");
  const allOpps = await scopedOpps(req, ["bu", "amount", "weighted", "probability", "stage", "stale", "source", "ageDays", "fp", "updatedAt"]);
  const opps = dedupOppsByFp(allOpps.filter((o) => o.stale !== true && !isAgedLost(o)))
    .filter((o) => { const s = Number(o.stage) || 0; return s >= 1 && s <= 5; })
    .map((o) => ({ ...o, pw: projectionWeight(o, tiers) }));
  const plan = capacityVsPipeline({ consultants, loadByConsultant: byConsultant, months, opps });
  return { ok: true, months, openOppCount: opps.length, ...plan };
});

// === CRA / TEMPS CONSTATÉ + ACTIVITÉ ESN (Lots 15/17/19/20/21/22 « 20/10 DirOps ») EXTRAIT dans
// handlers/timesheets.js (patron R3). CRA mensuel → TACE/occupation réels, tendance, auto-CRA ClickUp,
// P&L par ressource et pré-facturation. Deps injectées ; exports déclarés ici (déploiement par nom).
const { createTimesheets } = require("./handlers/timesheets");
const _timesheets = createTimesheets({ onCallG, HttpsError, db, FieldValue, requireWrite, requireRead, assertPlainId, CLICKUP_TOKEN, CLICKUP_TEAM, recomputeNow: recomputeSummaries, logOps });
exports.upsertTimesheet = _timesheets.upsertTimesheet;
exports.deleteTimesheet = _timesheets.deleteTimesheet;
exports.timesheetKpis = _timesheets.timesheetKpis;
exports.taceHistory = _timesheets.taceHistory;
exports.importTimesheets = _timesheets.importTimesheets;
exports.syncClickupTimesheets = _timesheets.syncClickupTimesheets;
exports.resourcePnl = _timesheets.resourcePnl;
exports.preBillingFromCra = _timesheets.preBillingFromCra;
exports.deliveryMarginByAffaire = _timesheets.deliveryMarginByAffaire;

// === VIVIER / RECRUTEMENT (Lot 16 « 20/10 DirOps ») — pipeline de candidats rattaché au gap de capacité
// (Lot 14). candidates/* callable-only. Écriture « pipeline », lecture « overview ». EXTRAIT dans
// handlers/candidates.js (patron R3). Deps injectées ; exports déclarés ici (déploiement par nom).
const { createCandidates } = require("./handlers/candidates");
const _candidates = createCandidates({ onCallG, HttpsError, db, FieldValue, requireWrite, requireRead, assertPlainId });
exports.upsertCandidate = _candidates.upsertCandidate;
exports.deleteCandidate = _candidates.deleteCandidate;
exports.listCandidates = _candidates.listCandidates;

// === SÉCURITÉ PAR ENREGISTREMENT (Lot 2 « niveau Salesforce ») — modèle PROPRIÉTAIRE + HIÉRARCHIE.
// Chaque enregistrement (opportunité, compte) porte un `ownerUid` et une liste dénormalisée
// `visibleTo` = chaîne ascendante du propriétaire (propriétaire + manager + … , cf. domain/hierarchy).
// Les Security Rules et les requêtes client filtrent en O(1) (`array-contains uid`) SANS traversée
// récursive (impossible en rules). L' APPLICATION est GOUVERNÉE par l'OWD (config/recordAccess) : par
// défaut « public » (comportement historique inchangé, aucune régression) ; passé à « private » par la
// direction, seuls le propriétaire, sa ligne hiérarchique et les administrateurs voient l'enregistrement.
async function loadUsersMap() {
  const snap = await db.collection("users").select("managerUid", "name").get();
  const map = {};
  snap.forEach((d) => { map[d.id] = { managerUid: d.data().managerUid || null, name: d.data().name || null }; });
  return map;
}
// visibleTo d'un propriétaire (charge la hiérarchie si non fournie). ownerUid vide → [] (sans propriétaire).
async function visibleToFor(ownerUid, usersMap) {
  const { ownerChain } = require("./domain/hierarchy");
  const map = usersMap || (await loadUsersMap());
  return ownerChain(map, ownerUid);
}
// Ré-indexe visibleTo sur TOUS les enregistrements (opportunités, comptes, contacts) à partir des
// propriétaires courants et de la hiérarchie courante. À exécuter après un changement de hiérarchie
// (setManager) ou avant de basculer un objet en OWD « private » (backfill). Batché (chunks de 400).
// opts.deriveFromAm : pour une opportunité SANS propriétaire, en dérive un depuis son champ `am` (nom
// du commercial) en le mappant sur l'utilisateur de même nom (normalisé). Rend l'OWD « private »
// immédiatement exploitable sur les opps importées (sinon toutes « sans propriétaire » = admins seuls).
async function reindexAllVisibility(opts = {}) {
  const { ownerChain } = require("./domain/hierarchy");
  const usersSnap = await db.collection("users").select("managerUid", "name").get();
  const usersMap = {}; const nameToUid = {};
  usersSnap.forEach((d) => {
    usersMap[d.id] = { managerUid: d.data().managerUid || null };
    const nm = String(d.data().name || "").trim().toUpperCase();
    if (nm && !nameToUid[nm]) nameToUid[nm] = d.id;
  });
  const deriveFromAm = opts.deriveFromAm === true;
  let updated = 0, derived = 0;
  // Opportunités : propriétaire existant, sinon (option) dérivé de l'AM. L'owner dérivé est PERSISTÉ.
  {
    const snap = await db.collection("opportunities").select("ownerUid", "am").get();
    let batch = db.batch(); let n = 0;
    for (const doc of snap.docs) {
      let owner = doc.data().ownerUid || null;
      if (!owner && deriveFromAm) {
        const cand = nameToUid[String(doc.data().am || "").trim().toUpperCase()];
        if (cand) { owner = cand; derived++; }
      }
      const patch = { visibleTo: ownerChain(usersMap, owner) };
      if (owner && !doc.data().ownerUid) patch.ownerUid = owner;
      batch.set(doc.ref, patch, { merge: true });
      updated++; n++;
      if (n >= 400) { await batch.commit(); batch = db.batch(); n = 0; }
    }
    if (n) await batch.commit();
  }
  // Comptes : propriétaire uniquement (pas d'AM). Contacts : visibilité HÉRITÉE du compte de rattachement.
  const accSnap = await db.collection("accounts").select("ownerUid").get();
  const accOwner = {}; accSnap.forEach((d) => { accOwner[d.id] = d.data().ownerUid || null; });
  const commitChunks = async (docs, ownerOf) => {
    let batch = db.batch(); let n = 0;
    for (const doc of docs) {
      batch.set(doc.ref, { visibleTo: ownerChain(usersMap, ownerOf(doc)) }, { merge: true });
      updated++; n++;
      if (n >= 400) { await batch.commit(); batch = db.batch(); n = 0; }
    }
    if (n) await batch.commit();
  };
  await commitChunks(accSnap.docs, (d) => d.data().ownerUid || null);
  const cSnap = await db.collection("contacts").select("accountId").get();
  await commitChunks(cSnap.docs, (d) => accOwner[d.data().accountId] || null);
  return { updated, derived };
}
// « Administrateur d'enregistrements » = voit TOUT quel que soit l'OWD (direction ou droit
// d'écriture « habilitations »). Aligné sur le helper isRecordAdmin() des Security Rules.
async function isRecordAdmin(req) {
  if (req.auth?.token?.nt360Role === "direction") return true;
  const { canWrite } = require("./domain/authz");
  const matrix = ((await db.doc("config/permissions").get()).data() || {}).matrix || {};
  return canWrite(matrix, req.auth?.token?.nt360Role, "habilitations");
}
// OWD courant d'un objet (config/recordAccess) : 'private' ou 'public' (défaut). Lecture unique.
async function recordAccessOwd(obj) {
  const cfg = (await db.doc("config/recordAccess").get()).data() || {};
  return cfg[obj] === "private" ? "private" : "public";
}

// GARDE RBAC PAR ENREGISTREMENT (audit) : sous OWD « private », une mutation ciblée (réattribution,
// édition, suppression, activité) exige que l'appelant VOIE déjà l'enregistrement (visibleTo). Sans
// cela, un rôle « pipeline » pouvait, par simple énumération d'id, éditer / SE RÉATTRIBUER (et donc
// lire) un enregistrement privé hors de son périmètre — les Security Rules cadrent la LECTURE directe
// mais pas ces callables Admin SDK. Les admins d'enregistrement (direction / droit habilitations) et
// l'OWD « public » (défaut historique) passent sans restriction. `curData` = doc DÉJÀ chargé.
async function assertRecordVisible(req, coll, curData) {
  if (await isRecordAdmin(req)) return;
  if ((await recordAccessOwd(coll)) !== "private") return;
  const vt = Array.isArray(curData && curData.visibleTo) ? curData.visibleTo : [];
  if (!vt.includes(req.auth.uid)) throw new HttpsError("permission-denied", "enregistrement non visible (OWD privé) — action refusée");
}

// Exige un 2e facteur (MFA) pour les actions sensibles SI config/security.require2fa est actif. Le jeton
// Firebase porte `firebase.sign_in_second_factor` quand l'utilisateur s'est authentifié avec un second
// facteur. Direction INCLUSE (pas d'exception : un compte admin est la cible la plus sensible). Par
// défaut inactif (require2fa=false) → aucun changement de comportement tant que la direction ne l'active pas.
async function requireStrongAuth(req) {
  const sec = (await db.doc("config/security").get()).data() || {};
  if (!sec.require2fa) return;
  if (!req.auth?.token?.firebase?.sign_in_second_factor) {
    throw new HttpsError("permission-denied", "authentification à deux facteurs requise pour cette action");
  }
}

// Réaffecte le PROPRIÉTAIRE d'un enregistrement (opportunité ou compte) et recalcule sa visibleTo.
// Gouverné « pipeline » (comme les autres mutations d'opp/compte), audité. Pour un compte, propage la
// visibilité à ses contacts (qui suivent le compte).
exports.assignOwner = onCallG("assignOwner", { memoryMiB: 256, timeoutSeconds: 60 }, async (req) => {
  await requireWrite(req, "pipeline");
  const coll = String(req.data?.collection || "");
  if (!["opportunities", "accounts"].includes(coll)) throw new HttpsError("invalid-argument", "collection invalide");
  const id = assertPlainId(req.data?.id, "id enregistrement");
  const ownerUid = req.data?.ownerUid ? String(req.data.ownerUid) : null;
  const ref = db.doc(`${coll}/${id}`);
  const cur = await ref.get();
  if (!cur.exists) throw new HttpsError("not-found", "enregistrement introuvable");
  // Sous OWD privé, on ne peut réattribuer (et donc s'accorder la lecture de) qu'un enregistrement
  // qu'on VOIT déjà — sinon self-grant par énumération d'id (audit RBAC : assignOwner le plus impactant).
  await assertRecordVisible(req, coll, cur.data() || {});
  const usersMap = await loadUsersMap();
  const visibleTo = await visibleToFor(ownerUid, usersMap);
  await ref.set({ ownerUid, visibleTo, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  if (coll === "accounts") { // les contacts du compte héritent de la nouvelle visibilité
    const cs = await db.collection("contacts").where("accountId", "==", id).get();
    if (!cs.empty) { const b = db.batch(); cs.forEach((s) => b.set(s.ref, { visibleTo }, { merge: true })); await b.commit(); }
  }
  await db.collection("auditLog").add({ uid: req.auth.uid, action: "assign_owner", module: "pipeline", entity: coll, entityId: id, detail: { ownerUid }, ts: FieldValue.serverTimestamp() });
  return { ok: true, id, ownerUid };
});

// Pose le MANAGER d'un utilisateur (users/{uid}.managerUid) — brique de la hiérarchie de rôles.
// Direction uniquement, MFA si exigé, audité. Refuse l'auto-management et tout CYCLE hiérarchique.
// Ré-indexe la visibilité (la chaîne ascendante de tout subordonné a changé).
exports.setManager = onCallG("setManager", { memoryMiB: 512, timeoutSeconds: 300 }, async (req) => {
  if (req.auth?.token?.nt360Role !== "direction") throw new HttpsError("permission-denied", "admin requis");
  await requireStrongAuth(req);
  const uid = assertPlainId(req.data?.uid, "uid");
  const managerUid = req.data?.managerUid ? String(req.data.managerUid) : null;
  if (managerUid && managerUid === uid) throw new HttpsError("invalid-argument", "un utilisateur ne peut pas être son propre manager");
  if (managerUid) {
    const { ownerChain } = require("./domain/hierarchy");
    // Cycle : si le futur manager rapporte (transitivement) déjà à uid, le lien fermerait une boucle.
    if (ownerChain(await loadUsersMap(), managerUid).includes(uid)) throw new HttpsError("failed-precondition", "cycle hiérarchique interdit");
  }
  await db.doc(`users/${uid}`).set({ managerUid }, { merge: true });
  await db.collection("auditLog").add({ uid: req.auth.uid, action: "set_manager", module: "habilitations", entity: "user", entityId: uid, detail: { managerUid }, ts: FieldValue.serverTimestamp() });
  const { updated } = await reindexAllVisibility(); // changement de hiérarchie → pas de dérivation d'owner
  return { ok: true, uid, managerUid, reindexed: updated };
});

// Affecte un utilisateur à une ÉQUIPE (users/{uid}.team) — regroupement organisationnel (Lot 10b).
// Direction uniquement, audité. La valeur libre (issue du référentiel config/teams) est bornée.
exports.setUserTeam = onCallG("setUserTeam", async (req) => {
  if (req.auth?.token?.nt360Role !== "direction") throw new HttpsError("permission-denied", "admin requis");
  const uid = assertPlainId(req.data?.uid, "uid");
  const team = String(req.data?.team || "").trim().slice(0, 60);
  await db.doc(`users/${uid}`).set({ team: team || null }, { merge: true });
  await db.collection("auditLog").add({ uid: req.auth.uid, action: "set_team", module: "habilitations", entity: "user", entityId: uid, detail: { team }, ts: FieldValue.serverTimestamp() });
  return { ok: true, uid, team };
});

// OWD (Org-Wide Default) par objet : config/recordAccess = { opportunities, accounts } ∈ {public,private}.
// Direction uniquement, MFA si exigé, audité. Bascule en « private » → seuls propriétaire + hiérarchie +
// admins voient l'objet (les rules et le front filtrent sur visibleTo). Backfill recommandé (reindexVisibility).
exports.setRecordAccess = onCallG("setRecordAccess", async (req) => {
  if (req.auth?.token?.nt360Role !== "direction") throw new HttpsError("permission-denied", "admin requis");
  await requireStrongAuth(req);
  const norm = (v) => (v === "private" ? "private" : "public");
  const cfg = { opportunities: norm(req.data?.opportunities), accounts: norm(req.data?.accounts) };
  await db.doc("config/recordAccess").set(cfg, { merge: true });
  await db.collection("auditLog").add({ uid: req.auth.uid, action: "set_record_access", module: "habilitations", entity: "config", entityId: "recordAccess", detail: cfg, ts: FieldValue.serverTimestamp() });
  return { ok: true, ...cfg };
});

// Politique d'authentification (config/security) : require2fa (MFA obligatoire pour les actions
// sensibles). Direction uniquement, audité. Par défaut inactif.
exports.setSecurityConfig = onCallG("setSecurityConfig", async (req) => {
  if (req.auth?.token?.nt360Role !== "direction") throw new HttpsError("permission-denied", "admin requis");
  await requireStrongAuth(req);
  const require2fa = req.data?.require2fa === true;
  await db.doc("config/security").set({ require2fa }, { merge: true });
  await db.collection("auditLog").add({ uid: req.auth.uid, action: "set_security", module: "habilitations", entity: "config", entityId: "security", detail: { require2fa }, ts: FieldValue.serverTimestamp() });
  return { ok: true, require2fa };
});

// Backfill/rafraîchissement de visibleTo sur tous les enregistrements. Direction uniquement, MFA si
// exigé, audité. À lancer avant de passer un objet en OWD « private » (sinon les enregistrements sans
// visibleTo à jour seraient invisibles des non-admins).
exports.reindexVisibility = onCallG("reindexVisibility", { memoryMiB: 512, timeoutSeconds: 300 }, async (req) => {
  if (req.auth?.token?.nt360Role !== "direction") throw new HttpsError("permission-denied", "admin requis");
  await requireStrongAuth(req);
  const { updated, derived } = await reindexAllVisibility({ deriveFromAm: req.data?.deriveFromAm === true });
  await db.collection("auditLog").add({ uid: req.auth.uid, action: "reindex_visibility", module: "habilitations", entity: "config", entityId: "recordAccess", detail: { updated, derived }, ts: FieldValue.serverTimestamp() });
  return { ok: true, reindexed: updated, derived };
});

// === OBJET COMPTE (Account 360) — socle relationnel. Entité stable clé sur le nom client CANONIQUE
// (jointure directe avec le champ `client` normalisé partout). Métadonnées éditables (secteur, pays,
// hiérarchie parent, propriétaire → socle sécurité Lot 2, notes, tags). Gouverné « pipeline », audité.
// Pas de recompute (métadonnée hors agrégats). Lecture via les rules (canRead('overview')). ===
exports.upsertAccount = onCallG("upsertAccount", { memoryMiB: 256, timeoutSeconds: 60 }, async (req) => {
  await requireWrite(req, "pipeline");
  const { accountId } = require("./domain/accounts");
  const { buildClientResolver } = require("./domain/clientName");
  const d = req.data || {};
  const resolve = buildClientResolver(((await db.doc("config/clientAliases").get()).data() || {}).pairs || []);
  const canon = resolve(d.name);
  const id = accountId(canon);
  if (!id) throw new HttpsError("invalid-argument", "nom de client requis");
  const patch = { name: canon, updatedAt: FieldValue.serverTimestamp() };
  if (d.sector !== undefined) patch.sector = String(d.sector || "").trim();
  if (d.country !== undefined) patch.country = String(d.country || "").trim();
  if (d.territory !== undefined) patch.territory = String(d.territory || "").trim().slice(0, 60); // territoire (Lot 10b)
  if (d.notes !== undefined) patch.notes = String(d.notes || "").slice(0, 2000);
  if (d.tags !== undefined) patch.tags = Array.isArray(d.tags) ? d.tags.slice(0, 20).map((t) => String(t).trim()).filter(Boolean) : [];
  if (d.ownerUid !== undefined) { // propriété + visibleTo dénormalisée (Lot 2 sécurité par enregistrement)
    patch.ownerUid = d.ownerUid ? String(d.ownerUid) : null;
    patch.visibleTo = await visibleToFor(patch.ownerUid);
  }
  if (d.parent !== undefined) {
    const p = d.parent ? accountId(resolve(d.parent)) : null;
    if (p && p === id) throw new HttpsError("invalid-argument", "un compte ne peut pas être son propre parent");
    patch.parentId = p;
  }
  await db.doc(`accounts/${id}`).set(patch, { merge: true });
  if (patch.visibleTo !== undefined) { // la visibilité des contacts SUIT le compte
    const cs = await db.collection("contacts").where("accountId", "==", id).get();
    if (!cs.empty) { const b = db.batch(); cs.forEach((s) => b.set(s.ref, { visibleTo: patch.visibleTo }, { merge: true })); await b.commit(); }
  }
  await db.collection("auditLog").add({ uid: req.auth.uid, action: "upsert_account", module: "pipeline", entity: "account", entityId: id, detail: { name: canon }, ts: FieldValue.serverTimestamp() });
  return { ok: true, id, name: canon };
});

// Contacts rattachés à un compte (accountId = id du compte). Un seul contact « principal » par compte.
exports.upsertContact = onCallG("upsertContact", { memoryMiB: 256, timeoutSeconds: 60 }, async (req) => {
  await requireWrite(req, "pipeline");
  const { accountId } = require("./domain/accounts");
  const { buildClientResolver } = require("./domain/clientName");
  const d = req.data || {};
  const resolve = buildClientResolver(((await db.doc("config/clientAliases").get()).data() || {}).pairs || []);
  const acc = accountId(resolve(d.account));
  if (!acc) throw new HttpsError("invalid-argument", "compte (client) requis");
  const name = String(d.name || "").trim();
  if (!name) throw new HttpsError("invalid-argument", "nom du contact requis");
  const email = String(d.email || "").trim();
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new HttpsError("invalid-argument", "email invalide");
  // Visibilité : le contact SUIT le compte (même visibleTo que le propriétaire du compte, cf. Lot 2).
  const accData = (await db.doc(`accounts/${acc}`).get()).data() || {};
  const visibleTo = Array.isArray(accData.visibleTo) ? accData.visibleTo : await visibleToFor(accData.ownerUid || null);
  const doc = { accountId: acc, name, role: String(d.role || "").trim(), email, phone: String(d.phone || "").trim(), primary: !!d.primary, visibleTo, updatedAt: FieldValue.serverTimestamp() };
  let id = d.id ? String(d.id) : null;
  if (id) { assertPlainId(id, "id contact"); await db.doc(`contacts/${id}`).set(doc, { merge: true }); }
  else { const ref = await db.collection("contacts").add({ ...doc, createdAt: FieldValue.serverTimestamp() }); id = ref.id; }
  if (doc.primary) { // un seul principal par compte
    const others = await db.collection("contacts").where("accountId", "==", acc).get();
    const b = db.batch(); let n = 0;
    others.forEach((s) => { if (s.id !== id && s.data().primary) { b.update(s.ref, { primary: false }); n++; } });
    if (n) await b.commit();
  }
  await db.collection("auditLog").add({ uid: req.auth.uid, action: "upsert_contact", module: "pipeline", entity: "contact", entityId: id, detail: { account: acc, name }, ts: FieldValue.serverTimestamp() });
  return { ok: true, id, accountId: acc };
});

exports.deleteContact = onCallG("deleteContact", { memoryMiB: 256, timeoutSeconds: 60 }, async (req) => {
  await requireWrite(req, "pipeline");
  const id = String(req.data?.id || "");
  assertPlainId(id, "id contact");
  await db.doc(`contacts/${id}`).delete();
  await db.collection("auditLog").add({ uid: req.auth.uid, action: "delete_contact", module: "pipeline", entity: "contact", entityId: id, ts: FieldValue.serverTimestamp() });
  return { ok: true };
});

// Vue Compte (lecture, droit « overview ») : résout le nom client → id de compte canonique (côté
// serveur, pas de duplication de la canonisation au front), renvoie la métadonnée du compte (ou un
// squelette si non encore créé) + ses contacts triés (principal d'abord). Les rollups CA/backlog du
// Client 360 viennent de summaries/clients (déjà agrégé, lu par le front).
exports.accountView = onCallG("accountView", { memoryMiB: 256, timeoutSeconds: 60 }, async (req) => {
  await requireRead(req, "overview");
  const { accountId } = require("./domain/accounts");
  const { buildClientResolver } = require("./domain/clientName");
  const resolve = buildClientResolver(((await db.doc("config/clientAliases").get()).data() || {}).pairs || []);
  const name = resolve(req.data?.client);
  const id = accountId(name);
  if (!id) throw new HttpsError("invalid-argument", "nom de client requis");
  const [accSnap, cSnap] = await Promise.all([
    db.doc(`accounts/${id}`).get(),
    db.collection("contacts").where("accountId", "==", id).get(),
  ]);
  // Sécurité par enregistrement : sous OWD « private » (comptes), l'appelant DOIT voir ce compte
  // (propriétaire/hiérarchie via visibleTo). Sinon accountView exposerait la fiche à un rôle « overview »
  // dépourvu de droit de vue sur cet enregistrement. Admins (direction / habilitations) voient tout.
  if (accSnap.exists && (await recordAccessOwd("accounts")) === "private" && !(await isRecordAdmin(req))) {
    const vis = accSnap.data().visibleTo || [];
    if (!vis.includes(req.auth.uid)) throw new HttpsError("permission-denied", "accès refusé à ce compte");
  }
  const contacts = cSnap.docs.map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (b.primary ? 1 : 0) - (a.primary ? 1 : 0) || String(a.name || "").localeCompare(String(b.name || "")));
  return { ok: true, id, name, account: accSnap.exists ? { id, ...accSnap.data() } : null, contacts };
});

// === ACTIVITÉS & TÂCHES (Lot 3 « niveau Salesforce ») — journal d'actions (appel/e-mail/RDV/note) et
// TÂCHES à échéance, rattachées à un compte ou une opportunité. Comble l'écart #3 de l'audit (aucun
// objet Activité/Tâche : ni timeline, ni relances d'actions). ACCÈS 100% PAR CALLABLE (Admin SDK) :
// activities/* est read:false+write:false côté rules → la visibilité par enregistrement (Lot 2) est
// appliquée ICI côté serveur, sans index composite ni cadrage client. Gouverné « pipeline », audité.
function nowISO10() { return new Date().toISOString().slice(0, 10); }

exports.upsertActivity = onCallG("upsertActivity", { memoryMiB: 256, timeoutSeconds: 60 }, async (req) => {
  await requireWrite(req, "pipeline");
  const { validateActivity } = require("./domain/activity");
  const v = validateActivity(req.data, nowISO10());
  if (!v.ok) throw new HttpsError("invalid-argument", v.error);
  const d = req.data || {};
  // Propriétaire : explicite si fourni, sinon le créateur (défaut Salesforce). visibleTo = chaîne
  // ascendante → la timeline suit la sécurité par enregistrement (Lot 2) sous OWD « private ».
  const ownerUid = d.ownerUid !== undefined ? (d.ownerUid ? String(d.ownerUid) : req.auth.uid) : req.auth.uid;
  // visibleTo = UNION de la chaîne du propriétaire de l'activité ET de celle du propriétaire de
  // l'enregistrement rattaché (compte/opp) → le propriétaire du record voit les activités qu'un tiers
  // journalise sur SON enregistrement (sinon, sous OWD « private », il en serait exclu — re-audit).
  const relColl = v.value.relatedType === "account" ? "accounts" : "opportunities";
  const relSnap = await db.doc(`${relColl}/${v.value.relatedId}`).get();
  // OWD privé : on ne journalise une activité que sur un enregistrement qu'on VOIT déjà — sinon
  // injection dans la timeline d'un enregistrement hors périmètre (audit RBAC).
  await assertRecordVisible(req, relColl, relSnap.exists ? (relSnap.data() || {}) : {});
  const relOwner = relSnap.exists ? relSnap.data().ownerUid : null;
  const chains = await Promise.all([visibleToFor(ownerUid), relOwner ? visibleToFor(relOwner) : Promise.resolve([])]);
  const visibleTo = Array.from(new Set([].concat(...chains)));
  const doc = { ...v.value, ownerUid, visibleTo, updatedAt: FieldValue.serverTimestamp() };
  let id = d.id ? String(d.id) : null;
  if (id) { assertPlainId(id, "id activité"); await db.doc(`activities/${id}`).set(doc, { merge: true }); }
  else { const ref = await db.collection("activities").add({ ...doc, createdBy: req.auth.uid, createdAt: FieldValue.serverTimestamp() }); id = ref.id; }
  await db.collection("auditLog").add({ uid: req.auth.uid, action: "upsert_activity", module: "pipeline", entity: "activity", entityId: id, detail: { type: v.value.type, relatedId: v.value.relatedId }, ts: FieldValue.serverTimestamp() });
  return { ok: true, id };
});

exports.deleteActivity = onCallG("deleteActivity", { memoryMiB: 256, timeoutSeconds: 60 }, async (req) => {
  await requireWrite(req, "pipeline");
  const id = assertPlainId(req.data?.id, "id activité");
  const snap = await db.doc(`activities/${id}`).get();
  if (!snap.exists) return { ok: true }; // idempotent : déjà supprimée
  const a = snap.data() || {};
  // Visibilité par enregistrement (parité listActivities/upsertActivity, Lot 13) : sous OWD privé, on ne
  // supprime que les activités de SON périmètre — sinon un tiers efface une activité hors de sa ligne.
  const { activityVisible } = require("./domain/activity");
  const relColl = a.relatedType === "account" ? "accounts" : "opportunities";
  const priv = (await recordAccessOwd(relColl)) === "private";
  if (!activityVisible(a, priv, await isRecordAdmin(req), req.auth.uid)) {
    throw new HttpsError("permission-denied", "activité hors de votre périmètre");
  }
  await db.doc(`activities/${id}`).delete();
  await db.collection("auditLog").add({ uid: req.auth.uid, action: "delete_activity", module: "pipeline", entity: "activity", entityId: id, ts: FieldValue.serverTimestamp() });
  return { ok: true };
});

// Liste des activités — lecture gouvernée « pipeline », visibilité par enregistrement appliquée ICI.
// args : { relatedId? (timeline d'un enregistrement), mine? (mes activités/tâches), openTasksOnly?,
// limit? }. Sans relatedId ni mine : flux global (plafonné). Tri : tâches ouvertes d'abord (par
// échéance croissante), puis reste par date d'activité décroissante.
exports.listActivities = onCallG("listActivities", { memoryMiB: 256, timeoutSeconds: 60 }, async (req) => {
  await requireRead(req, "pipeline");
  const d = req.data || {};
  let q = db.collection("activities");
  if (d.relatedId) q = q.where("relatedId", "==", String(d.relatedId));
  else if (d.mine) q = q.where("ownerUid", "==", req.auth.uid);
  // FLUX GLOBAL (sans filtre) : tri serveur par date DÉCROISSANTE AVANT le plafond — sinon `.limit(1000)`
  // retient un sous-ensemble ARBITRAIRE (ordre `__name__`) et « récent » omet les plus récentes à N grand.
  // orderBy mono-champ (aucun index composite requis). Les chemins filtrés (relatedId/mine) restent bornés par nature.
  else q = q.orderBy("createdAt", "desc");
  const cap = Math.min(500, Math.max(1, Number(d.limit) || 300));
  const snap = await q.limit(1000).get();
  let rows = snap.docs.map((s) => ({ id: s.id, ...s.data() }));
  // Visibilité par enregistrement : chaque activité est filtrée par l'OWD de SON type de rattachement
  // (compte OU opportunité — OWD indépendants). Sous OWD « private », un non-admin ne voit que les
  // activités de sa ligne hiérarchique (visibleTo). Public/admin → tout.
  const oppPrivate = (await recordAccessOwd("opportunities")) === "private";
  const accPrivate = (await recordAccessOwd("accounts")) === "private";
  if ((oppPrivate || accPrivate) && !(await isRecordAdmin(req))) {
    const { activityVisible } = require("./domain/activity"); // même prédicat que deleteActivity (source unique)
    rows = rows.filter((a) => activityVisible(a, a.relatedType === "account" ? accPrivate : oppPrivate, false, req.auth.uid));
  }
  if (d.openTasksOnly) rows = rows.filter((a) => a.type === "task" && a.done !== true);
  const { isOverdue } = require("./domain/activity");
  const today = nowISO10();
  const openTask = (a) => a.type === "task" && a.done !== true;
  rows.sort((a, b) => {
    const ao = openTask(a), bo = openTask(b);
    if (ao !== bo) return ao ? -1 : 1;                       // tâches ouvertes d'abord
    if (ao && bo) return String(a.dueDate || "9999").localeCompare(String(b.dueDate || "9999")); // par échéance
    return String(b.at || "").localeCompare(String(a.at || "")); // sinon par date d'activité desc
  });
  return { ok: true, activities: rows.slice(0, cap).map((a) => ({ ...a, overdue: isOverdue(a, today) })), total: rows.length };
});

// === APPROBATIONS (Lot 4 « niveau Salesforce ») — processus d'approbation gouvernable : une action
// sensible est SOUMISE, routée vers l'approbateur (manager du demandeur — hiérarchie Lot 2 — sinon
// direction), puis approuvée/rejetée avec traçabilité. Comble l'écart #4 (aucun processus gouvernable).
// ACCÈS PAR CALLABLE (approvals/* read:false+write:false) : visibilité appliquée serveur, cohérent
// avec activities. Gouverné « pipeline », audité.
async function anyDirectionUid(exceptUid) {
  const snap = await db.collection("users").where("role", "==", "direction").limit(10).get();
  const cand = snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((u) => u.active !== false && u.id !== exceptUid);
  return cand.length ? cand[0].id : null;
}

exports.submitForApproval = onCallG("submitForApproval", { secrets: [GRAPH_CLIENT_SECRET], memoryMiB: 256, timeoutSeconds: 60 }, async (req) => {
  await requireWrite(req, "pipeline");
  const { validateApprovalRequest, approverFor } = require("./domain/approval");
  const { ownerChain } = require("./domain/hierarchy");
  const v = validateApprovalRequest(req.data);
  if (!v.ok) throw new HttpsError("invalid-argument", v.error);
  const requester = req.auth.uid;
  const usersMap = await loadUsersMap();
  const approverUid = approverFor(usersMap, requester, await anyDirectionUid(requester));
  if (!approverUid) throw new HttpsError("failed-precondition", "aucun approbateur disponible (définir un manager ou un compte direction)");
  // visibleTo = ligne hiérarchique du demandeur + l'approbateur → la demande suit la sécurité par
  // enregistrement (le demandeur, sa hiérarchie et l'approbateur la voient).
  const visibleTo = Array.from(new Set([...ownerChain(usersMap, requester), approverUid]));
  const doc = {
    ...v.value, status: "pending", requestedBy: requester,
    requestedByName: (usersMap[requester] && usersMap[requester].name) || null,
    approverUid, visibleTo, at: nowISO10(), createdAt: FieldValue.serverTimestamp(),
  };
  const ref = await db.collection("approvals").add(doc);
  await db.collection("auditLog").add({ uid: requester, action: "approval_submit", module: "pipeline", entity: "approval", entityId: ref.id, detail: { kind: v.value.kind, entityId: v.value.entityId, approverUid }, ts: FieldValue.serverTimestamp() });
  // Email au décideur (best-effort — n'échoue jamais la soumission). Résout son adresse dans l'annuaire.
  try {
    const emailCfg = await loadEmailCfg();
    if (emailCfg.enabled && emailCfg.triggers.approvals) {
      const approver = (await db.doc(`users/${approverUid}`).get()).data() || {};
      if (approver.email) {
        const { buildApprovalEmail } = require("./domain/emailNotify");
        const mail = buildApprovalEmail({ type: v.value.kind, typeLabel: v.value.kind, label: v.value.label || v.value.entityId, amount: v.value.amount, note: v.value.note, requester: doc.requestedByName || "Un collaborateur" });
        await sendEmail(emailCfg, { to: approver.email, subject: mail.subject, html: mail.html });
      }
    }
  } catch (e) { logger.warn("approval email: non envoyé", { msg: e && e.message }); }
  return { ok: true, id: ref.id, approverUid };
});

exports.decideApproval = onCallG("decideApproval", { memoryMiB: 512, timeoutSeconds: 300 }, async (req) => {
  // DÉCIDER ≠ ÉDITER une opp : droit LECTURE `pipeline` suffit (le manager approbateur peut n'avoir que
  // la lecture). QUI peut décider reste borné dur ci-dessous (approbateur désigné OU direction) → aucune
  // fuite. Corrige le workflow d'approbation bloqué quand le décideur n'a pas `pipeline:write` (audit).
  await requireRead(req, "pipeline");
  const id = assertPlainId(req.data?.id, "id approbation");
  const decision = String(req.data?.decision || "");
  if (!["approved", "rejected"].includes(decision)) throw new HttpsError("invalid-argument", "décision invalide");
  const ref = db.doc(`approvals/${id}`);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", "demande introuvable");
  const cur = snap.data() || {};
  if (cur.status !== "pending") throw new HttpsError("failed-precondition", "demande déjà traitée");
  // Seul l'approbateur désigné OU la direction peut décider (pas d'auto-approbation par le demandeur).
  const isDir = req.auth.token?.nt360Role === "direction";
  if (cur.approverUid !== req.auth.uid && !isDir) throw new HttpsError("permission-denied", "réservé à l'approbateur ou à la direction");
  if (cur.requestedBy === req.auth.uid && !isDir) throw new HttpsError("permission-denied", "un demandeur ne peut pas approuver sa propre demande");
  await ref.set({ status: decision, decidedBy: req.auth.uid, decidedAt: FieldValue.serverTimestamp(), decisionNote: String(req.data?.note || "").trim().slice(0, 1000) }, { merge: true });
  await db.collection("auditLog").add({ uid: req.auth.uid, action: "approval_decide", module: "pipeline", entity: "approval", entityId: id, detail: { decision, entityId: cur.entityId }, ts: FieldValue.serverTimestamp() });
  // EFFET ASTREINTE APPLIQUÉ EN SYNCHRONE (audit rentabilité H2) : le trigger onMntApprovalDecided est
  // env-gaté (RECOMPUTE_REGION) et ABSENT du déploiement — sans lui, une astreinte approuvée restait
  // « en_attente » POUR TOUJOURS : sa charge n'était jamais comptée (mntContratPnl, marge de livraison,
  // mnt_risque) → marge SURESTIMÉE en silence. Best-effort (la décision est déjà écrite) ; idempotent
  // (on ne mute que si l'astreinte n'est pas déjà décidée — le trigger, s'il est un jour déployé,
  // réécrira les mêmes valeurs). L'effet CONTRAT (renouvellement/résiliation) reste porté par le trigger.
  if (cur.entityType === "astreinte" && cur.entityId) {
    try {
      const { isMntEnabled } = require("./domain/mntFeature");
      if (isMntEnabled((await db.doc("config/mntFeature").get()).data())) {
        const statut = decision === "approved" ? "validee" : "rejetee";
        const aRef = db.doc(`mnt_astreintes/${cur.entityId}`);
        const aSnap = await aRef.get();
        if (aSnap.exists && !["validee", "rejetee"].includes(String((aSnap.data() || {}).statut))) {
          await aRef.set({ statut, decidedBy: req.auth.uid, decidedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
          await db.collection("auditLog").add({ uid: req.auth.uid, action: "astreinte_decide", module: "maintenance", entity: "astreinte", entityId: cur.entityId, detail: { statut, approvalId: id }, ts: FieldValue.serverTimestamp() });
          if (statut === "validee") await refreshNowBestEffort("decideApproval", ["maintenance"]); // la charge validée pèse dans la marge
        }
      }
    } catch (e) { logger.error("decideApproval : effet astreinte en échec (décision enregistrée)", { id, message: e && e.message }); }
  }
  await fireOutbound("approval_decided", { approvalId: id, decision, kind: cur.kind, entityId: cur.entityId, amount: cur.amount ?? null }); // Lot 7b
  return { ok: true, id, status: decision };
});

// Liste des approbations — box : « toDecide » (à décider par moi), « mine » (mes demandes), « all »
// (toutes, réservé admin). Visibilité par enregistrement appliquée serveur (comme listActivities).
exports.listApprovals = onCallG("listApprovals", { memoryMiB: 256, timeoutSeconds: 60 }, async (req) => {
  await requireRead(req, "pipeline");
  const box = String(req.data?.box || "toDecide");
  // box « all » = RÉSERVÉ ADMIN (garde-fou dur, indépendant de l'OWD) — sinon fuite org-wide sous OWD
  // public (re-audit). Les non-admins n'ont accès qu'à « toDecide » (à décider par moi) / « mine ».
  if (box === "all" && !(await isRecordAdmin(req))) throw new HttpsError("permission-denied", "réservé aux administrateurs");
  let q = db.collection("approvals");
  if (box === "toDecide") q = q.where("approverUid", "==", req.auth.uid).where("status", "==", "pending");
  else if (box === "mine") q = q.where("requestedBy", "==", req.auth.uid);
  // box « all » (admin, sans filtre) : tri serveur par date décroissante avant le plafond — sinon 500
  // approbations ARBITRAIRES (ordre `__name__`). orderBy mono-champ (aucun index composite requis).
  else q = q.orderBy("createdAt", "desc");
  const snap = await q.limit(500).get();
  // Le montant d'une astreinte est une CHARGE confidentielle (ADR-035, révisé) : masqué (null) pour un
  // approbateur/lecteur SANS droit `rentabilite`. L'approbation reste possible sur le libellé + le motif ;
  // le chiffre exact exige le droit coût. Les autres natures (remise/DR/BC) portent un montant non
  // confidentiel (pipeline) — inchangées.
  const { canRead } = require("./domain/authz");
  const role = req.auth.token?.nt360Role;
  const matrix = ((await db.doc("config/permissions").get()).data() || {}).matrix || {};
  const hasCost = role === "direction" || canRead(matrix, role, "rentabilite");
  const rows = snap.docs.map((s) => {
    const d = { id: s.id, ...s.data() };
    if (d.entityType === "astreinte" && !hasCost) d.amount = null; // charge confidentielle masquée
    return d;
  });
  // Tri : en attente d'abord, puis par date décroissante.
  rows.sort((a, b) => {
    const ap = a.status === "pending", bp = b.status === "pending";
    if (ap !== bp) return ap ? -1 : 1;
    return String(b.at || "").localeCompare(String(a.at || ""));
  });
  return { ok: true, approvals: rows.slice(0, 300), total: rows.length };
});

// === PRÉVISION COMMERCIALE GOUVERNABLE (Lot 5) — roll-up des catégories de prévision (Commit/Best
// Case/Pipeline/Closed) sur le périmètre VISIBLE de l'appelant (sécurité par enregistrement), avec
// atteinte de l'objectif CAS (quota). Callable (comme listActivities) : évite un summary par utilisateur
// et respecte la visibilité. Gouverné « pipeline ».
exports.forecastRollup = onCallG("forecastRollup", { memoryMiB: 256, timeoutSeconds: 60 }, async (req) => {
  await requireRead(req, "pipeline");
  const { rollupForecast, rollupForecastByAm } = require("./domain/forecast");
  const { plausibleYear, fpKey } = require("./lib/ids");
  const { isAgedLost, isDormantClosing } = require("./domain/oppLifecycle");
  const { dedupOppsByFp } = require("./domain/oppPipeline");
  const [oppSnap, fiscalDoc, projDoc] = await Promise.all([
    // source/ageDays/probability : requis par isAgedLost (parité pipeline/board/scoring/vélocité).
    // fp + updatedAt : requis pour la dédup (intra/inter-source) et l'exclusion des opps DÉJÀ AU CARNET
    // (parité stricte avec l'assiette pipeline du reste de la famille — cf. audit cohérence).
    // Scan BORNÉ (MAX_SCAN+1 + sliceCapped, comme scoreOpportunities) — pression mémoire maîtrisée à N grand.
    db.collection("opportunities").select("client", "am", "stage", "amount", "forecastCategory", "closingDate", "stale", "source", "ageDays", "probability", "ownerUid", "visibleTo", "fp", "updatedAt").limit(MAX_SCAN + 1).get(),
    db.doc("config/fiscal").get(),
    db.doc("config/projection").get(),
  ]);
  const { docs: oppDocs, capped } = sliceCapped(oppSnap.docs);
  // Exclusion des DORMANTES (année de closing < exercice) de la prévision CUMULÉE (« Tout ») — même
  // drapeau/prédicat que le recompute (aggregate.js) → Commit/Best Case/Pipeline cohérents avec le
  // Cockpit. En mode année, le filtre de millésime (closingDate == periodYear) les écarte déjà.
  const excludeDormant = (projDoc.data() || {}).excludeDormant !== false;
  // Population COHÉRENTE avec le reste de la famille pipeline (cf. audit chiffres, divergence D) : NON `stale`
  // ET NON périmée par âge. isAgedLost ne touche que les OUVERTES (1-5) → les catégories Closed/gagné sont
  // conservées ; une opp ouverte périmée n'apparaît plus en Best Case/Pipeline ici alors qu'elle est absente
  // du scoring/vélocité.
  let opps = oppDocs.map((d) => ({ id: d.id, ...d.data() })).filter((o) => o.stale !== true && !isAgedLost(o));
  // Visibilité par enregistrement : sous OWD « private », un non-admin ne prévoit que son périmètre.
  const scoped = (await recordAccessOwd("opportunities")) === "private" && !(await isRecordAdmin(req));
  if (scoped) opps = opps.filter((o) => Array.isArray(o.visibleTo) && o.visibleTo.includes(req.auth.uid));
  const fiscalFy = (fiscalDoc.data() || {}).currentFy || 0;
  // EXERCICE SÉLECTIONNÉ. `period` = année ("2026") ou "all"/absent (cumul, référence quota = exercice courant).
  const periodYear = plausibleYear(String(req.data?.period || ""));
  // GAGNÉ (« Closed ») = CARNET de l'exercice, PAS les opps gagnées filtrées par closingDate. L'année de
  // gain fiable est celle de la COMMANDE (`yearPo`, dérivée du P&L/N° FP) ; sur une opp gagnée, `closingDate`
  // est la date de clôture PRÉVUE — souvent nulle ou d'un autre millésime — donc inexploitable pour le
  // millésime (cf. audit). On lit les lignes de commande MATÉRIALISÉES (summaries/commandesRows/*), la même
  // source que le cockpit (useCommandesRows → overviewCalc) → parité EXACTE du gagné avec le carnet.
  // `bookedFps` = TOUS les FP portés par le carnet (toutes années). Une opp OUVERTE dont le FP est déjà
  // au carnet serait comptée DEUX FOIS (dans Closed=CAS carnet ET dans le palier ouvert) → on l'exclut,
  // exactement comme le reste de la famille pipeline (chaine/pipeline/atterrissage excluent les FP bookés).
  // CLOISON (OWD private) : le carnet n'est PAS record-scopé → sous périmètre restreint, une ligne carnet
  // ne compte dans le « Closed » que si son FP correspond à une opp VISIBLE de l'appelant (attribution via
  // l'opp). `bookedFps` reste GLOBAL : l'exclusion anti-double-compte du pipeline ne dépend pas du périmètre.
  const visibleFps = scoped ? new Set(opps.map((o) => fpKey(o.fp)).filter(Boolean)) : null;
  const cmdSnap = await db.collection("commandesRows").get();
  let closedAmount = 0, closedCount = 0, maxYearPo = 0; const bookedFps = new Set();
  const closedByAm = new Map(); // réalisé CAS par commercial (ventilation forecast par AM)
  for (const chunk of cmdSnap.docs) {
    for (const o of (chunk.data() || {}).rows || []) {
      const k = fpKey(o.fp); if (k) bookedFps.add(k);
      maxYearPo = Math.max(maxYearPo, plausibleYear(o.yearPo) || 0); // repli exercice = max PO borné (parité aggregate)
      if (periodYear && plausibleYear(o.yearPo) !== periodYear) continue; // filtre millésime carnet
      if (visibleFps && !(k && visibleFps.has(k))) continue; // cloison : réalisé hors périmètre visible exclu
      const cas = Number(o.cas) || 0;
      closedAmount += cas; closedCount++;
      const am = o.am || "—"; const e = closedByAm.get(am) || { amount: 0, count: 0 }; e.amount += cas; e.count++; closedByAm.set(am, e);
    }
  }
  // Exercice courant : config/fiscal en priorité, PUIS repli sur max(yearPo borné) — MÊME règle
  // qu'aggregate.js (sinon l'ensemble « dormant » diverge entre le forecast et le pondéré du Cockpit
  // quand config/fiscal.currentFy n'est pas encore écrit). Année civile en dernier recours seulement.
  const currentFy = fiscalFy || maxYearPo || new Date().getUTCFullYear();
  const targetFy = periodYear || currentFy;
  // DÉDUP (source unique domain/oppPipeline, parité aggregate.js/scoring/vélocité/capacité) : sinon des
  // doublons de FP salesData (ids hérités) ou une opp 'saisie' ré-importée en LIVE gonflent le prévisionnel.
  opps = dedupOppsByFp(opps);
  // Les OUVERTES (1-5) alimentent commit/best_case/pipeline : filtrées par leur date de clôture PRÉVUE
  // (closingDate) ET privées de celles DÉJÀ AU CARNET (bookedFps). Les gagnées (stage 6) sont ignorées par
  // rollupForecast (le carnet les porte) → aucun double-compte, assiette alignée sur le pondéré du Cockpit.
  opps = opps.filter((o) => {
    if (Number(o.stage) === 6) return false;                 // gagné : porté par le carnet
    const k = fpKey(o.fp); if (k && bookedFps.has(k)) return false; // déjà au carnet → pas de double-compte
    if (periodYear && String(o.closingDate || "").slice(0, 4) !== String(periodYear)) return false;
    if (excludeDormant && !periodYear && isDormantClosing(o, currentFy)) return false; // « Tout » : hors dormantes
    return true;
  });
  const rollup = rollupForecast(opps, closedAmount, closedCount);
  // Quota = objectif CAS annuel GLOBAL de l'exercice. Sous OWD private (scoped), un objectif d'ENTREPRISE
  // n'est PAS attribuable à un sous-périmètre → quota (et donc atteinte) masqués : pas de référence trompeuse
  // (attainment devient null). Le « réalisé » cloisonné ci-dessus reste, lui, exposé pour le périmètre.
  let quota = 0;
  if (!scoped) {
    const objSnap = await db.collection("objectives").where("fiscalYear", "==", targetFy).where("scope", "==", "global").get();
    quota = objSnap.docs.reduce((s, d) => s + (Number(d.data().targetCas) || 0), 0);
  }
  return {
    ok: true, fiscalYear: targetFy, allPeriods: !periodYear, scoped, quota, capped,
    ...rollup,
    // Ventilation par COMMERCIAL (forecast review 1:1) — même assiette cloisonnée (opps visibles + réalisé
    // du périmètre). Le carnet gagné est attribué par `am` de la ligne commande.
    byAm: rollupForecastByAm(opps, closedByAm),
    attainment: quota > 0 ? { closed: rollup.closed / quota, commit: rollup.commit / quota, bestCase: rollup.bestCase / quota } : null,
  };
});

// === SCORING IA EXPLICABLE (Lot 5b) — classe les opportunités OUVERTES par probabilité de gain
// (modèle additif transparent, domain/scoring.js) sur le périmètre visible de l'appelant. Comble
// l'écart #5 (aucune IA prédictive). Callable, gouverné « pipeline ».
exports.scoreOpportunities = onCallG("scoreOpportunities", { memoryMiB: 256, timeoutSeconds: 60 }, async (req) => {
  await requireRead(req, "pipeline");
  const { scoreOpportunity, isOpen } = require("./domain/scoring");
  const { isAgedLost } = require("./domain/oppLifecycle");
  const { calibrate } = require("./domain/scoreCalib");
  const { dedupOppsByFp } = require("./domain/oppPipeline");
  // `source`/`ageDays` chargés pour EXCLURE la MÊME population que pipeline/board/vélocité (parité) :
  // fantômes `stale` (retirés de LIVE) et affaires périmées par âge (`isAgedLost`). `fp`/`updatedAt` : dédup
  // par FP (une 'saisie' ré-importée en salesData ne doit pas produire 2 lignes de score).
  const snap = await db.collection("opportunities")
    .select("client", "am", "amount", "stage", "probability", "forecastCategory", "nextStep", "nextStepDate", "dr", "mbPrev", "stale", "source", "ageDays", "fp", "updatedAt", "visibleTo")
    .limit(MAX_SCAN + 1).get(); // scan borné (R1)
  const all = sliceCapped(snap.docs).docs.map((d) => ({ id: d.id, ...d.data() }));
  // Calibration EMPIRIQUE (R6, dé-biais audit) : base + poids de catégorie dérivés du taux de gain HISTORIQUE.
  // Population fermée DÉDUPLIQUÉE par FP (une 'saisie' ré-importée ne compte pas deux fois) et incluant les
  // AUTO-PERDUES PAR ÂGE comme des PERTES — sinon le taux de gain de base est surévalué (ces affaires restent
  // stockées en étape 1-5, donc absentes du dénominateur). Catégorie EFFECTIVE (posée sinon dérivée de l'étape)
  // pour aligner les paliers de calibration sur le forecast (au lieu du champ brut, souvent vide).
  const { effectiveCategory } = require("./domain/forecast");
  const closed = dedupOppsByFp(all)
    .filter((o) => Number(o.stage) === 6 || Number(o.stage) === 7 || isAgedLost(o))
    .map((o) => ({ won: Number(o.stage) === 6, forecastCategory: effectiveCategory(o) }));
  const calib = calibrate(closed);
  // Population alignée sur pipeline/vélocité : NON `stale`, NON périmée par âge, DÉDUPLIQUÉE par FP (parité
  // aggregate.js). On DÉDUPLIQUE sur l'ensemble stale/aged-filtré (toutes étapes) AVANT de restreindre aux
  // OUVERTES — même ordre que forecastRollup. NB : les DORMANTES (closing d'un exercice révolu) restent
  // listées à dessein — une affaire ouverte qui a glissé est encore À TRAVAILLER (liste d'action, pas
  // prévision de CA). Seul le pondéré prévisionnel (cockpit/vélocité) les écarte.
  const scoped = (await recordAccessOwd("opportunities")) === "private" && !(await isRecordAdmin(req));
  let base = all.filter((o) => o.stale !== true && !isAgedLost(o));
  if (scoped) base = base.filter((o) => Array.isArray(o.visibleTo) && o.visibleTo.includes(req.auth.uid));
  const opps = dedupOppsByFp(base).filter((o) => isOpen(o));
  const today = nowISO10();
  const rows = opps.map((o) => {
    const s = scoreOpportunity(o, today, calib);
    // Facteurs COMPLETS (triés par le domaine) : le front tranche l'affichage (top 3 en ligne + « +N »,
    // liste complète au survol). Tronquer à 3 côté serveur rendait l'explicabilité « additive » mensongère.
    return { id: o.id, client: o.client || null, am: o.am || null, amount: Number(o.amount) || 0, stage: Number(o.stage) || 0, score: s.score, band: s.band, factors: s.factors };
  }).sort((a, b) => b.score - a.score || b.amount - a.amount);
  const bands = { hot: 0, warm: 0, cold: 0 };
  rows.forEach((r) => { if (bands[r.band] != null) bands[r.band]++; });
  // Transparence : on remonte la calibration effective (n historique, base observée) pour affichage.
  const calibMeta = calib ? { calibrated: true, sample: calib.n, baseWinRate: Math.round(calib.base * 100) } : { calibrated: false };
  return { ok: true, scoped, rows: rows.slice(0, 500), bands, total: rows.length, calib: calibMeta };
});

// === VÉLOCITÉ COMMERCIALE (Lot 8b) — indicateurs de dynamique du pipeline (taux de gain, deal moyen,
// pipeline pondéré, indice de vélocité) sur le périmètre VISIBLE. Callable, gouverné « pipeline ».
exports.salesVelocity = onCallG("salesVelocity", { memoryMiB: 256, timeoutSeconds: 60 }, async (req) => {
  await requireRead(req, "pipeline");
  const { salesVelocity } = require("./domain/velocity");
  const { normalizeTiers } = require("./domain/projection");
  const { fpKey, plausibleYear } = require("./lib/ids");
  const { dedupOppsByFp } = require("./domain/oppPipeline");
  const { isDormantClosing } = require("./domain/oppLifecycle");
  const [projDoc, fiscalDoc] = await Promise.all([db.doc("config/projection").get(), db.doc("config/fiscal").get()]);
  const tiers = normalizeTiers(projDoc.data() || undefined);
  const excludeDormant = (projDoc.data() || {}).excludeDormant !== false;
  // probability/ageDays/source : pondéré TIÉRÉ + exclusion des périmées (isAgedLost) ; `fp`/`updatedAt` : dédup
  // + exclusion des opps DÉJÀ au carnet ; `closingDate` : exclusion des DORMANTES (closing d'un exercice
  // révolu) — MÊME assiette que le « Pondéré projeté » du cockpit (invariant fort « même métrique = même nombre »).
  const snap = await db.collection("opportunities").select("stage", "amount", "probability", "ageDays", "source", "stale", "fp", "updatedAt", "closingDate", "visibleTo").limit(MAX_SCAN + 1).get();
  let opps = sliceCapped(snap.docs).docs.map((d) => d.data()).filter((o) => o.stale !== true);
  if ((await recordAccessOwd("opportunities")) === "private" && !(await isRecordAdmin(req))) {
    opps = opps.filter((o) => Array.isArray(o.visibleTo) && o.visibleTo.includes(req.auth.uid));
  }
  // Dédup FP (source unique domain/oppPipeline, parité aggregate.js) AVANT l'agrégation : une 'saisie'
  // ré-importée en salesData ou un doublon salesData doublerait sinon le pondéré ET le taux de gain.
  opps = dedupOppsByFp(opps);
  // Carnet P&L matérialisé (commandesRows/*) → FP au carnet (anti-double-compte) + max(yearPo) pour l'exercice.
  const bookedFps = new Set(); let maxYearPo = 0;
  try {
    const cmdSnap = await db.collection("commandesRows").get();
    for (const d of cmdSnap.docs) for (const r of (d.data().rows || [])) { const k = fpKey(r.fp); if (k) bookedFps.add(k); maxYearPo = Math.max(maxYearPo, plausibleYear(r.yearPo) || 0); }
  } catch { /* carnet indisponible → repli sans exclusion (pas de blocage de la vélocité) */ }
  // Exercice courant : config/fiscal prioritaire, PUIS repli max(yearPo borné) — MÊME règle qu'aggregate.js.
  const currentFy = ((fiscalDoc.data() || {}).currentFy || 0) || maxYearPo || new Date().getUTCFullYear();
  // DORMANTES écartées du pondéré ouvert (parité cockpit) — n'affecte que les OUVERTES (isDormantClosing borne 1-5).
  if (excludeDormant) opps = opps.filter((o) => !isDormantClosing(o, currentFy));
  return { ok: true, ...salesVelocity(opps, tiers, bookedFps) };
});

// === FUZZY MATCHING QUALITÉ (Lot 9) — repère les QUASI-DOUBLONS de noms clients (typos, mot en plus)
// que la normalisation exacte n'a pas fusionnés, sur l'ensemble commandes + factures + opportunités.
// Lecture gouvernée « import ». La correction (alias) reste manuelle via setClientAliases.
exports.fuzzyDuplicateClients = onCallG("fuzzyDuplicateClients", { memoryMiB: 512, timeoutSeconds: 120 }, async (req) => {
  await requireRead(req, "import");
  const { findFuzzyDuplicates } = require("./domain/fuzzy");
  const [ord, inv, opp] = await Promise.all([
    db.collection("orders").select("client").limit(MAX_SCAN + 1).get(),
    db.collection("invoices").select("client").limit(MAX_SCAN + 1).get(),
    db.collection("opportunities").select("client", "visibleTo").limit(MAX_SCAN + 1).get(),
  ]);
  // Scans BORNÉS (MAX_SCAN+1 + sliceCapped, comme le jumeau strict `clientNames`) — mémoire maîtrisée à N grand.
  const ordD = sliceCapped(ord.docs).docs, invD = sliceCapped(inv.docs).docs, oppD = sliceCapped(opp.docs).docs;
  const names = new Set();
  for (const docs of [ordD, invD]) docs.forEach((d) => { const c = String(d.data().client || "").trim(); if (c) names.add(c); });
  // OWD « private » sur les opportunités : ne PAS divulguer les noms de clients d'opps hors périmètre à un
  // rôle import:read non-admin (parité avec scopedOpps). Commandes/factures ne sont pas record-level scopées.
  const oppPrivate = (await recordAccessOwd("opportunities")) === "private" && !(await isRecordAdmin(req));
  oppD.forEach((d) => {
    const o = d.data();
    if (oppPrivate && !(Array.isArray(o.visibleTo) && o.visibleTo.includes(req.auth.uid))) return;
    const c = String(o.client || "").trim(); if (c) names.add(c);
  });
  const threshold = Math.min(0.95, Math.max(0.7, Number(req.data?.threshold) || 0.84));
  // `scanned` = noms EFFECTIVEMENT comparés (après plafond O(n²)) ; `capped` signale une troncature (au-delà,
  // des quasi-doublons peuvent rester invisibles) — plutôt qu'annoncer names.size en laissant croire à l'exhaustivité.
  const { pairs, scanned, capped } = findFuzzyDuplicates([...names], threshold);
  return { ok: true, pairs, scanned, total: names.size, capped, threshold };
});

// === ATELIER DE NORMALISATION CLIENTS — INVENTAIRE de tous les noms de clients (commandes + factures +
// opportunités) avec leur COMPTE et leur CIBLE CANONIQUE effective (règles + alias config/clientAliases).
// Donne à voir, en UN endroit, les graphies qui se regroupent déjà et celles à aliaser. Lecture « import ».
// La correction (poser un alias) reste gouvernée par setClientAliases (direction). Scan borné (R1).
exports.clientNames = onCallG("clientNames", { memoryMiB: 512, timeoutSeconds: 120 }, async (req) => {
  await requireRead(req, "import");
  const { groupClientNames } = require("./domain/clientName");
  const [ord, inv, opp, aliasDoc] = await Promise.all([
    db.collection("orders").select("client").limit(MAX_SCAN + 1).get(),
    db.collection("invoices").select("client").limit(MAX_SCAN + 1).get(),
    db.collection("opportunities").select("client", "visibleTo").limit(MAX_SCAN + 1).get(),
    db.doc("config/clientAliases").get(),
  ]);
  const capped = ord.size > MAX_SCAN || inv.size > MAX_SCAN || opp.size > MAX_SCAN;
  // Comptes par nom BRUT (tous docs). OWD « private » sur opps : un rôle import:read non-admin ne compte
  // que son périmètre (parité fuzzyDuplicateClients). Commandes/factures non record-level scopées.
  const counts = new Map();
  const bump = (raw) => { const c = String(raw || "").trim(); if (c) counts.set(c, (counts.get(c) || 0) + 1); };
  sliceCapped(ord.docs).docs.forEach((d) => bump(d.data().client));
  sliceCapped(inv.docs).docs.forEach((d) => bump(d.data().client));
  const oppPrivate = (await recordAccessOwd("opportunities")) === "private" && !(await isRecordAdmin(req));
  sliceCapped(opp.docs).docs.forEach((d) => { const o = d.data(); if (oppPrivate && !(Array.isArray(o.visibleTo) && o.visibleTo.includes(req.auth.uid))) return; bump(o.client); });
  const names = [...counts.entries()].map(([name, count]) => ({ name, count }));
  const pairs = ((aliasDoc.data() || {}).pairs) || [];
  const groups = groupClientNames(names, pairs);
  // Payload borné : on renvoie les 400 plus gros groupes (couvre l'essentiel du volume) + totaux exacts.
  return {
    ok: true, capped,
    distinctNames: names.length,
    distinctCanon: groups.length,
    toReview: groups.filter((g) => g.hasVariants).length, // groupes à ≥ 2 graphies (déjà fusionnées)
    aliasCount: pairs.length,
    groups: groups.slice(0, 400),
  };
});

// === REPORTING SELF-SERVICE (Lot 6) — moteur de rapport sur les opportunités (filtres + regroupement +
// mesure, domain/report.js) exécuté sur le périmètre VISIBLE de l'appelant, + définitions de rapport
// sauvegardées/partagées (reports/*, callable-only). Comble l'écart #6 (aucun reporting self-service).
async function scopedOpps(req, fields) {
  // Scan BORNÉ (MAX_SCAN+1 + sliceCapped) — mémoire maîtrisée à N grand (capacityPlan/runReport/…).
  const snap = await db.collection("opportunities").select(...fields, "visibleTo").limit(MAX_SCAN + 1).get();
  let opps = sliceCapped(snap.docs).docs.map((d) => ({ id: d.id, ...d.data() }));
  if ((await recordAccessOwd("opportunities")) === "private" && !(await isRecordAdmin(req))) {
    opps = opps.filter((o) => Array.isArray(o.visibleTo) && o.visibleTo.includes(req.auth.uid));
  }
  return opps;
}

// Reporting self-service EXTRAIT dans handlers/reports.js (patron R3 — découpe du monolithe). Deps
// d'infra + helpers injectés ; les exports restent DÉCLARÉS ici (garde-fou de déploiement par nom).
const { createReports } = require("./handlers/reports");
const _reports = createReports({ onCallG, requireRead, requireWrite, db, HttpsError, FieldValue, scopedOpps, loadUsersMap, assertPlainId });
exports.runReport = _reports.runReport;
exports.saveReport = _reports.saveReport;
exports.listReports = _reports.listReports;
exports.deleteReport = _reports.deleteReport;

// === API REST PUBLIQUE (Lot 7) — endpoint HTTP versionné (/v1) authentifié par CLÉ API (Bearer), pour
// intégrer nt360 à un SI tiers. Comble l'écart #7 (aucune API/webhooks). Les clés (hachées SHA-256,
// jamais stockées en clair) sont gérées par la direction ; scopes read/write ; rate-limitées. L'API est
// un compte de SERVICE au niveau organisation (voit tout) — distinct des utilisateurs. apiKeys/* est
// read:false+write:false (accès par callables + vérification serveur dans l'endpoint).
exports.createApiKey = onCallG("createApiKey", async (req) => {
  if (req.auth?.token?.nt360Role !== "direction") throw new HttpsError("permission-denied", "admin requis");
  await requireStrongAuth(req); // MFA sur l'émission d'une clé API (compte de service « voit tout »)
  const { hashApiKey } = require("./domain/apiKey");
  const label = String(req.data?.label || "").trim().slice(0, 120) || "clé API";
  const scopesIn = Array.isArray(req.data?.scopes) ? req.data.scopes : ["read"];
  const scopes = scopesIn.filter((s) => ["read", "write"].includes(s));
  if (!scopes.length) scopes.push("read");
  const raw = "nt360_" + require("crypto").randomBytes(24).toString("hex"); // clé brute — affichée UNE fois
  const ref = await db.collection("apiKeys").add({
    hash: hashApiKey(raw), prefix: raw.slice(0, 14), label, scopes, active: true,
    createdBy: req.auth.uid, createdAt: FieldValue.serverTimestamp(),
  });
  await db.collection("auditLog").add({ uid: req.auth.uid, action: "api_key_create", module: "habilitations", entity: "apiKey", entityId: ref.id, detail: { label, scopes }, ts: FieldValue.serverTimestamp() });
  return { ok: true, id: ref.id, key: raw, prefix: raw.slice(0, 14), scopes, note: "Copiez cette clé maintenant : elle ne sera plus affichée." };
});

exports.revokeApiKey = onCallG("revokeApiKey", async (req) => {
  if (req.auth?.token?.nt360Role !== "direction") throw new HttpsError("permission-denied", "admin requis");
  await requireStrongAuth(req); // MFA sur la révocation d'une clé API
  const id = assertPlainId(req.data?.id, "id clé");
  await db.doc(`apiKeys/${id}`).set({ active: false, revokedAt: FieldValue.serverTimestamp(), revokedBy: req.auth.uid }, { merge: true });
  await db.collection("auditLog").add({ uid: req.auth.uid, action: "api_key_revoke", module: "habilitations", entity: "apiKey", entityId: id, ts: FieldValue.serverTimestamp() });
  return { ok: true };
});

exports.listApiKeys = onCallG("listApiKeys", async (req) => {
  if (req.auth?.token?.nt360Role !== "direction") throw new HttpsError("permission-denied", "admin requis");
  const snap = await db.collection("apiKeys").get();
  const keys = snap.docs.map((s) => { const d = s.data(); return { id: s.id, prefix: d.prefix, label: d.label, scopes: d.scopes || [], active: d.active !== false }; })
    .sort((a, b) => (a.active === b.active ? 0 : a.active ? -1 : 1));
  return { ok: true, keys };
});

// Handler HTTP de l'API REST. Authentifie la clé, applique le rate-limit, route et répond en JSON.
async function apiHandler(req, res) {
  const { hashApiKey, parseBearer, matchRoute } = require("./domain/apiKey");
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
  res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  if (req.method === "OPTIONS") { res.status(204).send(""); return; }
  const send = (code, body) => res.status(code).json(body);
  try {
    const token = parseBearer(req.get("Authorization"));
    if (!token) return send(401, { error: "clé API requise (Authorization: Bearer nt360_…)" });
    const keySnap = await db.collection("apiKeys").where("hash", "==", hashApiKey(token)).limit(1).get();
    if (keySnap.empty || keySnap.docs[0].data().active === false) return send(401, { error: "clé API invalide ou révoquée" });
    const keyDoc = keySnap.docs[0]; const scopes = keyDoc.data().scopes || [];
    if (!(await rateLimit(keyDoc.id, "api", 600, 60_000))) return send(429, { error: "quota dépassé (600 req/min)" });
    const route = matchRoute(req.method, (req.path || req.url || "").split("?")[0]);
    if (!route) return send(404, { error: "route inconnue" });
    // Scope de LECTURE requis pour GET (list/get) — une clé « write-only » ne doit pas lire (re-audit).
    if ((route.action === "list" || route.action === "get") && !scopes.includes("read")) return send(403, { error: "scope 'read' requis" });
    // Sélection des champs exposés (pas de fuite de champs internes comme visibleTo).
    const OPP_FIELDS = ["oppId", "client", "am", "bu", "fp", "amount", "stage", "stageLabel", "probability", "weighted", "closingDate", "forecastCategory", "source"];
    const pick = (o, fields) => { const r = { id: o.id }; for (const k of fields) if (o[k] !== undefined) r[k] = o[k]; return r; };
    if (route.resource === "opportunities") {
      if (route.action === "list") {
        let q = db.collection("opportunities");
        if (req.query.bu) q = q.where("bu", "==", String(req.query.bu).toUpperCase());
        if (req.query.stage) q = q.where("stage", "==", Number(req.query.stage));
        const lim = Math.min(500, Math.max(1, Number(req.query.limit) || 100));
        const snap = await q.limit(lim).get();
        return send(200, { data: snap.docs.map((d) => pick({ id: d.id, ...d.data() }, OPP_FIELDS)), count: snap.size });
      }
      if (route.action === "get") {
        const snap = await db.doc(`opportunities/${route.id}`).get();
        if (!snap.exists) return send(404, { error: "opportunité introuvable" });
        return send(200, { data: pick({ id: snap.id, ...snap.data() }, OPP_FIELDS) });
      }
      if (route.action === "create") {
        if (!scopes.includes("write")) return send(403, { error: "scope 'write' requis" });
        const b = req.body || {};
        const client = String(b.client || "").trim();
        if (!client) return send(400, { error: "champ 'client' requis" });
        const { clampStage, oppWeighted } = require("./domain/mutations");
        const { DEFAULT_PROBA, STAGE_LABEL } = require("./parsers/salesData");
        const { fpKey } = require("./lib/ids");
        const stage = clampStage(b.stage);
        const amount = Number(b.amount) || 0;
        const pr = Number(b.probability);
        const probability = pr > 0 && pr <= 100 ? pr : (DEFAULT_PROBA[stage] ?? 0); // IdC en % (0-100)
        const id = "saisie_" + Date.now().toString(36) + require("crypto").randomBytes(4).toString("hex");
        const doc = {
          oppId: id, source: "api", client, am: String(b.am || "").trim(), bu: String(b.bu || "AUTRE").trim().toUpperCase(),
          fp: fpKey(b.fp) || null, amount, stage, stageLabel: STAGE_LABEL[stage] || String(stage),
          probability, weighted: oppWeighted(amount, probability), closingDate: b.closingDate || null,
          ownerUid: null, visibleTo: [], updatedAt: FieldValue.serverTimestamp(), createdAt: FieldValue.serverTimestamp(),
        };
        await db.doc(`opportunities/${id}`).set(doc);
        await db.collection("auditLog").add({ uid: `apiKey:${keyDoc.id}`, action: "api_create_opp", module: "pipeline", entity: "opportunity", entityId: id, detail: { client, stage }, ts: FieldValue.serverTimestamp() });
        await requestRecompute(oppScope(null, stage));
        return send(201, { data: pick({ id, ...doc }, OPP_FIELDS) });
      }
    }
    if (route.resource === "accounts") {
      const ACC_FIELDS = ["name", "sector", "country", "parentId", "tags"];
      if (route.action === "list") {
        const snap = await db.collection("accounts").limit(Math.min(500, Math.max(1, Number(req.query.limit) || 100))).get();
        return send(200, { data: snap.docs.map((d) => pick({ id: d.id, ...d.data() }, ACC_FIELDS)), count: snap.size });
      }
      if (route.action === "get") {
        const snap = await db.doc(`accounts/${route.id}`).get();
        if (!snap.exists) return send(404, { error: "compte introuvable" });
        return send(200, { data: pick({ id: snap.id, ...snap.data() }, ACC_FIELDS) });
      }
    }
    return send(404, { error: "route inconnue" });
  } catch (e) {
    logger.error("api a échoué", { message: e && e.message, stack: e && e.stack });
    return res.status(500).json({ error: "erreur interne" });
  }
}
exports.api = onRequest({ memoryMiB: 512, timeoutSeconds: 60, cors: false }, apiHandler);

// === CHAMPS CUSTOM + WEBHOOKS SORTANTS (Lot 7b) — extensibilité du modèle (champs personnalisés
// d'opportunité, définis par la direction) et diffusion d'événements vers un SI tiers (webhooks
// sortants sur opp gagnée / approbation décidée). Complète la dimension #7 à 10/10.
exports.setCustomFields = onCallG("setCustomFields", async (req) => {
  if (req.auth?.token?.nt360Role !== "direction") throw new HttpsError("permission-denied", "admin requis");
  const { normalizeDefs } = require("./domain/customField");
  const fields = normalizeDefs(req.data?.fields);
  await db.doc("config/customFields").set({ fields }, { merge: false });
  await db.collection("auditLog").add({ uid: req.auth.uid, action: "set_custom_fields", module: "habilitations", entity: "config", entityId: "customFields", detail: { fields: fields.length }, ts: FieldValue.serverTimestamp() });
  return { ok: true, fields };
});

// Webhook sortant (config/outboundWebhooks) : URL + événements souscrits + activation. Direction.
const OUTBOUND_EVENTS = ["opp_won", "approval_decided"];
exports.setOutboundWebhook = onCallG("setOutboundWebhook", async (req) => {
  if (req.auth?.token?.nt360Role !== "direction") throw new HttpsError("permission-denied", "admin requis");
  const d = req.data || {};
  const url = String(d.url || "").trim();
  if (url && !/^https:\/\//i.test(url)) throw new HttpsError("invalid-argument", "URL https requise");
  const events = (Array.isArray(d.events) ? d.events : []).filter((e) => OUTBOUND_EVENTS.includes(e));
  const cfg = { url, events, enabled: d.enabled === true && !!url };
  await db.doc("config/outboundWebhooks").set(cfg, { merge: true });
  await db.collection("auditLog").add({ uid: req.auth.uid, action: "set_outbound_webhook", module: "habilitations", entity: "config", entityId: "outboundWebhooks", detail: { events, enabled: cfg.enabled }, ts: FieldValue.serverTimestamp() });
  // test=true : ping immédiat de vérification.
  if (d.test && cfg.enabled) { try { await postJson(url, { event: "test", data: { ok: true }, ts: new Date().toISOString() }); } catch (_) { /* best-effort */ } }
  return { ok: true, ...cfg };
});

// Sous-système de webhooks sortants EXTRAIT dans handlers/outbound.js (R3 — 1re découpe du monolithe).
// Les dépendances d'infra sont injectées ; l'export retryOutbound reste DÉCLARÉ ici (garde-fou de
// déploiement). postJson/fireOutbound restent utilisables par les callables de ce fichier.
const { createOutbound } = require("./handlers/outbound");
const { postJson, fireOutbound, retryOutbound } = createOutbound({ db, logger, FieldValue, onSchedule });
exports.retryOutbound = retryOutbound;

// === AUTOMATISATION DÉCLARATIVE (Lot 4b) — EXTRAITE dans handlers/automations.js (patron R3). Deps
// injectées ; les exports restent DÉCLARÉS ici (garde-fou de déploiement par nom). runAutomationsCore
// est conservée au module scope car le planifié quotidien (plus haut) l'appelle directement.
const { createAutomations } = require("./handlers/automations");
const _automations = createAutomations({ onCallG, HttpsError, db, FieldValue, loadUsersMap, nowISO10 });
const runAutomationsCore = _automations.runAutomationsCore;
exports.setAutomations = _automations.setAutomations;
exports.runAutomations = _automations.runAutomations;

// --- ASSAINISSEMENT : suppression d'un/plusieurs enregistrement(s) erroné(s) ou fantôme(s). Les
// imports delta n'effacent JAMAIS (ajout / mise à jour uniquement) → seul l'app peut retirer un
// record qui ne doit plus exister. Gouverné par le module RBAC de la donnée, audité, recompute
// derrière. Le DELTA reste prioritaire : si une future ligne source réintroduit ce record (même
// clé), il réapparaît — la suppression assainit l'existant, elle ne verrouille pas contre la source.
// Les identifiants sont des DOC IDS (pas de re-transformation : safeId n'est pas idempotent). ---
// === ASSAINISSEMENT (suppression d'enregistrements + annulation) — EXTRAIT dans handlers/sanitize.js
// (patron R3). Deps injectées ; exports déclarés ici (garde-fou de déploiement par nom). Voir le module
// pour le détail (imports delta non destructifs, overlay d'annulation qui survit au ré-import, atomicité).
const { createSanitize } = require("./handlers/sanitize");
const _sanitize = createSanitize({ onCallG, HttpsError, db, FieldValue, requireWrite, assertPlainId, requestRecompute, recomputeNow: recomputeSummaries, logOps, assertRecordVisible, recordAccessOwd, isRecordAdmin, rateLimit });
exports.deleteRecords = _sanitize.deleteRecords;
exports.setCancellation = _sanitize.setCancellation;
exports.purgeCollections = _sanitize.purgeCollections;

// --- Correction d'une facture EXISTANTE : date de facturation et/ou date d'échéance (les seules
// dérivées manquantes fiabilisables in-app). Le MONTANT n'est pas éditable (intégrité comptable :
// il reste piloté par la source). Recalcule l'échéancier cash + la qualité des données. ---
exports.patchInvoice = onCallG("patchInvoice", { memoryMiB: 512, timeoutSeconds: 300 }, async (req) => {
  await requireWrite(req, "import");
  const id = String(req.data?.id || "");
  if (!id) throw new HttpsError("invalid-argument", "id facture requis");
  assertPlainId(id, "id facture");
  const ref = db.doc(`invoices/${id}`);
  if (!(await ref.get()).exists) throw new HttpsError("not-found", "facture introuvable");
  const d = req.data || {};
  const { toISO } = require("./lib/sheets");
  const { plausibleYear } = require("./lib/ids");
  // MÊME garde qu'à l'import (parsers/facturationDf) : une date au millésime aberrant (1850, 2206) passe
  // toISO (format valide) mais corrompt DSO/aging/overdue. On la REFUSE plutôt que de l'accepter en saisie
  // manuelle alors que l'import la rejette (asymétrie de garde).
  const plausibleIso = (iso) => (iso && plausibleYear(String(iso).slice(0, 4)) ? iso : null);
  const chk = (raw, label) => { const iso = toISO(raw); if (raw && !plausibleIso(iso)) throw new HttpsError("invalid-argument", `${label} au millésime invalide (attendu 2015..année+3)`); return iso || null; };
  // NORMALISER en ISO complet (YYYY-MM-DD) comme à l'ingestion : cashflow (échéance en fin de mois si
  // "YYYY-MM") et receivables (Date.parse → 1er du mois) interprètent différemment une date partielle,
  // ce qui désalignait le bucket mensuel d'une facture éditée à la main. toISO garantit une date pleine.
  const patch = { updatedAt: FieldValue.serverTimestamp() };
  if (d.date !== undefined) patch.date = d.date ? chk(d.date, "Date de facturation") : null;
  if (d.dueDate !== undefined) patch.dueDate = d.dueDate ? chk(d.dueDate, "Date d'échéance") : null;
  if (Object.keys(patch).length <= 1) throw new HttpsError("invalid-argument", "rien à corriger (date ou échéance requise)");
  await ref.set(patch, { merge: true });
  await db.collection("auditLog").add({
    uid: req.auth.uid, action: "patch_invoice", module: "facturation", entity: "invoice", entityId: id,
    detail: { date: patch.date ?? null, dueDate: patch.dueDate ?? null }, ts: FieldValue.serverTimestamp(),
  });
  await requestRecompute(); // date/échéance → échéancier cash, encours âgés, qualité des données
  return { ok: true, id };
});

// --- Correction d'une fiche affaire : prix de VENTE et/ou de REVIENT (comble « fiche sans prix de
// vente »). Donnée de MARGE → droit « rentabilite » requis, et écriture dans projectSheetsMargin
// (collection isolée, mêmes règles que le reste de la marge). Marge & %MB recalculés. Le prix de
// vente d'une fiche pilote le CAS quand la commande est de source fiche → recalcul complet. ---
exports.patchProjectSheet = onCallG("patchProjectSheet", { memoryMiB: 512, timeoutSeconds: 300 }, async (req) => {
  await requireWrite(req, "rentabilite");
  const { fpKey } = require("./lib/ids");
  const { safeId } = require("./lib/sheets");
  const d = req.data || {};
  const fp = fpKey(d.fp);
  if (!fp) throw new HttpsError("invalid-argument", "N° FP de la fiche requis");
  const id = safeId(fp);
  const baseSnap = await db.doc(`projectSheets/${id}`).get();
  const mSnap = await db.doc(`projectSheetsMargin/${id}`).get();
  if (!baseSnap.exists && !mSnap.exists) throw new HttpsError("not-found", "fiche affaire introuvable");
  const { computeFicheMargin } = require("./domain/mutations");
  const cur = { ...(baseSnap.data() || {}), ...(mSnap.data() || {}) };
  const provided = (v) => v !== undefined && String(v) !== "";
  if (!provided(d.saleTotal) && !provided(d.costTotal)) throw new HttpsError("invalid-argument", "prix de vente ou de revient requis");
  const m = computeFicheMargin({
    saleTotal: provided(d.saleTotal) ? Number(d.saleTotal) : undefined,
    costTotal: provided(d.costTotal) ? Number(d.costTotal) : undefined,
    prev: cur,
  });
  if (m.saleTotal != null && (!Number.isFinite(m.saleTotal) || m.saleTotal < 0)) throw new HttpsError("invalid-argument", "prix de vente invalide");
  if (m.costTotal != null && (!Number.isFinite(m.costTotal) || m.costTotal < 0)) throw new HttpsError("invalid-argument", "prix de revient invalide");
  await db.doc(`projectSheetsMargin/${id}`).set({ _id: id, fp, saleTotal: m.saleTotal, costTotal: m.costTotal, margin: m.margin, marginPct: m.marginPct }, { merge: true });
  await db.collection("auditLog").add({
    uid: req.auth.uid, action: "patch_fiche", module: "rentabilite", entity: "projectSheet", entityId: id,
    detail: { fp, saleTotal: m.saleTotal, costTotal: m.costTotal }, ts: FieldValue.serverTimestamp(),
  });
  await requestRecompute(); // fiche → CAS (si commande=fiche) + marge → recalcul complet
  return { ok: true, fp };
});

// Migration des satellites clés par FP lors d'une ré-clé de commande (patchOrder newFp). Les champs
// `fp` (factures, lignes BC — stockés en forme canonique fpKey) sont réécrits ; les docs clés par
// safeId(fp) (fiche affaire + marge isolée, jalons de facturation) sont déplacés sous le nouvel ID.
async function migrateFpSatellites(oldFp, newFp) {
  const { safeId } = require("./lib/sheets");
  for (const col of ["invoices", "bcLines"]) {
    const qs = await db.collection(col).where("fp", "==", oldFp).get();
    for (let i = 0; i < qs.docs.length; i += 400) {
      const batch = db.batch();
      for (const doc of qs.docs.slice(i, i + 400)) batch.set(doc.ref, { fp: newFp, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      await batch.commit();
    }
  }
  const oldI = safeId(oldFp), newI = safeId(newFp);
  for (const col of ["projectSheets", "projectSheetsMargin", "billingMilestones"]) {
    const s = await db.doc(`${col}/${oldI}`).get();
    if (!s.exists) continue;
    await db.doc(`${col}/${newI}`).set({ ...s.data(), _id: newI, fp: newFp }, { merge: true });
    await db.doc(`${col}/${oldI}`).delete();
  }
  // OVERLAYS clés par safeId(fp), stockés HORS du doc commande pour survivre aux ré-imports : ils DOIVENT
  // suivre la ré-clé, sinon ils pointent vers un FP disparu → annulation / affectation PMO / lien ClickUp
  // PERDUS. Cas le plus grave : une commande ANNULÉE ré-clée « ressusciterait » dans CAS/backlog/rentabilité
  // (le flag d'annulation vit dans config/cancelOrders, pas dans le doc commande). Cf. audit cycle de vie.
  for (const path of ["config/orderPm", "config/clickupLinks", "config/clickupSync", "config/clickupCaf"]) {
    const map = ((await db.doc(path).get()).data() || {}).map || {};
    if (Object.prototype.hasOwnProperty.call(map, oldI)) {
      await db.doc(path).set({ map: { [newI]: map[oldI], [oldI]: FieldValue.delete() }, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    }
  }
  const cancel = ((await db.doc("config/cancelOrders").get()).data() || {}).items || [];
  if (cancel.some((e) => e && e.id === oldI)) {
    await db.doc("config/cancelOrders").set({ items: cancel.map((e) => (e && e.id === oldI ? { ...e, id: newI } : e)), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  }
}

// --- Fiabilisation : corriger une commande P&L — année de PO manquante et/ou N° FP erroné.
// Le doc `orders` est clé par le FP ; corriger le FP = ré-clé (copie + suppression). Recalcule. ---
exports.patchOrder = onCallG("patchOrder", { memoryMiB: 512, timeoutSeconds: 300 }, async (req) => {
  await requireWrite(req, "import");
  const { fpKey } = require("./lib/ids");
  const { safeId } = require("./lib/sheets");
  const d = req.data || {};
  const fp = fpKey(d.fp);
  if (!fp) throw new HttpsError("invalid-argument", "N° FP de la commande requis");
  const ref = db.doc(`orders/${safeId(fp)}`);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("failed-precondition", "commande P&L introuvable (opp gagnée / fiche : corriger à la source)");

  const { validateYearPo } = require("./domain/mutations");
  const patch = {};
  if (d.yearPo != null && String(d.yearPo) !== "") {
    const y = validateYearPo(d.yearPo, new Date().getFullYear());
    if (!y.ok) throw new HttpsError("invalid-argument", "année de PO invalide");
    patch.yearPo = y.value;
  }
  // CAS / RAF éditables (saisie in-app). CAS > 0 (commande signée) ; RAF ≥ 0. Attention : sur une
  // commande dont le CAS est GOUVERNÉ à la source (opp gagnée / fiche affaire), le CAS édité ici
  // est ré-écrasé au prochain recompute — l'UI ne propose l'édition CAS que sur les lignes P&L/manuelles.
  if (d.cas != null && String(d.cas) !== "") {
    const c = Number(d.cas);
    if (!Number.isFinite(c) || c <= 0) throw new HttpsError("invalid-argument", "CAS (> 0) invalide");
    patch.cas = c;
  }
  if (d.raf != null && String(d.raf) !== "") {
    const rf = Number(d.raf);
    if (!Number.isFinite(rf) || rf < 0) throw new HttpsError("invalid-argument", "RAF (≥ 0) invalide");
    patch.raf = rf;
  }
  // RAF ≤ CAS (audit backlog M1) : un RAF supérieur au montant signé n'a pas de sens comptable —
  // « intégrer » avec un RAF de 500 M sur un CAS de 10 M gonflait backlog_fy, seulement signalé a
  // posteriori par l'alerte raf_incoherent. Comparé au CAS EFFECTIF après patch (patché sinon existant).
  {
    const effCas = patch.cas != null ? patch.cas : Number((snap.data() || {}).cas);
    if (patch.raf != null && Number.isFinite(effCas) && effCas > 0 && patch.raf > effCas) {
      throw new HttpsError("invalid-argument", `RAF (${Math.round(patch.raf)}) supérieur au CAS (${Math.round(effCas)}) — corrigez le CAS d'abord si la commande a été révisée à la hausse`);
    }
  }
  // Champs descriptifs éditables (source P&L/manuelle). Sur une ligne opp_won/fiche, client/am sont
  // gouvernés à la source → ré-écrasés au recompute ; l'UI ne propose l'édition que sur pnl/manuel.
  if (d.client !== undefined) patch.client = String(d.client || "").trim();
  if (d.am !== undefined) patch.am = String(d.am || "").trim();
  if (d.bu !== undefined) { const { cleanBu } = require("./lib/ids"); patch.bu = cleanBu(d.bu); }
  if (d.designation !== undefined) patch.designation = String(d.designation || "").trim();
  const newFp = d.newFp ? fpKey(d.newFp) : null;
  if (d.newFp && !newFp) throw new HttpsError("invalid-argument", "nouveau N° FP invalide");

  if (newFp && newFp !== fp) {
    // Ré-clé : le FP est la clé de jointure (factures, BC…). On copie sous le nouveau FP puis supprime.
    const newId = safeId(newFp);
    const newSnap = await db.doc(`orders/${newId}`).get();
    // Garde-fou : si une commande DISTINCTE existe déjà sous le FP cible, un set(merge) fusionnerait deux
    // lignes P&L (perte d'une commande) → on refuse. MAIS on distingue le cas d'une RÉ-CLÉ INTERROMPUE :
    // si le doc cible porte notre marqueur `_rekeyFrom === fp`, c'est la copie en vol d'un run précédent
    // (create fait, migrate/delete non terminés) → on REPREND au lieu de bloquer. Sans ça, une interruption
    // pendant migrateFpSatellites (plusieurs secondes sur un gros FP) laissait DEUX commandes (ancienne +
    // nouvelle) → double-compte CAS/backlog, et le retry butait sur cette garde (pas d'auto-guérison).
    if (newSnap.exists && newSnap.get("_rekeyFrom") !== fp) {
      throw new HttpsError("failed-precondition", `une commande existe déjà pour ${newFp} — ré-clé refusée (fusion destructive)`);
    }
    // ORDRE SÛR (cf. audit P0-A) : créer la nouvelle commande → MIGRER les satellites → SUPPRIMER
    // l'ancienne EN DERNIER. À tout instant, chaque satellite (facture/BC/fiche/marge/jalons) pointe vers
    // un FP qui PORTE une commande → jamais d'orphelin même si la fonction est interrompue en cours de
    // route ; migrateFpSatellites est idempotent (re-jouable). `_rekeyFrom` rend la ré-clé REPRENABLE
    // (résout la fenêtre de double-compte de l'ordre create→migrate→delete si interrompu au milieu).
    await db.doc(`orders/${newId}`).set({ ...snap.data(), ...patch, _id: newId, fp: newFp, _rekeyFrom: fp, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    await migrateFpSatellites(fp, newFp);
    await ref.delete();
    // Ré-clé terminée : on retire le marqueur (harmless s'il subsiste — un futur run ne le lira que si
    // oldId réapparaît, ce qui n'arrive pas). FieldValue.delete pour ne pas laisser un champ interne.
    await db.doc(`orders/${newId}`).set({ _rekeyFrom: FieldValue.delete() }, { merge: true });
  } else if (Object.keys(patch).length) {
    await ref.set({ ...patch, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  } else {
    throw new HttpsError("invalid-argument", "rien à modifier (année, CAS, RAF, client/AM/BU ou nouveau FP requis)");
  }
  await db.collection("auditLog").add({
    uid: req.auth.uid, action: "patch_order", module: "import", entity: "order", entityId: safeId(fp), // module RBAC réel de la mutation (audit backlog B1 — « overview » faussait le filtrage du journal)
    detail: { fp, newFp: newFp || null, yearPo: patch.yearPo ?? null, cas: patch.cas ?? null, raf: patch.raf ?? null, client: patch.client ?? null, am: patch.am ?? null }, ts: FieldValue.serverTimestamp(),
  });
  await refreshNowBestEffort("patchOrder");
  return { ok: true, fp: newFp || fp };
});

// --- createOrder : CRÉE une commande (ligne P&L) DIRECTEMENT dans l'app — sans passer par l'Excel.
// Réservé aux profils ayant le droit « import » (comme patchOrder). Deux usages : réconcilier une
// opp GAGNÉE sans ligne P&L (inscription pré-remplie depuis l'opp), ou saisir une commande manuelle.
// « P&L STRICT / Excel curaté prioritaire » préservé : on REFUSE si un orders/{fp} existe déjà, et
// au ré-import une ligne P&L du même FP écrase cette saisie (upsert par FP) — la saisie app ne
// persiste que tant que le FP est absent de l'Excel. source='manuel' → visible comme telle. ---
exports.createOrder = onCallG("createOrder", { memoryMiB: 512, timeoutSeconds: 300 }, async (req) => {
  await requireWrite(req, "import");
  const { fpKey, cleanBu } = require("./lib/ids");
  const { safeId } = require("./lib/sheets");
  const d = req.data || {};
  const fp = fpKey(d.fp);
  if (!fp) throw new HttpsError("invalid-argument", "N° FP requis (format FP/AAAA/N)");
  const cas = Number(d.cas);
  if (!Number.isFinite(cas) || cas <= 0) throw new HttpsError("invalid-argument", "CAS (> 0) requis");
  // RAF explicite : VALIDÉ (audit backlog M2 — l'ancien `Math.max(Number(d.raf) || 0, 0)` coerçait un RAF
  // non numérique en 0 : la commande naissait « soldée » sans erreur). Absent/vide = RAF plein (= CAS).
  let rafIn = null;
  if (d.raf != null && String(d.raf) !== "") {
    rafIn = Number(d.raf);
    if (!Number.isFinite(rafIn) || rafIn < 0) throw new HttpsError("invalid-argument", "RAF (≥ 0) invalide");
    if (rafIn > cas) throw new HttpsError("invalid-argument", "RAF supérieur au CAS");
  }
  const id = safeId(fp);
  const ref = db.doc(`orders/${id}`);
  if ((await ref.get()).exists) throw new HttpsError("already-exists", "une commande existe déjà pour ce FP — utilisez la correction (CAS/RAF/année)");
  // Année de PO : optionnelle (0 = non renseignée), mais si fournie elle est VALIDÉE (comme patchOrder)
  // — une saisie non numérique est rejetée plutôt que ramenée silencieusement à 0.
  let yearPo = 0;
  if (d.yearPo != null && String(d.yearPo) !== "") {
    const { validateYearPo } = require("./domain/mutations");
    const y = validateYearPo(d.yearPo, new Date().getFullYear());
    if (!y.ok) throw new HttpsError("invalid-argument", "année de PO invalide");
    yearPo = y.value;
  }
  const raf = rafIn; // validé plus haut ; null → RAF dérivé (CAS − facturé)
  const order = {
    _id: id, fp,
    client: String(d.client || "").trim(),
    designation: String(d.designation || "").trim(),
    bu: cleanBu(d.bu),
    am: String(d.am || "").trim(),
    yearPo, cas, raf,
    suppliers: [],
    source: "manuel",
    createdBy: req.auth.uid,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  };
  await ref.set(order, { merge: true });
  await db.collection("auditLog").add({
    uid: req.auth.uid, action: "create_order", module: "import", entity: "order", entityId: id,
    detail: { fp, cas, source: "manuel" }, ts: FieldValue.serverTimestamp(),
  });
  // Recompute BEST-EFFORT (« n'échoue jamais l'action appelante ») : la commande EST créée (intention de
  // l'utilisateur, écrite ci-dessus). Un échec/lenteur du recompute — verrou de bail, transitoire — NE DOIT
  // PAS remonter en faux « internal » et pousser l'utilisateur à recliquer (→ already-exists). Le carnet se
  // rafraîchit au prochain recompute (planifié 05:00 ou action suivante). L'échec reste tracé (logger/opsLog).
  await refreshNowBestEffort("createOrder");
  return { ok: true, fp };
});

// --- generateFromInvoices : GÉNÈRE une commande P&L + une opportunité GAGNÉE à partir de factures NON
// RATTACHÉES (Centre de correction), à l'unité (ids) ou EN MASSE (all:true). Résout l'anomalie « facture
// non rattachée » à la source : le FP FACTURE fait foi → on crée la commande manquante (CAS = Σ factures
// du FP) et l'opp gagnée du même FP (se réconcilient). SÛR : ignore les factures sans FP canonique et les
// FP déjà au carnet (aucun doublon ; ids d'opp DÉTERMINISTES → ré-exécution idempotente). Droit « import ». ---
exports.generateFromInvoices = onCallG("generateFromInvoices", { memoryMiB: 512, timeoutSeconds: 300 }, async (req) => {
  await requireWrite(req, "import");
  const { fpKey, buildFpAliasResolver } = require("./lib/ids");
  const { safeId } = require("./lib/sheets");
  const { planFromInvoices } = require("./domain/genFromInvoice");
  const { STAGE_LABEL } = require("./parsers/salesData");
  const { oppWeighted } = require("./domain/mutations");
  const d = req.data || {};
  const wantAll = d.all === true;
  const ids = Array.isArray(d.ids) ? [...new Set(d.ids.filter(Boolean).map(String))] : [];
  if (!wantAll && !ids.length) throw new HttpsError("invalid-argument", "sélection de factures requise (ou all:true)");

  const [invSnap, ordSnap, aliasDoc] = await Promise.all([
    // bu + alias de montant (montant/montantHt/…) : requis pour dériver TOUS les champs de la facture —
    // sans bu, la commande générée retombait sur « AUTRE » ; sans les alias, un montant hors « amountHt » = 0.
    db.collection("invoices").select("fp", "client", "bu", "amountHt", "montantHt", "montant", "amount", "amountTtc", "totalHt", "date", "numero").limit(MAX_SCAN + 1).get(),
    db.collection("orders").select("fp").limit(MAX_SCAN + 1).get(),
    db.doc("config/fpAliases").get(),
  ]);
  // Scans BORNÉS (MAX_SCAN+1 + sliceCapped) — la LECTURE est plafonnée (le plan d'écriture l'était déjà à 500).
  // MÊME canonisation FP que le recompute / correctionQueue (overlay d'alias) → cohérence des orphelines.
  const canonFp = buildFpAliasResolver(((aliasDoc.data() || {}).map) || {});
  let invoices = sliceCapped(invSnap.docs).docs.map((s) => { const v = { id: s.id, ...s.data() }; if (v.fp != null && v.fp !== "") v.fp = canonFp(v.fp); return v; });
  const orderFps = new Set(sliceCapped(ordSnap.docs).docs.map((s) => fpKey(s.data().fp)).filter(Boolean));
  if (!wantAll) { const sel = new Set(ids); invoices = invoices.filter((i) => sel.has(i.id)); }

  const { plan, skippedNoFp, skippedExisting } = planFromInvoices(invoices, orderFps);
  if (!plan.length) return { ok: true, created: { orders: 0, opps: 0 }, skippedNoFp, skippedExisting, plan: [] };
  if (plan.length > 500) throw new HttpsError("invalid-argument", "trop de commandes à générer d'un coup (max 500) — affinez la sélection");

  const visibleTo = await visibleToFor(req.auth.uid);
  // PLACEHOLDERS pour les champs SANS source sur la facture : le carnet ne comporte jamais de champ vide
  // (à qualifier ensuite), et le montant vient TOUJOURS de la facture (Σ HT, garanti > 0 par le plan).
  const PH_AM = "À affecter";
  const genDesignation = (p) => (p.numeros && p.numeros.length
    ? `Régularisation — facture ${p.numeros[0]}${p.numeros.length > 1 ? ` (+${p.numeros.length - 1})` : ""}`
    : "Généré depuis facture — à qualifier");
  let batch = db.batch(), pending = 0, createdOrders = 0, createdOpps = 0;
  for (const p of plan) {
    const oid = safeId(p.fp);
    const client = p.client || "Client à préciser"; // placeholder si aucune facture ne porte de client
    const bu = p.bu || "AUTRE";                      // BU depuis la facture, sinon placeholder « AUTRE »
    const designation = genDesignation(p);
    // COMMANDE (source « manuel », marquée genFromInvoice). RAF = 0 EXPLICITE (curaté) : la commande est
    // intégralement couverte par ses propres factures → SOLDÉE, aucun backlog. (Un RAF dérivé « CAS − facturé »
    // créerait un backlog fantôme si le montant facture est lu différemment côté fusion.) Rattachement
    // comptable par yearPo (exercice). merge:true : idempotent ; le P&L Excel reste prioritaire au ré-import.
    batch.set(db.doc(`orders/${oid}`), {
      _id: oid, fp: p.fp, client, designation, bu, am: PH_AM,
      yearPo: p.yearPo, cas: p.cas, raf: 0, suppliers: [],
      source: "manuel", genFromInvoice: true, createdBy: req.auth.uid,
      createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    createdOrders++;
    // OPPORTUNITÉ GAGNÉE (id DÉTERMINISTE → pas de doublon en ré-exécution). Même FP → réconciliée au P&L.
    const opId = `saisie_geninv_${oid}`;
    batch.set(db.doc(`opportunities/${opId}`), {
      oppId: opId, source: "saisie", genFromInvoice: true,
      client, am: PH_AM, bu, fp: p.fp, designation,
      amount: p.cas, stage: 6, stageLabel: STAGE_LABEL[6] || "6",
      probability: 100, weighted: oppWeighted(p.cas, 100), // IdC en % : gagné = 100 %
      closingDate: p.closingDate, ownerUid: req.auth.uid, visibleTo,
      createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    createdOpps++;
    if ((pending += 2) >= 400) { await batch.commit(); batch = db.batch(); pending = 0; }
  }
  if (pending) await batch.commit();
  await db.collection("auditLog").add({
    uid: req.auth.uid, action: "generate_from_invoices", module: "import", entity: "order", entityId: "*",
    detail: { orders: createdOrders, opps: createdOpps, all: wantAll, skippedNoFp, skippedExisting }, ts: FieldValue.serverTimestamp(),
  });
  await refreshNowBestEffort("generateFromInvoices");
  return { ok: true, created: { orders: createdOrders, opps: createdOpps }, skippedNoFp, skippedExisting, plan };
});

// ============================================================================
// FICHE D'AFFAIRE dématérialisée — CHEMIN ALTERNATIF à l'import du fichier P&L (greffe sur les
// commandes). Circuit de validation à 6 étapes (domain/ficheAffaire) : le contrôle de rôle PAR
// ÉTAPE et les champs obligatoires sont portés par le DOMAINE (pur, testé) ; ce callable ne fait
// que l'I/O (persistance fiche + journal append-only + masquage PM côté serveur). À la validation
// FINALE, la fiche alimente le P&L de la commande (backbone orders + projectSheets/margin isolée),
// consommé par mergeCommandes au prochain recompute. Doc id = safeId(FP) → 1 fiche par commande.
// ============================================================================
const { createFiches } = require("./handlers/fiches");
const _fiches = createFiches({ onCallG, HttpsError, db, FieldValue, requestRecompute });
exports.createFiche = _fiches.createFiche;
exports.updateFiche = _fiches.updateFiche;
exports.ficheAdvance = _fiches.ficheAdvance;
exports.ficheReject = _fiches.ficheReject;
exports.getFiche = _fiches.getFiche;
exports.listFiches = _fiches.listFiches;

// --- upsertOpsBulletin : enregistre le BULLETIN HEBDO « Hot Topics Opérations » (commentaires /
// points clés d'une semaine d'exercice). Saisie MANUELLE (Phase 1) ; réservé à la DIRECTION et au
// PMO (pilotage opérations). Lecture directe ouverte au niveau « overview » (rules), écriture 100%
// par ce callable (validé + audité). 1 bulletin par semaine (id déterministe 2026_W27, upsert). ---
exports.upsertOpsBulletin = onCallG("upsertOpsBulletin", { memoryMiB: 256 }, async (req) => {
  if (!req.auth) throw new HttpsError("unauthenticated", "connexion requise");
  const role = req.auth.token?.nt360Role;
  if (role !== "direction" && role !== "pmo") throw new HttpsError("permission-denied", "réservé à la direction / PMO (opérations)");
  const { validateOpsBulletin, bulletinId } = require("./domain/opsBulletin");
  const v = validateOpsBulletin(req.data);
  if (!v.ok) throw new HttpsError("invalid-argument", v.error);
  const id = bulletinId(v.value.fy, v.value.week);
  await db.doc(`opsBulletins/${id}`).set({
    ...v.value, _id: id,
    updatedBy: req.auth.uid, updatedByName: req.auth.token?.name || req.auth.token?.email || req.auth.uid,
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
  await db.collection("auditLog").add({ uid: req.auth.uid, action: "upsert_ops_bulletin", module: "overview", entity: "opsBulletin", entityId: id, detail: { fy: v.value.fy, week: v.value.week, sections: v.value.sections.length }, ts: FieldValue.serverTimestamp() });
  return { ok: true, id };
});

// --- setOrderPm : affecte un Project Manager (PMO) à une commande. Stocké en OVERLAY
// config/orderPm { map: { <safeId(fp)>: pm } }, hors du doc commande → l'affectation SURVIT au
// recompute ET à un ré-import delta (même logique que l'annulation). `pm` vide → désaffectation.
// Gouverné par le module « import » (comme patchOrder/createOrder) — ajustable via la matrice. ---
exports.setOrderPm = onCallG("setOrderPm", { memoryMiB: 512, timeoutSeconds: 300 }, async (req) => {
  await requireWrite(req, "import");
  const { fpKey } = require("./lib/ids");
  const { safeId } = require("./lib/sheets");
  const d = req.data || {};
  const fp = fpKey(d.fp);
  if (!fp) throw new HttpsError("invalid-argument", "N° FP de la commande requis");
  const pm = String(d.pm || "").trim().slice(0, 120);
  const id = safeId(fp);
  // Écriture ciblée dans la map : pm renseigné → pose la valeur ; vide → supprime l'entrée (merge).
  await db.doc("config/orderPm").set({ map: { [id]: pm ? pm : FieldValue.delete() }, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  await db.collection("auditLog").add({
    uid: req.auth.uid, action: pm ? "assign_pm" : "unassign_pm", module: "import", entity: "order", entityId: id,
    detail: { fp, pm: pm || null }, ts: FieldValue.serverTimestamp(),
  });
  await refreshNowBestEffort("setOrderPm");
  return { ok: true, fp, pm: pm || null };
});

// SYNCHRO DU MONTANT commande ⇄ opportunité (CA Signé), au choix par commande. L'opportunité liée =
// opp de MÊME N° FP canonique ; priorité à l'opp GAGNÉE (stage 6), sinon l'unique opp (ambiguïté → refus).
//  • toOpp  (commande → opp)   : pose le CAS de la commande comme montant de l'opp. Écrit l'opp (gouverné
//    « pipeline »). Refusé si l'opp est chiffrée par lignes (CPQ) — le montant y est dérivé.
//  • toOrder (opp → commande)  : pose le montant de l'opp comme CAS de la commande, en SURCHARGE
//    persistante (overlay config/orderCasOverride) qui PRIME sur P&L/fiche et SURVIT aux ré-imports
//    (comme l'affectation PM / les alias FP). Gouverné « import ».
//  • clear                     : retire la surcharge (la commande reprend son CAS P&L/opp/fiche).
exports.syncOrderAmount = onCallG("syncOrderAmount", { memoryMiB: 512, timeoutSeconds: 300 }, async (req) => {
  const { fpKey } = require("./lib/ids");
  const { safeId } = require("./lib/sheets");
  const { oppWeighted } = require("./domain/mutations");
  const d = req.data || {};
  const fp = fpKey(d.fp);
  const direction = String(d.direction || "");
  if (!fp) throw new HttpsError("invalid-argument", "N° FP de la commande requis");
  if (!["toOpp", "toOrder", "clear", "peek"].includes(direction)) throw new HttpsError("invalid-argument", "sens de synchronisation invalide");
  const id = safeId(fp);

  // PEEK (lecture seule) : renvoie le montant de l'opportunité liée + son état, pour AFFICHER les deux
  // valeurs (CAS commande vs montant opp) côté modal et laisser l'humain DÉCIDER du sens. N'écrit rien.
  if (direction === "peek") {
    await requireRead(req, "import");
    const snap = await db.collection("opportunities").select("fp", "amount", "stage", "lines", "visibleTo").limit(MAX_SCAN + 1).get();
    let matches = sliceCapped(snap.docs).docs.map((x) => ({ id: x.id, ...x.data() })).filter((o) => fpKey(o.fp) === fp);
    // OWD privé : ne pas divulguer le montant d'une opp hors périmètre (mêmes règles que les écritures).
    if ((await recordAccessOwd("opportunities")) === "private" && !(await isRecordAdmin(req))) {
      matches = matches.filter((o) => Array.isArray(o.visibleTo) && o.visibleTo.includes(req.auth.uid));
    }
    const wonP = matches.filter((o) => Number(o.stage) === 6);
    const poolP = wonP.length ? wonP : matches;
    const oppP = poolP.length === 1 ? poolP[0] : null;
    return {
      ok: true, fp, direction,
      oppFound: matches.length > 0, count: matches.length, ambiguous: poolP.length > 1,
      oppId: oppP ? oppP.id : null,
      oppAmount: oppP ? Math.round(Number(oppP.amount) || 0) : null,
      oppHasLines: oppP ? !!(Array.isArray(oppP.lines) && oppP.lines.length) : false,
      oppWon: oppP ? Number(oppP.stage) === 6 : false,
    };
  }

  // Retrait de la surcharge : la commande reprend son CAS d'origine (P&L / opp gagnée / fiche).
  if (direction === "clear") {
    await requireWrite(req, "import");
    await db.doc("config/orderCasOverride").set({ map: { [id]: FieldValue.delete() }, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    await db.collection("auditLog").add({ uid: req.auth.uid, action: "order_cas_override_clear", module: "import", entity: "order", entityId: id, detail: { fp }, ts: FieldValue.serverTimestamp() });
    await refreshNowBestEffort("syncOrderAmount");
    return { ok: true, fp, direction, cas: null };
  }

  // Localise l'opportunité liée (même N° FP canonique) — scan borné. Priorité à l'opp gagnée (stage 6).
  const snap = await db.collection("opportunities").select("fp", "amount", "stage", "probability", "lines", "visibleTo").limit(MAX_SCAN + 1).get();
  const matches = sliceCapped(snap.docs).docs.map((x) => ({ id: x.id, ...x.data() })).filter((o) => fpKey(o.fp) === fp);
  if (!matches.length) throw new HttpsError("not-found", "aucune opportunité liée à ce N° FP");
  const won = matches.filter((o) => Number(o.stage) === 6);
  const pool = won.length ? won : matches;
  if (pool.length > 1) throw new HttpsError("failed-precondition", `${pool.length} opportunités portent ce N° FP — désambiguïsez avant de synchroniser`);
  const opp = pool[0];

  if (direction === "toOpp") {
    await requireWrite(req, "pipeline");
    await assertRecordVisible(req, "opportunities", opp); // OWD privé : pas d'écriture hors périmètre
    if (Array.isArray(opp.lines) && opp.lines.length) throw new HttpsError("failed-precondition", "opportunité chiffrée par lignes (CPQ) — ajustez les lignes, pas le montant global");
    const cas = Number(d.cas);
    if (!Number.isFinite(cas) || cas < 0) throw new HttpsError("invalid-argument", "montant de la commande invalide");
    await db.doc(`opportunities/${opp.id}`).set({ amount: cas, weighted: oppWeighted(cas, opp.probability || 0), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    await db.collection("auditLog").add({ uid: req.auth.uid, action: "sync_amount_to_opp", module: "pipeline", entity: "opportunity", entityId: opp.id, detail: { fp, cas }, ts: FieldValue.serverTimestamp() });
    await refreshNowBestEffort("syncOrderAmount");
    return { ok: true, fp, direction, oppId: opp.id, cas };
  }

  // toOrder : montant de l'opp → surcharge CAS de la commande (overlay persistant, prioritaire).
  await requireWrite(req, "import");
  const amount = Math.round(Number(opp.amount) || 0);
  if (!(amount > 0)) throw new HttpsError("failed-precondition", "l'opportunité liée n'a pas de montant exploitable");
  await db.doc("config/orderCasOverride").set({ map: { [id]: amount }, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  await db.collection("auditLog").add({ uid: req.auth.uid, action: "order_cas_override_set", module: "import", entity: "order", entityId: id, detail: { fp, cas: amount, oppId: opp.id }, ts: FieldValue.serverTimestamp() });
  await refreshNowBestEffort("syncOrderAmount");
  return { ok: true, fp, direction, oppId: opp.id, cas: amount };
});

// --- Opportunités (source saisie) : CRUD + correction + export/import en masse. EXTRAIT dans
// handlers/opportunities.js (patron R3). Écriture « pipeline » ; recompute CIBLÉ (oppScope) ; journal de
// transition (oppHistory). Deps injectées ; exports déclarés ici (garde-fou de déploiement par nom). ---
const { createOpportunities } = require("./handlers/opportunities");
const _opps = createOpportunities({
  onCallG, HttpsError, db, FieldValue, logger,
  requireWrite, assertRecordVisible, visibleToFor, isRecordAdmin, recordAccessOwd,
  assertPlainId, requestRecompute, oppScope, OPP_RECOMPUTE, OPP_RECOMPUTE_WON,
  fireOutbound, readWorkbook, aoaToXlsxBase64, rateLimit,
});
exports.upsertOpportunity = _opps.upsertOpportunity;
exports.deleteOpportunity = _opps.deleteOpportunity;
exports.patchOpportunity = _opps.patchOpportunity;
exports.exportOpportunities = _opps.exportOpportunities;
exports.importOpportunities = _opps.importOpportunities;

const BC_STAGES = ["a_emettre", "emis", "livre", "facture", "solde"];

exports.addBcLine = onCallG("addBcLine", { memoryMiB: 512, timeoutSeconds: 120 }, async (req) => {
  await requireWrite(req, "bc");
  const { fpKey } = require("./lib/ids");
  const { hashId } = require("./lib/sheets");
  const { normCur } = require("./parsers/bcPdf");
  const { toXof } = require("./lib/fx");
  const f = req.data?.fields || {};
  const supplier = String(f.supplier || "").replace(/\s+/g, " ").trim().toUpperCase();
  const bcNumber = String(f.bcNumber || "").replace(/\s+/g, " ").trim();
  if (!supplier && !bcNumber) throw new HttpsError("invalid-argument", "fournisseur ou n° BC requis");

  const fp = fpKey(f.fp) || null;
  const description = String(f.description || "").trim();
  const status = BC_STAGES.includes(f.status) ? f.status : "a_emettre";
  const amount = Number(f.amount) || 0;
  // Devise → XOF : contre-valeur SAISIE prioritaire, sinon conversion via taux paramétré
  // (config/fxRates) ; sans taux, amountXof reste 0 (« à saisir ») — jamais le montant brut en devise.
  const currency = normCur(f.currency);
  const rates = ((await db.doc("config/fxRates").get()).data() || {}).rates || {};
  const conv = toXof(currency, amount, f.amountXof, rates);
  const id = "bc_" + hashId(fp, bcNumber, supplier, description);
  const doc = {
    fp, bcNumber, supplier,
    customer: String(f.customer || "").replace(/\s+/g, " ").trim().toUpperCase(),
    country: String(f.country || "").trim(),
    expenseType: String(f.expenseType || "").trim(),
    description,
    currency,
    amount,
    amountXof: conv.amountXof,
    fxRate: conv.fxRate, fxSource: conv.fxSource,
    status, statusRaw: String(f.statusRaw || status),
    dateIn: f.dateIn || null,
    source: "bc_unitaire",
    updatedAt: FieldValue.serverTimestamp(),
  };

  let pdfKey = null;
  if (req.data?.pdfB64) {
    try {
      pdfKey = `bc/${id}.pdf`;
      await getStorage().bucket(IMPORTS_BUCKET).file(pdfKey).save(Buffer.from(req.data.pdfB64, "base64"), { contentType: "application/pdf" });
      doc.pdfKey = `${IMPORTS_BUCKET}/${pdfKey}`;
    } catch (e) {
      logger.warn("addBcLine: PDF non stocké", { msg: e.message }); pdfKey = null;
    }
  }

  await db.doc(`bcLines/${id}`).set(doc, { merge: true });
  await db.collection("auditLog").add({
    uid: req.auth.uid, action: "add_bc", module: "bc", entity: "bcLine", entityId: id,
    detail: { bcNumber, supplier, fp }, ts: FieldValue.serverTimestamp(),
  });
  // 'cashflow' inclus (cf. audit cycle de vie) : un BC ajouté alimente immédiatement les décaissements
  // prévisionnels (domain/cashflow) ; sans lui la prévision cash restait périmée jusqu'au recompute complet.
  // + "partenariats" : summaries/par_ca (CA constructeur, ADR-P02) DÉRIVE des bcLines — sans ce scope le
  // CA partenaire restait périmé jusqu'au recompute nocturne (audit 40 axes, axe 29).
  await requestRecompute(["suppliers", "alerts", "cashflow", "partenariats"]);
  return { ok: true, id, pdfStored: !!pdfKey };
});

// --- setFxRates : taux de change (XOF par unité de devise) pour la conversion des BC en devise
// étrangère. Stocké dans config/fxRates { rates: { <DEVISE>: taux } }. Direction uniquement.
// Remplace l'ensemble des taux (l'UI envoie la table complète). N'affecte que les BC créés ENSUITE
// (la conversion est figée à l'écriture) — un BC existant se recorrige via sa contre-valeur XOF. ---
exports.setFxRates = onCallG("setFxRates", { memoryMiB: 256, timeoutSeconds: 60 }, async (req) => {
  if (req.auth?.token?.nt360Role !== "direction") throw new HttpsError("permission-denied", "admin requis");
  const raw = (req.data && req.data.rates) || {};
  const rates = {};
  for (const [k, v] of Object.entries(raw)) {
    const cur = String(k).toUpperCase().trim();
    const r = Number(v);
    if (cur && cur !== "XOF" && Number.isFinite(r) && r > 0) rates[cur] = r; // XOF = référence (taux 1 implicite)
  }
  await db.doc("config/fxRates").set({ rates, updatedBy: req.auth.uid, updatedAt: FieldValue.serverTimestamp() }, { merge: false });
  await db.collection("auditLog").add({
    uid: req.auth.uid, action: "set_fx_rates", module: "habilitations", entity: "config", entityId: "fxRates",
    detail: { devises: Object.keys(rates) }, ts: FieldValue.serverTimestamp(),
  });
  return { ok: true, rates };
});

// --- setRefList : référentiels ÉDITABLES (Project Managers, Business Units) alimentant les
// sélecteurs et filtres de l'app. config/<kind> { list: [...] }. Direction. Remplace la liste
// (nettoyage : trim, dédup insensible à la casse, MAJUSCULES pour les BU, plafonds). ---
const REF_LISTS = { projectManagers: { doc: "config/projectManagers", upper: false }, businessUnits: { doc: "config/businessUnits", upper: true }, territories: { doc: "config/territories", upper: false }, teams: { doc: "config/teams", upper: false } };
exports.setRefList = onCallG("setRefList", { memoryMiB: 256, timeoutSeconds: 60 }, async (req) => {
  if (req.auth?.token?.nt360Role !== "direction") throw new HttpsError("permission-denied", "admin requis");
  const kind = String(req.data?.kind || "");
  const spec = REF_LISTS[kind];
  if (!spec) throw new HttpsError("invalid-argument", "référentiel inconnu");
  const raw = Array.isArray(req.data?.list) ? req.data.list : [];
  const seen = new Set(); const list = [];
  for (const v of raw) {
    let s = String(v || "").replace(/\s+/g, " ").trim();
    if (spec.upper) s = s.toUpperCase();
    if (!s) continue;
    const k = s.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k); list.push(s.slice(0, 60));
    if (list.length >= 300) break;
  }
  list.sort((a, b) => a.localeCompare(b));
  await db.doc(spec.doc).set({ list, updatedBy: req.auth.uid, updatedAt: FieldValue.serverTimestamp() }, { merge: false });
  await db.collection("auditLog").add({
    uid: req.auth.uid, action: "set_ref_list", module: "habilitations", entity: "config", entityId: kind,
    detail: { count: list.length }, ts: FieldValue.serverTimestamp(),
  });
  return { ok: true, kind, list };
});

// --- Intégration ClickUp : config (config/clickup) + push d'une commande en tâche. ---
// setClickupConfig : active/désactive et choisit la liste cible (direction). teamId/liste par défaut
// pré-remplis (workspace + liste « Côte d'Ivoire »).
exports.setClickupConfig = onCallG("setClickupConfig", { memoryMiB: 256, timeoutSeconds: 60 }, async (req) => {
  if (req.auth?.token?.nt360Role !== "direction") throw new HttpsError("permission-denied", "admin requis");
  const d = req.data || {};
  const cfg = {
    enabled: d.enabled !== false,
    teamId: String(d.teamId || CLICKUP_TEAM),
    defaultListId: String(d.defaultListId || CLICKUP_LIST_CI),
    bcListId: String(d.bcListId || CLICKUP_LIST_BC),
    // Liste DÉDIÉE aux tâches de certification (module Partenariats, ADR-P10). VIDE par défaut → le push
    // par_ reste INACTIF (pas de mélange avec le board commandes). Renseignée = P4 actif.
    parListId: String(d.parListId || ""),
    updatedBy: req.auth.uid, updatedAt: FieldValue.serverTimestamp(),
  };
  await db.doc("config/clickup").set(cfg, { merge: true });
  await db.collection("auditLog").add({ uid: req.auth.uid, action: "set_clickup_config", module: "habilitations", entity: "config", entityId: "clickup", detail: { enabled: cfg.enabled, defaultListId: cfg.defaultListId }, ts: FieldValue.serverTimestamp() });
  return { ok: true, config: cfg };
});

// DRAPEAU du module « Contrats de maintenance » (ADR-009) : maître-interrupteur unique. ÉTEINT (défaut)
// ⇒ l'ERP est STRICTEMENT celui d'avant (aucune surface mnt_*, aucun agrégat, aucun cron). Édité en
// Habilitations, DIRECTION uniquement (comme setClickupConfig). Écriture Admin SDK (les rules gardent
// config/mntFeature en write:false). Audité. Le module s'allume/s'éteint sans redéploiement.
exports.setMntFeature = onCallG("setMntFeature", { memoryMiB: 256, timeoutSeconds: 60 }, async (req) => {
  if (req.auth?.token?.nt360Role !== "direction") throw new HttpsError("permission-denied", "admin requis");
  const enabled = req.data?.enabled === true;
  await db.doc("config/mntFeature").set({ enabled, updatedBy: req.auth.uid, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  await db.collection("auditLog").add({ uid: req.auth.uid, action: "set_mnt_feature", module: "habilitations", entity: "config", entityId: "mntFeature", detail: { enabled }, ts: FieldValue.serverTimestamp() });
  return { ok: true, enabled };
});

// CALENDRIER SLA (ADR-P23) — fuseau/pays, jours fériés éditables et fenêtre d'heures ouvrées B2B. Config
// OPÉRATIONNELLE du module (pas un maître-interrupteur) → gouvernée par le droit d'ÉCRITURE `maintenance`
// (le directeur_contrats la pilote). Document ABSENT ⇒ horloge SLA historique (UTC, Lun–Ven pleins, pas de
// férié). On stocke la forme NORMALISÉE (bornes sûres, fériés dédupliqués/triés). Recompute maintenance après.
exports.setMntCalendar = onCallG("setMntCalendar", { memoryMiB: 256, timeoutSeconds: 60 }, async (req) => {
  await requireWrite(req, "maintenance");
  const { mntCalendar } = require("./domain/mntCalendar");
  const d = req.data || {};
  const norm = mntCalendar({ tzOffsetMinutes: d.tzOffsetMinutes, pays: d.pays, holidays: d.holidays, b2b: d.b2b });
  await db.doc("config/mntCalendar").set({ tzOffsetMinutes: norm.offMin, pays: norm.pays, holidays: norm.holidays, b2b: norm.b2b, updatedBy: req.auth.uid, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  await db.collection("auditLog").add({ uid: req.auth.uid, action: "set_mnt_calendar", module: "maintenance", entity: "config", entityId: "mntCalendar", detail: { offMin: norm.offMin, holidays: norm.holidays.length, b2b: norm.b2b }, ts: FieldValue.serverTimestamp() });
  await requestRecompute(["maintenance"]); // l'horloge SLA change → re-scorer le risque
  return { ok: true, calendar: norm };
});

// DRAPEAU du module « Partenariats & Certifications » (ADR-P01) : même maître-interrupteur que
// setMntFeature. ÉTEINT (défaut) ⇒ l'ERP est STRICTEMENT celui d'avant (aucune surface par_*). Édité en
// Habilitations, DIRECTION uniquement. Écriture Admin SDK (les rules gardent config/parFeature en
// write:false). Audité. Le module s'allume/s'éteint sans redéploiement.
exports.setParFeature = onCallG("setParFeature", { memoryMiB: 512, timeoutSeconds: 300 }, async (req) => {
  if (req.auth?.token?.nt360Role !== "direction") throw new HttpsError("permission-denied", "admin requis");
  const enabled = req.data?.enabled === true;
  await db.doc("config/parFeature").set({ enabled, updatedBy: req.auth.uid, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  await db.collection("auditLog").add({ uid: req.auth.uid, action: "set_par_feature", module: "habilitations", entity: "config", entityId: "parFeature", detail: { enabled }, ts: FieldValue.serverTimestamp() });
  // À l'ALLUMAGE : recompute synchrone scopé pour matérialiser les summaries par_* immédiatement — sinon
  // le module s'ouvre sur des cartes vides (ou figées d'une activation passée) jusqu'au recompute nocturne.
  // BEST-EFFORT : le drapeau est DÉJÀ posé, un échec du recompute ne doit pas transformer l'activation en
  // erreur. À l'extinction, rien à recalculer : le bloc par_ d'aggregate est gaté par le drapeau.
  if (enabled) { try { await recomputeSummaries(["partenariats"]); } catch (e) { await logOps({ kind: "recompute", action: "setParFeature", status: "error", error: e?.message || String(e) }); } }
  return { ok: true, enabled };
});

// pushOrderToClickup : crée (ou met à jour, idempotent) une tâche ClickUp pour une commande, assignée
// à son PM. Lien FP↔tâche stocké en overlay config/clickupLinks → ré-appui = mise à jour, pas de
// doublon. Gouverné par le module « import ». Le token vient du secret CLICKUP_TOKEN (Secret Manager).
// Cœur du push commande → tâche, extrait (lib/clickupPush) pour être testable.
const { pushOrderCore } = require("./lib/clickupPush");

// Index N° FP → taskId des tâches EXISTANTES (via le champ « Opp ID »). Scanne TOUTES les listes pays
// par défaut (anti-doublon multi-pays : une tâche BF/GN ne doit pas être re-créée dans CI). Sert à la
// réconciliation / adoption. `listIds` : liste(s) à scanner (défaut = les 3 pays + la liste cible).
async function buildFpIndex(token, listIds) {
  const clickup = require("./lib/clickup");
  const cf = require("./lib/clickupFields");
  const { fpKey } = require("./lib/ids");
  const lists = Array.isArray(listIds) ? listIds : [listIds];
  const uniq = [...new Set(lists.filter(Boolean))];
  const all = [];
  for (const lid of uniq) {
    // PAS de swallow (audit F3) : un scan de liste raté (429/timeout) produirait un index PARTIEL →
    // une tâche existante non vue → CRÉATION d'un DOUBLON. On laisse l'erreur remonter pour que
    // l'appelant ANNULE la création plutôt que de dupliquer.
    const t = await clickup.listTasks(token, lid, { includeClosed: true });
    // MÊME logique pour la TRONCATURE : au-delà de 5000 tâches, l'index serait partiel sans erreur →
    // on refuse (l'appelant annule le push) plutôt que de risquer des doublons silencieux.
    if (t.truncated) throw new Error(`Liste ClickUp ${lid} tronquée (> 5000 tâches) — index anti-doublon incomplet, push annulé`);
    all.push(...t);
  }
  return cf.buildTaskFpIndex(all, fpKey);
}
// Toutes les listes pays + la liste cible → union pour l'anti-doublon.
function allScanLists(listId) { return [...new Set([...CLICKUP_LISTS_ALL, String(listId)])]; }

exports.pushOrderToClickup = onCallG("pushOrderToClickup", { secrets: [CLICKUP_TOKEN], memoryMiB: 256, timeoutSeconds: 120 }, async (req) => {
  await requireWrite(req, "import");
  const clickup = require("./lib/clickup");
  const cf = require("./lib/clickupFields");
  const { fpKey } = require("./lib/ids");
  const { safeId } = require("./lib/sheets");
  const cfg = (await db.doc("config/clickup").get()).data() || {};
  if (cfg.enabled === false) throw new HttpsError("failed-precondition", "intégration ClickUp désactivée (Habilitations)");
  const token = CLICKUP_TOKEN.value();
  if (!token) throw new HttpsError("failed-precondition", "token ClickUp absent (secret CLICKUP_TOKEN)");
  const order = req.data?.order || {};
  const extra = req.data?.extra || {};
  if (!fpKey(order.fp)) throw new HttpsError("invalid-argument", "N° FP de la commande requis");
  const teamId = cfg.teamId || CLICKUP_TEAM;
  const listId = String(req.data?.listId || cfg.defaultListId || CLICKUP_LIST_CI);

  let members = [];
  try { members = await clickup.listMembers(token, teamId); }
  catch (e) { logger.warn("ClickUp: membres non résolus", { msg: e && e.message }); }
  // Définitions des champs de la liste cible → résolution des libellés d'options en UUID (pas d'UUID
  // codé en dur : robuste si l'admin ClickUp modifie les listes).
  let fieldDefs = [];
  try { fieldDefs = await clickup.listFields(token, listId); }
  catch (e) { logger.warn("ClickUp: champs de liste illisibles", { listId, msg: e && e.message }); }
  // Statuts de la liste → validation du statut initial (omission propre s'il a été renommé).
  let statuses = []; try { statuses = await clickup.getListStatuses(token, listId); } catch (e) { logger.warn("ClickUp: statuts illisibles", { listId, msg: e && e.message }); }

  // VERROU (anti-doublon) : sérialise avec le push en masse et les autres push unitaires → ferme la
  // fenêtre TOCTOU (deux scans avant qu'une création n'ait lieu) sur double-clic concurrent du même FP.
  const { acquireClickupLock, releaseClickupLock } = require("./lib/clickupLock");
  const lock = await acquireClickupLock(db, "push", req.auth.uid);
  if (!lock.acquired) throw new HttpsError("failed-precondition", "Un push ClickUp est déjà en cours — patientez (évite les doublons).");
  try {
  const links = ((await db.doc("config/clickupLinks").get()).data() || {}).map || {};
  const fp = fpKey(order.fp), id = safeId(fp);
  // ANTI-DOUBLON : si la commande n'a pas de lien mais qu'une tâche existe déjà (Opp ID = FP, ex-
  // formulaire), on l'ADOPTE (mise à jour) au lieu de créer un doublon.
  if (!links[id]) {
    // ANTI-DOUBLON STRICT (audit F3) : si l'on ne peut PAS vérifier l'existant (scan en échec), on
    // ANNULE plutôt que de risquer un doublon — l'utilisateur réessaie. Un lien déjà connu, lui,
    // n'a pas besoin de scan (mise à jour sûre).
    let idx;
    try { idx = await buildFpIndex(token, allScanLists(listId)); }
    catch (e) { throw new HttpsError("unavailable", "ClickUp : vérification anti-doublon impossible (liste non scannée) — réessayez. " + ((e && e.message) || "")); }
    if (idx[fp]) links[id] = idx[fp];
  }
  let r;
  try { r = await pushOrderCore({ token, clickup, cf, safeId, fpKey, listId, members, fieldDefs, statuses, links, order, extra }); }
  catch (e) { throw new HttpsError(e.status === 401 || e.status === 403 ? "permission-denied" : "internal", `ClickUp : ${e.message || "échec de la synchronisation"}`); }
  // Persiste le lien (création OU adoption d'une tâche existante) — idempotent.
  await db.doc("config/clickupLinks").set({ map: { [r.id]: r.taskId } }, { merge: true });
  await db.collection("auditLog").add({ uid: req.auth.uid, action: r.created ? "clickup_create" : "clickup_update", module: "import", entity: "order", entityId: fpKey(order.fp), detail: { taskId: r.taskId, listId, assigned: r.assigned, fields: r.fields }, ts: FieldValue.serverTimestamp() });
  return { ok: true, taskId: r.taskId, url: r.url, assigned: r.assigned, created: r.created, fields: r.fields };
  } finally { await releaseClickupLock(db, FieldValue, "push"); }
});

// pushAllOrdersToClickup : crée/synchronise EN MASSE les tâches des commandes. Par défaut, seules les
// commandes NON encore liées sont créées ; force=true resynchronise aussi les tâches existantes (cœur
// + CAF). Membres/champs résolus une seule fois. Direction. Peut être long → le client peut voir un
// timeout pendant que le traitement se poursuit côté serveur (le journal d'audit enregistre la fin).
exports.pushAllOrdersToClickup = onCallG("pushAllOrdersToClickup", { secrets: [CLICKUP_TOKEN], memoryMiB: 512, timeoutSeconds: 540 }, async (req) => {
  if (req.auth?.token?.nt360Role !== "direction") throw new HttpsError("permission-denied", "admin requis");
  if (!(await rateLimit(req.auth.uid, "heavy", 30, 60_000))) throw new HttpsError("resource-exhausted", "Trop de synchronisations en peu de temps — patientez un instant.");
  const clickup = require("./lib/clickup");
  const cf = require("./lib/clickupFields");
  const { fpKey } = require("./lib/ids");
  const { safeId } = require("./lib/sheets");
  const cfg = (await db.doc("config/clickup").get()).data() || {};
  if (cfg.enabled === false) throw new HttpsError("failed-precondition", "intégration ClickUp désactivée (Habilitations)");
  const token = CLICKUP_TOKEN.value();
  if (!token) throw new HttpsError("failed-precondition", "token ClickUp absent (secret CLICKUP_TOKEN)");
  const force = req.data?.force === true;
  const teamId = cfg.teamId || CLICKUP_TEAM;
  const listId = String(req.data?.listId || cfg.defaultListId || CLICKUP_LIST_CI);
  const paysByList = { "901215917683": "CI", "901215918697": "BF", "901215918699": "GN" };
  const pays = paysByList[listId];
  let members = []; try { members = await clickup.listMembers(token, teamId); } catch (e) { logger.warn("bulk push: membres non résolus", { msg: e && e.message }); }
  let fieldDefs = []; try { fieldDefs = await clickup.listFields(token, listId); } catch (e) { logger.warn("bulk push: champs illisibles", { msg: e && e.message }); }
  let statuses = []; try { statuses = await clickup.getListStatuses(token, listId); } catch (e) { logger.warn("bulk push: statuts illisibles", { msg: e && e.message }); }
  // ANTI-DOUBLON : index des tâches existantes par FP (Opp ID) → adopter au lieu de dupliquer.
  // Audit F3 : un index PARTIEL (scan en échec) dupliquerait EN MASSE → on ANNULE le push entier
  // plutôt que de créer des doublons sur toutes les commandes non liées.
  // VERROU DE CONCURRENCE : deux clics rapprochés (le traitement long fait croire à un échec) lançaient
  // des push PARALLÈLES → index anti-doublon figé avant les créations des autres → tâches TRIPLÉES. Un
  // seul push en masse à la fois ; les concurrents sont refusés proprement.
  const { acquireClickupLock, releaseClickupLock } = require("./lib/clickupLock");
  const lock = await acquireClickupLock(db, "push", req.auth.uid);
  if (!lock.acquired) throw new HttpsError("failed-precondition", "Un push ClickUp en masse est déjà en cours — patientez qu'il se termine (évite les doublons). Suivez l'avancement dans ClickUp.");
  try {
  let fpIndex;
  try { fpIndex = await buildFpIndex(token, allScanLists(listId)); }
  catch (e) { throw new HttpsError("unavailable", "ClickUp : index anti-doublon indisponible — push en masse annulé pour éviter les doublons. " + ((e && e.message) || "")); }
  const links = ((await db.doc("config/clickupLinks").get()).data() || {}).map || {};
  const orders = await loadCommandeRows();
  const newLinks = {};
  let pending = 0; // liens non encore flushés (résilience : on persiste régulièrement, pas qu'à la fin)
  const flush = async () => { if (pending) { await db.doc("config/clickupLinks").set({ map: newLinks }, { merge: true }); pending = 0; } };
  let created = 0, updated = 0, adopted = 0, failed = 0, skipped = 0;
  for (const o of orders) {
    const fp = fpKey(o.fp);
    if (!fp) { skipped++; continue; }
    const id = safeId(fp);
    const existingTaskId = links[id] || newLinks[id] || fpIndex[fp] || null;
    if (existingTaskId && !force) {
      // Adoption d'une tâche existante non encore liée (écrit le lien, sans pousser de contenu).
      if (!links[id] && !newLinks[id]) { newLinks[id] = existingTaskId; adopted++; pending++; } else skipped++;
    } else {
      try {
        const r = await pushOrderCore({ token, clickup, cf, safeId, fpKey, listId, members, fieldDefs, statuses, links: { ...links, ...newLinks, ...(existingTaskId ? { [id]: existingTaskId } : {}) }, order: o, extra: { pays } });
        if (r.created) created++; else updated++;
        if (!links[id]) { newLinks[id] = r.taskId; pending++; } // persiste création OU adoption
      } catch (e) { failed++; logger.warn("bulk push: échec", { fp: o.fp, msg: e && e.message }); }
    }
    // Flush incrémental : un timeout (540 s) avant la fin ne fait plus perdre les liens déjà créés.
    if (pending >= 25) await flush();
  }
  await flush();
  const res = { created, updated, adopted, failed, skipped, total: orders.length };
  await db.collection("auditLog").add({ uid: req.auth.uid, action: "clickup_bulk_push", module: "habilitations", entity: "config", entityId: "clickupLinks", detail: { ...res, force, listId }, ts: FieldValue.serverTimestamp() });
  return { ok: true, ...res };
  } finally { await releaseClickupLock(db, FieldValue, "push"); }
});

// reconcileClickupLinks : RATTACHE les commandes aux tâches ClickUp DÉJÀ existantes (Opp ID = FP),
// sans rien créer ni modifier dans ClickUp — à lancer AVANT tout push en masse pour éviter les
// doublons des tâches créées via l'ancien formulaire. Direction.
exports.reconcileClickupLinks = onCallG("reconcileClickupLinks", { secrets: [CLICKUP_TOKEN], memoryMiB: 512, timeoutSeconds: 300 }, async (req) => {
  if (req.auth?.token?.nt360Role !== "direction") throw new HttpsError("permission-denied", "admin requis");
  const cfg = (await db.doc("config/clickup").get()).data() || {};
  if (cfg.enabled === false) throw new HttpsError("failed-precondition", "intégration ClickUp désactivée (Habilitations)");
  const token = CLICKUP_TOKEN.value();
  if (!token) throw new HttpsError("failed-precondition", "token ClickUp absent (secret CLICKUP_TOKEN)");
  const { fpKey } = require("./lib/ids");
  const { safeId } = require("./lib/sheets");
  const listId = String(req.data?.listId || cfg.defaultListId || CLICKUP_LIST_CI);
  let fpIndex;
  try { fpIndex = await buildFpIndex(token, allScanLists(listId)); }
  catch (e) { throw new HttpsError(e.status === 401 || e.status === 403 ? "permission-denied" : "internal", `ClickUp : ${e.message || "réconciliation impossible"}`); }
  const links = ((await db.doc("config/clickupLinks").get()).data() || {}).map || {};
  const orders = await loadCommandeRows();
  const newLinks = {};
  let matched = 0, already = 0;
  for (const o of orders) {
    const fp = fpKey(o.fp); if (!fp) continue;
    const id = safeId(fp);
    if (links[id]) { already++; continue; }
    if (fpIndex[fp]) { newLinks[id] = fpIndex[fp]; matched++; }
  }
  if (matched) await db.doc("config/clickupLinks").set({ map: newLinks }, { merge: true });
  const res = { matched, already, total: orders.length, tasksWithFp: Object.keys(fpIndex).length };
  await db.collection("auditLog").add({ uid: req.auth.uid, action: "clickup_reconcile", module: "habilitations", entity: "config", entityId: "clickupLinks", detail: { ...res, listId }, ts: FieldValue.serverTimestamp() });
  return { ok: true, ...res };
});

// dedupeClickupTasks : NETTOYAGE des tâches ClickUp DUPLIQUÉES (même N° FP) — typiquement créées par des
// push concurrents avant le verrou. Deux temps : apply=false → APERÇU (ne supprime RIEN), apply=true →
// supprime. Conserve la tâche LIÉE (ou la plus ancienne) et ne supprime que les doublons créés dans la
// fenêtre (défaut 24 h = « doublons du jour »). Direction. Audité.
exports.dedupeClickupTasks = onCallG("dedupeClickupTasks", { secrets: [CLICKUP_TOKEN], memoryMiB: 512, timeoutSeconds: 540 }, async (req) => {
  if (req.auth?.token?.nt360Role !== "direction") throw new HttpsError("permission-denied", "admin requis");
  const cfg = (await db.doc("config/clickup").get()).data() || {};
  if (cfg.enabled === false) throw new HttpsError("failed-precondition", "intégration ClickUp désactivée (Habilitations)");
  const token = CLICKUP_TOKEN.value();
  if (!token) throw new HttpsError("failed-precondition", "token ClickUp absent (secret CLICKUP_TOKEN)");
  const clickup = require("./lib/clickup");
  const cf = require("./lib/clickupFields");
  const { fpKey } = require("./lib/ids");
  const { planDedupe } = require("./domain/clickupDedupe");
  const listId = String(req.data?.listId || cfg.defaultListId || CLICKUP_LIST_CI);
  // SÉCURITÉ SUPPRESSION : le dédoublonnage groupe par N° FP (Opp ID). Sur une liste NON-commande (ex. BC,
  // où plusieurs N° BC distincts partagent légitimement un FP), il proposerait de supprimer des tâches
  // DISTINCTES et valides. On restreint donc aux listes commandes (les seules où « même FP = doublon »).
  if (!CLICKUP_LISTS_ALL.includes(listId)) throw new HttpsError("invalid-argument", "Le dédoublonnage ne s'applique qu'aux listes de commandes (pas aux BC/autres) — liste refusée.");
  const apply = req.data?.apply === true;
  // Fenêtre de suppression : par défaut les tâches créées dans les dernières 24 h (« doublons du jour »).
  // 0 = toutes les époques (SEULEMENT sur un nombre 0 EXPLICITE). Borné à 8760 h (1 an). Une saisie invalide
  // ("", "x", NaN) retombe sur le défaut 24 h — JAMAIS sur 0 (qui supprimerait les doublons de toute époque).
  let windowHours = 24;
  const rawWH = req.data?.windowHours;
  if (rawWH != null && rawWH !== "") {
    const n = Number(rawWH);
    if (Number.isFinite(n)) windowHours = Math.min(8760, Math.max(0, n));
  }
  const sinceMs = windowHours > 0 ? Date.now() - windowHours * 3600_000 : 0;
  // Scan SANS swallow (audit F3) : un scan partiel prendrait des tâches manquantes pour des « uniques »
  // et pourrait supprimer à tort → on ANNULE plutôt (l'appelant relance).
  const tasks = [];
  for (const lid of allScanLists(listId)) {
    let t;
    try { t = await clickup.listTasks(token, lid, { includeClosed: true }); }
    catch (e) { throw new HttpsError("unavailable", `ClickUp : liste ${lid} illisible — dédoublonnage annulé (aucune suppression). ${(e && e.message) || ""}`); }
    if (t.truncated) throw new HttpsError("failed-precondition", `Liste ClickUp ${lid} tronquée (> 5000 tâches) — dédoublonnage annulé pour éviter des suppressions à tort.`);
    for (const task of t) { const fp = fpKey(cf.taskFp(task)); if (fp) tasks.push({ id: task.id, fp, dateCreatedMs: Number(task.date_created) || 0, name: task.name }); }
  }
  const links = ((await db.doc("config/clickupLinks").get()).data() || {}).map || {};
  const linkedIds = new Set(Object.values(links));
  const plan = planDedupe(tasks, linkedIds, sinceMs);
  const samples = plan.groups.slice(0, 50).map((g) => ({ fp: g.fp, keptId: g.keepId, toDelete: g.deleteIds.length }));
  let deleted = 0, failed = 0;
  if (apply) {
    for (const g of plan.groups) {
      for (const id of g.deleteIds) {
        try { await clickup.deleteTask(token, id); deleted++; }
        catch (e) { failed++; logger.warn("dedupe ClickUp: suppression échouée", { id, msg: e && e.message }); }
      }
    }
    await db.collection("auditLog").add({ uid: req.auth.uid, action: "clickup_dedupe", module: "habilitations", entity: "config", entityId: "clickupTasks", detail: { deleted, failed, groups: plan.groups.length, duplicates: plan.duplicates, windowHours, listId }, ts: FieldValue.serverTimestamp() });
  }
  return { ok: true, dryRun: !apply, groups: plan.groups.length, duplicates: plan.duplicates, deletable: plan.deletable, deleted, failed, windowHours, samples };
});

// dedupeBcTasks (Lot 4b) : NETTOYAGE des tâches ClickUp de BC DUPLIQUÉES — même N° BC CANONIQUE (et non le
// N° FP, où plusieurs BC distincts partagent légitimement un FP). Complète dedupeClickupTasks, qui refuse
// justement les listes BC. Même sûreté : apply=false → aperçu (ne supprime rien) ; conserve la tâche LIÉE
// (config/clickupBcLinks) ou la plus ancienne ; ne supprime que les doublons de la fenêtre (défaut 24 h).
exports.dedupeBcTasks = onCallG("dedupeBcTasks", { secrets: [CLICKUP_TOKEN], memoryMiB: 512, timeoutSeconds: 540 }, async (req) => {
  await requireWrite(req, "bc"); // gouverné par le module BC (comme les push BC), pas « direction » global
  const cfg = (await db.doc("config/clickup").get()).data() || {};
  if (cfg.enabled === false) throw new HttpsError("failed-precondition", "intégration ClickUp désactivée (Habilitations)");
  const token = CLICKUP_TOKEN.value();
  if (!token) throw new HttpsError("failed-precondition", "token ClickUp absent (secret CLICKUP_TOKEN)");
  const clickup = require("./lib/clickup");
  const bc = require("./lib/clickupBc");
  const { safeId } = require("./lib/sheets");
  const { planDedupe } = require("./domain/clickupDedupe");
  const listId = bcListIdOf(cfg, req.data?.listId);
  const apply = req.data?.apply === true;
  // Même politique de fenêtre que dedupeClickupTasks : défaut 24 h, 0 EXPLICITE = toutes les époques, borné 1 an.
  let windowHours = 24;
  const rawWH = req.data?.windowHours;
  if (rawWH != null && rawWH !== "") { const n = Number(rawWH); if (Number.isFinite(n)) windowHours = Math.min(8760, Math.max(0, n)); }
  const sinceMs = windowHours > 0 ? Date.now() - windowHours * 3600_000 : 0;
  // Scan SANS swallow : un scan tronqué/illisible prendrait des doublons pour des uniques → on ANNULE.
  let t;
  try { t = await clickup.listTasks(token, listId, { includeClosed: true }); }
  catch (e) { throw new HttpsError("unavailable", `ClickUp : liste BC ${listId} illisible — dédoublonnage annulé (aucune suppression). ${(e && e.message) || ""}`); }
  if (t.truncated) throw new HttpsError("failed-precondition", `Liste BC ClickUp ${listId} tronquée (> 5000 tâches) — dédoublonnage annulé pour éviter des suppressions à tort.`);
  // Regroupement par N° BC CANONIQUE : on place la clé BC dans le champ `fp` attendu par le planificateur
  // générique (planDedupe groupe par `t.fp` = « clé de regroupement », peu importe sa sémantique).
  const tasks = [];
  for (const task of t) { const n = bc.taskBcNumber(task); const k = n ? bc.bcKey(n, safeId) : null; if (k) tasks.push({ id: task.id, fp: k, dateCreatedMs: Number(task.date_created) || 0 }); }
  const links = ((await db.doc("config/clickupBcLinks").get()).data() || {}).map || {};
  const linkedIds = new Set(Object.values(links));
  const plan = planDedupe(tasks, linkedIds, sinceMs);
  const samples = plan.groups.slice(0, 50).map((g) => ({ bcKey: g.fp, keptId: g.keepId, toDelete: g.deleteIds.length }));
  let deleted = 0, failed = 0;
  if (apply) {
    for (const g of plan.groups) {
      for (const id of g.deleteIds) {
        try { await clickup.deleteTask(token, id); deleted++; }
        catch (e) { failed++; logger.warn("dedupe BC ClickUp: suppression échouée", { id, msg: e && e.message }); }
      }
    }
    await db.collection("auditLog").add({ uid: req.auth.uid, action: "clickup_bc_dedupe", module: "bc", entity: "config", entityId: "clickupBcTasks", detail: { deleted, failed, groups: plan.groups.length, duplicates: plan.duplicates, windowHours, listId }, ts: FieldValue.serverTimestamp() });
  }
  return { ok: true, dryRun: !apply, groups: plan.groups.length, duplicates: plan.duplicates, deletable: plan.deletable, deleted, failed, windowHours, samples };
});

// Diagnostic ClickUp RÉUTILISABLE (callable ET planifié) : scanne la liste une fois, croise commandes +
// overlays, RE-VÉRIFIE la santé du webhook (ClickUp le désactive après échecs répétés — jamais recontrôlé
// jusqu'ici → dérive silencieuse), écrit summaries/clickupHealth (horodaté `at`). Throw en cas d'échec
// (l'appelant persiste `lastError`). loadCommandeRows/onSchedule hoistés → déclaration avant usage OK.
async function runClickupHealth(listId) {
  const token = CLICKUP_TOKEN.value();
  if (!token) throw new Error("token ClickUp absent (secret CLICKUP_TOKEN)");
  const clickup = require("./lib/clickup");
  const { clickupHealth } = require("./domain/clickupHealth");
  const { fpKey } = require("./lib/ids");
  const { safeId } = require("./lib/sheets");
  const cfg = (await db.doc("config/clickup").get()).data() || {};
  const tasks = await clickup.listTasks(token, listId, { includeClosed: true });
  const links = ((await db.doc("config/clickupLinks").get()).data() || {}).map || {};
  const syncMap = ((await db.doc("config/clickupSync").get()).data() || {}).map || {};
  const orders = await loadCommandeRows();
  const health = clickupHealth(orders, tasks, links, syncMap, fpKey, safeId);
  health.truncated = !!tasks.truncated; // liens fantômes non fiables si le scan est tronqué (> 5000 tâches)
  // Santé du webhook : le webhook enregistré existe-t-il TOUJOURS côté ClickUp et n'est-il pas « failing » ?
  // Best-effort — un échec ici n'invalide pas le diagnostic. Reflète l'état RÉEL dans config/clickup.webhookActive.
  let webhook = { registered: false };
  try {
    const wh = (await db.doc("config/clickupWebhook").get()).data() || {};
    if (wh.id) {
      const list = await clickup.listWebhooks(token, cfg.teamId || CLICKUP_TEAM);
      const mine = (list || []).find((w) => String(w.id) === String(wh.id));
      const status = mine && mine.health ? (mine.health.status || null) : null;
      const active = !!mine && status !== "failing";
      webhook = { registered: true, present: !!mine, status, active };
      await db.doc("config/clickup").set({ webhookActive: active }, { merge: true });
    }
  } catch (e) { webhook = { registered: true, error: String((e && e.message) || e).slice(0, 120) }; }
  await db.doc("summaries/clickupHealth").set({ ...health, webhook, listId, lastError: null, lastErrorAt: null, at: FieldValue.serverTimestamp() });
  return health;
}

// clickupHealth : diagnostic de QUALITÉ de l'intégration (couverture, tâches orphelines, écarts CAF, liens
// fantômes, santé webhook). Écrit summaries/clickupHealth (lu par la carte de monitoring). Direction.
exports.clickupHealth = onCallG("clickupHealth", { secrets: [CLICKUP_TOKEN], memoryMiB: 512, timeoutSeconds: 300 }, async (req) => {
  if (req.auth?.token?.nt360Role !== "direction") throw new HttpsError("permission-denied", "admin requis");
  const cfg = (await db.doc("config/clickup").get()).data() || {};
  if (cfg.enabled === false) throw new HttpsError("failed-precondition", "intégration ClickUp désactivée (Habilitations)");
  if (!CLICKUP_TOKEN.value()) throw new HttpsError("failed-precondition", "token ClickUp absent (secret CLICKUP_TOKEN)");
  const listId = String(req.data?.listId || cfg.defaultListId || CLICKUP_LIST_CI);
  // Tout est enveloppé : n'importe quelle erreur (API ClickUp 429/404/réseau, lecture loadCommandeRows,
  // ÉCRITURE Firestore illégale…) est rendue LISIBLE — on persiste le motif réel (`lastError`) ET on
  // propage un HttpsError PORTEUR DU MESSAGE (sinon « internal » nu, indiagnosticable côté client).
  try {
    const health = await runClickupHealth(listId);
    return { ok: true, ...health };
  } catch (e) {
    const status = e && e.status;
    const reason = String((e && e.message) || (e && e.code) || e || "erreur inconnue").slice(0, 300);
    await db.doc("summaries/clickupHealth").set({ lastError: reason, lastErrorAt: FieldValue.serverTimestamp(), listId }, { merge: true }).catch(() => {});
    throw new HttpsError(status === 401 || status === 403 ? "permission-denied" : "internal", `Diagnostic ClickUp : ${reason}`);
  }
});

// scheduledClickupHealth : diagnostic PLANIFIÉ. Jusqu'ici on-demand uniquement → couverture/orphelins/
// écart CAF/liens fantômes affichés au cockpit pouvaient être périmés jusqu'au clic d'un admin. Best-effort :
// persiste lastError sans planter le scheduler. Co-localisé avec le pull (05:00) et le recompute.
exports.scheduledClickupHealth = onSchedule({ schedule: "every day 05:15", secrets: [CLICKUP_TOKEN], memoryMiB: 512, timeoutSeconds: 300 }, async () => {
  const t0 = Date.now();
  try {
    const cfg = (await db.doc("config/clickup").get()).data() || {};
    if (cfg.enabled === false) return;
    const h = await runClickupHealth(String(cfg.defaultListId || CLICKUP_LIST_CI));
    await logOps({ kind: "scheduled", action: "clickupHealth", status: "ok", ms: Date.now() - t0, detail: { coverage: h.coverage, phantomLinks: h.phantomLinks, orphanTasks: h.orphanTasks } });
  } catch (e) {
    const reason = String((e && e.message) || e).slice(0, 300);
    await db.doc("summaries/clickupHealth").set({ lastError: reason, lastErrorAt: FieldValue.serverTimestamp() }, { merge: true }).catch(() => {});
    await logOps({ kind: "scheduled", action: "clickupHealth", status: "error", ms: Date.now() - t0, detail: { reason } }).catch(() => {});
  }
});

// listClickupMembers : membres du workspace ClickUp (nom + e-mail) — pour peupler le référentiel PM
// avec des noms EXACTS (évite les fautes de saisie qui casseraient l'assignation). Direction.
exports.listClickupMembers = onCallG("listClickupMembers", { secrets: [CLICKUP_TOKEN], memoryMiB: 256, timeoutSeconds: 60 }, async (req) => {
  if (req.auth?.token?.nt360Role !== "direction") throw new HttpsError("permission-denied", "admin requis");
  const token = CLICKUP_TOKEN.value();
  if (!token) throw new HttpsError("failed-precondition", "token ClickUp absent (secret CLICKUP_TOKEN)");
  const clickup = require("./lib/clickup");
  const cfg = (await db.doc("config/clickup").get()).data() || {};
  let members;
  try { members = await clickup.listMembers(token, cfg.teamId || CLICKUP_TEAM); }
  catch (e) { throw new HttpsError(e.status === 401 || e.status === 403 ? "permission-denied" : "internal", `ClickUp : ${e.message || "membres illisibles"}`); }
  return { ok: true, members: members.map((m) => ({ name: m.username, email: m.email })).filter((m) => m.name) };
});

// Lignes de commandes matérialisées (tous les chunks commandesRows/{i}).
async function loadCommandeRows() {
  const meta = (await db.doc("summaries/commandes").get()).data() || {};
  const chunks = Number(meta.chunks || 0);
  // Lecture des chunks EN PARALLÈLE (le nombre est connu via meta.chunks) : sur un gros carnet, 25 chunks
  // lus en série = 25 aller-retours ; en parallèle → 1 temps de latence. Ordre préservé (map indexé).
  const snaps = await Promise.all(Array.from({ length: chunks }, (_, i) => db.doc(`commandesRows/${i}`).get()));
  const rows = [];
  for (const s of snaps) rows.push(...(((s.data() || {}).rows) || []));
  return rows;
}

// CAF courant par clé safeId(fp), lu des commandes matérialisées.
async function loadCafByFp(safeId) {
  const out = {};
  for (const r of await loadCommandeRows()) { if (r && r.fp) out[safeId(r.fp)] = Number(r.facture || 0); }
  return out;
}

// Pousse le CAF (CA Facturé) des commandes vers leurs tâches ClickUp liées. force=false : uniquement
// les CAF ayant changé depuis le dernier envoi (overlay config/clickupCaf) — cheap, appelé après
// chaque recompute. force=true : toutes les tâches (bouton « Forcer la synchro »). Le token doit être
// disponible (secret lié à la fonction appelante). Nécessite les champs de la liste par défaut pour
// résoudre l'id du champ « CA Facturé » (partagé par les 3 listes pays).
async function runCafSync({ force }) {
  const cfg = (await db.doc("config/clickup").get()).data() || {};
  if (cfg.enabled === false) return { disabled: true, pushed: 0, skipped: 0, total: 0 };
  const token = CLICKUP_TOKEN.value();
  if (!token) return { pushed: 0, skipped: 0, total: 0, note: "token absent" };
  const links = ((await db.doc("config/clickupLinks").get()).data() || {}).map || {};
  if (!Object.keys(links).length) return { pushed: 0, skipped: 0, total: 0 };
  const clickup = require("./lib/clickup");
  const cf = require("./lib/clickupFields");
  const { diffCaf } = require("./lib/clickupCaf");
  const { safeId } = require("./lib/sheets");
  const listId = String(cfg.defaultListId || CLICKUP_LIST_CI);
  const fields = await clickup.listFields(token, listId);
  const cafField = cf.findField(fields, cf.FIELD_NAMES.caFacture);
  if (!cafField) throw new Error("champ « CA Facturé » introuvable dans la liste ClickUp");
  const cafByFp = await loadCafByFp(safeId);
  const last = ((await db.doc("config/clickupCaf").get()).data() || {}).map || {};
  const { toPush, nextMap, skipped } = diffCaf(links, last, cafByFp, force);
  let pushed = 0, failed = 0;
  for (const t of toPush) {
    try { await clickup.setField(token, t.taskId, cafField.id, t.caf); nextMap[t.key] = t.caf; pushed++; }
    catch (e) { logger.warn("CAF→ClickUp: échec", { key: t.key, msg: e && e.message }); if (last[t.key] !== undefined) nextMap[t.key] = last[t.key]; failed++; }
  }
  await db.doc("config/clickupCaf").set({ map: nextMap, updatedAt: FieldValue.serverTimestamp() });
  return { pushed, skipped, failed, total: Object.keys(links).length };
}

// Entretien automatique du CAF après un recompute (best-effort : n'échoue JAMAIS l'appelant).
async function maybeSyncCaf(trigger) {
  try {
    const r = await runCafSync({ force: false });
    if (r.pushed) logger.info("CAF→ClickUp entretenu", { trigger, ...r });
  } catch (e) { logger.warn("CAF→ClickUp: entretien échoué", { trigger, msg: e && e.message }); }
}

// syncClickupCaf : force la synchro du CAF de TOUTES les tâches liées (bouton Habilitations). Direction.
exports.syncClickupCaf = onCallG("syncClickupCaf", { secrets: [CLICKUP_TOKEN], memoryMiB: 256, timeoutSeconds: 300 }, async (req) => {
  if (req.auth?.token?.nt360Role !== "direction") throw new HttpsError("permission-denied", "admin requis");
  if (!(await rateLimit(req.auth.uid, "heavy", 30, 60_000))) throw new HttpsError("resource-exhausted", "Trop de synchronisations en peu de temps — patientez un instant.");
  const token = CLICKUP_TOKEN.value();
  if (!token) throw new HttpsError("failed-precondition", "token ClickUp absent (secret CLICKUP_TOKEN)");
  let res;
  try { res = await runCafSync({ force: true }); }
  catch (e) { throw new HttpsError(e.status === 401 || e.status === 403 ? "permission-denied" : "internal", `CAF : ${(e && e.message) || e}`); }
  await db.collection("auditLog").add({ uid: req.auth.uid, action: "clickup_caf_sync", module: "habilitations", entity: "config", entityId: "clickupCaf", detail: res, ts: FieldValue.serverTimestamp() });
  return { ok: true, ...res };
});

// C1 (audit intégral) : l'assigné ClickUp ne REMPLIT le PM app (config/orderPm) QUE pour les
// commandes SANS PM app. Le PM posé dans l'app (setOrderPm) fait AUTORITÉ : un pull nocturne ou un
// webhook ne doit JAMAIS écraser une affectation humaine par l'assigné ClickUp (potentiellement
// périmé/différent), ce qui la « révertait » silencieusement à chaque événement. Renvoie le nombre
// de PM effectivement remplis (commandes jusque-là sans PM).
async function fillOrderPmFromClickup(updates) {
  const keys = Object.keys(updates || {});
  if (!keys.length) return 0;
  const current = ((await db.doc("config/orderPm").get()).data() || {}).map || {};
  const fill = {};
  for (const k of keys) if (!String(current[k] || "").trim()) fill[k] = updates[k];
  const n = Object.keys(fill).length;
  if (n) await db.doc("config/orderPm").set({ map: fill, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  return n;
}

// SENS INVERSE ClickUp → app : lit le statut projet + les dates des tâches liées et les stocke en
// overlay config/clickupSync (survit au recompute). Recalcule ensuite les commandes pour fusionner
// immédiatement ces champs dans les lignes. Préserve la dernière valeur connue si un getTask échoue.
async function runClickupPull() {
  const cfg = (await db.doc("config/clickup").get()).data() || {};
  if (cfg.enabled === false) return { disabled: true, pulled: 0, total: 0 };
  const token = CLICKUP_TOKEN.value();
  if (!token) return { pulled: 0, total: 0, note: "token absent" };
  const links = ((await db.doc("config/clickupLinks").get()).data() || {}).map || {};
  const keys = Object.keys(links);
  if (!keys.length) return { pulled: 0, total: 0 };
  const clickup = require("./lib/clickup");
  const cf = require("./lib/clickupFields");
  const prev = ((await db.doc("config/clickupSync").get()).data() || {}).map || {};
  const map = {};
  for (const k of Object.keys(prev)) if (links[k]) map[k] = prev[k]; // purge les liens disparus
  const pmUpdates = {}; // assigné ClickUp → PM app (overlay config/orderPm), quand un assigné existe
  // Un SEUL listTasks paginé par liste (≈15 appels pour ~1400 tâches), indexé par id — et non N getTask
  // séquentiels (un par commande liée). À l'échelle réelle (≈1400 liens) le N+1 dépassait le timeout 300 s
  // et ne synchronisait qu'une fraction des tâches (« 209 synchronisées » pour 1400 liens). On scanne
  // TOUTES les listes pays (une tâche BF/GN peut être liée), en tolérant qu'une liste soit illisible.
  const listId = String(cfg.defaultListId || CLICKUP_LIST_CI);
  const taskById = {};
  let truncated = 0, listErrors = 0;
  for (const lid of allScanLists(listId)) {
    let tasks;
    try { tasks = await clickup.listTasks(token, lid, { includeClosed: true }); }
    catch (e) { logger.warn("ClickUp pull: liste illisible", { lid, msg: e && e.message }); listErrors++; continue; }
    if (tasks.truncated) truncated++; // > 5000 tâches : certaines manqueront → repli sur l'état précédent
    for (const t of tasks) taskById[String(t.id)] = t;
  }
  let pulled = 0, failed = 0;
  for (const key of keys) {
    const task = taskById[String(links[key])];
    // Tâche absente du scan (supprimée côté ClickUp, liste illisible/tronquée) → on GARDE l'état précédent
    // (déjà recopié dans `map`), comme le faisait le repli sur échec getTask. Pas de régression à vide.
    if (!task) { failed++; continue; }
    const sync = { ...cf.readTaskSync(task), taskId: links[key] };
    // L'endpoint LISTE n'inclut PAS les checklists (→ progress null) ni toujours time_spent, contrairement
    // à GET /task. On préserve donc la dernière valeur connue quand la lecture liste est nulle, pour ne pas
    // régresser un avancement / un temps passé déjà remonté.
    const p = prev[key] || {};
    if (sync.progress == null && p.progress != null) sync.progress = p.progress;
    if (sync.timeSpentMs == null && p.timeSpentMs != null) sync.timeSpentMs = p.timeSpentMs;
    map[key] = sync;
    if (sync.pm) pmUpdates[key] = sync.pm; // récupère le PM courant (assigné) de la tâche
    pulled++;
  }
  if (truncated || listErrors) logger.warn("ClickUp pull: couverture partielle", { truncated, listErrors, pulled, total: keys.length });
  await db.doc("config/clickupSync").set({ map, updatedAt: FieldValue.serverTimestamp() });
  // App-wins : l'assigné ClickUp ne remplit le PM app QUE pour les commandes sans PM app (cf. C1).
  const pmFilled = await fillOrderPmFromClickup(pmUpdates);
  // Couvre tous les summaries dérivés de clickupSync : chunks commandes + Actualité (projets bloqués/
  // urgents, retard livraison) + Qualité (incohérences statut↔données).
  try { const { recomputeAll } = require("./lib/aggregate"); await recomputeAll(db, ["commandes", "news", "dataQuality"]); }
  catch (e) { logger.warn("ClickUp pull: recompute partiel échoué", { msg: e && e.message }); }
  return { pulled, failed, total: keys.length, pmUpdated: pmFilled };
}

// syncFromClickup : bouton « Synchroniser depuis ClickUp » (statut projet + dates). Direction.
exports.syncFromClickup = onCallG("syncFromClickup", { secrets: [CLICKUP_TOKEN], memoryMiB: 512, timeoutSeconds: 300 }, async (req) => {
  if (req.auth?.token?.nt360Role !== "direction") throw new HttpsError("permission-denied", "admin requis");
  const token = CLICKUP_TOKEN.value();
  if (!token) throw new HttpsError("failed-precondition", "token ClickUp absent (secret CLICKUP_TOKEN)");
  let res;
  try { res = await runClickupPull(); }
  catch (e) { throw new HttpsError(e.status === 401 || e.status === 403 ? "permission-denied" : "internal", `ClickUp : ${(e && e.message) || e}`); }
  await db.collection("auditLog").add({ uid: req.auth.uid, action: "clickup_pull", module: "habilitations", entity: "config", entityId: "clickupSync", detail: res, ts: FieldValue.serverTimestamp() });
  return { ok: true, ...res };
});

// scheduledClickupPull : tirage QUOTIDIEN du statut + dates ClickUp → app (agrégats jamais périmés).
exports.scheduledClickupPull = onSchedule({ schedule: "every day 04:30", secrets: [CLICKUP_TOKEN], memoryMiB: 512, timeoutSeconds: 300 }, async () => {
  const t0 = Date.now();
  try {
    const res = await runClickupPull();
    await logOps({ kind: "scheduled", action: "clickupPull", status: "ok", ms: Date.now() - t0, detail: { count: res.pulled } });
  } catch (e) {
    logger.error("scheduledClickupPull a échoué", { message: e && e.message, stack: e && e.stack });
    await logOps({ kind: "scheduled", action: "clickupPull", status: "error", ms: Date.now() - t0, error: (e && e.message) || String(e) });
  }
});

// ===================================================================================================
// INTÉGRATION BC FOURNISSEURS ⇄ ClickUp (liste « Commandes Fournisseurs »).
// Une tâche = UN bon de commande (N° BC) ; les lignes bcLines partageant le même N° BC sont AGRÉGÉES
// (montant sommé). Sens app → ClickUp : push/synchro du BC (fournisseur, montant, ETA, pays, client,
// Opp ID). Sens ClickUp → app : le STATUT d'avancement achat + l'ETA remontent en overlay
// config/clickupBcSync (ADDITIF : n'écrasent jamais le statut financier SOA de l'app). ClickUp fait
// foi sur l'avancement logistique du BC.
// ===================================================================================================
const { pushBcCore } = require("./lib/clickupBcPush");

// Lignes BC brutes (collection bcLines), issues de l'import BC (source ≠ « fiche »). L'exécution des
// BC = achats RÉELLEMENT émis, pas les achats planifiés au niveau fiche affaire.
async function loadBcLines() {
  const out = [];
  (await db.collection("bcLines").get()).forEach((doc) => { const v = doc.data() || {}; if (v.source !== "fiche") out.push({ id: doc.id, ...v }); });
  return out;
}

// Index N° BC (champ « Numéro de Commande ») → taskId des tâches BC EXISTANTES → adoption anti-doublon.
async function buildBcClickupIndex(token, listId) {
  const clickup = require("./lib/clickup");
  const bc = require("./lib/clickupBc");
  const { safeId } = require("./lib/sheets");
  const tasks = await clickup.listTasks(token, listId, { includeClosed: true });
  // MÊME garde que buildFpIndex : un index TRONQUÉ (> 5000 tâches) rate des adoptions → doublons. On
  // REFUSE plutôt que de rendre un index partiel silencieux (l'appelant annule la création BC).
  if (tasks.truncated) throw new Error(`Liste BC ClickUp ${listId} tronquée (> 5000 tâches) — index anti-doublon incomplet, opération annulée`);
  return { index: bc.buildBcIndex(tasks, safeId), tasks };
}

function bcListIdOf(cfg, override) { return String(override || (cfg && cfg.bcListId) || CLICKUP_LIST_BC); }

// pushBcToClickup : crée (ou met à jour, idempotent) la tâche d'UN bon de commande (identifié par son
// N° BC). Agrège toutes les lignes bcLines de même N° BC en une tâche. Lien N°BC↔tâche en overlay
// config/clickupBcLinks → ré-appui = mise à jour, pas de doublon. Gouverné par le module « bc ».
exports.pushBcToClickup = onCallG("pushBcToClickup", { secrets: [CLICKUP_TOKEN], memoryMiB: 256, timeoutSeconds: 120 }, async (req) => {
  await requireWrite(req, "bc");
  const clickup = require("./lib/clickup");
  const bc = require("./lib/clickupBc");
  const { safeId } = require("./lib/sheets");
  const cfg = (await db.doc("config/clickup").get()).data() || {};
  if (cfg.enabled === false) throw new HttpsError("failed-precondition", "intégration ClickUp désactivée (Habilitations)");
  const token = CLICKUP_TOKEN.value();
  if (!token) throw new HttpsError("failed-precondition", "token ClickUp absent (secret CLICKUP_TOKEN)");
  const bcNumber = String(req.data?.bcNumber || "").trim();
  if (!bcNumber) throw new HttpsError("invalid-argument", "N° BC requis");
  const listId = bcListIdOf(cfg, req.data?.listId);
  // Groupe = toutes les lignes bcLines de ce N° BC (montant sommé, un seul bon de commande).
  const groups = bc.groupBcByNumber((await loadBcLines()).filter((b) => String(b.bcNumber || "").trim() === bcNumber), safeId);
  const group = groups[0];
  if (!group) throw new HttpsError("not-found", `aucune ligne BC pour le N° « ${bcNumber} »`);
  let fieldDefs = [];
  try { fieldDefs = await clickup.listFields(token, listId); }
  catch (e) { logger.warn("BC push: champs illisibles", { listId, msg: e && e.message }); }
  let statuses = []; try { statuses = await clickup.getListStatuses(token, listId); } catch (e) { logger.warn("BC push: statuts illisibles", { listId, msg: e && e.message }); }
  // VERROU (anti-doublon) : sérialise avec le push BC en masse et les autres push BC unitaires — évite la
  // fenêtre TOCTOU (deux exécutions scannent l'index avant que l'une crée) sur double-clic concurrent.
  const { acquireClickupLock, releaseClickupLock } = require("./lib/clickupLock");
  const lock = await acquireClickupLock(db, "pushBc", req.auth.uid);
  if (!lock.acquired) throw new HttpsError("failed-precondition", "Un push BC ClickUp est déjà en cours — patientez (évite les doublons).");
  try {
    const links = ((await db.doc("config/clickupBcLinks").get()).data() || {}).map || {};
    // ANTI-DOUBLON : si le BC n'a pas de lien mais qu'une tâche porte déjà ce N° de Commande, on l'ADOPTE.
    // Échec du scan (429/timeout/troncature) → on ANNULE (throw) plutôt que de risquer un doublon (parité
    // avec le push commandes ; l'ancien warn silencieux recréait une tâche existante non vue).
    if (!links[group.key]) {
      let t;
      try { t = (await buildBcClickupIndex(token, listId)).index[group.key]; }
      catch (e) { throw new HttpsError("unavailable", `ClickUp : index anti-doublon indisponible — création BC annulée pour éviter un doublon. ${(e && e.message) || ""}`); }
      if (t) links[group.key] = t;
    }
    let r;
    try { r = await pushBcCore({ token, clickup, listId, fieldDefs, statuses, links, group, extra: req.data?.extra || {} }); }
    catch (e) { throw new HttpsError(e.status === 401 || e.status === 403 ? "permission-denied" : "internal", `ClickUp : ${e.message || "échec de la synchronisation BC"}`); }
    await db.doc("config/clickupBcLinks").set({ map: { [r.key]: r.taskId } }, { merge: true });
    await db.collection("auditLog").add({ uid: req.auth.uid, action: r.created ? "clickup_bc_create" : "clickup_bc_update", module: "bc", entity: "bcLine", entityId: bcNumber, detail: { taskId: r.taskId, listId, fields: r.fields }, ts: FieldValue.serverTimestamp() });
    return { ok: true, taskId: r.taskId, url: r.url, created: r.created, fields: r.fields };
  } finally { await releaseClickupLock(db, FieldValue, "pushBc"); }
});

// pushAllBcToClickup : crée/synchronise EN MASSE les tâches de tous les BC. force=false : seuls les BC
// NON encore liés sont créés/adoptés ; force=true resynchronise aussi les tâches existantes. Direction.
exports.pushAllBcToClickup = onCallG("pushAllBcToClickup", { secrets: [CLICKUP_TOKEN], memoryMiB: 512, timeoutSeconds: 540 }, async (req) => {
  if (req.auth?.token?.nt360Role !== "direction") throw new HttpsError("permission-denied", "admin requis");
  if (!(await rateLimit(req.auth.uid, "heavy", 30, 60_000))) throw new HttpsError("resource-exhausted", "Trop de synchronisations en peu de temps — patientez un instant.");
  const clickup = require("./lib/clickup");
  const bc = require("./lib/clickupBc");
  const { safeId } = require("./lib/sheets");
  const cfg = (await db.doc("config/clickup").get()).data() || {};
  if (cfg.enabled === false) throw new HttpsError("failed-precondition", "intégration ClickUp désactivée (Habilitations)");
  const token = CLICKUP_TOKEN.value();
  if (!token) throw new HttpsError("failed-precondition", "token ClickUp absent (secret CLICKUP_TOKEN)");
  const force = req.data?.force === true;
  const listId = bcListIdOf(cfg, req.data?.listId);
  // Même verrou de concurrence que le push commandes : évite la triple création sur clics rapprochés.
  const { acquireClickupLock, releaseClickupLock } = require("./lib/clickupLock");
  const lock = await acquireClickupLock(db, "pushBc", req.auth.uid);
  if (!lock.acquired) throw new HttpsError("failed-precondition", "Un push BC ClickUp est déjà en cours — patientez qu'il se termine (évite les doublons).");
  try {
  let fieldDefs = []; try { fieldDefs = await clickup.listFields(token, listId); } catch (e) { logger.warn("BC bulk: champs illisibles", { msg: e && e.message }); }
  let statuses = []; try { statuses = await clickup.getListStatuses(token, listId); } catch (e) { logger.warn("BC bulk: statuts illisibles", { msg: e && e.message }); }
  // ANTI-DOUBLON : échec du scan d'index (429/timeout/troncature) → on ANNULE le push entier (parité avec
  // le push commandes). L'ancien `catch → bcIndex = {}` recréait EN MASSE tous les BC non liés (doublons).
  let bcIndex;
  try { bcIndex = (await buildBcClickupIndex(token, listId)).index; }
  catch (e) { throw new HttpsError("unavailable", "ClickUp : index anti-doublon BC indisponible — push en masse annulé pour éviter les doublons. " + ((e && e.message) || "")); }
  const links = ((await db.doc("config/clickupBcLinks").get()).data() || {}).map || {};
  const groups = bc.groupBcByNumber(await loadBcLines(), safeId);
  const newLinks = {};
  let pending = 0;
  const flush = async () => { if (pending) { await db.doc("config/clickupBcLinks").set({ map: newLinks }, { merge: true }); pending = 0; } };
  let created = 0, updated = 0, adopted = 0, failed = 0, skipped = 0;
  for (const g of groups) {
    const existingTaskId = links[g.key] || newLinks[g.key] || bcIndex[g.key] || null;
    if (existingTaskId && !force) {
      if (!links[g.key] && !newLinks[g.key]) { newLinks[g.key] = existingTaskId; adopted++; pending++; } else skipped++;
    } else {
      try {
        const r = await pushBcCore({ token, clickup, listId, fieldDefs, statuses, links: { ...links, ...newLinks, ...(existingTaskId ? { [g.key]: existingTaskId } : {}) }, group: g, extra: {} });
        if (r.created) created++; else updated++;
        if (!links[g.key]) { newLinks[g.key] = r.taskId; pending++; }
      } catch (e) { failed++; logger.warn("BC bulk: échec", { bc: g.bcNumber, msg: e && e.message }); }
    }
    if (pending >= 25) await flush();
  }
  await flush();
  const res = { created, updated, adopted, failed, skipped, total: groups.length };
  await db.collection("auditLog").add({ uid: req.auth.uid, action: "clickup_bc_bulk_push", module: "habilitations", entity: "config", entityId: "clickupBcLinks", detail: { ...res, force, listId }, ts: FieldValue.serverTimestamp() });
  return { ok: true, ...res };
  } finally { await releaseClickupLock(db, FieldValue, "pushBc"); }
});

// reconcileBcLinks : RATTACHE les BC aux tâches ClickUp DÉJÀ existantes (par N° de Commande) sans rien
// créer ni modifier — à lancer AVANT un push en masse. Direction.
exports.reconcileBcLinks = onCallG("reconcileBcLinks", { secrets: [CLICKUP_TOKEN], memoryMiB: 512, timeoutSeconds: 300 }, async (req) => {
  if (req.auth?.token?.nt360Role !== "direction") throw new HttpsError("permission-denied", "admin requis");
  const bc = require("./lib/clickupBc");
  const { safeId } = require("./lib/sheets");
  const cfg = (await db.doc("config/clickup").get()).data() || {};
  if (cfg.enabled === false) throw new HttpsError("failed-precondition", "intégration ClickUp désactivée (Habilitations)");
  const token = CLICKUP_TOKEN.value();
  if (!token) throw new HttpsError("failed-precondition", "token ClickUp absent (secret CLICKUP_TOKEN)");
  const listId = bcListIdOf(cfg, req.data?.listId);
  let bcIndex;
  try { bcIndex = (await buildBcClickupIndex(token, listId)).index; }
  catch (e) { throw new HttpsError(e.status === 401 || e.status === 403 ? "permission-denied" : "internal", `ClickUp : ${e.message || "réconciliation impossible"}`); }
  const links = ((await db.doc("config/clickupBcLinks").get()).data() || {}).map || {};
  const groups = bc.groupBcByNumber(await loadBcLines(), safeId);
  const newLinks = {};
  let matched = 0, already = 0;
  for (const g of groups) {
    if (links[g.key]) { already++; continue; }
    if (bcIndex[g.key]) { newLinks[g.key] = bcIndex[g.key]; matched++; }
  }
  if (matched) await db.doc("config/clickupBcLinks").set({ map: newLinks }, { merge: true });
  const res = { matched, already, total: groups.length, tasksWithNumber: Object.keys(bcIndex).length };
  await db.collection("auditLog").add({ uid: req.auth.uid, action: "clickup_bc_reconcile", module: "habilitations", entity: "config", entityId: "clickupBcLinks", detail: { ...res, listId }, ts: FieldValue.serverTimestamp() });
  return { ok: true, ...res };
});

// importBcFromClickup : IMPORTE dans l'app les BC saisis DIRECTEMENT dans ClickUp (tâches de la liste
// « Commandes Fournisseurs » sans ligne bcLines correspondante). Crée une bcLine par tâche avec un N° de
// Commande + un Montant. GARDE-FOUS : (1) l'import Logistics/PDF/fiche PRIME — un N° BC déjà connu par
// une autre source est ignoré (jamais de doublon comptable) ; (2) statut « émis » = ENGAGÉ non facturé →
// alimente l'engagement fournisseur, JAMAIS le solde SOA (seule une facture bouge le solde) ; (3) montant
// converti en XOF via config/fxRates ; (4) id stable → ré-import idempotent. Direction.
exports.importBcFromClickup = onCallG("importBcFromClickup", { secrets: [CLICKUP_TOKEN], memoryMiB: 512, timeoutSeconds: 300 }, async (req) => {
  if (req.auth?.token?.nt360Role !== "direction") throw new HttpsError("permission-denied", "admin requis");
  const cfg = (await db.doc("config/clickup").get()).data() || {};
  if (cfg.enabled === false) throw new HttpsError("failed-precondition", "intégration ClickUp désactivée (Habilitations)");
  const token = CLICKUP_TOKEN.value();
  if (!token) throw new HttpsError("failed-precondition", "token ClickUp absent (secret CLICKUP_TOKEN)");
  const clickup = require("./lib/clickup");
  const bc = require("./lib/clickupBc");
  const { toXof } = require("./lib/fx");
  const { safeId } = require("./lib/sheets");
  const { fpKey, cleanName, bcKey: idBcKey } = require("./lib/ids");
  const listId = bcListIdOf(cfg, req.data?.listId);
  const rates = ((await db.doc("config/fxRates").get()).data() || {}).rates || {};
  // BC déjà connus par une source COMPTABLE (≠ clickup) → prioritaires, on ne les réimporte pas. Le `known`
  // porte DEUX clés par BC : l'id de stockage (bc.bcKey, safeId) ET la clé LOGIQUE (ids.bcKey, sans séparateur)
  // → un BC saisi « BC-001 » (Excel) est reconnu quand ClickUp l'écrit « BC 001 » (audit : double engagement sinon).
  const known = new Set();
  (await db.collection("bcLines").get()).forEach((doc) => { const v = doc.data() || {}; if (v.bcNumber && v.source !== "clickup") { known.add(bc.bcKey(v.bcNumber, safeId)); known.add(idBcKey(v.bcNumber)); } });
  let tasks;
  try { tasks = await clickup.listTasks(token, listId, { includeClosed: true }); }
  catch (e) { throw new HttpsError(e.status === 401 || e.status === 403 ? "permission-denied" : "internal", `ClickUp : ${e.message || "liste illisible"}`); }
  const writes = [];
  const newLinks = {};
  let created = 0, skippedKnown = 0, skippedIncomplete = 0;
  for (const t of tasks) {
    const r = bc.readBcFromTask(t);
    if (!r || !r.bcNumber || !(r.amount > 0)) { skippedIncomplete++; continue; }
    const key = bc.bcKey(r.bcNumber, safeId); // id de stockage (inchangé → idempotence préservée, pas de migration)
    if (known.has(key) || known.has(idBcKey(r.bcNumber))) { skippedKnown++; continue; } // import comptable prime (aussi « à un séparateur près »)
    const conv = toXof(r.currency || "XOF", r.amount, null, rates);
    const id = "bc_cu_" + key; // id stable → ré-import = même doc (idempotent)
    writes.push({ path: `bcLines/${id}`, data: {
      _id: id, fp: fpKey(r.fp) || "", bcNumber: r.bcNumber, supplier: cleanName(r.supplier), customer: r.customer || "",
      country: r.country || "", currency: r.currency || "XOF", amount: r.amount || 0,
      amountXof: conv.amountXof, fxRate: conv.fxRate, fxSource: conv.fxSource,
      // Statut RÉEL depuis ClickUp (livre/annule/en_cours) au lieu de « emis » figé — sinon un BC déjà livré
      // reste « en retard à vie » et un BC annulé compte à tort dans l'engagement (audit P1-2). mapBcStatus ne
      // renvoie JAMAIS « facture » → le solde SOA n'est jamais mû par un simple label ClickUp (reste un acte compta).
      status: bc.mapBcStatus(r.statusRaw) || "emis", // engagement fournisseur, JAMAIS le solde SOA
      etaReel: r.etaReel || null, clickupBcStatusRaw: r.statusRaw || null,
      source: "clickup", clickupTaskId: r.taskId || null, importedAt: FieldValue.serverTimestamp(),
    } });
    if (r.taskId) newLinks[key] = r.taskId;
    created++;
  }
  // Écriture par batch (merge → idempotent), puis liens + recompute des agrégats fournisseurs.
  let batch = db.batch(), n = 0;
  for (const w of writes) { batch.set(db.doc(w.path), w.data, { merge: true }); if (++n % 400 === 0) { await batch.commit(); batch = db.batch(); } }
  if (n % 400 !== 0 || n === 0) await batch.commit();
  if (Object.keys(newLinks).length) await db.doc("config/clickupBcLinks").set({ map: newLinks }, { merge: true });
  // « alerts » AJOUTÉ (cf. audit P1-6) : importBcFromClickup CRÉE de vraies bcLines (statut/ETA) → les
  // alertes BC (bc_en_attente / bc_en_retard) et les relances BC (bloc co-déclenché par alerts) doivent
  // se rafraîchir immédiatement, sinon elles restaient périmées jusqu'au prochain recompute couvrant.
  try { const { recomputeAll } = require("./lib/aggregate"); await recomputeAll(db, ["suppliers", "facturation", "dataQuality", "news", "alerts", "partenariats"]); }
  catch (e) { logger.warn("import BC: recompute partiel échoué", { msg: e && e.message }); }
  const res = { created, skippedKnown, skippedIncomplete, scanned: tasks.length };
  await db.collection("auditLog").add({ uid: req.auth.uid, action: "clickup_bc_import", module: "bc", entity: "bcLines", entityId: "import", detail: { ...res, listId }, ts: FieldValue.serverTimestamp() });
  return { ok: true, ...res };
});

// SENS INVERSE BC ClickUp → app : lit le statut d'avancement achat + l'ETA des tâches BC liées et les
// stocke en overlay config/clickupBcSync (survit au recompute). Recalcule ensuite les agrégats
// fournisseurs (exposition, retards, décaissements) pour fusionner immédiatement ces champs. Préserve
// la dernière valeur connue si un getTask échoue.
async function runBcPull() {
  const cfg = (await db.doc("config/clickup").get()).data() || {};
  if (cfg.enabled === false) return { disabled: true, pulled: 0, total: 0 };
  const token = CLICKUP_TOKEN.value();
  if (!token) return { pulled: 0, total: 0, note: "token absent" };
  const links = ((await db.doc("config/clickupBcLinks").get()).data() || {}).map || {};
  const keys = Object.keys(links);
  if (!keys.length) return { pulled: 0, total: 0 };
  const clickup = require("./lib/clickup");
  const bc = require("./lib/clickupBc");
  const prev = ((await db.doc("config/clickupBcSync").get()).data() || {}).map || {};
  const map = {};
  for (const k of Object.keys(prev)) if (links[k]) map[k] = prev[k]; // purge les liens disparus
  // Un SEUL listTasks paginé (indexé par id), et non N getTask séquentiels — SYMÉTRIQUE au pull commande
  // (runClickupPull). À l'échelle réelle, le N+1 (un getTask par BC lié) menaçait le timeout 300 s.
  // readBcSync ne lit que le statut + le champ perso ETA, TOUS DEUX présents dans la réponse LISTE →
  // aucune perte de champ. Tâche absente du scan (supprimée/déplacée/tronquée/illisible) → on GARDE l'état
  // précédent (déjà recopié dans `map`), exactement comme l'ancien repli sur échec getTask.
  const listId = String(cfg.bcListId || CLICKUP_LIST_BC);
  const taskById = {};
  let truncated = 0, listErrors = 0;
  try {
    const tasks = await clickup.listTasks(token, listId, { includeClosed: true });
    if (tasks.truncated) truncated++;
    for (const t of tasks) taskById[String(t.id)] = t;
  } catch (e) { logger.warn("BC pull: liste illisible", { listId, msg: e && e.message }); listErrors++; }
  let pulled = 0, failed = 0;
  for (const key of keys) {
    const task = taskById[String(links[key])];
    if (!task) { failed++; continue; }
    map[key] = { ...bc.readBcSync(task), taskId: links[key] };
    pulled++;
  }
  if (truncated || listErrors) logger.warn("BC pull: couverture partielle", { truncated, listErrors, pulled, total: keys.length });
  await db.doc("config/clickupBcSync").set({ map, updatedAt: FieldValue.serverTimestamp() });
  // « dataQuality » (clé canonique, l'ancienne « qualite » était inerte) + « news » (bulletin BC en retard).
  try { const { recomputeAll } = require("./lib/aggregate"); await recomputeAll(db, ["suppliers", "facturation", "dataQuality", "news", "partenariats"]); }
  catch (e) { logger.warn("BC pull: recompute partiel échoué", { msg: e && e.message }); }
  return { pulled, failed, total: keys.length };
}

// syncBcFromClickup : bouton « Synchroniser les BC depuis ClickUp » (avancement achat + ETA). Direction.
exports.syncBcFromClickup = onCallG("syncBcFromClickup", { secrets: [CLICKUP_TOKEN], memoryMiB: 512, timeoutSeconds: 300 }, async (req) => {
  if (req.auth?.token?.nt360Role !== "direction") throw new HttpsError("permission-denied", "admin requis");
  const token = CLICKUP_TOKEN.value();
  if (!token) throw new HttpsError("failed-precondition", "token ClickUp absent (secret CLICKUP_TOKEN)");
  let res;
  try { res = await runBcPull(); }
  catch (e) { throw new HttpsError(e.status === 401 || e.status === 403 ? "permission-denied" : "internal", `ClickUp : ${(e && e.message) || e}`); }
  await db.collection("auditLog").add({ uid: req.auth.uid, action: "clickup_bc_pull", module: "habilitations", entity: "config", entityId: "clickupBcSync", detail: res, ts: FieldValue.serverTimestamp() });
  return { ok: true, ...res };
});

// scheduledBcPull : tirage QUOTIDIEN de l'avancement achat + ETA des BC (agrégats jamais périmés).
exports.scheduledBcPull = onSchedule({ schedule: "every day 04:45", secrets: [CLICKUP_TOKEN], memoryMiB: 512, timeoutSeconds: 300 }, async () => {
  const t0 = Date.now();
  try {
    const res = await runBcPull();
    await logOps({ kind: "scheduled", action: "bcPull", status: "ok", ms: Date.now() - t0, detail: { count: res.pulled } });
  } catch (e) {
    logger.error("scheduledBcPull a échoué", { message: e && e.message, stack: e && e.stack });
    await logOps({ kind: "scheduled", action: "bcPull", status: "error", ms: Date.now() - t0, error: (e && e.message) || String(e) });
  }
});

// ===================================================================================================
// WEBHOOKS ClickUp TEMPS RÉEL (Lot 2). Un webhook UNIQUE au niveau workspace pousse les événements
// (statut, mise à jour de champs, suppression, déplacement) vers la fonction HTTP `clickupWebhook`.
// Le handler discrimine COMMANDE vs BC par index inverse du task_id (config/clickupLinks vs
// clickupBcLinks) puis remonte immédiatement l'overlay concerné + recalcule les agrégats touchés →
// l'app reflète ClickUp en secondes, sans attendre le tirage quotidien. Signature HMAC-SHA256 vérifiée
// (secret ClickUp stocké côté serveur dans config/clickupWebhook, jamais exposé au client).
// ===================================================================================================

// Applique un événement à UNE tâche : relit la tâche, met à jour l'overlay (commande OU BC) et
// recalcule le sous-ensemble d'agrégats concerné. Idempotent (rejeu de webhook sans effet de bord).
async function applyClickupTaskEvent(token, taskId, event) {
  const clickup = require("./lib/clickup");
  const cf = require("./lib/clickupFields");
  const bc = require("./lib/clickupBc");
  const enrich = require("./lib/clickupEnrich");
  const { planTaskEvent } = require("./lib/clickupWebhook");
  const [linksDoc, bcLinksDoc] = await Promise.all([db.doc("config/clickupLinks").get(), db.doc("config/clickupBcLinks").get()]);
  const links = (linksDoc.data() || {}).map || {};
  const bcLinks = (bcLinksDoc.data() || {}).map || {};
  // Routage PUR (testé) : commande / BC / ignoré + suppression. Le wrapper applique ensuite les I/O.
  const plan = planTaskEvent(links, bcLinks, taskId, event);
  const { recomputeAll } = require("./lib/aggregate");
  const isComment = event === "taskCommentPosted";
  // Note ops ClickUp → app (bidirectionnel fin) : sur un commentaire, on remonte le dernier commentaire
  // HUMAIN (≠ notre synthèse) en overlay { lastComment: {by,text,at} }. Deep-merge → préserve statut/dates.
  const lastComment = async () => { try { return enrich.latestHumanComment(await clickup.listComments(token, taskId), enrich.MARKER); } catch (e) { logger.warn("webhook: commentaires illisibles", { msg: e && e.message }); return null; } };
  if (plan.kind === "commande") {
    if (plan.deleted) {
      await db.doc("config/clickupLinks").set({ map: { [plan.key]: FieldValue.delete() } }, { merge: true });
      await db.doc("config/clickupSync").set({ map: { [plan.key]: FieldValue.delete() } }, { merge: true });
    } else if (isComment) {
      await db.doc("config/clickupSync").set({ map: { [plan.key]: { lastComment: await lastComment() } } }, { merge: true });
    } else {
      const task = await clickup.getTask(token, taskId);
      const sync = { ...cf.readTaskSync(task), taskId };
      await db.doc("config/clickupSync").set({ map: { [plan.key]: sync } }, { merge: true });
      if (sync.pm) await fillOrderPmFromClickup({ [plan.key]: sync.pm }); // app-wins (cf. C1)
    }
    // Couvre TOUS les summaries dérivés de clickupSync : chunks commandes + Actualité + Qualité.
    try { await recomputeAll(db, ["commandes", "news", "dataQuality"]); }
    catch (e) { logger.warn("webhook: recompute commandes échoué", { msg: e && e.message }); }
    return plan;
  }
  if (plan.kind === "bc") {
    if (plan.deleted) {
      await db.doc("config/clickupBcLinks").set({ map: { [plan.key]: FieldValue.delete() } }, { merge: true });
      await db.doc("config/clickupBcSync").set({ map: { [plan.key]: FieldValue.delete() } }, { merge: true });
    } else if (isComment) {
      await db.doc("config/clickupBcSync").set({ map: { [plan.key]: { lastComment: await lastComment() } } }, { merge: true });
    } else {
      const task = await clickup.getTask(token, taskId);
      await db.doc("config/clickupBcSync").set({ map: { [plan.key]: { ...bc.readBcSync(task), taskId } } }, { merge: true });
    }
    try { await recomputeAll(db, ["suppliers", "facturation", "dataQuality", "news", "partenariats"]); }
    catch (e) { logger.warn("webhook: recompute BC échoué", { msg: e && e.message }); }
    return plan;
  }
  return plan; // ignored : tâche non liée (créée hors app, ou lien pas encore posé)
}

// clickupWebhook : point d'entrée HTTP des webhooks ClickUp. Vérifie la signature, applique l'événement,
// répond 200 rapidement. Non authentifié (public) MAIS protégé par HMAC — toute requête sans signature
// valide est rejetée (401). App Check ne s'applique pas (appel serveur-à-serveur ClickUp).
exports.clickupWebhook = onRequest({ secrets: [CLICKUP_TOKEN], memoryMiB: 512, timeoutSeconds: 120, cors: false }, async (req, res) => {
  if (req.method !== "POST") { res.status(405).send("method not allowed"); return; }
  const { verifySignature, parseWebhook } = require("./lib/clickupWebhook");
  const wcfg = (await db.doc("config/clickupWebhook").get()).data() || {};
  if (!wcfg.secret) { logger.warn("webhook reçu mais aucun secret configuré"); res.status(503).send("webhook not configured"); return; }
  const signature = req.get("X-Signature") || req.get("x-signature") || "";
  const raw = req.rawBody || Buffer.from(JSON.stringify(req.body || {}), "utf8");
  if (!verifySignature(raw, signature, wcfg.secret)) { logger.warn("webhook: signature invalide"); res.status(401).send("invalid signature"); return; }
  const { event, taskId } = parseWebhook(req.body || {});
  if (!taskId) { res.status(200).json({ ok: true, ignored: "no task_id" }); return; }
  const cfg = (await db.doc("config/clickup").get()).data() || {};
  if (cfg.enabled === false) { res.status(200).json({ ok: true, ignored: "integration disabled" }); return; }
  const token = CLICKUP_TOKEN.value();
  if (!token) { res.status(200).json({ ok: true, ignored: "no token" }); return; }
  try {
    const r = await applyClickupTaskEvent(token, taskId, event);
    res.status(200).json({ ok: true, event, ...r });
  } catch (e) {
    // On répond 200 même en cas d'échec applicatif : l'overlay/le recompute sont best-effort et le
    // tirage quotidien rattrapera ; renvoyer 5xx déclencherait des rejeux ClickUp inutiles.
    logger.error("webhook: traitement échoué", { event, taskId, msg: e && e.message });
    res.status(200).json({ ok: false, event, error: (e && e.message) || String(e) });
  }
});

// === WEBHOOK ENTRANT ODOO (docs/ODOO_WEBHOOK.md) — reçoit les MàJ Odoo sur opportunités / commandes / factures.
// Auth : signature HMAC-SHA256 (hex) du corps BRUT via le secret partagé config/odooWebhook.secret (en-tête
// X-Signature) — même schéma que clickupWebhook. Contrat JSON façonné côté Odoo (docs/ODOO_WEBHOOK.md) :
//   POST { object: "opportunity"|"order"|"invoice"|"bc", records: [ {…} ] }
// Upsert idempotent : commandes/factures par id déterministe (safeId(fp) / safeId(numero)), opportunités par
// rapprochement fp puis odooId (création odoo_… sinon), BC par N° BC canonique (bc_odoo_<bcKey>, ADR-051 :
// « comptable/ClickUp prime » → skip si déjà connu). Odoo est source AUTORITAIRE (create + update).
const ODOO_MAX_RECORDS = 500;
exports.odooWebhook = onRequest({ memoryMiB: 512, timeoutSeconds: 120, cors: false }, async (req, res) => {
  if (req.method !== "POST") { res.status(405).send("method not allowed"); return; }
  const { verifySignature } = require("./lib/clickupWebhook"); // HMAC-SHA256 générique (réutilisé)
  const { mapOdooRecord, resolveBcFp } = require("./domain/odooSync");
  const { safeId } = require("./lib/sheets");
  const cfg = (await db.doc("config/odooWebhook").get()).data() || {};
  if (!cfg.secret) { logger.warn("odooWebhook : aucun secret configuré"); res.status(503).json({ error: "webhook non configuré" }); return; }
  if (cfg.enabled === false) { res.status(200).json({ ok: true, ignored: "integration disabled" }); return; }
  const raw = req.rawBody || Buffer.from(JSON.stringify(req.body || {}), "utf8");
  const signature = req.get("X-Signature") || req.get("x-signature") || "";
  if (!verifySignature(raw, signature, cfg.secret)) { logger.warn("odooWebhook : signature invalide"); res.status(401).json({ error: "signature invalide" }); return; }
  const body = req.body || {};
  const object = String(body.object || "");
  const records = Array.isArray(body.records) ? body.records : (body.record ? [body.record] : []);
  if (!records.length) { res.status(400).json({ error: "aucun enregistrement (records[] requis)" }); return; }
  const truncated = records.length > ODOO_MAX_RECORDS;
  const batch = records.slice(0, ODOO_MAX_RECORDS);
  const results = [], errors = [];
  let wrote = false;
  // Contexte BC (ADR-051) : Odoo alimente `bcLines` comme l'import ClickUp. Priorité « comptable/ClickUp prime »
  // → on IGNORE un BC Odoo dont le N° BC est DÉJÀ porté par une source non-odoo (comptable ou ClickUp), sinon
  // le SOA fournisseur (domain/fournisseurs.js somme TOUTES les lignes) double-compterait l'engagement. Le
  // `known` porte deux clés par BC (stockage `bc.bcKey`+safeId ET logique `idBcKey` sans séparateur) → reconnu
  // « à un séparateur près ». Chargé UNE fois par requête.
  let bcCtx = null;
  if (object === "bc") {
    const bcDom = require("./domain/clickupBc");
    const { bcKey: idBcKey } = require("./lib/ids");
    const { normCur } = require("./parsers/bcPdf");
    const { toXof } = require("./lib/fx");
    const rates = ((await db.doc("config/fxRates").get()).data() || {}).rates || {};
    // Overlay de rapprochement DC → N° FP (ADR-054) : filet quand Odoo envoie un BC sans FP résoluble mais
    // avec un DC connu. Vide par défaut → aucun effet (le cas normal Odoo envoie FP+DC).
    const dcAliases = ((await db.doc("config/dcAliases").get()).data() || {}).map || {};
    const known = new Set();
    // Lecture BORNÉE (MAX_SCAN) : le `known` garantit l'absence de double-compte du SOA (ADR-051). Si bcLines
    // dépasse le plafond, on REFUSE l'ingestion BC (fail-safe, jamais silencieux) plutôt que de bâtir un `known`
    // tronqué → un BC comptable au-delà du cap deviendrait invisible et un BC Odoo de même N° le doublonnerait.
    const bcSnap = await db.collection("bcLines").select("bcNumber", "source").limit(MAX_SCAN + 1).get();
    if (bcSnap.size > MAX_SCAN) {
      logger.error("odooWebhook BC : bcLines dépasse MAX_SCAN — ingestion refusée (risque de double-compte SOA)", { size: bcSnap.size });
      res.status(503).json({ error: "bcLines trop volumineux pour garantir l'unicité des BC — contactez l'administrateur" });
      return;
    }
    bcSnap.forEach((d) => {
      const v = d.data() || {};
      if (v.bcNumber && v.source !== "odoo") { known.add(bcDom.bcKey(v.bcNumber, safeId)); known.add(idBcKey(v.bcNumber)); }
    });
    bcCtx = { bcDom, idBcKey, normCur, toXof, rates, known, dcAliases };
  }
  // BC Odoo : n'apporte QUE le statut d'ENGAGEMENT (jamais « facture »/« solde » — le solde SOA reste un acte
  // comptable, MÊME règle que l'import ClickUp `mapBcStatus`). Défaut « emis » (un BC Odoo est une commande émise).
  const BC_COMMIT_ONLY = ["a_emettre", "emis", "livre"];
  // Traitement d'UN enregistrement (résolution d'id + upsert + audit). Les ids cibles sont DÉTERMINISTES
  // (safeId(fp)/safeId(numero) pour commande/facture ; odoo_+safeId(odooId||fp) pour une opp non rapprochée),
  // donc deux écritures concurrentes sur le même doc CONVERGENT (upsert idempotent) — parallélisation sûre.
  const processOne = async (rec) => {
    const m = mapOdooRecord(object, rec);
    if (!m.ok) { errors.push({ error: m.error, odooId: (rec && (rec.odooId || rec.id)) || null }); return; }
    // --- BC fournisseur → bcLines (ADR-051) : priorité comptable/ClickUp + conversion XOF + statut d'engagement ---
    if (m.object === "bc") {
      // Rapprochement DC → FP (ADR-054) : si Odoo n'a pas fourni de FP résoluble mais un DC connu de l'overlay
      // config/dcAliases, on rattache le BC à l'affaire. Le FP explicite d'Odoo prime (resolveBcFp le garantit).
      const resolvedFp = resolveBcFp(m.doc, bcCtx.dcAliases);
      if (resolvedFp && resolvedFp !== m.doc.fp) { m.doc.fp = resolvedFp; m.key.fp = resolvedFp; }
      const key = bcCtx.bcDom.bcKey(m.key.bcNumber, safeId);
      if (bcCtx.known.has(key) || bcCtx.known.has(bcCtx.idBcKey(m.key.bcNumber))) {
        // Un BC comptable/ClickUp de MÊME N° BC existe déjà → il PRIME ; on n'écrit pas de doublon Odoo (évite le
        // double engagement du SOA). Idempotent : un renvoi Odoo reste sans effet tant que la source amont existe.
        results.push({ id: null, object: "bc", action: "skipped", fp: m.key.fp || null, bcNumber: m.key.bcNumber });
        return;
      }
      const id = "bc_odoo_" + key; // id stable par N° BC canonique → ré-envoi = même doc (idempotent)
      const ref = db.doc(`bcLines/${id}`);
      const exists = (await ref.get()).exists;
      const doc = { ...m.doc, _id: id, updatedAt: FieldValue.serverTimestamp() };
      // Statut d'ENGAGEMENT seulement (jamais facture/solde) ; défaut « emis » à la création.
      if (BC_COMMIT_ONLY.includes(doc.statusRaw)) doc.status = doc.statusRaw;
      else if (!exists) doc.status = "emis";
      // Conversion XOF : uniquement si Odoo a fourni un montant (sinon on ne recalcule pas — doc additif). Contre-
      // valeur SAISIE (amountXof) prioritaire, sinon taux config/fxRates ; sans taux, amountXof=0 (« à saisir »).
      if (doc.amount !== undefined) {
        const cur = bcCtx.normCur(doc.currency || "XOF");
        const conv = bcCtx.toXof(cur, doc.amount || 0, doc.amountXof, bcCtx.rates);
        doc.currency = cur; doc.amountXof = conv.amountXof; doc.fxRate = conv.fxRate; doc.fxSource = conv.fxSource;
      }
      if (!exists) doc.createdAt = FieldValue.serverTimestamp();
      await ref.set(doc, { merge: true });
      wrote = true;
      results.push({ id, object: "bc", action: exists ? "updated" : "created", fp: m.key.fp || null, bcNumber: m.key.bcNumber });
      await db.collection("auditLog").add({ uid: "odoo:webhook", action: exists ? "odoo_update" : "odoo_create", module: "bc", entity: "bc", entityId: id, detail: { bcNumber: m.key.bcNumber, fp: m.key.fp || null, odooId: m.key.odooId || null }, ts: FieldValue.serverTimestamp() });
      return;
    }
    let id = m.id; // commandes/factures : déterministe
    if (!id) {
      // opportunités : rapprocher par fp CANONIQUE puis par odooId ; sinon créer un id déterministe.
      let found = null;
      if (m.key.fp) { const s = await db.collection("opportunities").where("fp", "==", m.key.fp).limit(1).get(); if (!s.empty) found = s.docs[0].id; }
      if (!found && m.key.odooId) { const s = await db.collection("opportunities").where("odooId", "==", m.key.odooId).limit(1).get(); if (!s.empty) found = s.docs[0].id; }
      id = found || ("odoo_" + safeId(m.key.odooId || m.key.fp));
    }
    const ref = db.doc(`${m.collection}/${id}`);
    const exists = (await ref.get()).exists;
    const doc = { ...m.doc, updatedAt: FieldValue.serverTimestamp() };
    if (m.collection === "opportunities") doc.oppId = id;
    // #4 (ADR-050) : ne PAS rétrograder la source d'une opp EXISTANTE. Si l'Excel a créé l'opp ('salesData'),
    // Odoo l'ENRICHIT sans lui retirer sa source → elle reste éligible au marquage FANTÔME de la synchro Excel
    // (une opp co-alimentée retirée du fichier LIVE redevient `stale`, cf. lib/sync.js). Une opp NOUVELLE créée
    // par Odoo conserve source:"odoo" (Odoo en est l'autorité — non éligible au fantôme Excel, ce qui est voulu).
    if (exists && m.collection === "opportunities") delete doc.source;
    if (!exists) doc.createdAt = FieldValue.serverTimestamp();
    await ref.set(doc, { merge: true });
    wrote = true;
    results.push({ id, object: m.object, action: exists ? "updated" : "created", fp: m.key.fp || null });
    await db.collection("auditLog").add({ uid: "odoo:webhook", action: exists ? "odoo_update" : "odoo_create", module: "pipeline", entity: m.object, entityId: id, detail: { fp: m.key.fp || null, odooId: m.key.odooId || null }, ts: FieldValue.serverTimestamp() });
  };
  try {
    // Concurrence BORNÉE : jusqu'à ODOO_MAX_RECORDS (500) records, chacun ~4-5 aller-retours Firestore. En
    // séquentiel un gros lot frôlait le timeout 120 s (audit 2026-07) ; on traite par paquets parallèles.
    const CONC = 8;
    for (let i = 0; i < batch.length; i += CONC) {
      await Promise.all(batch.slice(i, i + CONC).map((rec) => processOne(rec)));
    }
    if (wrote) await requestRecompute(null); // recompute différé/coalescé (un seul pour tout le lot)
    res.status(200).json({ ok: true, object, written: results.length, failed: errors.length, truncated, results, errors });
  } catch (e) {
    logger.error("odooWebhook : traitement échoué", { object, msg: e && e.message, stack: e && e.stack });
    res.status(500).json({ error: "erreur interne", written: results.length, errors });
  }
});

// Configure le webhook entrant Odoo (secret partagé HMAC + activation). Direction. Le secret n'est JAMAIS
// relu côté client (write-only) : le callable renvoie seulement s'il est défini et l'état d'activation.
exports.setOdooWebhook = onCallG("setOdooWebhook", { memoryMiB: 256, timeoutSeconds: 60 }, async (req) => {
  if (req.auth?.token?.nt360Role !== "direction") throw new HttpsError("permission-denied", "admin requis");
  const patch = {};
  if (typeof req.data?.enabled === "boolean") patch.enabled = req.data.enabled;
  const secret = String(req.data?.secret || "");
  if (secret) { if (secret.length < 16) throw new HttpsError("invalid-argument", "secret trop court (≥ 16 caractères)"); patch.secret = secret; }
  if (Object.keys(patch).length === 0) throw new HttpsError("invalid-argument", "rien à mettre à jour (secret ou enabled requis)");
  patch.updatedAt = FieldValue.serverTimestamp();
  await db.doc("config/odooWebhook").set(patch, { merge: true });
  await db.collection("auditLog").add({ uid: req.auth.uid, action: "odoo_webhook_config", module: "habilitations", entity: "config", entityId: "odooWebhook", detail: { enabled: patch.enabled, secretSet: !!secret }, ts: FieldValue.serverTimestamp() });
  const cur = (await db.doc("config/odooWebhook").get()).data() || {};
  return { ok: true, enabled: cur.enabled !== false, hasSecret: !!cur.secret };
});

// État de l'intégration Odoo pour l'écran d'administration (config/odooWebhook n'est PAS lisible côté client
// — allowlist fail-closed — car il PORTE le secret). Ne renvoie JAMAIS le secret : uniquement s'il est posé
// (`hasSecret`) + l'interrupteur (`enabled`). « Live » = `hasSecret && enabled`.
exports.odooWebhookStatus = onCallG("odooWebhookStatus", { memoryMiB: 256, timeoutSeconds: 30 }, async (req) => {
  if (req.auth?.token?.nt360Role !== "direction") throw new HttpsError("permission-denied", "admin requis");
  const cur = (await db.doc("config/odooWebhook").get()).data() || {};
  return { enabled: cur.enabled !== false, hasSecret: !!cur.secret };
});

// setupClickupWebhook : enregistre (ou met à jour) LE webhook workspace pointant vers clickupWebhook.
// L'endpoint (URL déployée de la fonction) est fourni par l'admin. Le secret HMAC renvoyé À LA CRÉATION
// est persisté dans config/clickupWebhook (serveur uniquement). Direction.
exports.setupClickupWebhook = onCallG("setupClickupWebhook", { secrets: [CLICKUP_TOKEN], memoryMiB: 256, timeoutSeconds: 60 }, async (req) => {
  if (req.auth?.token?.nt360Role !== "direction") throw new HttpsError("permission-denied", "admin requis");
  const token = CLICKUP_TOKEN.value();
  if (!token) throw new HttpsError("failed-precondition", "token ClickUp absent (secret CLICKUP_TOKEN)");
  const endpoint = String(req.data?.endpoint || "").trim();
  if (!/^https:\/\/.+/.test(endpoint)) throw new HttpsError("invalid-argument", "endpoint HTTPS de la fonction clickupWebhook requis");
  const clickup = require("./lib/clickup");
  const { WEBHOOK_EVENTS } = require("./lib/clickupWebhook");
  const cfg = (await db.doc("config/clickup").get()).data() || {};
  const teamId = cfg.teamId || CLICKUP_TEAM;
  const stored = (await db.doc("config/clickupWebhook").get()).data() || {};
  try {
    // Un webhook déjà connu (id stocké) → mise à jour de l'endpoint/événements (le secret est conservé).
    let existing = null;
    try { existing = (await clickup.listWebhooks(token, teamId)).find((w) => w.id === stored.id || w.endpoint === endpoint) || null; }
    catch (e) { logger.warn("setup webhook: liste illisible", { msg: e && e.message }); }
    if (existing) {
      await clickup.updateWebhook(token, existing.id, { endpoint, events: WEBHOOK_EVENTS, status: "active" });
      const secret = stored.secret || existing.secret || null; // le secret n'est pas re-renvoyé à la maj
      await db.doc("config/clickupWebhook").set({ id: existing.id, endpoint, events: WEBHOOK_EVENTS, secret, updatedBy: req.auth.uid, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      await db.doc("config/clickup").set({ webhookActive: true, webhookEndpoint: endpoint }, { merge: true });
      await db.collection("auditLog").add({ uid: req.auth.uid, action: "clickup_webhook_update", module: "habilitations", entity: "config", entityId: "clickupWebhook", detail: { id: existing.id, endpoint }, ts: FieldValue.serverTimestamp() });
      return { ok: true, id: existing.id, endpoint, events: WEBHOOK_EVENTS, hasSecret: !!secret, created: false };
    }
    const r = await clickup.createWebhook(token, teamId, endpoint, WEBHOOK_EVENTS);
    const wh = r && (r.webhook || r);
    const secret = (wh && wh.secret) || null;
    await db.doc("config/clickupWebhook").set({ id: (wh && wh.id) || r.id, endpoint, events: WEBHOOK_EVENTS, secret, updatedBy: req.auth.uid, updatedAt: FieldValue.serverTimestamp() });
    await db.doc("config/clickup").set({ webhookActive: true, webhookEndpoint: endpoint }, { merge: true });
    await db.collection("auditLog").add({ uid: req.auth.uid, action: "clickup_webhook_create", module: "habilitations", entity: "config", entityId: "clickupWebhook", detail: { id: (wh && wh.id) || r.id, endpoint }, ts: FieldValue.serverTimestamp() });
    return { ok: true, id: (wh && wh.id) || r.id, endpoint, events: WEBHOOK_EVENTS, hasSecret: !!secret, created: true };
  } catch (e) {
    throw new HttpsError(e.status === 401 || e.status === 403 ? "permission-denied" : "internal", `ClickUp : ${e.message || "création du webhook impossible"}`);
  }
});

// deleteClickupWebhook : supprime le webhook enregistré (côté ClickUp + config). Direction.
exports.deleteClickupWebhook = onCallG("deleteClickupWebhook", { secrets: [CLICKUP_TOKEN], memoryMiB: 256, timeoutSeconds: 60 }, async (req) => {
  if (req.auth?.token?.nt360Role !== "direction") throw new HttpsError("permission-denied", "admin requis");
  const token = CLICKUP_TOKEN.value();
  if (!token) throw new HttpsError("failed-precondition", "token ClickUp absent (secret CLICKUP_TOKEN)");
  const stored = (await db.doc("config/clickupWebhook").get()).data() || {};
  if (!stored.id) return { ok: true, note: "aucun webhook enregistré" };
  const clickup = require("./lib/clickup");
  try { await clickup.deleteWebhook(token, stored.id); }
  catch (e) { if (e.status !== 404) throw new HttpsError(e.status === 401 || e.status === 403 ? "permission-denied" : "internal", `ClickUp : ${e.message || "suppression impossible"}`); }
  await db.doc("config/clickupWebhook").set({ id: FieldValue.delete(), secret: FieldValue.delete(), endpoint: FieldValue.delete(), disabledBy: req.auth.uid, disabledAt: FieldValue.serverTimestamp() }, { merge: true });
  await db.doc("config/clickup").set({ webhookActive: false }, { merge: true });
  await db.collection("auditLog").add({ uid: req.auth.uid, action: "clickup_webhook_delete", module: "habilitations", entity: "config", entityId: "clickupWebhook", detail: { id: stored.id }, ts: FieldValue.serverTimestamp() });
  return { ok: true, deleted: stored.id };
});

// ===================================================================================================
// ENRICHISSEMENTS app → ClickUp (Lot 3). Pose sur chaque tâche commande liée un COMMENTAIRE DE
// SYNTHÈSE idempotent (CA/RAF, jalons de facturation, BC liés, qualité, retard) et un TAG « à risque »
// quand la commande présente des anomalies ou un retard. La synthèse est consolidée dans UN commentaire
// marqué (retrouvé et mis à jour à chaque passage) → jamais de doublon. Best-effort par tâche.
// ===================================================================================================
async function runClickupEnrich() {
  const cfg = (await db.doc("config/clickup").get()).data() || {};
  if (cfg.enabled === false) return { disabled: true, enriched: 0, total: 0 };
  const token = CLICKUP_TOKEN.value();
  if (!token) return { enriched: 0, total: 0, note: "token absent" };
  // VERROU (anti-doublon) : l'enrichissement manuel (bouton) et le scheduler 05:00 peuvent se chevaucher.
  // Deux passages concurrents liraient les MÊMES sous-tâches (vides) et créeraient tous deux « Jalon i »
  // → doublons. Un seul enrichissement à la fois ; le concurrent est ignoré proprement.
  const { acquireClickupLock, releaseClickupLock } = require("./lib/clickupLock");
  const lock = await acquireClickupLock(db, "enrich", "runClickupEnrich");
  if (!lock.acquired) return { enriched: 0, total: 0, skipped: "déjà en cours" };
  try {
  const links = ((await db.doc("config/clickupLinks").get()).data() || {}).map || {};
  const keys = Object.keys(links);
  if (!keys.length) return { enriched: 0, total: 0 };
  const clickup = require("./lib/clickup");
  const enrich = require("./lib/clickupEnrich");
  const { isDeliveryOverdue } = require("./domain/clickupSignals");
  const { safeId } = require("./lib/sheets");
  const orders = await loadCommandeRows();
  const orderByKey = {};
  for (const o of orders) if (o.fp) orderByKey[safeId(o.fp)] = o;
  // BC liés par commande (N° BC agrégés) et jalons de facturation par commande.
  const bcByFp = {};
  for (const b of await loadBcLines()) { const k = safeId(String(b.fp || "").trim()); if (!k || !b.bcNumber) continue; (bcByFp[k] = bcByFp[k] || []).push(String(b.bcNumber).trim()); }
  const msByFp = {};
  (await db.collection("billingMilestones").get()).forEach((doc) => { const v = doc.data() || {}; if (v.fp && Array.isArray(v.milestones)) msByFp[safeId(v.fp)] = v.milestones; });
  // Anomalies qualité par commande (depuis summaries/dataQuality — refs = N° FP concernés).
  const dq = (await db.doc("summaries/dataQuality").get()).data() || {};
  const flagsByFp = {};
  for (const iss of dq.issues || []) for (const ref of iss.refs || []) { const k = safeId(String(ref).trim()); if (!k) continue; (flagsByFp[k] = flagsByFp[k] || []).push(iss.label || iss.type); }
  const today = new Date().toISOString().slice(0, 10);
  let enriched = 0, failed = 0, tagged = 0, subtasked = 0, checklisted = 0;
  for (const key of keys) {
    const taskId = links[key];
    const o = orderByKey[key];
    if (!o) continue; // lien orphelin (commande disparue) → rien à synthétiser
    // Retard de livraison via le prédicat PARTAGÉ (isActive) → cohérent avec le cockpit Qualité.
    const overdue = isDeliveryOverdue(o.clickupStatus, o.dateContractuelle, today);
    const d = {
      fp: o.fp, cas: o.cas, facture: o.facture, raf: o.raf,
      milestones: (msByFp[key] || []).map((m) => ({ label: m.label, amount: Number(m.amount || 0), dueDate: m.dueDate || m.date })),
      bcRefs: [...new Set((bcByFp[key] || []).filter(Boolean))],
      qualityFlags: [...new Set(flagsByFp[key] || [])],
      overdue,
    };
    try {
      // Une seule lecture détaillée (sous-tâches + checklists + liste parente) réutilisée pour tout.
      const detail = await clickup.getTaskDetail(token, taskId);
      const listId = detail && detail.list && detail.list.id;
      // 1) Commentaire de synthèse (upsert idempotent).
      const text = enrich.buildSyncComment(d);
      const existing = enrich.findMarkedComment(await clickup.listComments(token, taskId), enrich.MARKER);
      if (existing) await clickup.updateComment(token, existing.id, text); else await clickup.createComment(token, taskId, text);
      // 2) Tag « à risque » (posé/retiré).
      try {
        if (enrich.needsRiskTag(d)) { await clickup.addTag(token, taskId, enrich.RISK_TAG); tagged++; }
        else { await clickup.removeTag(token, taskId, enrich.RISK_TAG).catch(() => {}); }
      } catch (e) { logger.warn("enrich: tag non posé", { key, msg: e && e.message }); }
      // 3) Jalons de facturation → vraies SOUS-TÂCHES (réconciliées par clé `Jalon i`, jamais supprimées).
      if (listId) {
        try {
          const plan = enrich.planMilestoneSubtasks(detail.subtasks, enrich.buildMilestoneSubtasks(d.milestones));
          for (const e of plan.toCreate) { const p = { name: e.name }; if (e.dueMs) { p.due_date = e.dueMs; p.due_date_time = false; } await clickup.createSubtask(token, listId, taskId, p); }
          for (const u of plan.toUpdate) { const p = { name: u.expected.name }; if (u.expected.dueMs) { p.due_date = u.expected.dueMs; p.due_date_time = false; } await clickup.updateTask(token, u.id, p); }
          for (const c of plan.toClose) { await clickup.deleteTask(token, c.id).catch(() => {}); } // purge des « Jalon i » orphelins (échéancier rétréci)
          if (plan.toCreate.length || plan.toUpdate.length || plan.toClose.length) subtasked++;
        } catch (e) { logger.warn("enrich: sous-tâches jalons échouées", { key, msg: e && e.message }); }
      }
      // 4) BC liés → CHECKLIST (recréée à l'identique = idempotente : supprime la nôtre puis re-crée).
      try {
        const items = enrich.buildBcChecklistItems(d.bcRefs);
        const existingCl = enrich.findBcChecklist(detail.checklists, enrich.BC_CHECKLIST);
        if (items.length) {
          if (existingCl) await clickup.deleteChecklist(token, existingCl.id).catch(() => {});
          const cl = await clickup.createChecklist(token, taskId, enrich.BC_CHECKLIST);
          const clId = cl && (cl.checklist ? cl.checklist.id : cl.id);
          if (clId) for (const it of items) await clickup.createChecklistItem(token, clId, it);
          checklisted++;
        } else if (existingCl) { await clickup.deleteChecklist(token, existingCl.id).catch(() => {}); }
      } catch (e) { logger.warn("enrich: checklist BC échouée", { key, msg: e && e.message }); }
      enriched++;
    } catch (e) { failed++; logger.warn("enrich: échec", { key, msg: e && e.message }); }
  }
  return { enriched, failed, tagged, subtasked, checklisted, total: keys.length };
  } finally { await releaseClickupLock(db, FieldValue, "enrich"); }
}

// enrichClickup : bouton « Enrichir les tâches ClickUp » (synthèse + tag). Direction.
exports.enrichClickup = onCallG("enrichClickup", { secrets: [CLICKUP_TOKEN], memoryMiB: 512, timeoutSeconds: 540 }, async (req) => {
  if (req.auth?.token?.nt360Role !== "direction") throw new HttpsError("permission-denied", "admin requis");
  const token = CLICKUP_TOKEN.value();
  if (!token) throw new HttpsError("failed-precondition", "token ClickUp absent (secret CLICKUP_TOKEN)");
  let res;
  try { res = await runClickupEnrich(); }
  catch (e) { throw new HttpsError(e.status === 401 || e.status === 403 ? "permission-denied" : "internal", `ClickUp : ${(e && e.message) || e}`); }
  await db.collection("auditLog").add({ uid: req.auth.uid, action: "clickup_enrich", module: "habilitations", entity: "config", entityId: "clickupLinks", detail: res, ts: FieldValue.serverTimestamp() });
  return { ok: true, ...res };
});

// scheduledClickupEnrich : entretien QUOTIDIEN des commentaires de synthèse + tags (après le pull).
exports.scheduledClickupEnrich = onSchedule({ schedule: "every day 05:00", secrets: [CLICKUP_TOKEN], memoryMiB: 512, timeoutSeconds: 540 }, async () => {
  const t0 = Date.now();
  try {
    const res = await runClickupEnrich();
    await logOps({ kind: "scheduled", action: "clickupEnrich", status: "ok", ms: Date.now() - t0, detail: { count: res.enriched } });
  } catch (e) {
    logger.error("scheduledClickupEnrich a échoué", { message: e && e.message, stack: e && e.stack });
    await logOps({ kind: "scheduled", action: "clickupEnrich", status: "error", ms: Date.now() - t0, error: (e && e.message) || String(e) });
  }
});

// --- Écritures BC / crédit fournisseur en onCall : elles RECALCULENT ensuite les agrégats
// (suppliers + alerts), sinon l'exposition et les alertes restaient périmées jusqu'au
// « Recalculer » manuel. Le rôle est revérifié côté serveur. ---
exports.setBcStatus = onCallG("setBcStatus", { memoryMiB: 512, timeoutSeconds: 120 }, async (req) => {
  await requireWrite(req, "bc");
  const { id, status } = req.data || {};
  if (!id || !BC_STAGES.includes(status)) throw new HttpsError("invalid-argument", "id + statut (∈ cycle BC) requis");
  assertPlainId(id, "id BC");
  await db.doc(`bcLines/${id}`).set({ status, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  await db.collection("auditLog").add({
    uid: req.auth.uid, action: "bc_status", module: "bc", entity: "bcLine", entityId: id,
    detail: { status }, ts: FieldValue.serverTimestamp(),
  });
  // 'cashflow' inclus (cf. audit cycle de vie) : passer un BC en « facturé » en fait un décaissement
  // (SOA) → la prévision cash doit se rafraîchir tout de suite, pas au prochain recompute complet.
  await requestRecompute(["suppliers", "alerts", "cashflow", "partenariats"]);
  return { ok: true };
});

// --- Fiabilisation d'une ligne BC réelle : rattacher un N° FP et/ou corriger le montant XOF
// (ex. BC en devise étrangère non convertie → montant 0). Recalcule exposition + décaissements. ---
exports.patchBcLine = onCallG("patchBcLine", { memoryMiB: 512, timeoutSeconds: 120 }, async (req) => {
  await requireWrite(req, "bc");
  const { fpKey } = require("./lib/ids");
  const d = req.data || {};
  const { id, fp, amountXof } = d;
  if (!id) throw new HttpsError("invalid-argument", "id requis");
  assertPlainId(id, "id BC");
  const patch = { updatedAt: FieldValue.serverTimestamp() };
  // On n'écrit le FP que s'il donne une clé canonique NON vide : un fp vide/blanc n'est pas un
  // « détachement » utile mais un no-op qui déclencherait un recompute complet pour rien.
  const fpk = fp !== undefined ? fpKey(fp) : null;
  if (fpk) patch.fp = fpk;
  if (amountXof !== undefined && amountXof !== null && amountXof !== "") {
    const n = Number(amountXof);
    if (!Number.isFinite(n) || n < 0) throw new HttpsError("invalid-argument", "montant XOF invalide");
    patch.amountXof = n;
  }
  // Taux de change appliqué lors d'une conversion GUIDÉE (contre-valeur XOF calculée depuis le montant
  // en devise). On fige le taux sur la ligne (traçabilité, affichage « @ taux ») et on marque la source
  // « manuel » — prioritaire, non ré-écrasée par resolveLogisticsFx au recompute.
  if (d.fxRate !== undefined && d.fxRate !== null && d.fxRate !== "") {
    const rt = Number(d.fxRate);
    if (!Number.isFinite(rt) || rt <= 0) throw new HttpsError("invalid-argument", "taux de change invalide");
    patch.fxRate = rt;
    patch.fxSource = "manuel";
  }
  // Champs descriptifs éditables (fournisseur mal mappé, type de dépense, description, date d'entrée).
  if (d.supplier !== undefined) patch.supplier = String(d.supplier || "").replace(/\s+/g, " ").trim().toUpperCase();
  if (d.expenseType !== undefined) patch.expenseType = String(d.expenseType || "").trim();
  if (d.description !== undefined) patch.description = String(d.description || "").trim();
  if (d.dateIn !== undefined) patch.dateIn = d.dateIn || null;
  if (Object.keys(patch).length <= 1) throw new HttpsError("invalid-argument", "rien à corriger (FP, montant, fournisseur ou champ valide requis)");
  await db.doc(`bcLines/${id}`).set(patch, { merge: true });
  await db.collection("auditLog").add({
    uid: req.auth.uid, action: "bc_patch", module: "bc", entity: "bcLine", entityId: id,
    detail: { fp: patch.fp ?? null, amountXof: patch.amountXof ?? null, supplier: patch.supplier ?? null }, ts: FieldValue.serverTimestamp(),
  });
  await requestRecompute(["suppliers", "alerts", "cashflow", "partenariats"]);
  return { ok: true };
});

exports.upsertCreditLine = onCallG("upsertCreditLine", { memoryMiB: 512, timeoutSeconds: 120 }, async (req) => {
  await requireWrite(req, "fournisseurs");
  // id = nom du fournisseur CANONIQUE (cleanName, autorité unique ADR-P20) — clé d'appariement avec
  // l'exposition (domain/fournisseurs utilise la MÊME cleanName). Compacte les espaces internes : sans ça,
  // un plafond saisi « à un espace près » ne s'appariait pas à son fournisseur agrégé.
  const { cleanName } = require("./lib/ids");
  const id = cleanName(req.data?.id || "");
  if (!id) throw new HttpsError("invalid-argument", "fournisseur requis");
  assertPlainId(id, "id fournisseur");
  // SOA : plafond autorisé + solde d'OUVERTURE (posé à date, « à jour maintenant »). Seule une FACTURE
  // fournisseur (BC au statut « facturé ») bouge ensuite le solde ; l'ouverture est la base d'antériorité.
  const d = req.data || {};
  const patch = { name: id, authorized: Number(d.authorized) || 0, updatedAt: FieldValue.serverTimestamp() };
  if (d.openingBalance !== undefined) patch.openingBalance = Number(d.openingBalance) || 0;
  if (d.openingDate !== undefined) patch.openingDate = d.openingDate || null;
  await db.doc(`creditLines/${id}`).set(patch, { merge: true });
  await db.collection("auditLog").add({
    uid: req.auth.uid, action: "credit_line", module: "fournisseurs", entity: "creditLine", entityId: id,
    detail: { authorized: patch.authorized, openingBalance: patch.openingBalance ?? null, openingDate: patch.openingDate ?? null }, ts: FieldValue.serverTimestamp(),
  });
  await requestRecompute(["suppliers", "alerts"]);
  return { ok: true };
});

// MIGRATION one-shot (ADR-P20) : re-clé les creditLines existantes vers la forme CANONIQUE (cleanName). Les id
// historiques étaient en `trim+MAJUSCULES` SANS compaction ; désormais le SOA agrège en `cleanName` (compacte).
// Un plafond dont l'id porte un double espace ne s'apparierait plus à son fournisseur → on le DÉPLACE vers l'id
// canonique. Idempotent (ré-exécution = no-op une fois les clés canoniques). Si l'id canonique existe déjà
// (les deux formes coexistaient), on GARDE la cible non vide et on supprime la source (rapporté). Réservé écriture.
exports.migrateCreditLineKeys = onCallG("migrateCreditLineKeys", { memoryMiB: 256, timeoutSeconds: 120 }, async (req) => {
  await requireWrite(req, "fournisseurs");
  const { cleanName } = require("./lib/ids");
  const snap = await db.collection("creditLines").limit(5000).get();
  let moved = 0, merged = 0; const skipped = [];
  for (const doc of snap.docs) {
    const data = doc.data() || {};
    const canon = cleanName(data.name || data.id || doc.id);
    if (!canon || canon === doc.id) continue; // déjà canonique
    const targetRef = db.doc(`creditLines/${canon}`);
    const target = await targetRef.get();
    if (target.exists) {
      // Collision : la forme canonique existe déjà. On ne fusionne pas les montants (risque de double) —
      // on garde la cible et on supprime la source, en rapportant pour arbitrage manuel si besoin.
      skipped.push({ from: doc.id, to: canon, reason: "cible existante conservée" });
      await doc.ref.delete().catch(() => {});
      merged++;
    } else {
      await targetRef.set({ ...data, name: canon, updatedAt: FieldValue.serverTimestamp() }, { merge: false });
      await doc.ref.delete().catch(() => {});
      moved++;
    }
  }
  await db.collection("auditLog").add({ uid: req.auth.uid, action: "migrate_credit_line_keys", module: "fournisseurs", entity: "creditLine", entityId: "batch", detail: { moved, merged }, ts: FieldValue.serverTimestamp() });
  if (moved || merged) await requestRecompute(["suppliers", "alerts"]);
  return { ok: true, moved, merged, skipped: skipped.slice(0, 40) };
});

// === VÉRITÉ DU COÛT (ADR-P21) — objet FACTURE FOURNISSEUR : quand le drapeau config/soaFeature est actif, le
// SOLDE du compte fournisseur (SOA) dérive de ces pièces réelles au lieu du statut « facturé » d'un BC posé à la
// main. Additif + gated : drapeau OFF (défaut) → SOA strictement inchangé.
exports.setSoaFeature = onCallG("setSoaFeature", { memoryMiB: 256, timeoutSeconds: 60 }, async (req) => {
  if (req.auth?.token?.nt360Role !== "direction") throw new HttpsError("permission-denied", "admin requis");
  const enabled = req.data?.enabled === true;
  await db.doc("config/soaFeature").set({ enabled, updatedBy: req.auth.uid, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  await db.collection("auditLog").add({ uid: req.auth.uid, action: "set_soa_feature", module: "fournisseurs", entity: "config", entityId: "soaFeature", detail: { enabled }, ts: FieldValue.serverTimestamp() });
  await requestRecompute(["suppliers", "alerts"]);
  return { ok: true, enabled };
});

exports.upsertSupplierInvoice = onCallG("upsertSupplierInvoice", { memoryMiB: 256, timeoutSeconds: 60 }, async (req) => {
  await requireWrite(req, "fournisseurs");
  const { cleanName, fpKey } = require("./lib/ids");
  const d = req.data || {};
  const supplier = cleanName(d.supplier || ""); // clé fournisseur CANONIQUE (autorité unique ADR-P20)
  if (!supplier) throw new HttpsError("invalid-argument", "fournisseur requis");
  const amountXof = Number(d.amountXof) || 0;
  if (!(amountXof > 0)) throw new HttpsError("invalid-argument", "montant XOF > 0 requis");
  const doc = {
    supplier, amountXof,
    date: d.date ? String(d.date).slice(0, 10) : null,
    bcNumber: d.bcNumber ? String(d.bcNumber).slice(0, 60) : null,
    fp: fpKey(d.fp) || null, // rapproché par fpKey (autorité N° FP)
    ref: d.ref ? String(d.ref).slice(0, 80) : null,
    updatedAt: FieldValue.serverTimestamp(),
  };
  let id = d.id;
  if (id) { assertPlainId(id, "id facture fournisseur"); await db.doc(`supplierInvoices/${id}`).set(doc, { merge: true }); }
  else { const ref = await db.collection("supplierInvoices").add({ ...doc, createdBy: req.auth.uid, createdAt: FieldValue.serverTimestamp() }); id = ref.id; }
  await db.collection("auditLog").add({ uid: req.auth.uid, action: "upsert_supplier_invoice", module: "fournisseurs", entity: "supplierInvoice", entityId: id, detail: { supplier, amountXof }, ts: FieldValue.serverTimestamp() });
  await requestRecompute(["suppliers", "alerts"]);
  return { ok: true, id };
});

exports.deleteSupplierInvoice = onCallG("deleteSupplierInvoice", { memoryMiB: 256, timeoutSeconds: 60 }, async (req) => {
  await requireWrite(req, "fournisseurs");
  const id = assertPlainId(req.data?.id, "id facture fournisseur");
  await db.doc(`supplierInvoices/${id}`).delete();
  await db.collection("auditLog").add({ uid: req.auth.uid, action: "delete_supplier_invoice", module: "fournisseurs", entity: "supplierInvoice", entityId: id, ts: FieldValue.serverTimestamp() });
  await requestRecompute(["suppliers", "alerts"]);
  return { ok: true };
});

// === MARGE NETTE (ADR-P22) — modèle de coût config/costModel { structureRate }. `structureRate` = frais de
// STRUCTURE (SG&A) en % du CA, borné [0..1] : transforme la marge BRUTE de Rentabilité par ressource en marge
// NETTE. Additif + gated : taux 0 (défaut, doc absent) → marge nette = marge brute (aucun impact). Direction seule.
exports.setCostModel = onCallG("setCostModel", { memoryMiB: 256, timeoutSeconds: 60 }, async (req) => {
  if (req.auth?.token?.nt360Role !== "direction") throw new HttpsError("permission-denied", "admin requis");
  const r = Number(req.data?.structureRate);
  if (!Number.isFinite(r) || r < 0 || r > 1) throw new HttpsError("invalid-argument", "structureRate ∈ [0..1] requis");
  await db.doc("config/costModel").set({ structureRate: r, updatedBy: req.auth.uid, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  await db.collection("auditLog").add({ uid: req.auth.uid, action: "set_cost_model", module: "rentabilite", entity: "config", entityId: "costModel", detail: { structureRate: r }, ts: FieldValue.serverTimestamp() });
  return { ok: true, structureRate: r };
});

// --- Analyse d'un BC fournisseur PDF (mode « Unitaire ») : extrait le texte (pdfjs) puis
// mappe les champs (best-effort) pour PRÉ-REMPLIR le formulaire. L'utilisateur confirme
// avant enregistrement via addBcLine. Ne persiste rien. ---
exports.parseBcPdf = onCallG("parseBcPdf", { memoryMiB: 1024, timeoutSeconds: 120 }, async (req) => {
  await requireWrite(req, "bc");
  const b64 = req.data?.pdfB64;
  if (!b64 || typeof b64 !== "string") throw new HttpsError("invalid-argument", "PDF requis (pdfB64)");
  const { extractPdfText, parseBcText } = require("./parsers/bcPdf");
  let text;
  try {
    text = await extractPdfText(Buffer.from(b64, "base64"));
  } catch (e) {
    logger.warn("parseBcPdf: extraction échouée", { msg: e.message });
    throw new HttpsError("failed-precondition", "PDF illisible (texte non extractible)");
  }
  const fields = parseBcText(text);
  return { ok: true, fields };
});

// --- Dédoublonnage (admin) : factures / opportunités / BC fournisseurs. Regroupe par clé
// métier, garde le meilleur représentant, supprime les autres. `apply:false` = analyse seule. ---
exports.dedupe = onCallG("dedupe", { memoryMiB: 512, timeoutSeconds: 300 }, async (req) => {
  if (req.auth?.token?.nt360Role !== "direction") throw new HttpsError("permission-denied", "admin requis");
  if (!(await rateLimit(req.auth.uid, "heavy", 30, 60_000))) throw new HttpsError("resource-exhausted", "Trop d'opérations lourdes en peu de temps — patientez un instant.");
  const { planDedupe, invoiceKey, opportunityKey, bcKey } = require("./domain/dedupe");
  const { buildFpAliasResolver } = require("./lib/ids");
  const KEYS = { invoices: invoiceKey, opportunities: opportunityKey, bcLines: bcKey };
  const only = (Array.isArray(req.data?.collections) ? req.data.collections : Object.keys(KEYS)).filter((c) => KEYS[c]);
  const apply = req.data?.apply !== false; // défaut : applique (l'UI propose une analyse préalable)
  // MÊME overlay de réconciliation FP (config/fpAliases) que le recompute/Centre de correction → un FP
  // aliasé est vu comme UN seul deal par le dédup (cohérence détection ↔ action).
  const canonFp = buildFpAliasResolver((((await db.doc("config/fpAliases").get()).data()) || {}).map || {});

  const result = {};
  const toDelete = [];
  for (const col of only) {
    // Scan BORNÉ : un dédup DESTRUCTIF doit voir TOUS les docs pour choisir le bon représentant. Si la
    // collection dépasse MAX_SCAN, on REFUSE de dédoublonner (capped:true, aucune suppression) plutôt que
    // de supprimer sur des données INCOMPLÈTES (un représentant pourrait être dans la partie non lue).
    const snap = await db.collection(col).limit(MAX_SCAN + 1).get();
    const { docs: kept, capped } = sliceCapped(snap.docs);
    if (capped) { result[col] = { total: kept.length, duplicateGroups: 0, duplicates: 0, capped: true, sample: [] }; continue; }
    const docs = kept.map((d) => { const v = { id: d.id, ...d.data() }; if (v.fp != null && v.fp !== "") v.fp = canonFp(v.fp); return v; });
    const plan = planDedupe(docs, KEYS[col]);
    result[col] = { total: plan.total, duplicateGroups: plan.duplicateGroups, duplicates: plan.duplicates, capped: false, sample: plan.sample };
    if (apply) plan.remove.forEach((id) => toDelete.push(`${col}/${id}`));
  }

  if (apply && toDelete.length) {
    let batch = db.batch(), nB = 0;
    for (const path of toDelete) {
      batch.delete(db.doc(path));
      if (++nB % 400 === 0) { await batch.commit(); batch = db.batch(); }
    }
    await batch.commit();
    await db.collection("auditLog").add({
      uid: req.auth.uid, action: "dedupe", module: "habilitations", entity: "collections",
      entityId: only.join(","), detail: result, ts: FieldValue.serverTimestamp(),
    });
    // Recompute BEST-EFFORT (blindage) : les doublons sont DÉJÀ supprimés (batch.commit) — un échec du
    // recalcul ne doit pas remonter en erreur (le prochain recompute rattrape).
    try { await recomputeSummaries(); }
    catch (re) { logger.error("dedupe : recompute post-suppression échoué — doublons supprimés, agrégats au prochain recompute", { message: re && re.message }); }
  }
  return { ok: true, applied: apply, result };
});

// --- F7 : export one-pager CODIR (XLSX) → Cloud Storage + URL signée ---
// Le one-pager CODIR agrège des chiffres financiers (chaîne de valeur, backlog, pipeline, atterrissage,
// marge). AUTORISATION PAR LA MATRICE OPPOSABLE, plus par une liste de rôles figée : le rapport est un
// document « vue d'ensemble » → droit overview requis pour le générer, et CHAQUE bloc (backlog, pipeline,
// marge) n'entre dans le classeur que si le rôle a le droit du module correspondant DANS LA MATRICE.
// Sans ça, révoquer p.ex. « pipeline » à un rôle laissait quand même passer le total pondéré dans l'export
// (contournement de la source unique de vérité). Cf. audit de bon fonctionnement.
exports.exportReport = onCallG("exportReport", async (req) => {
  if (!req.auth) throw new HttpsError("unauthenticated", "connexion requise");
  if (!(await rateLimit(req.auth.uid, "heavy", 30, 60_000))) throw new HttpsError("resource-exhausted", "Trop d'exports en peu de temps — patientez un instant.");
  const ExcelJS = require("exceljs");
  const { canRead } = require("./domain/authz");
  const role = req.auth.token?.nt360Role;
  const matrix = ((await db.doc("config/permissions").get()).data() || {}).matrix || {};
  if (!canRead(matrix, role, "overview")) throw new HttpsError("permission-denied", "droit « vue d'ensemble » requis pour le rapport");
  const canMargin = canRead(matrix, role, "rentabilite");
  const canBacklog = canRead(matrix, role, "backlog");
  const canPipeline = canRead(matrix, role, "pipeline");
  const canObjectifs = canRead(matrix, role, "objectifs");
  const period = req.data?.period || "all";
  const get = async (p) => (await db.doc(p).get()).data() || {};
  const fiscal = await get("config/fiscal");
  const ov = await get(`summaries/overview_${period}`);
  const att = await get(`summaries/atterrissage_${fiscal.currentFy || ""}`); // atterrissage.* → module overview
  // Objectif/Écart : lus depuis le doc ISOLÉ atterrissageObjectifs_ (gaté « objectifs ») — le doc public ne
  // les porte plus depuis l'isolation RBAC ; les lire là où ils étaient laissait des chiffres FIGÉS (résidu
  // merge:true d'avant l'isolation) ou vides dans le livrable CODIR (audit 40 axes, axe 16).
  const attObj = canObjectifs ? await get(`summaries/atterrissageObjectifs_${fiscal.currentFy || ""}`) : {};
  const bl = canBacklog ? await get("summaries/backlog_fy") : {};
  const pl = canPipeline ? await get("summaries/pipeline") : {};
  const ovm = canMargin ? await get(`summaries/overviewMargin_${period}`) : {};

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("CODIR");
  ws.addRow(["Pilote Revenu NT CI — One-pager CODIR"]);
  ws.addRow(["Période", period, "FY", fiscal.currentFy || ""]);
  ws.addRow([]);
  ws.addRow(["Indicateur", "Valeur"]);
  [
    ["Certitudes", ov.certitudes], ["Commandes (CAS)", ov.commandes], ["Facturé", ov.facture],
    // Encaissé + taux : la chaîne exportée s'arrêtait au Facturé alors que l'écran affiche 5 maillons.
    ["Encaissé", ov.encaisse],
    ...(canBacklog ? [["Backlog (RAF)", bl.total]] : []),
    ...(canMargin ? [["Marge brute", ovm.mb]] : []),
    ["Taux facturation", ov.ratios?.tauxFacturation],
    // Repli dérivé pour un summary d'avant la persistance du ratio (encaisse/facture sont publics).
    ["Taux encaissement", ov.ratios?.tauxEncaissement ?? ((ov.facture || 0) > 0 ? (ov.encaisse || 0) / ov.facture : 0)],
    ...(canPipeline ? [["Pipeline actif pondéré", pl.tot?.weighted]] : []),
    ["Atterrissage projeté", att.projete],
    ...(canObjectifs ? [["Objectif CAS", attObj.objectif], ["Écart", attObj.ecart]] : []),
  ].forEach((r) => ws.addRow(r));

  const buf = await wb.xlsx.writeBuffer();
  const key = `exports/codir_${period}_${Date.now()}.xlsx`;
  const file = getStorage().bucket(IMPORTS_BUCKET).file(key);
  await file.save(Buffer.from(buf), { contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  await db.collection("auditLog").add({
    uid: req.auth.uid, action: "export", module: "overview", entity: "codir", entityId: key,
    detail: { period }, ts: FieldValue.serverTimestamp(),
  });
  let url = null;
  try {
    [url] = await file.getSignedUrl({ action: "read", expires: Date.now() + 3600 * 1000 });
  } catch (e) {
    logger.warn("getSignedUrl indisponible (émulateur ?)", { msg: e.message });
  }
  return { ok: true, objectKey: `${IMPORTS_BUCKET}/${key}`, url };
});

// --- Migration prototype → Firestore (BUILD_KIT §13) ---
exports.importLegacyBackup = onCallG("importLegacyBackup", async (req) => {
  if (req.auth?.token?.nt360Role !== "direction") throw new HttpsError("permission-denied", "admin requis");
  if (!(await rateLimit(req.auth.uid, "heavy", 30, 60_000))) throw new HttpsError("resource-exhausted", "Trop d'opérations lourdes en peu de temps — patientez un instant.");
  const b = req.data?.backup || {};
  const { safeId } = require("./lib/sheets");
  const writes = [];
  const push = (path, data) => writes.push({ path, data });
  (b.uorders || []).forEach((o) => o.fp && push(`orders/${safeId(o.fp)}`, { ...o, source: o.source || "legacy" }));
  (b.uinv || []).forEach((i) => i.numero && push(`invoices/${safeId(i.numero)}`, { ...i, source: "legacy" }));
  (b.objectives || []).forEach((o, idx) => push(`objectives/${o.fiscalYear || 0}_${o.scope || "global"}_${o.scopeValue || idx}`, o));
  (b.lines || []).forEach((c) => c.id && push(`creditLines/${safeId(c.id)}`, c));
  (b.fiches || []).forEach((f) => {
    if (!f.fp) return;
    const id = safeId(f.fp);
    const { costTotal, saleTotal, margin, marginPct, ...fbase } = f; // marge isolée (rentabilite)
    push(`projectSheets/${id}`, { ...fbase, _id: id, source: "legacy" });
    push(`projectSheetsMargin/${id}`, { _id: id, fp: f.fp, costTotal, saleTotal, margin, marginPct });
  });
  (b.pipeOpps || []).forEach((o, idx) => push(`opportunities/${o.oppId ? safeId(o.oppId) : "legacy_" + idx}`, { ...o, source: o.source || "salesData" }));

  // GARDE ANTI-ÉCRASEMENT (cf. audit) : par défaut, on REFUSE d'écraser des données déjà présentes — un
  // outil de migration ne doit pas clobber en silence des corrections manuelles (CAS/RAF via patchOrder,
  // marge via patchProjectSheet…). `force:true` requis pour réappliquer sur des collections non vides.
  if (req.data?.force !== true) {
    for (const col of ["orders", "invoices", "opportunities"]) {
      const one = await db.collection(col).limit(1).get();
      if (!one.empty) throw new HttpsError("failed-precondition", `${col} n'est pas vide — import legacy refusé (passer force:true pour réappliquer et écraser)`);
    }
  }
  let batch = db.batch(), n = 0;
  for (const w of writes) { batch.set(db.doc(w.path), w.data, { merge: true }); if (++n % 400 === 0) { await batch.commit(); batch = db.batch(); } }
  await batch.commit();
  // TRAÇABILITÉ (cf. audit) : journaliser la migration (qui, combien, forcée ou non) — sinon un import
  // legacy réappliqué ne laissait aucune trace, contrairement à importDelta/reingest.
  await db.collection("auditLog").add({
    uid: req.auth.uid, action: "import_legacy", module: "import", entity: "backup", entityId: String(writes.length),
    detail: { written: writes.length, force: req.data?.force === true }, ts: FieldValue.serverTimestamp(),
  });
  // Recompute BEST-EFFORT (blindage) : la restauration a DÉJÀ écrit les docs — un échec du recalcul ne doit
  // pas faire échouer l'import legacy (le prochain recompute rattrape).
  try {
    const { recomputeAll } = require("./lib/aggregate");
    await recomputeAll(db);
  } catch (re) {
    logger.error("importLegacyBackup : recompute post-restauration échoué — docs restaurés, agrégats au prochain recompute", { message: re && re.message });
  }
  return { ok: true, written: writes.length };
});

// --- F8 : export Firestore managé planifié → bucket de sauvegarde DÉDIÉ (BACKUP_BUCKET) ---
// On ATTEND la complétion de l'opération longue (LRO) et on ne trace « ok » qu'à la RÉUSSITE réelle :
// avant, seul le LANCEMENT était journalisé → un export qui démarrait puis échouait en aval passait pour
// réussi. timeoutSeconds élevé pour laisser la LRO se terminer ; si l'export dépasse ce délai, la fonction
// est tuée AVANT le log « ok » → l'absence de trace récente est précisément le signal recherché.
exports.scheduledFirestoreExport = onSchedule({ schedule: "every sunday 03:00", timeoutSeconds: 540, memoryMiB: 256 }, async () => {
  const startedAtMs = Date.now();
  const ts = new Date().toISOString().slice(0, 10);
  const uri = `gs://${BACKUP_BUCKET}/backups/${ts}`;
  const dedicated = BACKUP_BUCKET !== IMPORTS_BUCKET; // vrai une fois le bucket de sauvegarde dédié configuré
  try {
    const firestore = require("@google-cloud/firestore");
    const client = new firestore.v1.FirestoreAdminClient();
    const projectId = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || "propulse-business-87f7a";
    const name = client.databasePath(projectId, FIRESTORE_DB);
    const [op] = await client.exportDocuments({
      name,
      outputUriPrefix: uri,
      collectionIds: [], // toutes les collections
    });
    logger.info("scheduledFirestoreExport lancé", { op: op.name, uri, dedicated });
    // Suivi de COMPLÉTION : op.promise() résout à la fin réelle de l'export (ou rejette en cas d'échec aval).
    const [response] = await op.promise();
    logger.info("scheduledFirestoreExport terminé", { op: op.name, outputUriPrefix: response?.outputUriPrefix || uri });
    // Trace de SUCCÈS queryable APRÈS complétion. Un dernier opsLog 'scheduledFirestoreExport' ok manquant
    // ou périmé (> 8 j) reste un signal exploitable ; `dedicated:false` signale que le bucket dédié n'est
    // pas encore branché (ops : créer nt360-backups + rétention, puis pointer BACKUP_BUCKET dessus).
    await logOps({ kind: "scheduled", action: "scheduledFirestoreExport", status: "ok", op: op.name, ms: Date.now() - startedAtMs, detail: { uri: response?.outputUriPrefix || uri, dedicated } });
    return { ok: true, op: op.name, uri: response?.outputUriPrefix || uri };
  } catch (e) {
    logger.error("scheduledFirestoreExport a échoué", { message: e && e.message, stack: e && e.stack, uri });
    await logOps({ kind: "scheduled", action: "scheduledFirestoreExport", status: "error", ms: Date.now() - startedAtMs, detail: { uri, dedicated }, error: (e && e.message) || String(e) });
    throw e;
  }
});

// Exposé pour les tests / réutilisation.
module.exports.IMPORTS_BUCKET = IMPORTS_BUCKET;
