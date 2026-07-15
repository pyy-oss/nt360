// HANDLER — Contrats de maintenance (mnt_), Lot 1 : contrat + engagements SLA embarqués.
// Extraction hors du monolithe index.js (patron R3, injection de dépendances). mnt_contrats est
// callable-only (rules read = drapeau + droit `maintenance`, write:false). DOUBLE garde à l'écriture :
// requireWrite('maintenance') ET drapeau config/mntFeature ALLUMÉ (ADR-009) — module éteint ⇒ refus.
// Exports déclarés dans index.js (garde de déploiement par nom).
const { safeId } = require("../lib/sheets");
const { isMntEnabled } = require("../domain/mntFeature");

function createMaintenance({ onCallG, HttpsError, db, FieldValue, requireWrite, assertPlainId }) {
  // Le module doit être ALLUMÉ pour toute écriture. Sans ça, aucune donnée mnt_* ne se crée : l'ERP
  // reste strictement celui d'avant même si un rôle porte le droit `maintenance`.
  async function assertMntEnabled() {
    const cfg = (await db.doc("config/mntFeature").get()).data();
    if (!isMntEnabled(cfg)) throw new HttpsError("failed-precondition", "module Contrats de maintenance désactivé");
  }

  const upsertMntContrat = onCallG("upsertMntContrat", { memoryMiB: 256, timeoutSeconds: 60 }, async (req) => {
    await requireWrite(req, "maintenance");
    await assertMntEnabled();
    const { validateMntContrat } = require("../domain/mntContrat");
    const v = validateMntContrat(req.data);
    if (!v.ok) throw new HttpsError("invalid-argument", v.error);
    // 1 contrat = 1 affaire (ADR-001) : l'id du document dérive du N° FP canonique (idempotent).
    const id = safeId(v.value.fp);
    const ref = db.doc(`mnt_contrats/${id}`);
    const exists = (await ref.get()).exists;
    const doc = { ...v.value, updatedAt: FieldValue.serverTimestamp() };
    if (exists) await ref.set(doc, { merge: true });
    else await ref.set({ ...doc, createdBy: req.auth.uid, createdAt: FieldValue.serverTimestamp() });
    await db.collection("auditLog").add({
      uid: req.auth.uid, action: exists ? "update_mnt_contrat" : "create_mnt_contrat", module: "maintenance",
      entity: "mnt_contrat", entityId: id, detail: { fp: v.value.fp, statut: v.value.statut, montantEngage: v.value.montantEngage }, ts: FieldValue.serverTimestamp(),
    });
    return { ok: true, id };
  });

  const deleteMntContrat = onCallG("deleteMntContrat", { memoryMiB: 256, timeoutSeconds: 60 }, async (req) => {
    await requireWrite(req, "maintenance");
    await assertMntEnabled();
    const id = assertPlainId(req.data?.id, "id contrat");
    await db.doc(`mnt_contrats/${id}`).delete();
    await db.collection("auditLog").add({
      uid: req.auth.uid, action: "delete_mnt_contrat", module: "maintenance", entity: "mnt_contrat", entityId: id, ts: FieldValue.serverTimestamp(),
    });
    return { ok: true };
  });

  return { upsertMntContrat, deleteMntContrat };
}

module.exports = { createMaintenance };
