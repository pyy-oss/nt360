// HANDLER — Consultants (Lot 11) + Plan de charge / staffing (Lot 12) : extraction hors du monolithe
// index.js (patron R3). consultants/* et assignments/* callable-only (rules read:false+write:false).
// Écriture « pipeline », lecture « overview » ; le COÛT (CJM) est CONFIDENTIEL → masqué sauf droit
// « rentabilite ». Fabrique `createStaffing(deps)` à injection ; helpers PURS requis directement.
// Exports déclarés dans index.js (garde-fou de déploiement par nom). Comportement identique.
const { MAX_SCAN, sliceCapped } = require("../domain/scan");

function createStaffing({ onCallG, HttpsError, db, FieldValue, requireWrite, requireRead, assertPlainId, recomputeNow, logOps }) {
  // ── Pont vers le module Partenariats (par_, gaté drapeau config/parFeature). Les certifs/assignations
  // DÉNORMALISENT nom/BU/grade du consultant (+ managerUid destinataire des relances) pour s'afficher sous
  // le seul droit `partenariats` : une fiche renommée ou supprimée doit se PROPAGER, sinon les vues
  // partenariats montrent un nom périmé ou des lignes orphelines (audit partenariats, cycle de vie).
  // Drapeau ÉTEINT ⇒ no-op strict (aucune lecture/écriture par_ : l'ERP reste celui d'avant). BEST-EFFORT :
  // la mutation consultant est DÉJÀ écrite — un échec de propagation est tracé (logOps), jamais remonté.
  async function parEnabled() {
    const { isParEnabled } = require("../domain/parFeature");
    return isParEnabled((await db.doc("config/parFeature").get()).data());
  }
  const refreshPar = async (action) => {
    try { if (recomputeNow) await recomputeNow(["partenariats"]); }
    catch (e) { if (logOps) await logOps({ kind: "recompute", action, status: "error", error: (e && e.message) || String(e) }); }
  };
  // Réécrit les dénormalisations par_ du consultant — MÊMES champs que upsertParCertification (nom/BU/grade
  // + managerUid) et upsertParAssignment (nom/BU ; managerUid non touché : il peut y être saisi à la main).
  async function syncParDenorm(id, cons) {
    const [certSnap, assignSnap] = await Promise.all([
      db.collection("par_certifications").where("consultantId", "==", id).limit(200).get(),
      db.collection("par_assignments").where("consultantId", "==", id).limit(200).get(),
    ]);
    if (certSnap.empty && assignSnap.empty) return 0;
    const name = String(cons.name || "").slice(0, 120), bu = String(cons.bu || "").slice(0, 40), grade = String(cons.grade || "").slice(0, 40);
    const managerUid = cons.managerUid ? String(cons.managerUid).slice(0, 128) : null;
    const batch = db.batch();
    for (const d of certSnap.docs) batch.set(d.ref, { consultantName: name, consultantBu: bu, consultantGrade: grade, managerUid, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    for (const d of assignSnap.docs) batch.set(d.ref, { consultantName: name, consultantBu: bu, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    await batch.commit();
    return certSnap.size + assignSnap.size;
  }
  // Supprime les certifs/assignations du consultant supprimé — sans cascade elles resteraient comptées
  // dans quotas/relances au nom d'une personne qui n'existe plus dans l'annuaire.
  async function cascadeParDelete(id) {
    const [certSnap, assignSnap] = await Promise.all([
      db.collection("par_certifications").where("consultantId", "==", id).limit(200).get(),
      db.collection("par_assignments").where("consultantId", "==", id).limit(200).get(),
    ]);
    if (certSnap.empty && assignSnap.empty) return { certs: 0, assigns: 0 };
    const batch = db.batch();
    for (const d of certSnap.docs) batch.delete(d.ref);
    for (const d of assignSnap.docs) batch.delete(d.ref);
    await batch.commit();
    return { certs: certSnap.size, assigns: assignSnap.size };
  }

  const upsertConsultant = onCallG("upsertConsultant", { memoryMiB: 256, timeoutSeconds: 60 }, async (req) => {
    await requireWrite(req, "pipeline");
    const { validateConsultant } = require("../domain/consultant");
    const v = validateConsultant(req.data);
    if (!v.ok) throw new HttpsError("invalid-argument", v.error);
    const doc = { ...v.value, updatedAt: FieldValue.serverTimestamp() };
    let id = req.data?.id ? assertPlainId(req.data.id, "id consultant") : null;
    let parChanged = false;
    if (id) {
      // Lecture AVANT écriture : ne propager vers par_ que si un champ dénormalisé a réellement changé.
      const before = (await db.doc(`consultants/${id}`).get()).data() || {};
      await db.doc(`consultants/${id}`).set(doc, { merge: true });
      parChanged = ["name", "bu", "grade", "managerUid"].some((k) => (before[k] ?? null) !== (v.value[k] ?? null));
      // CJM modifié (audit rentabilité M3) : preBilling / mnt_risque / P&L ressource en dérivent — sans
      // recompute, le palier de risque marge des contrats reste faux jusqu'au nocturne. Best-effort.
      if ((before.cjm ?? null) !== (v.value.cjm ?? null)) {
        try { if (recomputeNow) await recomputeNow(["prebilling", "maintenance"]); }
        catch (e) { if (logOps) await logOps({ kind: "recompute", trigger: "upsertConsultant.cjm", status: "error", error: (e && e.message) || String(e) }); }
      }
    }
    else { const ref = await db.collection("consultants").add({ ...doc, createdBy: req.auth.uid, createdAt: FieldValue.serverTimestamp() }); id = ref.id; }
    await db.collection("auditLog").add({ uid: req.auth.uid, action: "upsert_consultant", module: "pipeline", entity: "consultant", entityId: id, detail: { name: v.value.name, status: v.value.status }, ts: FieldValue.serverTimestamp() });
    if (parChanged) {
      try { if (await parEnabled()) { const n = await syncParDenorm(id, v.value); if (n) await refreshPar("upsertConsultant"); } }
      catch (e) { if (logOps) await logOps({ kind: "partenariats", action: "upsertConsultantParSync", status: "error", error: (e && e.message) || String(e) }); }
    }
    return { ok: true, id };
  });

  const deleteConsultant = onCallG("deleteConsultant", { memoryMiB: 256, timeoutSeconds: 60 }, async (req) => {
    await requireWrite(req, "pipeline");
    const id = assertPlainId(req.data?.id, "id consultant");
    await db.doc(`consultants/${id}`).delete();
    let cascade = { certs: 0, assigns: 0 };
    try { if (await parEnabled()) { cascade = await cascadeParDelete(id); if (cascade.certs + cascade.assigns) await refreshPar("deleteConsultant"); } }
    catch (e) { if (logOps) await logOps({ kind: "partenariats", action: "deleteConsultantParCascade", status: "error", error: (e && e.message) || String(e) }); }
    await db.collection("auditLog").add({ uid: req.auth.uid, action: "delete_consultant", module: "pipeline", entity: "consultant", entityId: id, detail: { parCertifs: cascade.certs, parAssigns: cascade.assigns }, ts: FieldValue.serverTimestamp() });
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
    const { isWorkforce } = require("../domain/consultant");
    // Effectif EN ACTIVITÉ (staffé + intercontrat) : le banc doit apparaître en intercontrat (IC), pas « — ».
    const activeIds = consultants.filter((c) => isWorkforce(c.status)).map((c) => c.id);
    const { byConsultant, flags } = buildLoad(assignments, months, activeIds);
    // TJM par ressource = donnée `rentabilite` (MÊME verrou que preBilling — audit rentabilité H3) : sous
    // le seul droit `overview`, un lecteur reconstruisait le CA par ressource depuis `tjmBilled`. Le plan
    // de charge n'a besoin que des périodes/allocations — le tarif est retiré sans le droit coût.
    const { canRead } = require("../domain/authz");
    const role = req.auth.token?.nt360Role;
    const matrix = ((await db.doc("config/permissions").get()).data() || {}).matrix || {};
    const canRate = role === "direction" || canRead(matrix, role, "rentabilite");
    const safeAssignments = canRate ? assignments : assignments.map((a) => { const { tjmBilled: _tjm, ...rest } = a; return rest; });
    return { ok: true, months, consultants: consultants.map((c) => ({ id: c.id, name: c.name || null, status: c.status || "active", bu: c.bu || null })), assignments: safeAssignments, byConsultant, flags };
  });

  return { upsertConsultant, deleteConsultant, listConsultants, upsertAssignment, deleteAssignment, staffingPlan };
}

module.exports = { createStaffing };
