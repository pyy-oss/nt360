// Cloud Functions 2nd gen — Node.js 20 (codebase unique). BUILD_KIT §9, §10, §11, §14.
const { onObjectFinalized } = require("firebase-functions/v2/storage");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { logger } = require("firebase-functions/v2");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { getStorage } = require("firebase-admin/storage");
const { getAuth } = require("firebase-admin/auth");
const XLSX = require("xlsx");

const { getApp } = require("firebase-admin/app");
const { IMPORTS_BUCKET, FIRESTORE_DB } = require("./lib/config");
const { buildWrites, fiscalYearFromOrders } = require("./lib/ingest");
const { applyWrites } = require("./lib/apply");
const { parseBuffer, reingestBucket } = require("./lib/reingest");
const { defineSecret } = require("firebase-functions/params");
// Token API ClickUp (Secret Manager) — utilisé seulement par les fonctions d'intégration ClickUp.
const CLICKUP_TOKEN = defineSecret("CLICKUP_TOKEN");
// Défauts d'intégration ClickUp (surchargés par config/clickup) : workspace + liste « Côte d'Ivoire ».
const CLICKUP_TEAM = "90121503678";
const CLICKUP_LIST_CI = "901215917683";

initializeApp();
// Base Firestore nommée nt360 (projet partagé) — isole données et règles.
const db = getFirestore(getApp(), FIRESTORE_DB);
// Filet de sécurité global : un seul champ `undefined` dans un document écrit fait échouer
// TOUT le batch (« Cannot use undefined as a Firestore value »), donc tout le recompute. On
// demande à Firestore d'ignorer les champs undefined (ils sont simplement omis) — les défauts
// explicites côté domaine restent la 1re ligne de défense ; ceci évite qu'un oubli ne brique
// à nouveau un recalcul entier.
db.settings({ ignoreUndefinedProperties: true });

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
  const [buf] = await getStorage().bucket(bucket).file(name).download();
  const wb = XLSX.read(buf, { cellDates: true }); // SheetJS tolère dataValidation mal formé (§18.4)

  const { kinds, writes, report } = buildWrites(wb);
  logger.info("ingest", { name, kinds, ...report });

  await applyWrites(db, writes); // upsert + nettoyage des orphelins de fiche (voir applyWrites)

  await db.collection("imports").add({
    uid: null, kinds, filename: name, objectKey: `${bucket}/${name}`,
    rowsIn: report.rowsIn ?? 0, rowsOk: report.rowsOk ?? 0, rowsSkipped: report.rowsSkipped ?? 0,
    report, ts: FieldValue.serverTimestamp(),
  });

  if (kinds.includes("pnl") || kinds.includes("fiche")) await updateFiscalYearFromOrders();
  await recomputeSummaries(); // F3 : recalcul des agrégats impactés
}

