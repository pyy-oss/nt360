// HANDLER — Partenariats & Certifications (par_). Lot 1 : référentiel partenaire (par_partners) —
// partenaire + niveaux + compétences + catalogue de certifs + exigences de quota, structures EMBARQUÉES.
// Même patron que le module maintenance (extraction hors index.js, injection). Collections par_*
// callable-only (rules read = drapeau + droit `partenariats`, write:false). DOUBLE garde à l'écriture :
// requireWrite + drapeau config/parFeature ALLUMÉ (ADR-P01). Exports déclarés dans index.js.
const { slug, validatePartner, computeExpiry } = require("../domain/parPartner");
const { validateCertification, computeCertStatus } = require("../domain/parCertification");
const { validateAssignment, ASSIGNMENT_STATUSES } = require("../domain/parAssignment");
const { isParEnabled } = require("../domain/parFeature");

function createPartenariats({ onCallG, HttpsError, db, FieldValue, requireWrite, requireRead, requestRecompute, ANTHROPIC_API_KEY, CLICKUP_TOKEN, rateLimit, logOps }) {
  // Le module doit être ALLUMÉ pour toute écriture. Sans ça, aucune donnée par_* ne se crée : l'ERP
  // reste strictement celui d'avant même si un rôle porte le droit `partenariats`.
  async function assertParEnabled() {
    const cfg = (await db.doc("config/parFeature").get()).data();
    if (!isParEnabled(cfg)) throw new HttpsError("failed-precondition", "module Partenariats & Certifications désactivé");
  }

  // Crée/met à jour un référentiel partenaire complet (idempotent, id = slug du partenaire). Le doc porte
  // le référentiel ENTIER (tiers/competencies/catalog/requirements validés + intègres) — écriture non
  // fusionnante sur ces tableaux : l'édition REMPLACE le référentiel (sémantique « je pose l'état »),
  // volontaire pour un référentiel piloté par la direction/steward.
  const upsertParPartner = onCallG("upsertParPartner", { memoryMiB: 256, timeoutSeconds: 60 }, async (req) => {
    await requireWrite(req, "partenariats");
    await assertParEnabled();
    const v = validatePartner(req.data);
    if (!v.ok) throw new HttpsError("invalid-argument", v.error);
    const id = v.value.id; // slug stable = jointure universelle (partnerId)
    const ref = db.doc(`par_partners/${id}`);
    const exists = (await ref.get()).exists;
    const doc = { ...v.value, updatedAt: FieldValue.serverTimestamp() };
    if (exists) await ref.set(doc, { merge: false }); // remplace le référentiel (tableaux non fusionnés)
    else await ref.set({ ...doc, createdBy: req.auth.uid, createdAt: FieldValue.serverTimestamp() });
    await db.collection("auditLog").add({ uid: req.auth.uid, action: exists ? "update_par_partner" : "create_par_partner", module: "partenariats", entity: "par_partner", entityId: id, detail: { name: v.value.name, tiers: v.value.tiers.length, certifs: v.value.certificationCatalog.length }, ts: FieldValue.serverTimestamp() });
    await requestRecompute(["partenariats"]); // rafraîchit summaries/par_ca (nom du partenaire affiché)
    return { ok: true, id };
  });

  // Supprime un référentiel partenaire. Réservé écriture `partenariats` + drapeau. Idempotent.
  const deleteParPartner = onCallG("deleteParPartner", { memoryMiB: 256, timeoutSeconds: 60 }, async (req) => {
    await requireWrite(req, "partenariats");
    await assertParEnabled();
    const id = slug(req.data && req.data.id);
    if (!id) throw new HttpsError("invalid-argument", "id de partenaire invalide");
    await db.doc(`par_partners/${id}`).delete().catch(() => {});
    await db.collection("auditLog").add({ uid: req.auth.uid, action: "delete_par_partner", module: "partenariats", entity: "par_partner", entityId: id, detail: {}, ts: FieldValue.serverTimestamp() });
    await requestRecompute(["partenariats"]);
    return { ok: true, id };
  });

  // Crée/met à jour une certification d'un ingénieur. Idempotent : id = <consultantId>_<catalogId>
  // (une certif par consultant × entrée de catalogue). ADR-P03 : le consultant DOIT exister (sinon on
  // créerait une personne fantôme) — on lit sa fiche pour dénormaliser NOM/BU/GRADE (jamais le CJM
  // confidentiel), afin d'afficher la certif sous le seul droit `partenariats`. La date d'expiration et
  // le statut sont DÉRIVÉS du catalogue du partenaire (validityMonths) — jamais saisis à la main.
  const upsertParCertification = onCallG("upsertParCertification", { memoryMiB: 256, timeoutSeconds: 60 }, async (req) => {
    await requireWrite(req, "partenariats");
    await assertParEnabled();
    const v = validateCertification(req.data);
    if (!v.ok) throw new HttpsError("invalid-argument", v.error);
    const { consultantId, partnerId, certificationCatalogId, obtainedDate } = v.value;

    // Le consultant doit exister (annuaire ESN existant = seule vérité des personnes).
    const consSnap = await db.doc(`consultants/${consultantId}`).get();
    if (!consSnap.exists) throw new HttpsError("failed-precondition", "consultant inconnu (annuaire ESN)");
    const cons = consSnap.data() || {};

    // Le partenaire + l'entrée de catalogue doivent exister (référentiel Lot 1) → validité de la certif.
    const partSnap = await db.doc(`par_partners/${partnerId}`).get();
    if (!partSnap.exists) throw new HttpsError("failed-precondition", "partenaire inconnu (référentiel)");
    const entry = ((partSnap.data() || {}).certificationCatalog || []).find((e) => e.id === certificationCatalogId);
    if (!entry) throw new HttpsError("failed-precondition", "certification absente du catalogue du partenaire");

    const expiryDate = computeExpiry(obtainedDate, entry.validityMonths);
    const today = new Date().toISOString().slice(0, 10);
    const status = computeCertStatus(expiryDate, today);

    const id = `${slug(consultantId) || consultantId}_${certificationCatalogId}`;
    const ref = db.doc(`par_certifications/${id}`);
    const exists = (await ref.get()).exists;
    // Dénormalisation NON confidentielle du consultant (affichage sans exposer le CJM) + du catalogue.
    const doc = {
      ...v.value, expiryDate, status,
      consultantName: String(cons.name || "").slice(0, 120), consultantBu: String(cons.bu || "").slice(0, 40), consultantGrade: String(cons.grade || "").slice(0, 40),
      // Manager du consultant dénormalisé (destinataire des relances de RENOUVELLEMENT, PA4) — jamais le CJM.
      managerUid: cons.managerUid ? String(cons.managerUid).slice(0, 128) : null,
      competencyId: entry.competencyId, certCode: entry.code || "", certName: entry.name || "", certLevel: entry.level || "",
      updatedAt: FieldValue.serverTimestamp(),
    };
    if (exists) await ref.set(doc, { merge: true });
    else await ref.set({ ...doc, createdBy: req.auth.uid, createdAt: FieldValue.serverTimestamp() });
    await db.collection("auditLog").add({ uid: req.auth.uid, action: exists ? "update_par_certification" : "create_par_certification", module: "partenariats", entity: "par_certification", entityId: id, detail: { consultantId, partnerId, certificationCatalogId, status }, ts: FieldValue.serverTimestamp() });
    await requestRecompute(["partenariats"]); // rafraîchit quotas (couverture) + alertes cycle de vie
    return { ok: true, id, status, expiryDate };
  });

  // Supprime une certification. Réservé écriture `partenariats` + drapeau. Idempotent.
  const deleteParCertification = onCallG("deleteParCertification", { memoryMiB: 256, timeoutSeconds: 60 }, async (req) => {
    await requireWrite(req, "partenariats");
    await assertParEnabled();
    const id = String(req.data && req.data.id || "").trim().slice(0, 200);
    if (!id) throw new HttpsError("invalid-argument", "id de certification invalide");
    await db.doc(`par_certifications/${id}`).delete().catch(() => {});
    await db.collection("auditLog").add({ uid: req.auth.uid, action: "delete_par_certification", module: "partenariats", entity: "par_certification", entityId: id, detail: {}, ts: FieldValue.serverTimestamp() });
    return { ok: true, id };
  });

  // Édite l'overlay de rapprochement fournisseur → partenaire (config/parPartnerMap, patron
  // config/clientAliases). Clés NORMALISÉES en MAJUSCULES (comme la résolution de CA), valeurs = partnerId
  // en slug. Écriture Admin SDK (rules write:false). Déclenche un recompute scopé pour rafraîchir le CA.
  const setParPartnerMap = onCallG("setParPartnerMap", { memoryMiB: 256, timeoutSeconds: 60 }, async (req) => {
    await requireWrite(req, "partenariats");
    await assertParEnabled();
    const raw = (req.data && req.data.map) || {};
    if (typeof raw !== "object" || Array.isArray(raw)) throw new HttpsError("invalid-argument", "table de correspondance invalide");
    const map = {};
    for (const [k, val] of Object.entries(raw)) {
      const key = String(k || "").trim().toUpperCase();
      const partnerId = slug(val);
      if (key && partnerId) map[key] = partnerId; // paires incomplètes ignorées (pas de coercion silencieuse d'erreur)
    }
    await db.doc("config/parPartnerMap").set({ map, updatedBy: req.auth.uid, updatedAt: FieldValue.serverTimestamp() }, { merge: false });
    await db.collection("auditLog").add({ uid: req.auth.uid, action: "set_par_partner_map", module: "partenariats", entity: "config", entityId: "parPartnerMap", detail: { entries: Object.keys(map).length }, ts: FieldValue.serverTimestamp() });
    await requestRecompute(["partenariats"]); // rafraîchit summaries/par_ca (nouveau mapping)
    return { ok: true, entries: Object.keys(map).length };
  });

  // Crée/met à jour une assignation (idempotent : id = <consultantId>_<catalogId>, une assignation active
  // par consultant × certif). Valide l'existence du consultant (ADR-P03) et de l'entrée de catalogue ;
  // dénormalise NOM du consultant + son manager (relance) + libellé de certif — jamais le CJM.
  const upsertParAssignment = onCallG("upsertParAssignment", { memoryMiB: 256, timeoutSeconds: 60 }, async (req) => {
    await requireWrite(req, "partenariats");
    await assertParEnabled();
    const v = validateAssignment(req.data);
    if (!v.ok) throw new HttpsError("invalid-argument", v.error);
    const { consultantId, partnerId, certificationCatalogId } = v.value;
    const consSnap = await db.doc(`consultants/${consultantId}`).get();
    if (!consSnap.exists) throw new HttpsError("failed-precondition", "consultant inconnu (annuaire ESN)");
    const cons = consSnap.data() || {};
    const partSnap = await db.doc(`par_partners/${partnerId}`).get();
    if (!partSnap.exists) throw new HttpsError("failed-precondition", "partenaire inconnu (référentiel)");
    const entry = ((partSnap.data() || {}).certificationCatalog || []).find((e) => e.id === certificationCatalogId);
    if (!entry) throw new HttpsError("failed-precondition", "certification absente du catalogue du partenaire");

    const id = `${slug(consultantId) || consultantId}_${certificationCatalogId}`;
    const ref = db.doc(`par_assignments/${id}`);
    const exists = (await ref.get()).exists;
    const doc = {
      ...v.value,
      // manager par défaut = manager du consultant (destinataire des relances) si non fourni.
      managerUid: v.value.managerUid || (cons.managerUid ? String(cons.managerUid).slice(0, 128) : null),
      consultantName: String(cons.name || "").slice(0, 120), consultantBu: String(cons.bu || "").slice(0, 40),
      cert: entry.code || entry.name || certificationCatalogId, competencyId: entry.competencyId,
      updatedAt: FieldValue.serverTimestamp(),
    };
    if (exists) await ref.set(doc, { merge: true });
    else await ref.set({ ...doc, createdBy: req.auth.uid, createdAt: FieldValue.serverTimestamp() });
    await db.collection("auditLog").add({ uid: req.auth.uid, action: exists ? "update_par_assignment" : "create_par_assignment", module: "partenariats", entity: "par_assignment", entityId: id, detail: { consultantId, partnerId, certificationCatalogId, status: v.value.status, targetDate: v.value.targetDate }, ts: FieldValue.serverTimestamp() });
    await requestRecompute(["partenariats"]); // rafraîchit summaries/par_relances
    return { ok: true, id };
  });

  // Change le statut d'une assignation (planifie → en_formation → obtenu, etc.). Réservé écriture + drapeau.
  const setParAssignmentStatus = onCallG("setParAssignmentStatus", { memoryMiB: 256, timeoutSeconds: 60 }, async (req) => {
    await requireWrite(req, "partenariats");
    await assertParEnabled();
    const id = String(req.data && req.data.id || "").trim().slice(0, 200);
    const status = String(req.data && req.data.status || "").trim();
    if (!id) throw new HttpsError("invalid-argument", "id d'assignation invalide");
    if (!ASSIGNMENT_STATUSES.includes(status)) throw new HttpsError("invalid-argument", "statut d'assignation invalide");
    const ref = db.doc(`par_assignments/${id}`);
    if (!(await ref.get()).exists) throw new HttpsError("failed-precondition", "assignation inconnue");
    await ref.set({ status, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    await db.collection("auditLog").add({ uid: req.auth.uid, action: "set_par_assignment_status", module: "partenariats", entity: "par_assignment", entityId: id, detail: { status }, ts: FieldValue.serverTimestamp() });
    await requestRecompute(["partenariats"]);
    return { ok: true, id, status };
  });

  // Supprime une assignation. Réservé écriture + drapeau. Idempotent.
  const deleteParAssignment = onCallG("deleteParAssignment", { memoryMiB: 256, timeoutSeconds: 60 }, async (req) => {
    await requireWrite(req, "partenariats");
    await assertParEnabled();
    const id = String(req.data && req.data.id || "").trim().slice(0, 200);
    if (!id) throw new HttpsError("invalid-argument", "id d'assignation invalide");
    await db.doc(`par_assignments/${id}`).delete().catch(() => {});
    await db.collection("auditLog").add({ uid: req.auth.uid, action: "delete_par_assignment", module: "partenariats", entity: "par_assignment", entityId: id, detail: {}, ts: FieldValue.serverTimestamp() });
    await requestRecompute(["partenariats"]);
    return { ok: true, id };
  });

  // Le CA constructeur (volume d'achat fournisseur, summaries/par_ca) est CONFIDENTIEL — même cloisonnement
  // que la marge : droit `rentabilite` requis (ADR-P07), aligné sur le second verrou des rules. Sans ce
  // droit, l'IA raisonne quand même sur les certifs/quotas/relances mais le CA est MASQUÉ du snapshot
  // (jamais transmis au modèle ni renvoyé au client) → aucune fuite via le plan d'action ou la QBR.
  async function parCanSeeCa(req) {
    const role = req.auth && req.auth.token && req.auth.token.nt360Role;
    if (role === "direction") return true;
    const { canRead } = require("../domain/authz");
    const matrix = ((await db.doc("config/permissions").get()).data() || {}).matrix || {};
    return canRead(matrix, role, "rentabilite");
  }

  // Pousse (ou met à jour, idempotent) une assignation de certification en TÂCHE ClickUp, dans la liste
  // DÉDIÉE config/clickup.parListId (ADR-P10) — jamais le board commandes. Réutilise le client ClickUp
  // existant + le secret CLICKUP_TOKEN. Lien taskId/url stocké sur l'assignation → ré-appui = mise à jour,
  // pas de doublon. Réservé écriture `partenariats` + drapeau. Inactif si parListId non renseigné.
  const pushParAssignmentToClickup = onCallG("pushParAssignmentToClickup", { secrets: CLICKUP_TOKEN ? [CLICKUP_TOKEN] : [], memoryMiB: 256, timeoutSeconds: 60 }, async (req) => {
    await requireWrite(req, "partenariats");
    await assertParEnabled();
    if (rateLimit && !(await rateLimit(req.auth.uid, "clickup", 30, 60_000))) throw new HttpsError("resource-exhausted", "Trop de synchronisations ClickUp en peu de temps — patientez un instant.");
    const id = String(req.data && req.data.id || "").trim().slice(0, 200);
    if (!id) throw new HttpsError("invalid-argument", "id d'assignation invalide");
    const cu = (await db.doc("config/clickup").get()).data() || {};
    if (cu.enabled === false) throw new HttpsError("failed-precondition", "Intégration ClickUp désactivée.");
    const listId = String(cu.parListId || "").trim();
    if (!listId) throw new HttpsError("failed-precondition", "Liste ClickUp des certifications non configurée (Habilitations → ClickUp).");
    const token = CLICKUP_TOKEN && CLICKUP_TOKEN.value();
    if (!token) throw new HttpsError("failed-precondition", "CLICKUP_TOKEN non configuré (Secret Manager).");
    const ref = db.doc(`par_assignments/${id}`);
    const snap = await ref.get();
    if (!snap.exists) throw new HttpsError("failed-precondition", "assignation inconnue");
    const a = snap.data() || {};
    const clickup = require("../lib/clickup");
    const { parAssignmentTaskPayload } = require("../domain/parClickup");
    const payload = parAssignmentTaskPayload(a);
    let taskId = a.clickupTaskId, url = a.clickupUrl, created = false;
    try {
      if (taskId) { await clickup.updateTask(token, taskId, payload); }
      else { const t = await clickup.createTask(token, listId, payload); taskId = t.id; url = t.url; created = true; }
    } catch (e) { throw new HttpsError("unavailable", "ClickUp n'a pas répondu (réessayez)."); }
    await ref.set({ clickupTaskId: taskId, clickupUrl: url || null, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    await db.collection("auditLog").add({ uid: req.auth.uid, action: created ? "push_par_assignment_clickup" : "update_par_assignment_clickup", module: "partenariats", entity: "par_assignment", entityId: id, detail: { taskId }, ts: FieldValue.serverTimestamp() });
    if (logOps) await logOps({ kind: "clickup", action: "parAssignmentPush", status: "ok", uid: req.auth.uid, detail: { id, taskId, created } });
    return { ok: true, taskId, url: url || null, created };
  });

  // Garde-fou IA commun : droit lecture + drapeau + rate-limit + clé présente. Renvoie la clé.
  async function assertAiReady(req) {
    await requireRead(req, "partenariats");
    await assertParEnabled();
    if (rateLimit && !(await rateLimit(req.auth.uid, "ai", 20, 60_000))) throw new HttpsError("resource-exhausted", "Trop de générations IA en peu de temps — patientez un instant.");
    const apiKey = ANTHROPIC_API_KEY && ANTHROPIC_API_KEY.value();
    if (!apiKey) throw new HttpsError("failed-precondition", "ANTHROPIC_API_KEY non configuré (Secret Manager) — assistant IA indisponible.");
    return apiKey;
  }

  // PLAN D'ACTION BUSINESS (IA). Snapshot construit CÔTÉ SERVEUR à partir des summaries par_* (aucune
  // donnée confidentielle : statuts, quotas, CA agrégé par constructeur). Sortie re-validée (domain/parAi).
  const generateParActionPlan = onCallG("generateParActionPlan", { secrets: ANTHROPIC_API_KEY ? [ANTHROPIC_API_KEY] : [], memoryMiB: 512, timeoutSeconds: 300 }, async (req) => {
    const apiKey = await assertAiReady(req);
    const seeCa = await parCanSeeCa(req); // CA masqué sans droit `rentabilite` (ADR-P07)
    const { actionPlanSnapshot } = require("../domain/parAi");
    const [caSnap, quotaSnap, relSnap] = await Promise.all([
      db.doc("summaries/par_ca").get(), db.doc("summaries/par_quotas").get(), db.doc("summaries/par_relances").get(),
    ]);
    const snapshot = actionPlanSnapshot({ dateIso: new Date().toISOString().slice(0, 10), ca: seeCa ? (caSnap.data() || {}) : {}, quotas: quotaSnap.data() || {}, relances: relSnap.data() || {} });
    if (!snapshot.partners.length) throw new HttpsError("failed-precondition", "aucune donnée partenaire à analyser (initialisez le référentiel).");
    const { generateActionPlan } = require("../lib/parAi");
    let out;
    try { out = await generateActionPlan(apiKey, snapshot); }
    catch (e) { if (e && e.code === "ai_refusal") throw new HttpsError("failed-precondition", "Le modèle a refusé de traiter la demande."); throw new HttpsError("internal", "L'assistant IA n'a pas pu produire de plan (réessayez)."); }
    if (logOps) await logOps({ kind: "ai", action: "parActionPlan", status: "ok", uid: req.auth.uid, detail: { partenaires: snapshot.partners.length, items: out.plan.length, model: out.model, usage: out.usage } });
    return { ok: true, plan: out.plan, model: out.model };
  });

  // SYNTHÈSE QBR par partenaire (IA). Snapshot construit côté serveur (référentiel + summaries + certifs).
  const generateParQbr = onCallG("generateParQbr", { secrets: ANTHROPIC_API_KEY ? [ANTHROPIC_API_KEY] : [], memoryMiB: 512, timeoutSeconds: 300 }, async (req) => {
    const apiKey = await assertAiReady(req);
    const seeCa = await parCanSeeCa(req); // CA masqué sans droit `rentabilite` (ADR-P07)
    const partnerId = slug(req.data && req.data.partnerId);
    if (!partnerId) throw new HttpsError("invalid-argument", "partenaire invalide");
    const periode = String((req.data && req.data.periode) || "").trim().slice(0, 40);
    const partSnap = await db.doc(`par_partners/${partnerId}`).get();
    if (!partSnap.exists) throw new HttpsError("failed-precondition", "partenaire inconnu (référentiel)");
    const { MAX_SCAN, sliceCapped } = require("../domain/scan");
    const [caSnap, quotaSnap, relSnap, certSnap] = await Promise.all([
      db.doc("summaries/par_ca").get(), db.doc("summaries/par_quotas").get(), db.doc("summaries/par_relances").get(),
      db.collection("par_certifications").where("partnerId", "==", partnerId).limit(MAX_SCAN + 1).get(),
    ]);
    const certifs = sliceCapped(certSnap.docs).docs.map((d) => ({ id: d.id, ...d.data() }));
    // Le statut persisté d'une certif est un cache figé à l'écriture ; on le RE-DÉRIVE ici (même fonction
    // pure que le recompute, cf. aggregate.js) avant de bâtir la QBR, pour que « certifications actives »
    // reflète le temps écoulé — une certif écrite « active » a pu expirer depuis. Statut « à date » cohérent.
    const qbrToday = new Date().toISOString().slice(0, 10);
    for (const c of certifs) c.status = computeCertStatus(c.expiryDate, qbrToday);
    const { qbrSnapshot } = require("../domain/parAi");
    const snapshot = qbrSnapshot({ partnerId, partner: partSnap.data() || {}, periode, ca: seeCa ? (caSnap.data() || {}) : {}, quotas: quotaSnap.data() || {}, certifs, relances: relSnap.data() || {} });
    const { generateQbr } = require("../lib/parAi");
    let out;
    try { out = await generateQbr(apiKey, snapshot); }
    catch (e) { if (e && e.code === "ai_refusal") throw new HttpsError("failed-precondition", "Le modèle a refusé de traiter la demande."); throw new HttpsError("internal", "L'assistant IA n'a pas pu produire de synthèse (réessayez)."); }
    if (logOps) await logOps({ kind: "ai", action: "parQbr", status: "ok", uid: req.auth.uid, detail: { partnerId, model: out.model, usage: out.usage } });
    return { ok: true, qbr: out.qbr, snapshot, model: out.model };
  });

  return { upsertParPartner, deleteParPartner, upsertParCertification, deleteParCertification, setParPartnerMap, upsertParAssignment, setParAssignmentStatus, deleteParAssignment, pushParAssignmentToClickup, generateParActionPlan, generateParQbr };
}

module.exports = { createPartenariats };
