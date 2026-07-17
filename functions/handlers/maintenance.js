// HANDLER — Contrats de maintenance (mnt_). Lot 1 : contrat + engagements SLA embarqués. Lot 2 :
// tickets + interventions, avec ALIMENTATION DU CRA existant (timesheets) — une seule vérité du temps.
// Extraction hors du monolithe index.js (patron R3, injection). Collections mnt_* callable-only (rules
// read = drapeau + droit `maintenance`, write:false). DOUBLE garde à l'écriture : requireWrite +
// drapeau config/mntFeature ALLUMÉ (ADR-009). Exports déclarés dans index.js (déploiement par nom).
const { safeId } = require("../lib/sheets");
const { fpKey } = require("../lib/ids");
const { isMntEnabled } = require("../domain/mntFeature");
const { MAX_SCAN, sliceCapped } = require("../domain/scan");
const { monthOf, craDaysFromHours } = require("../domain/mntTicket");

function createMaintenance({ onCallG, HttpsError, db, FieldValue, requireWrite, requireRead, assertPlainId, loadUsersMap, anyDirectionUid, ANTHROPIC_API_KEY, rateLimit, logOps, requestRecompute }) {
  // Le module doit être ALLUMÉ pour toute écriture. Sans ça, aucune donnée mnt_* ne se crée : l'ERP
  // reste strictement celui d'avant même si un rôle porte le droit `maintenance`.
  async function assertMntEnabled() {
    const cfg = (await db.doc("config/mntFeature").get()).data();
    if (!isMntEnabled(cfg)) throw new HttpsError("failed-precondition", "module Contrats de maintenance désactivé");
  }

  // Recalcule la CONTRIBUTION MAINTENANCE au CRA pour un (consultant × mois) : somme des heures des
  // interventions du mois → jours (ADR-013), écrite dans timesheets/mnt_<consultant>_<mois> avec
  // source « mnt » (id DISTINCT du CRA manuel → aucune collision ; computeConstat somme les deux).
  // 0 h ⇒ suppression du doc (pas de ligne fantôme). Le drapeau garde le tout : éteint ⇒ pas
  // d'interventions ⇒ pas de contribution ⇒ TACE strictement inchangée.
  async function refreshCra(consultantId, month) {
    if (!consultantId || !month) return;
    const snap = await db.collection("mnt_interventions").where("consultantId", "==", consultantId).limit(MAX_SCAN + 1).get();
    let hours = 0;
    for (const d of sliceCapped(snap.docs).docs) { const x = d.data(); if (monthOf(x.date) === month) hours += Number(x.heures) || 0; }
    const ref = db.doc(`timesheets/mnt_${safeId(consultantId)}_${month}`);
    if (hours > 0) await ref.set({ consultantId, month, billedDays: craDaysFromHours(hours), source: "mnt", updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    else await ref.delete().catch(() => {});
  }

  const upsertMntContrat = onCallG("upsertMntContrat", { memoryMiB: 256, timeoutSeconds: 60 }, async (req) => {
    await requireWrite(req, "maintenance");
    await assertMntEnabled();
    const { validateMntContrat } = require("../domain/mntContrat");
    const v = validateMntContrat(req.data);
    if (!v.ok) throw new HttpsError("invalid-argument", v.error);
    const id = safeId(v.value.fp); // 1 contrat = 1 affaire (ADR-001), idempotent
    const ref = db.doc(`mnt_contrats/${id}`);
    const exists = (await ref.get()).exists;
    const doc = { ...v.value, updatedAt: FieldValue.serverTimestamp() };
    if (exists) await ref.set(doc, { merge: true });
    else await ref.set({ ...doc, createdBy: req.auth.uid, createdAt: FieldValue.serverTimestamp() });
    await db.collection("auditLog").add({ uid: req.auth.uid, action: exists ? "update_mnt_contrat" : "create_mnt_contrat", module: "maintenance", entity: "mnt_contrat", entityId: id, detail: { fp: v.value.fp, statut: v.value.statut, montantEngage: v.value.montantEngage }, ts: FieldValue.serverTimestamp() });
    // Rafraîchit summaries/mnt_risque (KPI risque/rétention) après l'édition — recompute DIFFÉRÉ et SCOPÉ
    // « maintenance » (le seul bloc à recalculer ; les lectures invoices/asOf sont inconditionnelles).
    // Sinon le score ne bougeait qu'au recompute planifié de 05:00.
    await requestRecompute(["maintenance"]);
    return { ok: true, id };
  });

  // IMPORT EN MASSE des contrats depuis un classeur (.xlsx/.csv). `apply=false` = APERÇU (dry-run,
  // n'écrit rien) ; `apply=true` = applique (upsert par id = safeId(fp), idempotent). Double garde
  // (requireWrite + drapeau) comme toute écriture mnt_. Parseur/plan PURS (parsers/mntImport +
  // domain/mntImport) ; exceljs requis PARESSEUSEMENT (readWorkbook async). Budget aligné import (512/300).
  const importMntContrats = onCallG("importMntContrats", { memoryMiB: 512, timeoutSeconds: 300 }, async (req) => {
    await requireWrite(req, "maintenance");
    await assertMntEnabled();
    const fileB64 = req.data && req.data.fileB64;
    const apply = !!(req.data && req.data.apply);
    if (!fileB64 || typeof fileB64 !== "string") throw new HttpsError("invalid-argument", "fichier manquant");
    const { readWorkbook } = require("../lib/xlsxRead");
    const { parseMntContratsImport } = require("../parsers/mntImport");
    const { planMntContratsImport } = require("../domain/mntImport");
    let wb;
    try { wb = await readWorkbook(Buffer.from(fileB64, "base64")); }
    catch (e) { throw new HttpsError("invalid-argument", "classeur illisible (.xlsx/.csv attendu)"); }
    const { rows, report } = parseMntContratsImport(wb);
    const CAP = 2000; // borne le volume traité (protège mémoire/temps ; au-delà, découper le fichier)
    if (rows.length > CAP) throw new HttpsError("invalid-argument", `trop de lignes (${rows.length} > ${CAP}) — découpez le fichier`);
    // Contrats existants (petite collection, callable-only) — scan borné par prudence.
    const snap = await db.collection("mnt_contrats").limit(MAX_SCAN + 1).get();
    const existing = new Set(sliceCapped(snap.docs).docs.map((d) => d.id));
    const plan = planMntContratsImport(rows, existing);
    const created = plan.toCreate.length, updated = plan.toUpdate.length, skipped = plan.errors.length;
    const s5 = (arr) => arr.slice(0, 5).map((r) => ({ fp: r.value.fp, client: r.value.client, statut: r.value.statut }));
    const samples = { create: s5(plan.toCreate), update: s5(plan.toUpdate), errors: plan.errors.slice(0, 10) };
    if (!apply) return { ok: true, applied: false, created, updated, skipped, rowsParsed: report.rowsParsed, samples };
    // Application : écritures batchées (limite Firestore 500/batch → chunks de 400). La MISE À JOUR est
    // NON EFFAÇANTE — on écrit le `patch` (seuls les champs renseignés + JAMAIS `engagements`, préservés) ;
    // la CRÉATION pose le doc complet. Le classement create/update est décidé par le plan (pas au write).
    const all = [
      ...plan.toCreate.map((r) => ({ mode: "create", id: r.id, value: r.value })),
      ...plan.toUpdate.map((r) => ({ mode: "update", id: r.id, patch: r.patch })),
    ];
    for (let i = 0; i < all.length; i += 400) {
      const batch = db.batch();
      for (const rec of all.slice(i, i + 400)) {
        const ref = db.doc(`mnt_contrats/${rec.id}`);
        if (rec.mode === "update") batch.set(ref, { ...rec.patch, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
        else batch.set(ref, { ...rec.value, updatedAt: FieldValue.serverTimestamp(), createdBy: req.auth.uid, createdAt: FieldValue.serverTimestamp() });
      }
      await batch.commit();
    }
    await db.collection("auditLog").add({ uid: req.auth.uid, action: "import_mnt_contrats", module: "maintenance", entity: "mnt_contrat", entityId: "(masse)", detail: { created, updated, skipped, rowsParsed: report.rowsParsed }, ts: FieldValue.serverTimestamp() });
    if (created || updated) await requestRecompute(["maintenance"]); // rafraîchit le risque après un import qui a écrit
    return { ok: true, applied: true, created, updated, skipped, rowsParsed: report.rowsParsed, samples };
  });

  // SUGGESTIONS IA — juge quelles affaires du carnet (candidats fournis par le front, seule autorité du
  // carnet fusionné → parité « même métrique = même nombre ») relèvent d'une prestation RÉCURRENTE et
  // devraient porter un contrat. « L'IA propose, l'humain valide » : renvoie des propositions PRÉ-REMPLI-ables,
  // AUCUNE écriture. Double garde (requireWrite + drapeau) comme le reste du module + limite anti-coût.
  // Budget aligné sur l'assistant du Centre de correction (512/300, secret ANTHROPIC_API_KEY).
  const aiSuggestMntContrats = onCallG(
    "aiSuggestMntContrats",
    { secrets: ANTHROPIC_API_KEY ? [ANTHROPIC_API_KEY] : [], memoryMiB: 512, timeoutSeconds: 300 },
    async (req) => {
      await requireWrite(req, "maintenance");
      await assertMntEnabled();
      // Coût : chaque appel = 1 requête Opus (réflexion adaptative). 20/min/compte suffisent au travail humain.
      if (rateLimit && !(await rateLimit(req.auth.uid, "ai", 20, 60_000))) {
        throw new HttpsError("resource-exhausted", "Trop d'analyses IA en peu de temps — patientez un instant.");
      }
      const apiKey = ANTHROPIC_API_KEY && ANTHROPIC_API_KEY.value();
      if (!apiKey) throw new HttpsError("failed-precondition", "ANTHROPIC_API_KEY non configuré (Secret Manager) — assistant IA indisponible.");

      // Candidats fournis par le front (affaires du carnet SANS contrat) — bornés + assainis. On NE reçoit
      // que le nécessaire au jugement ; on re-borne côté serveur (garde-fou coût/exfiltration).
      const raw = Array.isArray(req.data?.candidates) ? req.data.candidates : [];
      if (!raw.length) throw new HttpsError("invalid-argument", "aucun candidat à analyser");
      const CAP = 60; // même borne que l'assistant du Centre de correction (coût + latence)
      const truncated = raw.length > CAP;
      const candidates = raw.slice(0, CAP).map((c) => ({
        fp: String((c && c.fp) || "").slice(0, 40),
        client: String((c && c.client) || "").slice(0, 120),
        bu: String((c && c.bu) || "").slice(0, 40),
        am: String((c && c.am) || "").slice(0, 80),
        affaire: String((c && c.affaire) || "").slice(0, 200),
        cas: Number(c && c.cas) || 0,
      })).filter((c) => fpKey(c.fp));
      if (!candidates.length) throw new HttpsError("invalid-argument", "aucun candidat exploitable (N° FP requis)");

      // Sécurité additionnelle : on écarte tout candidat DÉJÀ sous contrat (le carnet du front peut dater d'un
      // instant t ; on rapproche par fpKey comme partout ailleurs).
      const snap = await db.collection("mnt_contrats").limit(MAX_SCAN + 1).get();
      const have = new Set(sliceCapped(snap.docs).docs.map((d) => fpKey((d.data() || {}).fp)).filter(Boolean));
      const pool = candidates.filter((c) => !have.has(fpKey(c.fp)));
      if (!pool.length) throw new HttpsError("failed-precondition", "toutes les affaires proposées portent déjà un contrat.");

      const { aiSuggestMntContrats: runAi } = require("../lib/mntSuggestAi");
      let out;
      try {
        out = await runAi(apiKey, pool);
      } catch (e) {
        if (e && e.code === "ai_refusal") throw new HttpsError("failed-precondition", "Le modèle a refusé de traiter ce lot.");
        throw new HttpsError("internal", "L'assistant IA n'a pas pu produire de suggestions (réessayez).");
      }
      // Audit : USAGE uniquement (tailles, modèle, coût) — jamais le contenu des affaires.
      if (logOps) await logOps({ kind: "ai", action: "suggestMntContrats", status: "ok", uid: req.auth.uid, detail: { candidates: pool.length, suggestions: out.suggestions.length, model: out.model, usage: out.usage } });
      return { ok: true, suggestions: out.suggestions, model: out.model, truncated, analyzed: pool.length, total: raw.length };
    },
  );

  const deleteMntContrat = onCallG("deleteMntContrat", { memoryMiB: 256, timeoutSeconds: 60 }, async (req) => {
    await requireWrite(req, "maintenance");
    await assertMntEnabled();
    const id = assertPlainId(req.data?.id, "id contrat");
    await db.doc(`mnt_contrats/${id}`).delete();
    await db.collection("auditLog").add({ uid: req.auth.uid, action: "delete_mnt_contrat", module: "maintenance", entity: "mnt_contrat", entityId: id, ts: FieldValue.serverTimestamp() });
    await requestRecompute(["maintenance"]);
    return { ok: true };
  });

  // Changement de statut d'un contrat — MINIMAL (ne touche que `statut`, comme setBcStatus pour les BC).
  // Sert l'action EN MASSE « Passer au statut » : plus sûr que de renvoyer tout le contrat via upsert (aucun
  // autre champ n'est réécrit). Rafraîchit le score de risque (recompute scopé).
  const setMntContratStatut = onCallG("setMntContratStatut", { memoryMiB: 256, timeoutSeconds: 60 }, async (req) => {
    await requireWrite(req, "maintenance");
    await assertMntEnabled();
    const { STATUTS } = require("../domain/mntContrat");
    const id = assertPlainId(req.data?.id, "id contrat");
    const statut = String(req.data?.statut || "").trim();
    if (!STATUTS.includes(statut)) throw new HttpsError("invalid-argument", "statut invalide");
    const ref = db.doc(`mnt_contrats/${id}`);
    if (!(await ref.get()).exists) throw new HttpsError("not-found", "contrat introuvable");
    await ref.set({ statut, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    await db.collection("auditLog").add({ uid: req.auth.uid, action: "set_mnt_contrat_statut", module: "maintenance", entity: "mnt_contrat", entityId: id, detail: { statut }, ts: FieldValue.serverTimestamp() });
    await requestRecompute(["maintenance"]);
    return { ok: true };
  });

  // ABONNEMENTS DE SURVEILLANCE (Lot 5, ADR-026) — préférence PAR UTILISATEUR (doc mnt_watches/{uid}).
  // S'abonner est une PERSONNALISATION lecture (requireRead suffit : voir le module ⇒ pouvoir le suivre).
  // Écrit le doc de l'appelant uniquement (id = uid). PAS de recompute : les abonnements ne changent aucun
  // agrégat — le ciblage se fait à l'affichage sur summaries/mnt_surveillance (déjà matérialisé).
  const setMntWatch = onCallG("setMntWatch", { memoryMiB: 256, timeoutSeconds: 60 }, async (req) => {
    await requireRead(req, "maintenance");
    await assertMntEnabled();
    // Garde-débit léger (personnalisation, fail-open) — homogène avec les autres callables gouvernés.
    if (rateLimit && !(await rateLimit(req.auth.uid, "mntWatch", 30, 60_000))) throw new HttpsError("resource-exhausted", "Trop de modifications d'abonnement en peu de temps — patientez un instant.");
    const { normalizeWatch } = require("../domain/mntSurveillance");
    const watch = normalizeWatch(req.data);
    await db.doc(`mnt_watches/${req.auth.uid}`).set({ ...watch, updatedAt: FieldValue.serverTimestamp() }, { merge: false });
    await db.collection("auditLog").add({ uid: req.auth.uid, action: "set_mnt_watch", module: "maintenance", entity: "mnt_watch", entityId: req.auth.uid, detail: { global: watch.global, contrats: watch.contrats.length, clients: watch.clients.length, ams: watch.ams.length }, ts: FieldValue.serverTimestamp() });
    return { ok: true };
  });

  const upsertMntTicket = onCallG("upsertMntTicket", { memoryMiB: 256, timeoutSeconds: 60 }, async (req) => {
    await requireWrite(req, "maintenance");
    await assertMntEnabled();
    const { validateTicket } = require("../domain/mntTicket");
    const v = validateTicket(req.data);
    if (!v.ok) throw new HttpsError("invalid-argument", v.error);
    const doc = { ...v.value, updatedAt: FieldValue.serverTimestamp() };
    let id = req.data?.id ? assertPlainId(req.data.id, "id ticket") : null;
    if (id) {
      // Horodatages de TRANSITION (SLA à la minute) : posés UNE fois quand le statut franchit le seuil,
      // jamais réécrits (le SLA se mesure sur le premier passage). Prise en compte = passage en_cours ;
      // résolution = passage resolu/clos.
      const prev = (await db.doc(`mnt_tickets/${id}`).get()).data() || {};
      if (v.value.statut === "en_cours" && !prev.priseEnCompteLe) doc.priseEnCompteLe = FieldValue.serverTimestamp();
      if ((v.value.statut === "resolu" || v.value.statut === "clos") && !prev.resoluLe) doc.resoluLe = FieldValue.serverTimestamp();
      await db.doc(`mnt_tickets/${id}`).set(doc, { merge: true });
    } else {
      // CRÉATION : poser les MÊMES horodatages de transition que l'édition, selon le statut INITIAL. Un
      // ticket saisi rétroactivement déjà resolu/clos (historisation, courant en ESN) doit porter resoluLe,
      // sinon le moteur de risque calcule markMs=null → SLA « rompu » à jamais sur un ticket clos dans les
      // temps (audit m5). serverTimestamp partagé : ouverture et résolution au même instant → SLA respecté.
      const seedTs = FieldValue.serverTimestamp();
      const seed = { ...doc, ouvertLe: seedTs, createdBy: req.auth.uid };
      if (v.value.statut === "en_cours") seed.priseEnCompteLe = seedTs;
      if (v.value.statut === "resolu" || v.value.statut === "clos") seed.resoluLe = seedTs;
      const ref = await db.collection("mnt_tickets").add(seed);
      id = ref.id;
    }
    await db.collection("auditLog").add({ uid: req.auth.uid, action: id ? "upsert_mnt_ticket" : "create_mnt_ticket", module: "maintenance", entity: "mnt_ticket", entityId: id, detail: { contratId: v.value.contratId, statut: v.value.statut, priorite: v.value.priorite }, ts: FieldValue.serverTimestamp() });
    await requestRecompute(["maintenance"]); // le ticket alimente les SLA rompus / quota du score de risque
    return { ok: true, id };
  });

  const deleteMntTicket = onCallG("deleteMntTicket", { memoryMiB: 256, timeoutSeconds: 60 }, async (req) => {
    await requireWrite(req, "maintenance");
    await assertMntEnabled();
    const id = assertPlainId(req.data?.id, "id ticket");
    await db.doc(`mnt_tickets/${id}`).delete();
    await db.collection("auditLog").add({ uid: req.auth.uid, action: "delete_mnt_ticket", module: "maintenance", entity: "mnt_ticket", entityId: id, ts: FieldValue.serverTimestamp() });
    await requestRecompute(["maintenance"]);
    return { ok: true };
  });

  const upsertMntIntervention = onCallG("upsertMntIntervention", { memoryMiB: 256, timeoutSeconds: 60 }, async (req) => {
    await requireWrite(req, "maintenance");
    await assertMntEnabled();
    const { validateIntervention } = require("../domain/mntTicket");
    const v = validateIntervention(req.data);
    if (!v.ok) throw new HttpsError("invalid-argument", v.error);
    const doc = { ...v.value, updatedAt: FieldValue.serverTimestamp() };
    // Édition : on relit l'ancienne valeur pour rafraîchir AUSSI l'ancien (consultant, mois) si changé.
    let id = req.data?.id ? assertPlainId(req.data.id, "id intervention") : null;
    let prev = null;
    if (id) { prev = (await db.doc(`mnt_interventions/${id}`).get()).data() || null; await db.doc(`mnt_interventions/${id}`).set(doc, { merge: true }); }
    else { const ref = await db.collection("mnt_interventions").add({ ...doc, createdBy: req.auth.uid, createdAt: FieldValue.serverTimestamp() }); id = ref.id; }
    await refreshCra(v.value.consultantId, monthOf(v.value.date));
    if (prev && (prev.consultantId !== v.value.consultantId || monthOf(prev.date) !== monthOf(v.value.date))) await refreshCra(prev.consultantId, monthOf(prev.date));
    await db.collection("auditLog").add({ uid: req.auth.uid, action: "upsert_mnt_intervention", module: "maintenance", entity: "mnt_intervention", entityId: id, detail: { ticketId: v.value.ticketId, consultantId: v.value.consultantId, heures: v.value.heures }, ts: FieldValue.serverTimestamp() });
    return { ok: true, id };
  });

  const deleteMntIntervention = onCallG("deleteMntIntervention", { memoryMiB: 256, timeoutSeconds: 60 }, async (req) => {
    await requireWrite(req, "maintenance");
    await assertMntEnabled();
    const id = assertPlainId(req.data?.id, "id intervention");
    const prev = (await db.doc(`mnt_interventions/${id}`).get()).data() || null;
    await db.doc(`mnt_interventions/${id}`).delete();
    if (prev) await refreshCra(prev.consultantId, monthOf(prev.date));
    await db.collection("auditLog").add({ uid: req.auth.uid, action: "delete_mnt_intervention", module: "maintenance", entity: "mnt_intervention", entityId: id, ts: FieldValue.serverTimestamp() });
    return { ok: true };
  });

  // Décision de contrat (renouvellement / résiliation) SOUMISE au moteur d'approbation EXISTANT
  // (ADR-004) — routée vers le manager du demandeur (sinon direction), visible via la sécurité par
  // enregistrement, décidée par le callable `decideApproval` et l'écran Approbations existants. On ne
  // recrée aucun circuit : on ajoute juste une entrée `maintenance`-gouvernée dans `approvals`.
  const submitMntDecision = onCallG("submitMntDecision", { memoryMiB: 256, timeoutSeconds: 60 }, async (req) => {
    await requireWrite(req, "maintenance");
    await assertMntEnabled();
    const kind = String(req.data?.kind || "");
    if (!["renouvellement_contrat", "resiliation_contrat"].includes(kind)) throw new HttpsError("invalid-argument", "nature de décision invalide");
    const contratId = assertPlainId(req.data?.contratId, "id contrat");
    const c = (await db.doc(`mnt_contrats/${contratId}`).get()).data();
    if (!c) throw new HttpsError("not-found", "contrat introuvable");
    const { validateApprovalRequest, approverFor } = require("../domain/approval");
    const { ownerChain } = require("../domain/hierarchy");
    const v = validateApprovalRequest({ kind, entityType: "mnt_contrat", entityId: contratId, entityLabel: `${c.client || ""} · ${c.fp || ""}`.trim(), note: req.data?.note });
    if (!v.ok) throw new HttpsError("invalid-argument", v.error);
    const requester = req.auth.uid;
    const usersMap = await loadUsersMap();
    const approverUid = approverFor(usersMap, requester, await anyDirectionUid(requester));
    if (!approverUid) throw new HttpsError("failed-precondition", "aucun approbateur disponible (définir un manager ou un compte direction)");
    const visibleTo = Array.from(new Set([...ownerChain(usersMap, requester), approverUid]));
    const doc = { ...v.value, status: "pending", requestedBy: requester, requestedByName: (usersMap[requester] && usersMap[requester].name) || null, approverUid, visibleTo, at: new Date().toISOString().slice(0, 10), createdAt: FieldValue.serverTimestamp() };
    const ref = await db.collection("approvals").add(doc);
    await db.collection("auditLog").add({ uid: requester, action: "mnt_decision_submit", module: "maintenance", entity: "approval", entityId: ref.id, detail: { kind, contratId, approverUid }, ts: FieldValue.serverTimestamp() });
    return { ok: true, id: ref.id, approverUid };
  });

  // ANALYSE DE RÉTENTION IA (Lot 6/7 « valeur ajoutée » — anticipation) — l'IA lit les contrats DÉJÀ repérés
  // à risque (moteur interne) + stats tickets et rend, par contrat, les MOTIFS de churn + une reco de
  // rétention. ADDITIF (ne re-score pas). « L'IA propose » : aucune écriture. Double garde + limite anti-coût.
  const aiAnalyzeChurn = onCallG(
    "aiAnalyzeChurn",
    { secrets: ANTHROPIC_API_KEY ? [ANTHROPIC_API_KEY] : [], memoryMiB: 512, timeoutSeconds: 300 },
    async (req) => {
      await requireRead(req, "maintenance");
      await assertMntEnabled();
      if (rateLimit && !(await rateLimit(req.auth.uid, "ai", 20, 60_000))) throw new HttpsError("resource-exhausted", "Trop d'analyses IA en peu de temps — patientez un instant.");
      const apiKey = ANTHROPIC_API_KEY && ANTHROPIC_API_KEY.value();
      if (!apiKey) throw new HttpsError("failed-precondition", "ANTHROPIC_API_KEY non configuré (Secret Manager) — assistant IA indisponible.");
      const raw = Array.isArray(req.data?.contrats) ? req.data.contrats : [];
      if (!raw.length) throw new HttpsError("invalid-argument", "aucun contrat à analyser");
      const CAP = 60;
      const truncated = raw.length > CAP;
      const contrats = raw.slice(0, CAP).map((c) => ({
        fp: String((c && c.fp) || "").slice(0, 40), client: String((c && c.client) || "").slice(0, 120),
        niveau: String((c && c.niveau) || "").slice(0, 20),
        signals: Array.isArray(c && c.signals) ? c.signals.slice(0, 8).map((s) => String(s).slice(0, 60)) : [],
        joursEcheance: (c && c.joursEcheance != null && Number.isFinite(Number(c.joursEcheance))) ? Number(c.joursEcheance) : null, ticketsOuverts: Number(c && c.ticketsOuverts) || 0, slaBreaches: Number(c && c.slaBreaches) || 0,
      })).filter((c) => fpKey(c.fp));
      if (!contrats.length) throw new HttpsError("invalid-argument", "aucun contrat exploitable (N° FP requis)");
      const { aiAnalyzeChurn: runAi } = require("../lib/aiChurn");
      let out;
      try {
        out = await runAi(apiKey, contrats);
      } catch (e) {
        if (e && e.code === "ai_refusal") throw new HttpsError("failed-precondition", "Le modèle a refusé de traiter ce lot.");
        throw new HttpsError("internal", "L'assistant IA n'a pas pu produire d'analyse (réessayez).");
      }
      if (logOps) await logOps({ kind: "ai", action: "analyzeChurn", status: "ok", uid: req.auth.uid, detail: { contrats: contrats.length, analyses: out.analyses.length, model: out.model, usage: out.usage } });
      return { ok: true, analyses: out.analyses, model: out.model, truncated, analyzed: contrats.length, total: raw.length };
    },
  );

  // RENTABILITÉ PAR CONTRAT (Lot 4/7 « valeur ajoutée ») — revenu engagé à ce jour vs coût des interventions
  // (jours CRA × CJM). Le CJM est CONFIDENTIEL : coût/marge MASQUÉS sauf droit `rentabilite` (même règle que
  // resourcePnl/activityKpis). Lecture gouvernée `maintenance` + drapeau. Calcul serveur (le CJM ne sort pas).
  const mntContratPnl = onCallG("mntContratPnl", { memoryMiB: 256, timeoutSeconds: 120 }, async (req) => {
    await requireRead(req, "maintenance");
    await assertMntEnabled();
    const { canRead } = require("../domain/authz");
    const role = req.auth.token?.nt360Role;
    const matrix = ((await db.doc("config/permissions").get()).data() || {}).matrix || {};
    const hasCost = role === "direction" || canRead(matrix, role, "rentabilite");
    const [cSnap, iSnap, conSnap] = await Promise.all([
      db.collection("mnt_contrats").limit(MAX_SCAN + 1).get(),
      db.collection("mnt_interventions").limit(MAX_SCAN + 1).get(),
      db.collection("consultants").select("cjm").limit(MAX_SCAN + 1).get(),
    ]);
    const contrats = sliceCapped(cSnap.docs).docs.map((d) => ({ id: d.id, ...d.data() }));
    const interventions = sliceCapped(iSnap.docs).docs.map((d) => d.data());
    const cjmById = {};
    for (const d of sliceCapped(conSnap.docs).docs) { const x = d.data() || {}; if (x.cjm != null) cjmById[d.id] = Number(x.cjm); }
    const { computeContratPnl } = require("../domain/mntContratPnl");
    const asOf = new Date().toISOString().slice(0, 10);
    return { ok: true, rows: computeContratPnl(contrats, interventions, cjmById, asOf, hasCost), hasCost };
  });

  return { upsertMntContrat, importMntContrats, aiSuggestMntContrats, aiAnalyzeChurn, mntContratPnl, deleteMntContrat, setMntContratStatut, setMntWatch, upsertMntTicket, deleteMntTicket, upsertMntIntervention, deleteMntIntervention, submitMntDecision };
}

module.exports = { createMaintenance };
