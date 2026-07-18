// HANDLER — Partenariats & Certifications (par_). Lot 1 : référentiel partenaire (par_partners) —
// partenaire + niveaux + compétences + catalogue de certifs + exigences de quota, structures EMBARQUÉES.
// Même patron que le module maintenance (extraction hors index.js, injection). Collections par_*
// callable-only (rules read = drapeau + droit `partenariats`, write:false). DOUBLE garde à l'écriture :
// requireWrite + drapeau config/parFeature ALLUMÉ (ADR-P01). Exports déclarés dans index.js.
const { slug, validatePartner } = require("../domain/parPartner");
const { isParEnabled } = require("../domain/parFeature");

function createPartenariats({ onCallG, HttpsError, db, FieldValue, requireWrite }) {
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
    return { ok: true, id };
  });

  return { upsertParPartner, deleteParPartner };
}

module.exports = { createPartenariats };
