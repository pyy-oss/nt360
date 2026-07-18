// HANDLER — Partenariats & Certifications (par_). Lot 1 : référentiel partenaire (par_partners) —
// partenaire + niveaux + compétences + catalogue de certifs + exigences de quota, structures EMBARQUÉES.
// Même patron que le module maintenance (extraction hors index.js, injection). Collections par_*
// callable-only (rules read = drapeau + droit `partenariats`, write:false). DOUBLE garde à l'écriture :
// requireWrite + drapeau config/parFeature ALLUMÉ (ADR-P01). Exports déclarés dans index.js.
const { slug, validatePartner, computeExpiry } = require("../domain/parPartner");
const { validateCertification, computeCertStatus } = require("../domain/parCertification");
const { isParEnabled } = require("../domain/parFeature");

function createPartenariats({ onCallG, HttpsError, db, FieldValue, requireWrite, requestRecompute }) {
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

  return { upsertParPartner, deleteParPartner, upsertParCertification, deleteParCertification, setParPartnerMap };
}

module.exports = { createPartenariats };
