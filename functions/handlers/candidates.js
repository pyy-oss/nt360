// HANDLER — Vivier / recrutement (Lot 16) : extraction hors du monolithe index.js (patron R3). Pipeline
// de candidats (candidates/*) rattaché au gap de capacité ; écriture « pipeline », lecture « overview ».
// Fabrique `createCandidates(deps)` à injection : les deps d'infra/RBAC d'index.js sont injectées ; les
// helpers PURS (scan borné, domaine candidat) sont requis directement. Exports déclarés dans index.js
// (garde-fou de déploiement par nom). Comportement identique à l'inline d'origine.
const { MAX_SCAN, sliceCapped } = require("../domain/scan");

function createCandidates({ onCallG, HttpsError, db, FieldValue, requireWrite, requireRead, assertPlainId }) {
  const upsertCandidate = onCallG("upsertCandidate", { memoryMiB: 256, timeoutSeconds: 60 }, async (req) => {
    await requireWrite(req, "pipeline");
    const { validateCandidate } = require("../domain/candidate");
    const v = validateCandidate(req.data);
    if (!v.ok) throw new HttpsError("invalid-argument", v.error);
    const doc = { ...v.value, updatedAt: FieldValue.serverTimestamp() };
    let id = req.data?.id ? assertPlainId(req.data.id, "id candidat") : null;
    if (id) { await db.doc(`candidates/${id}`).set(doc, { merge: true }); }
    else { const ref = await db.collection("candidates").add({ ...doc, createdBy: req.auth.uid, createdAt: FieldValue.serverTimestamp() }); id = ref.id; }
    await db.collection("auditLog").add({ uid: req.auth.uid, action: "upsert_candidate", module: "pipeline", entity: "candidate", entityId: id, detail: { name: v.value.name, status: v.value.status, bu: v.value.bu }, ts: FieldValue.serverTimestamp() });
    return { ok: true, id };
  });

  const deleteCandidate = onCallG("deleteCandidate", { memoryMiB: 256, timeoutSeconds: 60 }, async (req) => {
    await requireWrite(req, "pipeline");
    const id = assertPlainId(req.data?.id, "id candidat");
    await db.doc(`candidates/${id}`).delete();
    await db.collection("auditLog").add({ uid: req.auth.uid, action: "delete_candidate", module: "pipeline", entity: "candidate", entityId: id, ts: FieldValue.serverTimestamp() });
    return { ok: true };
  });

  const listCandidates = onCallG("listCandidates", { memoryMiB: 256, timeoutSeconds: 60 }, async (req) => {
    await requireRead(req, "overview");
    const { recruitmentFunnel } = require("../domain/candidate");
    const snap = await db.collection("candidates").limit(MAX_SCAN + 1).get(); // scan borné (R1)
    const rows = sliceCapped(snap.docs).docs.map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
    const funnel = recruitmentFunnel(rows);
    return { ok: true, rows, ...funnel };
  });

  return { upsertCandidate, deleteCandidate, listCandidates };
}

module.exports = { createCandidates };
