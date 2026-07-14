// HANDLER — Consultants (Lot 11) + Plan de charge / staffing (Lot 12) : extraction hors du monolithe
// index.js (patron R3). consultants/* et assignments/* callable-only (rules read:false+write:false).
// Écriture « pipeline », lecture « overview » ; le COÛT (CJM) est CONFIDENTIEL → masqué sauf droit
// « rentabilite ». Fabrique `createStaffing(deps)` à injection ; helpers PURS requis directement.
// Exports déclarés dans index.js (garde-fou de déploiement par nom). Comportement identique.
const { MAX_SCAN, sliceCapped } = require("../domain/scan");

function createStaffing({ onCallG, HttpsError, db, FieldValue, requireWrite, requireRead, assertPlainId }) {
  const upsertConsultant = onCallG("upsertConsultant", { memoryMiB: 256, timeoutSeconds: 60 }, async (req) => {
    await requireWrite(req, "pipeline");
    const { validateConsultant } = require("../domain/consultant");
    const v = validateConsultant(req.data);
    if (!v.ok) throw new HttpsError("invalid-argument", v.error);
    const doc = { ...v.value, updatedAt: FieldValue.serverTimestamp() };
    let id = req.data?.id ? assertPlainId(req.data.id, "id consultant") : null;
    if (id) { await db.doc(`consultants/${id}`).set(doc, { merge: true }); }
    else { const ref = await db.collection("consultants").add({ ...doc, createdBy: req.auth.uid, createdAt: FieldValue.serverTimestamp() }); id = ref.id; }
    await db.collection("auditLog").add({ uid: req.auth.uid, action: "upsert_consultant", module: "pipeline", entity: "consultant", entityId: id, detail: { name: v.value.name, status: v.value.status }, ts: FieldValue.serverTimestamp() });
    return { ok: true, id };
  });

  const deleteConsultant = onCallG("deleteConsultant", { memoryMiB: 256, timeoutSeconds: 60 }, async (req) => {
    await requireWrite(req, "pipeline");
    const id = assertPlainId(req.data?.id, "id consultant");
    await db.doc(`consultants/${id}`).delete();
    await db.collection("auditLog").add({ uid: req.auth.uid, action: "delete_consultant", module: "pipeline", entity: "consultant", entityId: id, ts: FieldValue.serverTimestamp() });
    return { ok: true };
  });

  const listConsultants = onCallG("listConsultants", { memoryMiB: 256, timeoutSeconds: 60 }, async (req) => {
    await requireRead(req, "overview");
    const { stripConfidential } = require("../domain/consultant");
    const { canRead } = require("../domain/authz");
    const role = req.auth.token?.nt360Role;
    const matrix = ((await db.doc("config/permissions").get()).data() || {}).matrix || {};
    const canCost = canRead(matrix, role, "rentabilite"); // le coût (CJM) suit la confidentialité de marge
    const snap = await db.collection("consultants").limit(MAX_SCAN + 1).get(); // scan borné (R1)
    const rows = sliceCapped(snap.docs).docs
      .map((d) => stripConfidential({ id: d.id, ...d.data() }, canCost))
      .sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
    return { ok: true, rows, canCost };
  });

  const upsertAssignment = onCallG("upsertAssignment", { memoryMiB: 256, timeoutSeconds: 60 }, async (req) => {
    await requireWrite(req, "pipeline");
    const { validateAssignment } = require("../domain/assignment");
    const v = validateAssignment(req.data);
    if (!v.ok) throw new HttpsError("invalid-argument", v.error);
    const doc = { ...v.value, updatedAt: FieldValue.serverTimestamp() };
    let id = req.data?.id ? assertPlainId(req.data.id, "id affectation") : null;
    if (id) { await db.doc(`assignments/${id}`).set(doc, { merge: true }); }
    else { const ref = await db.collection("assignments").add({ ...doc, createdBy: req.auth.uid, createdAt: FieldValue.serverTimestamp() }); id = ref.id; }
    await db.collection("auditLog").add({ uid: req.auth.uid, action: "upsert_assignment", module: "pipeline", entity: "assignment", entityId: id, detail: { consultantId: v.value.consultantId, startMonth: v.value.startMonth, allocationPct: v.value.allocationPct }, ts: FieldValue.serverTimestamp() });
    return { ok: true, id };
  });

  const deleteAssignment = onCallG("deleteAssignment", { memoryMiB: 256, timeoutSeconds: 60 }, async (req) => {
    await requireWrite(req, "pipeline");
    const id = assertPlainId(req.data?.id, "id affectation");
    await db.doc(`assignments/${id}`).delete();
    await db.collection("auditLog").add({ uid: req.auth.uid, action: "delete_assignment", module: "pipeline", entity: "assignment", entityId: id, ts: FieldValue.serverTimestamp() });
    return { ok: true };
  });

  const staffingPlan = onCallG("staffingPlan", { memoryMiB: 256, timeoutSeconds: 60 }, async (req) => {
    await requireRead(req, "overview");
    const { monthsRange, buildLoad } = require("../domain/assignment");
    // Plage de mois : à partir du mois demandé (ou courant), sur N mois (défaut 6, borné 1..18).
    const now = new Date();
    const curYm = req.data?.fromMonth && /^\d{4}-\d{2}$/.test(req.data.fromMonth)
      ? req.data.fromMonth : `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const span = Math.min(18, Math.max(1, Number(req.data?.months) || 6));
    let [ey, em] = curYm.split("-").map(Number); em += span - 1; while (em > 12) { em -= 12; ey += 1; }
    const months = monthsRange(curYm, `${ey}-${String(em).padStart(2, "0")}`);
    const [cSnap, aSnap] = await Promise.all([
      db.collection("consultants").select("name", "status", "bu").limit(MAX_SCAN + 1).get(),
      db.collection("assignments").limit(MAX_SCAN + 1).get(),
    ]);
    const consultants = sliceCapped(cSnap.docs).docs.map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
    const assignments = sliceCapped(aSnap.docs).docs.map((d) => ({ id: d.id, ...d.data() }));
    const activeIds = consultants.filter((c) => (c.status || "active") === "active").map((c) => c.id);
    const { byConsultant, flags } = buildLoad(assignments, months, activeIds);
    return { ok: true, months, consultants: consultants.map((c) => ({ id: c.id, name: c.name || null, status: c.status || "active", bu: c.bu || null })), assignments, byConsultant, flags };
  });

  return { upsertConsultant, deleteConsultant, listConsultants, upsertAssignment, deleteAssignment, staffingPlan };
}

module.exports = { createStaffing };
