// HANDLER — Contrats de maintenance (mnt_). Lot 1 : contrat + engagements SLA embarqués. Lot 2 :
// tickets + interventions, avec ALIMENTATION DU CRA existant (timesheets) — une seule vérité du temps.
// Extraction hors du monolithe index.js (patron R3, injection). Collections mnt_* callable-only (rules
// read = drapeau + droit `maintenance`, write:false). DOUBLE garde à l'écriture : requireWrite +
// drapeau config/mntFeature ALLUMÉ (ADR-009). Exports déclarés dans index.js (déploiement par nom).
const { safeId } = require("../lib/sheets");
const { isMntEnabled } = require("../domain/mntFeature");
const { MAX_SCAN, sliceCapped } = require("../domain/scan");
const { monthOf, craDaysFromHours } = require("../domain/mntTicket");

function createMaintenance({ onCallG, HttpsError, db, FieldValue, requireWrite, assertPlainId }) {
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
    return { ok: true, id };
  });

  const deleteMntContrat = onCallG("deleteMntContrat", { memoryMiB: 256, timeoutSeconds: 60 }, async (req) => {
    await requireWrite(req, "maintenance");
    await assertMntEnabled();
    const id = assertPlainId(req.data?.id, "id contrat");
    await db.doc(`mnt_contrats/${id}`).delete();
    await db.collection("auditLog").add({ uid: req.auth.uid, action: "delete_mnt_contrat", module: "maintenance", entity: "mnt_contrat", entityId: id, ts: FieldValue.serverTimestamp() });
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
    if (id) { await db.doc(`mnt_tickets/${id}`).set(doc, { merge: true }); }
    else { const ref = await db.collection("mnt_tickets").add({ ...doc, ouvertLe: FieldValue.serverTimestamp(), createdBy: req.auth.uid }); id = ref.id; }
    await db.collection("auditLog").add({ uid: req.auth.uid, action: id ? "upsert_mnt_ticket" : "create_mnt_ticket", module: "maintenance", entity: "mnt_ticket", entityId: id, detail: { contratId: v.value.contratId, statut: v.value.statut, priorite: v.value.priorite }, ts: FieldValue.serverTimestamp() });
    return { ok: true, id };
  });

  const deleteMntTicket = onCallG("deleteMntTicket", { memoryMiB: 256, timeoutSeconds: 60 }, async (req) => {
    await requireWrite(req, "maintenance");
    await assertMntEnabled();
    const id = assertPlainId(req.data?.id, "id ticket");
    await db.doc(`mnt_tickets/${id}`).delete();
    await db.collection("auditLog").add({ uid: req.auth.uid, action: "delete_mnt_ticket", module: "maintenance", entity: "mnt_ticket", entityId: id, ts: FieldValue.serverTimestamp() });
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

  return { upsertMntContrat, deleteMntContrat, upsertMntTicket, deleteMntTicket, upsertMntIntervention, deleteMntIntervention };
}

module.exports = { createMaintenance };