if (process.env.INGEST_REGION) {
  exports.ingest = onObjectFinalized(
    { bucket: IMPORTS_BUCKET, region: process.env.INGEST_REGION, memoryMiB: 1024, timeoutSeconds: 300 },
    ingestHandler
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

// Journal d'EXPLOITATION : trace persistante des recomputes (manuels/planifiés) et de leurs
// échecs, pour l'observabilité (surfacé en Admin). N'échoue jamais l'action appelante.
async function logOps(entry) {
  try {
    await db.collection("opsLog").add({ ...entry, ts: FieldValue.serverTimestamp() });
  } catch (e) {
    logger.error("opsLog: écriture impossible", { message: e && e.message });
  }
}

// --- setUserRole : pose du rôle (custom claim), admin uniquement (§8) ---
const ROLES = ["direction", "commercial_dir", "commercial", "pmo", "achats", "lecture"];

exports.setUserRole = onCallG("setUserRole", async (req) => {
  if (req.auth?.token?.role !== "direction") throw new HttpsError("permission-denied", "admin requis");
  const { uid, role } = req.data || {};
  if (!uid || !ROLES.includes(role)) throw new HttpsError("invalid-argument", "uid et role (∈ 6 profils) requis");
  await getAuth().setCustomUserClaims(uid, { role });
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
  if (req.auth?.token?.role !== "direction") throw new HttpsError("permission-denied", "admin requis");
  const d = req.data || {};
  const email = String(d.email || "").trim().toLowerCase();
  const role = d.role;
  const password = String(d.password || "");
  const name = String(d.name || "").trim() || email.split("@")[0];
  if (!EMAIL_RE.test(email)) throw new HttpsError("invalid-argument", "email invalide");
  if (!ROLES.includes(role)) throw new HttpsError("invalid-argument", "rôle (∈ 6 profils) requis");
  if (password.length < 8) throw new HttpsError("invalid-argument", "mot de passe : 8 caractères minimum");
  const auth = getAuth();
  let existing = null;
  try { existing = await auth.getUserByEmail(email); } catch (e) { if (e.code !== "auth/user-not-found") throw e; }
  if (existing) throw new HttpsError("already-exists", "un compte existe déjà pour cet email");
  const user = await auth.createUser({ email, password, displayName: name, emailVerified: true });
  await auth.setCustomUserClaims(user.uid, { role });
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
  if (req.auth?.token?.role !== "direction") throw new HttpsError("permission-denied", "admin requis");
  const d = req.data || {};
  const email = String(d.email || "").trim().toLowerCase();
  const role = d.role;
  if (!EMAIL_RE.test(email)) throw new HttpsError("invalid-argument", "email invalide");
  if (!ROLES.includes(role)) throw new HttpsError("invalid-argument", "rôle (∈ 6 profils) requis");
  const auth = getAuth();
  let user;
  try { user = await auth.getUserByEmail(email); }
  catch (e) { if (e.code === "auth/user-not-found") throw new HttpsError("not-found", "aucun compte Firebase pour cet email (ni dans ce projet, ni dans ses autres apps)"); throw e; }
  const name = String(d.name || "").trim() || user.displayName || email.split("@")[0];
  // FUSION des claims : préserve d'éventuels claims d'une autre app du projet, ajoute/écrase `role`.
  await auth.setCustomUserClaims(user.uid, { ...(user.customClaims || {}), role });
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
  if (req.auth?.token?.role !== "direction") throw new HttpsError("permission-denied", "admin requis");
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
  if (req.auth?.token?.role !== "direction") throw new HttpsError("permission-denied", "admin requis");
  const d = req.data || {};
  const pct = (v, def) => { const n = Number(v); return Number.isFinite(n) && n >= 0 && n <= 1 ? n : def; };
  const years = (v, def) => { const n = Math.trunc(Number(v)); return Number.isFinite(n) && n >= 1 && n <= 10 ? n : def; };
  const cfg = {
    concentration: pct(d.concentration, 0.30),
    surfacturationPct: pct(d.surfacturationPct, 0.005),
    rafEcartPct: pct(d.rafEcartPct, 0.10),
    dormantYears: years(d.dormantYears, 2),
  };
  await db.doc("config/alerts").set(cfg, { merge: true });
  await db.collection("auditLog").add({
    uid: req.auth.uid, action: "alert_thresholds", module: "habilitations",
    entity: "config", entityId: "alerts", detail: cfg, ts: FieldValue.serverTimestamp(),
  });
  await recomputeSummaries(["alerts", "dataQuality"]);
  return { ok: true, ...cfg };
});

// --- Niveaux de PROJECTION configurables (config/projection) : activer/désactiver et pondérer
// chacun des 3 niveaux (Certitudes ≥90 · Forecast 70-90 · Pipe 50-70). Édité par la direction ;
// recompute COMPLET (overview, pipeline, atterrissage, AM 360° en dépendent). Poids bornés [0,1]. ---
exports.setProjectionConfig = onCallG("setProjectionConfig", async (req) => {
  if (req.auth?.token?.role !== "direction") throw new HttpsError("permission-denied", "admin requis");
  const d = req.data || {};
  const w = (v, def) => { const n = Number(v); return Number.isFinite(n) && n >= 0 && n <= 1 ? n : def; };
  const tier = (k, dw) => ({ active: d?.[k]?.active === undefined ? true : !!d[k].active, weight: w(d?.[k]?.weight, dw) });
  const cfg = { certitudes: tier("certitudes", 1), forecast: tier("forecast", 0.2), pipe: tier("pipe", 0.05) };
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
  await recomputeSummaries(); // projection → overview / pipeline / atterrissage / ams : recompute complet
  return { ok: true, ...cfg };
});

// --- Table d'ALIAS de normalisation des noms de clients (config/clientAliases) : fusionne les
// graphies distinctes d'un même client (ex. « SGBCI » ↔ « Société Générale »). Édité par la
// direction ; recompute COMPLET (le nom canonique pilote tous les regroupements client). Remplace
// intégralement (merge:false) → retirer une paire la supprime réellement. Bornée à 500 paires. ---
exports.setClientAliases = onCallG("setClientAliases", async (req) => {
  if (req.auth?.token?.role !== "direction") throw new HttpsError("permission-denied", "admin requis");
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
  await recomputeSummaries(); // les noms canoniques pilotent byClient/concentration/EntityView/atterrissage
  return { ok: true, count: pairs.length };
});

// --- Jalons de facturation par projet (billingMilestones/{safeId(fp)}) : échéancier prévisionnel
// (≤ 15 jalons {date, montant}), SOURCE UNIQUE du report N+1 (Σ jalons après le 31/12). Édité par
// direction/PMO. La règle « Σ jalons = RAF » est validée à l'éditeur ; le serveur normalise (≤ 15,
// dates ISO, montants > 0) et borne le report dérivé au RAF (aucune incohérence même en cas de dérive). ---
exports.setBillingMilestones = onCallG("setBillingMilestones", async (req) => {
  await requireWrite(req, "backlog"); // gouverné par la matrice (module « backlog »)
  const { fpKey } = require("./lib/ids");
  const { safeId } = require("./lib/sheets");
  const { normalizeMilestones } = require("./domain/milestones");
  const fp = fpKey(req.data?.fp);
  if (!fp) throw new HttpsError("invalid-argument", "N° FP de la commande requis");
  const milestones = normalizeMilestones(req.data?.milestones);
  await db.doc(`billingMilestones/${safeId(fp)}`).set({ fp, milestones, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  await db.collection("auditLog").add({
    uid: req.auth.uid, action: "billing_milestones", module: "backlog",
    entity: "milestones", entityId: fp, detail: { count: milestones.length, total: milestones.reduce((s, m) => s + m.amount, 0) }, ts: FieldValue.serverTimestamp(),
  });
  // 'atterrissage' (report N+1 + tendance de facturation) ET 'news' : sinon l'Actualité (retard de
  // facturation vs jalons, trajectoire) ne se rafraîchissait pas après une édition de jalons.
  await recomputeSummaries(["atterrissage", "news"]);
  return { ok: true, fp, milestones };
});

// --- Notifications d'alerte (webhook entrant Slack/Teams : POST JSON {text}). L'URL vit dans
// config/notifications (lecture réservée aux habilitations) ; sans URL/désactivé, tout no-op. ---
async function postWebhook(url, text) {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) });
  if (!res.ok) throw new Error(`webhook HTTP ${res.status}`);
}

// Codes HttpsError « attendus » (rejets de validation/autorisation) : ne PAS les traiter comme des
// incidents. Tout le reste = échec inattendu → journalisé dans opsLog + alerte webhook.
const EXPECTED_ERR = new Set(["invalid-argument", "permission-denied", "unauthenticated", "failed-precondition", "not-found", "already-exists"]);

// Enveloppe un handler onCall : capture les échecs INATTENDUS (observabilité), les trace dans
// opsLog et, si un webhook est configuré, envoie une alerte de crash — puis re-propage l'erreur.
function guarded(action, handler) {
  return async (req) => {
    try {
      return await handler(req);
    } catch (e) {
      if (e && e.code && EXPECTED_ERR.has(e.code)) throw e; // rejet métier normal → pas un incident
      const msg = (e && e.message) || String(e);
      logger.error(`${action} a échoué`, { message: msg, stack: e && e.stack });
      await logOps({ kind: "callable", action, status: "error", uid: (req.auth && req.auth.uid) || null, error: msg });
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
  const role = req.auth.token?.role;
  if (role === "direction") return;
  const { canWrite } = require("./domain/authz");
  const matrix = ((await db.doc("config/permissions").get()).data() || {}).matrix || {};
  if (!canWrite(matrix, role, module)) throw new HttpsError("permission-denied", `droit d'écriture « ${module} » requis`);
}

// --- Matrice de droits : édition via CALLABLE validé + audité (jamais en écriture directe). RÉSERVÉ
// À LA DIRECTION : réécrire la matrice = pouvoir s'auto-accorder « write » partout (escalade). On
// aligne donc sa garde sur les autres actions Habilitations (création de compte, rôle, configs), qui
// sont toutes direction-only — plutôt que sur requireWrite('habilitations') qui l'ouvrirait à un
// délégataire. Valide le schéma avant écriture (une matrice malformée casserait level() pour tous). ---
exports.setPermissions = onCallG("setPermissions", async (req) => {
  if (req.auth?.token?.role !== "direction") throw new HttpsError("permission-denied", "admin requis");
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
  if (req.auth?.token?.role !== "direction") throw new HttpsError("permission-denied", "admin requis");
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
exports.alertDigest = onSchedule({ schedule: "every day 07:00", timeoutSeconds: 60 }, async () => {
  const cfg = (await db.doc("config/notifications").get()).data() || {};
  if (!cfg.enabled || !cfg.webhookUrl) return;
  const al = (await db.doc("summaries/alerts").get()).data() || {};
  const minRank = cfg.minSeverity === "medium" ? 1 : 0;
  const crit = (al.items || []).filter((a) => (SEV_RANK[a.severity] ?? 9) <= minRank);
  if (!crit.length) return;
  const hash = crit.map((a) => `${a.type}:${a.count}`).join("|");
  if (hash === cfg.lastHash) return; // déjà notifié, rien de nouveau
  const text = `⚠️ nt360 — Alertes (exercice ${al.fy || ""})\n` + crit.map((a) => `• ${a.message}`).join("\n");
  try {
    await postWebhook(cfg.webhookUrl, text);
    await db.doc("config/notifications").set({ lastHash: hash, lastSentAt: FieldValue.serverTimestamp() }, { merge: true });
    await logOps({ kind: "notification", trigger: "planifié", status: "ok", detail: { count: crit.length } });
  } catch (e) {
    logger.error("alertDigest a échoué", { message: e && e.message });
    await logOps({ kind: "notification", trigger: "planifié", status: "error", error: (e && e.message) || String(e) });
  }
});

// --- logLogin : audit de connexion (critère F1) ---
exports.logLogin = onCallG("logLogin", async (req) => {
  if (!req.auth) throw new HttpsError("unauthenticated", "connexion requise");
  await db.collection("auditLog").add({
    uid: req.auth.uid, action: "login", module: "auth", entity: "session", entityId: req.auth.uid,
    detail: { role: req.auth.token.role || null, email: req.auth.token.email || null },
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
  const d = req.data || {};
  const s = (v, n) => (v == null ? null : String(v).slice(0, n));
  await db.collection("errorLog").add({
    uid: req.auth.uid,
    role: req.auth.token.role || null,
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
exports.recompute = onCallG("recompute", { memoryMiB: 512, timeoutSeconds: 300 }, async (req) => {
  if (req.auth?.token?.role !== "direction") throw new HttpsError("permission-denied", "admin requis");
  const { recomputeAll } = require("./lib/aggregate");
  const t0 = Date.now();
  try {
    const res = await recomputeAll(db, req.data?.only);
    await logOps({ kind: "recompute", trigger: "manuel", status: "ok", ms: Date.now() - t0, uid: req.auth.uid, detail: { summaries: res.written.length, currentFy: res.currentFy } });
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
exports.scheduledRecompute = onSchedule({ schedule: "every day 05:00", memoryMiB: 512, timeoutSeconds: 300 }, async () => {
  const { recomputeAll } = require("./lib/aggregate");
  const t0 = Date.now();
  try {
    const res = await recomputeAll(db);
    await logOps({ kind: "recompute", trigger: "planifié", status: "ok", ms: Date.now() - t0, detail: { summaries: res.written.length, currentFy: res.currentFy } });
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
  const wb = XLSX.read(buf, { cellDates: true });
  const res = await applySalesSync(db, wb);
  const { recomputeAll } = require("./lib/aggregate");
  await recomputeAll(db); // recalcul complet : une opp gagnée peut devenir commande (CAS/backlog/rentabilité)
  logger.info("syncSalesData", res);
  return res;
}

exports.syncSalesData = onSchedule("every day 06:00", async () => {
  try {
    await runSalesSync();
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
exports.importDelta = onCallG("importDelta", { memoryMiB: 512, timeoutSeconds: 300 }, async (req) => {
  await requireWrite(req, "import");
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
  try { parsed = parseBuffer(buf, filename); }
  catch (e) { throw new HttpsError(e.code || "invalid-argument", e.message || "fichier illisible"); }
  const { kinds, writes, files, rowsIn, rowsOk, rowsSkipped } = parsed;
  if (!kinds.length) throw new HttpsError("failed-precondition", "aucune source reconnue dans le fichier");

  await applyWrites(db, writes); // dédup par chemin + upsert + nettoyage des orphelins de fiche (voir applyWrites)

  const report = { kinds, files, rowsIn, rowsOk, rowsSkipped };
  await db.collection("imports").add({
    uid: req.auth.uid, kinds, filename, objectKey: null, mode: "delta",
    rowsIn, rowsOk, rowsSkipped, report, ts: FieldValue.serverTimestamp(),
  });
  await db.collection("auditLog").add({
    uid: req.auth.uid, action: "import_delta", module: "facturation", entity: "delta", entityId: filename,
    detail: { kinds, rowsOk, files: files.length }, ts: FieldValue.serverTimestamp(),
  });

  if (kinds.includes("pnl") || kinds.includes("fiche")) await updateFiscalYearFromOrders();
  await recomputeSummaries();
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
  if (req.auth?.token?.role !== "direction") throw new HttpsError("permission-denied", "admin requis");
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
exports.setInvoiceFp = onCallG("setInvoiceFp", { memoryMiB: 256, timeoutSeconds: 120 }, async (req) => {
  await requireWrite(req, "import");
  const { fpKey } = require("./lib/ids");
  const id = String(req.data?.id || "");
  if (!id) throw new HttpsError("invalid-argument", "id facture requis");
  const fp = fpKey(req.data?.fp) || null;
  if (!fp) throw new HttpsError("invalid-argument", "N° FP invalide (attendu FP/AAAA/NNNNN)");
  const ref = db.doc(`invoices/${id}`);
  if (!(await ref.get()).exists) throw new HttpsError("not-found", "facture introuvable");
  await ref.set({ fp, linked: true, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  await db.collection("auditLog").add({
    uid: req.auth.uid, action: "set_invoice_fp", module: "facturation", entity: "invoice", entityId: id,
    detail: { fp }, ts: FieldValue.serverTimestamp(),
  });
  await recomputeSummaries();
  return { ok: true, id, fp };
});

// --- ASSAINISSEMENT : suppression d'un/plusieurs enregistrement(s) erroné(s) ou fantôme(s). Les
// imports delta n'effacent JAMAIS (ajout / mise à jour uniquement) → seul l'app peut retirer un
// record qui ne doit plus exister. Gouverné par le module RBAC de la donnée, audité, recompute
// derrière. Le DELTA reste prioritaire : si une future ligne source réintroduit ce record (même
// clé), il réapparaît — la suppression assainit l'existant, elle ne verrouille pas contre la source.
// Les identifiants sont des DOC IDS (pas de re-transformation : safeId n'est pas idempotent). ---
const DELETABLE = { orders: "import", invoices: "import", bcLines: "bc", projectSheets: "rentabilite", opportunities: "pipeline" };
exports.deleteRecords = onCallG("deleteRecords", { memoryMiB: 256, timeoutSeconds: 300 }, async (req) => {
  const d = req.data || {};
  const collection = String(d.collection || "");
  const module = DELETABLE[collection];
  if (!module) throw new HttpsError("invalid-argument", "collection non assainissable");
  await requireWrite(req, module);
  const ids = (Array.isArray(d.ids) ? d.ids : []).map((x) => String(x || "")).filter(Boolean).slice(0, 1000);
  if (!ids.length) throw new HttpsError("invalid-argument", "aucun identifiant fourni");
  for (let i = 0; i < ids.length; i += 400) {
    const batch = db.batch();
    for (const id of ids.slice(i, i + 400)) {
      batch.delete(db.doc(`${collection}/${id}`));
      if (collection === "projectSheets") batch.delete(db.doc(`projectSheetsMargin/${id}`)); // marge isolée liée
    }
    await batch.commit();
  }
  await db.collection("auditLog").add({
    uid: req.auth.uid, action: "delete_records", module, entity: collection, entityId: String(ids.length),
    detail: { collection, count: ids.length }, ts: FieldValue.serverTimestamp(),
  });
  await recomputeSummaries();
  return { ok: true, count: ids.length };
});

// --- ANNULATION d'une commande / facture (statut « Annulée » persistant). Non destructif : le doc
// source reste (historique) mais son id est ajouté à l'overlay config/cancellations → le recompute
// l'EXCLUT de tous les agrégats. Overlay (et non un champ du doc) pour SURVIVRE à un ré-import delta.
// Gouverné par le même module que la suppression (« import ») ; audité ; recompute complet derrière. ---
// Docs séparés (et non un doc unique) : chaque overlay est lisible AU NIVEAU DE SON MODULE
// (cancelOrders → overview, cancelInvoices → facturation) — pas de fuite d'un libellé facturation
// vers un rôle sans droit facturation. Écriture réservée au callable (rules : write false).
const CANCELLABLE = { orders: { module: "import", doc: "config/cancelOrders" }, invoices: { module: "import", doc: "config/cancelInvoices" } };
exports.setCancellation = onCallG("setCancellation", { memoryMiB: 256, timeoutSeconds: 300 }, async (req) => {
  const d = req.data || {};
  const collection = String(d.collection || "");
  const spec = CANCELLABLE[collection];
  if (!spec) throw new HttpsError("invalid-argument", "objet non annulable");
  await requireWrite(req, spec.module);
  const id = String(d.id || "");
  if (!id) throw new HttpsError("invalid-argument", "identifiant requis");
  const cancelled = d.cancelled !== false; // défaut = annuler
  const ref = db.doc(spec.doc);
  const cur = (await ref.get()).data() || {};
  const list = (Array.isArray(cur.items) ? cur.items : []).filter((e) => e && e.id !== id);
  if (cancelled) {
    list.push({ id, label: String(d.label || "").slice(0, 120), client: String(d.client || "").slice(0, 120), uid: req.auth.uid, ts: Date.now() });
  }
  await ref.set({ items: list.slice(0, 5000), updatedAt: FieldValue.serverTimestamp() }, { merge: false });
  await db.collection("auditLog").add({
    uid: req.auth.uid, action: cancelled ? "cancel_record" : "restore_record", module,
    entity: collection, entityId: id, detail: { collection }, ts: FieldValue.serverTimestamp(),
  });
  await recomputeSummaries(); // exclusion → impacte carnet/CAS/backlog/facturation/cash/rentabilité/qualité
  return { ok: true, id, cancelled };
});

// --- Correction d'une facture EXISTANTE : date de facturation et/ou date d'échéance (les seules
// dérivées manquantes fiabilisables in-app). Le MONTANT n'est pas éditable (intégrité comptable :
// il reste piloté par la source). Recalcule l'échéancier cash + la qualité des données. ---
exports.patchInvoice = onCallG("patchInvoice", { memoryMiB: 256, timeoutSeconds: 120 }, async (req) => {
  await requireWrite(req, "import");
  const id = String(req.data?.id || "");
  if (!id) throw new HttpsError("invalid-argument", "id facture requis");
  const ref = db.doc(`invoices/${id}`);
  if (!(await ref.get()).exists) throw new HttpsError("not-found", "facture introuvable");
  const d = req.data || {};
  const patch = { updatedAt: FieldValue.serverTimestamp() };
  if (d.date !== undefined) patch.date = d.date || null;
  if (d.dueDate !== undefined) patch.dueDate = d.dueDate || null;
  if (Object.keys(patch).length <= 1) throw new HttpsError("invalid-argument", "rien à corriger (date ou échéance requise)");
  await ref.set(patch, { merge: true });
  await db.collection("auditLog").add({
    uid: req.auth.uid, action: "patch_invoice", module: "facturation", entity: "invoice", entityId: id,
    detail: { date: patch.date ?? null, dueDate: patch.dueDate ?? null }, ts: FieldValue.serverTimestamp(),
  });
  await recomputeSummaries(); // date/échéance → échéancier cash, encours âgés, qualité des données
  return { ok: true, id };
});

// --- Correction d'une fiche affaire : prix de VENTE et/ou de REVIENT (comble « fiche sans prix de
// vente »). Donnée de MARGE → droit « rentabilite » requis, et écriture dans projectSheetsMargin
// (collection isolée, mêmes règles que le reste de la marge). Marge & %MB recalculés. Le prix de
// vente d'une fiche pilote le CAS quand la commande est de source fiche → recalcul complet. ---
exports.patchProjectSheet = onCallG("patchProjectSheet", { memoryMiB: 256, timeoutSeconds: 120 }, async (req) => {
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
  await recomputeSummaries(); // fiche → CAS (si commande=fiche) + marge → recalcul complet
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
}

// --- Fiabilisation : corriger une commande P&L — année de PO manquante et/ou N° FP erroné.
// Le doc `orders` est clé par le FP ; corriger le FP = ré-clé (copie + suppression). Recalcule. ---
exports.patchOrder = onCallG("patchOrder", { memoryMiB: 256, timeoutSeconds: 120 }, async (req) => {
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
    // Garde-fou : si une commande existe DÉJÀ sous le FP cible, un set(merge) fusionnerait deux
    // lignes P&L distinctes (perte d'une commande) → on refuse.
    const newId = safeId(newFp);
    if ((await db.doc(`orders/${newId}`).get()).exists) throw new HttpsError("failed-precondition", `une commande existe déjà pour ${newFp} — ré-clé refusée (fusion destructive)`);
    await db.doc(`orders/${newId}`).set({ ...snap.data(), ...patch, _id: newId, fp: newFp, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    await ref.delete();
    // Le FP est la clé de jointure : on migre aussi les satellites (factures, BC, fiche, jalons),
    // sinon ils resteraient orphelins sous l'ancien FP (facturé=0, RAF gonflé, marge & report perdus).
    await migrateFpSatellites(fp, newFp);
  } else if (Object.keys(patch).length) {
    await ref.set({ ...patch, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  } else {
    throw new HttpsError("invalid-argument", "rien à modifier (année, CAS, RAF, client/AM/BU ou nouveau FP requis)");
  }
  await db.collection("auditLog").add({
    uid: req.auth.uid, action: "patch_order", module: "overview", entity: "order", entityId: safeId(fp),
    detail: { fp, newFp: newFp || null, yearPo: patch.yearPo ?? null, cas: patch.cas ?? null, raf: patch.raf ?? null, client: patch.client ?? null, am: patch.am ?? null }, ts: FieldValue.serverTimestamp(),
  });
  await recomputeSummaries();
  return { ok: true, fp: newFp || fp };
});

// --- createOrder : CRÉE une commande (ligne P&L) DIRECTEMENT dans l'app — sans passer par l'Excel.
// Réservé aux profils ayant le droit « import » (comme patchOrder). Deux usages : réconcilier une
// opp GAGNÉE sans ligne P&L (inscription pré-remplie depuis l'opp), ou saisir une commande manuelle.
// « P&L STRICT / Excel curaté prioritaire » préservé : on REFUSE si un orders/{fp} existe déjà, et
// au ré-import une ligne P&L du même FP écrase cette saisie (upsert par FP) — la saisie app ne
// persiste que tant que le FP est absent de l'Excel. source='manuel' → visible comme telle. ---
exports.createOrder = onCallG("createOrder", { memoryMiB: 256, timeoutSeconds: 120 }, async (req) => {
  await requireWrite(req, "import");
  const { fpKey, cleanBu } = require("./lib/ids");
  const { safeId } = require("./lib/sheets");
  const d = req.data || {};
  const fp = fpKey(d.fp);
  if (!fp) throw new HttpsError("invalid-argument", "N° FP requis (format FP/AAAA/N)");
  const cas = Number(d.cas);
  if (!Number.isFinite(cas) || cas <= 0) throw new HttpsError("invalid-argument", "CAS (> 0) requis");
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
  const raf = d.raf != null && String(d.raf) !== "" ? Math.max(Number(d.raf) || 0, 0) : null; // null → RAF dérivé (CAS − facturé)
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
    uid: req.auth.uid, action: "create_order", module: "overview", entity: "order", entityId: id,
    detail: { fp, cas, source: "manuel" }, ts: FieldValue.serverTimestamp(),
  });
  await recomputeSummaries();
  return { ok: true, fp };
});

// --- setOrderPm : affecte un Project Manager (PMO) à une commande. Stocké en OVERLAY
// config/orderPm { map: { <safeId(fp)>: pm } }, hors du doc commande → l'affectation SURVIT au
// recompute ET à un ré-import delta (même logique que l'annulation). `pm` vide → désaffectation.
// Gouverné par le module « import » (comme patchOrder/createOrder) — ajustable via la matrice. ---
exports.setOrderPm = onCallG("setOrderPm", { memoryMiB: 256, timeoutSeconds: 120 }, async (req) => {
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
  await recomputeSummaries();
  return { ok: true, fp, pm: pm || null };
});

// --- Ajout unitaire d'un BC fournisseur (mode « Unitaire / PDF ») : une ligne bcLines,
// PDF joint stocké pour traçabilité. ID déterministe (clés métier) ⇒ ré-envoi idempotent. ---
// --- Saisie / édition d'opportunités (source 'saisie') en onCall : RECALCULE ensuite les
// agrégats pipeline, sinon l'opp restait invisible des summaries jusqu'au recompute admin/quotidien. ---
// Autorisation pipeline/BC/fournisseurs : gouvernée par la MATRICE (requireWrite), plus de liste figée.

exports.upsertOpportunity = onCallG("upsertOpportunity", { memoryMiB: 512, timeoutSeconds: 120 }, async (req) => {
  await requireWrite(req, "pipeline");
  const { fpKey } = require("./lib/ids");
  const { DEFAULT_PROBA, STAGE_LABEL } = require("./parsers/salesData");
  const { clampStage, oppWeighted } = require("./domain/mutations");
  const d = req.data || {};
  const client = String(d.client || "").trim();
  if (!client) throw new HttpsError("invalid-argument", "client requis");
  const stage = clampStage(d.stage);
  const amount = Number(d.amount) || 0;
  // Proba : valeur fournie (0..1) sinon défaut de l'étape — évite un pondéré à 0 par oubli.
  const pr = Number(d.probability);
  const probability = pr > 0 && pr <= 1 ? pr : (DEFAULT_PROBA[stage] ?? 0);
  // Édition : id fourni préfixé « saisie_ » ; sinon nouvelle saisie. On ne touche QUE les saisies.
  const id = (typeof d.id === "string" && d.id.startsWith("saisie_")) ? d.id
    : ("saisie_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8));
  const doc = {
    oppId: id, source: "saisie",
    client, am: String(d.am || "").trim(), bu: String(d.bu || "AUTRE").trim().toUpperCase(),
    fp: fpKey(d.fp) || null,
    amount, stage, stageLabel: STAGE_LABEL[stage] || String(stage),
    probability, weighted: oppWeighted(amount, probability),
    closingDate: d.closingDate || null,
    updatedAt: FieldValue.serverTimestamp(),
  };
  await db.doc(`opportunities/${id}`).set(doc, { merge: true });
  await db.collection("auditLog").add({
    uid: req.auth.uid, action: "upsert_opp", module: "pipeline", entity: "opportunity", entityId: id,
    detail: { client, stage, fp: doc.fp }, ts: FieldValue.serverTimestamp(),
  });
  await recomputeSummaries(); // saisie occasionnelle → recalcul complet (l'opp peut devenir commande, etc.)
  return { ok: true, id };
});

exports.deleteOpportunity = onCallG("deleteOpportunity", { memoryMiB: 256, timeoutSeconds: 120 }, async (req) => {
  await requireWrite(req, "pipeline");
  const id = String(req.data?.id || "");
  if (!id.startsWith("saisie_")) throw new HttpsError("failed-precondition", "seules les opportunités saisies sont supprimables");
  await db.doc(`opportunities/${id}`).delete();
  await recomputeSummaries(); // saisie occasionnelle → recalcul complet (l'opp peut devenir commande, etc.)
  return { ok: true };
});

// --- Correction d'une opportunité EXISTANTE (importée ou saisie) : N° FP, D Prev (date de clôture),
// montant, étape, AM, BU. Contrairement à upsertOpportunity (qui ne crée/édite que des saisies),
// ce callable corrige N'IMPORTE QUELLE opp SANS toucher à sa `source` — donc pas de détournement
// (la règle Firestore continue d'interdire au client de basculer une opp importée en 'saisie').
// Comble le blocage majeur « opp GAGNÉE importée sans N° FP » (non corrigeable in-app jusqu'ici).
// Au ré-import Sales_DATA, la source reste prioritaire (elle réécrit l'opp) — cohérent « Excel prioritaire ». ---
exports.patchOpportunity = onCallG("patchOpportunity", { memoryMiB: 256, timeoutSeconds: 120 }, async (req) => {
  await requireWrite(req, "pipeline");
  const { fpKey } = require("./lib/ids");
  const { STAGE_LABEL } = require("./parsers/salesData");
  const { clampStage, oppWeighted } = require("./domain/mutations");
  const d = req.data || {};
  const id = String(d.id || "");
  if (!id) throw new HttpsError("invalid-argument", "id opportunité requis");
  const ref = db.doc(`opportunities/${id}`);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", "opportunité introuvable");
  const cur = snap.data() || {};
  const patch = { updatedAt: FieldValue.serverTimestamp() };
  if (d.fp !== undefined) patch.fp = fpKey(d.fp) || null; // '' → détache le FP
  if (d.closingDate !== undefined) patch.closingDate = d.closingDate || null;
  if (d.am !== undefined) patch.am = String(d.am || "").trim();
  if (d.bu !== undefined) patch.bu = String(d.bu || "").trim().toUpperCase();
  if (d.stage !== undefined) {
    const stage = clampStage(d.stage);
    patch.stage = stage;
    patch.stageLabel = STAGE_LABEL[stage] || String(stage);
  }
  if (d.amount !== undefined && String(d.amount) !== "") {
    const a = Number(d.amount);
    if (!Number.isFinite(a) || a < 0) throw new HttpsError("invalid-argument", "montant invalide");
    patch.amount = a;
  }
  // Probabilité (IdC) éditable : la projection pondère par PALIER d'IdC, pas par étape — corriger
  // l'étape sans pouvoir ajuster l'IdC laissait le pondéré figé. Bornée [0,1].
  if (d.probability !== undefined && String(d.probability) !== "") {
    const pr = Number(d.probability);
    if (!Number.isFinite(pr) || pr < 0 || pr > 1) throw new HttpsError("invalid-argument", "probabilité (0..1) invalide");
    patch.probability = pr;
  }
  // Pondéré recalculé si le montant OU la probabilité change (valeurs courantes conservées sinon).
  if (patch.amount !== undefined || patch.probability !== undefined) {
    patch.weighted = oppWeighted(patch.amount !== undefined ? patch.amount : cur.amount, patch.probability !== undefined ? patch.probability : cur.probability);
  }
  if (Object.keys(patch).length <= 1) throw new HttpsError("invalid-argument", "rien à corriger");
  await ref.set(patch, { merge: true });
  await db.collection("auditLog").add({
    uid: req.auth.uid, action: "patch_opp", module: "pipeline", entity: "opportunity", entityId: id,
    detail: { fp: patch.fp ?? null, stage: patch.stage ?? null, amount: patch.amount ?? null }, ts: FieldValue.serverTimestamp(),
  });
  await recomputeSummaries(); // l'opp peut devenir/réconcilier une commande → recalcul complet
  return { ok: true, id };
});

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
  await recomputeSummaries(["suppliers", "alerts"]);
  return { ok: true, id, pdfStored: !!pdfKey };
});

// --- setFxRates : taux de change (XOF par unité de devise) pour la conversion des BC en devise
// étrangère. Stocké dans config/fxRates { rates: { <DEVISE>: taux } }. Direction uniquement.
// Remplace l'ensemble des taux (l'UI envoie la table complète). N'affecte que les BC créés ENSUITE
// (la conversion est figée à l'écriture) — un BC existant se recorrige via sa contre-valeur XOF. ---
exports.setFxRates = onCallG("setFxRates", { memoryMiB: 256, timeoutSeconds: 60 }, async (req) => {
  if (req.auth?.token?.role !== "direction") throw new HttpsError("permission-denied", "admin requis");
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
const REF_LISTS = { projectManagers: { doc: "config/projectManagers", upper: false }, businessUnits: { doc: "config/businessUnits", upper: true } };
exports.setRefList = onCallG("setRefList", { memoryMiB: 256, timeoutSeconds: 60 }, async (req) => {
  if (req.auth?.token?.role !== "direction") throw new HttpsError("permission-denied", "admin requis");
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
  if (req.auth?.token?.role !== "direction") throw new HttpsError("permission-denied", "admin requis");
  const d = req.data || {};
  const cfg = {
    enabled: d.enabled !== false,
    teamId: String(d.teamId || CLICKUP_TEAM),
    defaultListId: String(d.defaultListId || CLICKUP_LIST_CI),
    updatedBy: req.auth.uid, updatedAt: FieldValue.serverTimestamp(),
  };
  await db.doc("config/clickup").set(cfg, { merge: true });
  await db.collection("auditLog").add({ uid: req.auth.uid, action: "set_clickup_config", module: "habilitations", entity: "config", entityId: "clickup", detail: { enabled: cfg.enabled, defaultListId: cfg.defaultListId }, ts: FieldValue.serverTimestamp() });
  return { ok: true, config: cfg };
});

// pushOrderToClickup : crée (ou met à jour, idempotent) une tâche ClickUp pour une commande, assignée
// à son PM. Lien FP↔tâche stocké en overlay config/clickupLinks → ré-appui = mise à jour, pas de
// doublon. Gouverné par le module « import ». Le token vient du secret CLICKUP_TOKEN (Secret Manager).
exports.pushOrderToClickup = onCallG("pushOrderToClickup", { secrets: [CLICKUP_TOKEN], memoryMiB: 256, timeoutSeconds: 60 }, async (req) => {
  await requireWrite(req, "import");
  const clickup = require("./lib/clickup");
  const { fpKey } = require("./lib/ids");
  const { safeId } = require("./lib/sheets");
  const cfg = (await db.doc("config/clickup").get()).data() || {};
  if (cfg.enabled === false) throw new HttpsError("failed-precondition", "intégration ClickUp désactivée (Habilitations)");
  const token = CLICKUP_TOKEN.value();
  if (!token) throw new HttpsError("failed-precondition", "token ClickUp absent (secret CLICKUP_TOKEN)");
  const order = req.data?.order || {};
  const fp = fpKey(order.fp);
  if (!fp) throw new HttpsError("invalid-argument", "N° FP de la commande requis");
  const teamId = cfg.teamId || CLICKUP_TEAM;
  const listId = String(req.data?.listId || cfg.defaultListId || CLICKUP_LIST_CI);

  let assignee = null;
  try { assignee = clickup.resolveAssignee(await clickup.listMembers(token, teamId), order.pm); }
  catch (e) { logger.warn("ClickUp: membres non résolus", { msg: e && e.message }); }
  const payload = clickup.taskPayload({ ...order, fp }, assignee);

  const id = safeId(fp);
  const links = ((await db.doc("config/clickupLinks").get()).data() || {}).map || {};
  const existing = links[id];
  let task, created = false;
  try {
    if (existing) { task = await clickup.updateTask(token, existing, payload); task.id = existing; }
    else { task = await clickup.createTask(token, listId, payload); created = true; await db.doc("config/clickupLinks").set({ map: { [id]: task.id } }, { merge: true }); }
  } catch (e) {
    throw new HttpsError(e.status === 401 || e.status === 403 ? "permission-denied" : "internal", `ClickUp : ${e.message || "échec de la synchronisation"}`);
  }
  await db.collection("auditLog").add({ uid: req.auth.uid, action: created ? "clickup_create" : "clickup_update", module: "import", entity: "order", entityId: fp, detail: { taskId: task.id, listId, assigned: !!assignee }, ts: FieldValue.serverTimestamp() });
  return { ok: true, taskId: task.id, url: task.url || `https://app.clickup.com/t/${task.id}`, assigned: !!assignee, created };
});

// listClickupMembers : membres du workspace ClickUp (nom + e-mail) — pour peupler le référentiel PM
// avec des noms EXACTS (évite les fautes de saisie qui casseraient l'assignation). Direction.
exports.listClickupMembers = onCallG("listClickupMembers", { secrets: [CLICKUP_TOKEN], memoryMiB: 256, timeoutSeconds: 60 }, async (req) => {
  if (req.auth?.token?.role !== "direction") throw new HttpsError("permission-denied", "admin requis");
  const token = CLICKUP_TOKEN.value();
  if (!token) throw new HttpsError("failed-precondition", "token ClickUp absent (secret CLICKUP_TOKEN)");
  const clickup = require("./lib/clickup");
  const cfg = (await db.doc("config/clickup").get()).data() || {};
  let members;
  try { members = await clickup.listMembers(token, cfg.teamId || CLICKUP_TEAM); }
  catch (e) { throw new HttpsError(e.status === 401 || e.status === 403 ? "permission-denied" : "internal", `ClickUp : ${e.message || "membres illisibles"}`); }
  return { ok: true, members: members.map((m) => ({ name: m.username, email: m.email })).filter((m) => m.name) };
});

// --- Écritures BC / crédit fournisseur en onCall : elles RECALCULENT ensuite les agrégats
// (suppliers + alerts), sinon l'exposition et les alertes restaient périmées jusqu'au
// « Recalculer » manuel. Le rôle est revérifié côté serveur. ---
exports.setBcStatus = onCallG("setBcStatus", { memoryMiB: 512, timeoutSeconds: 120 }, async (req) => {
  await requireWrite(req, "bc");
  const { id, status } = req.data || {};
  if (!id || !BC_STAGES.includes(status)) throw new HttpsError("invalid-argument", "id + statut (∈ cycle BC) requis");
  await db.doc(`bcLines/${id}`).set({ status, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  await db.collection("auditLog").add({
    uid: req.auth.uid, action: "bc_status", module: "bc", entity: "bcLine", entityId: id,
    detail: { status }, ts: FieldValue.serverTimestamp(),
  });
  await recomputeSummaries(["suppliers", "alerts"]);
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
  await recomputeSummaries(["suppliers", "alerts", "cashflow"]);
  return { ok: true };
});

exports.upsertCreditLine = onCallG("upsertCreditLine", { memoryMiB: 512, timeoutSeconds: 120 }, async (req) => {
  await requireWrite(req, "fournisseurs");
  // id = nom du fournisseur en MAJUSCULES (clé d'appariement avec l'exposition, cf. domain/fournisseurs).
  const id = String(req.data?.id || "").trim().toUpperCase();
  if (!id) throw new HttpsError("invalid-argument", "fournisseur requis");
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
  await recomputeSummaries(["suppliers", "alerts"]);
  return { ok: true };
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
  if (req.auth?.token?.role !== "direction") throw new HttpsError("permission-denied", "admin requis");
  const { planDedupe, invoiceKey, opportunityKey, bcKey } = require("./domain/dedupe");
  const KEYS = { invoices: invoiceKey, opportunities: opportunityKey, bcLines: bcKey };
  const only = (Array.isArray(req.data?.collections) ? req.data.collections : Object.keys(KEYS)).filter((c) => KEYS[c]);
  const apply = req.data?.apply !== false; // défaut : applique (l'UI propose une analyse préalable)

  const result = {};
  const toDelete = [];
  for (const col of only) {
    const snap = await db.collection(col).get();
    const docs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const plan = planDedupe(docs, KEYS[col]);
    result[col] = { total: plan.total, duplicateGroups: plan.duplicateGroups, duplicates: plan.duplicates };
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
    await recomputeSummaries();
  }
  return { ok: true, applied: apply, result };
});

// --- F7 : export one-pager CODIR (XLSX) → Cloud Storage + URL signée ---
// Le one-pager CODIR contient des données financières (P&L, atterrissage) → réservé aux
// profils habilités à la rentabilité (direction / commercial_dir / lecture), pas à tout compte.
const EXPORT_ROLES = ["direction", "commercial_dir", "lecture"];
exports.exportReport = onCallG("exportReport", async (req) => {
  if (!req.auth) throw new HttpsError("unauthenticated", "connexion requise");
  if (!EXPORT_ROLES.includes(req.auth.token?.role)) throw new HttpsError("permission-denied", "droit de rapport requis");
  const ExcelJS = require("exceljs");
  const { canRead } = require("./domain/authz");
  const period = req.data?.period || "all";
  const get = async (p) => (await db.doc(p).get()).data() || {};
  // La MARGE n'entre dans l'export que si le rôle appelant a le droit « rentabilite » DANS LA MATRICE
  // (pas selon une liste figée) : révoquer rentabilite retire la marge de l'export, comme partout.
  const matrix = ((await db.doc("config/permissions").get()).data() || {}).matrix || {};
  const canMargin = canRead(matrix, req.auth.token?.role, "rentabilite");
  const [ov, bl, pl, fiscal] = await Promise.all([
    get(`summaries/overview_${period}`), get("summaries/backlog_fy"),
    get("summaries/pipeline"), get("config/fiscal"),
  ]);
  const ovm = canMargin ? await get(`summaries/overviewMargin_${period}`) : {};
  const att = await get(`summaries/atterrissage_${fiscal.currentFy || ""}`);

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("CODIR");
  ws.addRow(["Pilote Revenu NT CI — One-pager CODIR"]);
  ws.addRow(["Période", period, "FY", fiscal.currentFy || ""]);
  ws.addRow([]);
  ws.addRow(["Indicateur", "Valeur"]);
  [
    ["Certitudes", ov.certitudes], ["Commandes (CAS)", ov.commandes], ["Facturé", ov.facture],
    ["Backlog (RAF)", bl.total],
    ...(canMargin ? [["Marge brute", ovm.mb]] : []),
    ["Taux facturation", ov.ratios?.tauxFacturation],
    ["Pipeline actif pondéré", pl.tot?.weighted], ["Atterrissage projeté", att.projete],
    ["Objectif CAS", att.objectif], ["Écart", att.ecart],
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
  if (req.auth?.token?.role !== "direction") throw new HttpsError("permission-denied", "admin requis");
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

  let batch = db.batch(), n = 0;
  for (const w of writes) { batch.set(db.doc(w.path), w.data, { merge: true }); if (++n % 400 === 0) { await batch.commit(); batch = db.batch(); } }
  await batch.commit();
  const { recomputeAll } = require("./lib/aggregate");
  await recomputeAll(db);
  return { ok: true, written: writes.length };
});

// --- F8 : export Firestore managé planifié → gs://nt360/backups/ (sauvegarde) ---
exports.scheduledFirestoreExport = onSchedule("every sunday 03:00", async () => {
  try {
    const firestore = require("@google-cloud/firestore");
    const client = new firestore.v1.FirestoreAdminClient();
    const projectId = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || "propulse-business-87f7a";
    const ts = new Date().toISOString().slice(0, 10);
    const name = client.databasePath(projectId, FIRESTORE_DB);
    const [op] = await client.exportDocuments({
      name,
      outputUriPrefix: `gs://${IMPORTS_BUCKET}/backups/${ts}`,
      collectionIds: [], // toutes les collections
    });
    logger.info("scheduledFirestoreExport lancé", { op: op.name });
    return { ok: true };
  } catch (e) {
    logger.error("scheduledFirestoreExport a échoué", { message: e && e.message, stack: e && e.stack });
    await logOps({ kind: "scheduled", action: "scheduledFirestoreExport", status: "error", error: (e && e.message) || String(e) });
    throw e;
  }
});

// Exposé pour les tests / réutilisation.
module.exports.IMPORTS_BUCKET = IMPORTS_BUCKET;
