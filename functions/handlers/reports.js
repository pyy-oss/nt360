// HANDLER — Reporting self-service (Lot 6) : extraction hors du monolithe index.js (patron R3).
//
// Groupe COHÉSIF de 4 callables autour des définitions de rapport (config `reports`) et de leur
// exécution sur les opportunités cadrées. Exposé en FABRIQUE `createReports(deps)` : toutes les
// dépendances d'infrastructure et helpers d'index.js sont INJECTÉES → aucun global d'index.js n'est
// référencé (garde-fou check-no-undef). Les exports restent DÉCLARÉS dans index.js pour le garde-fou
// de déploiement par nom (deployed-functions.txt). Comportement identique à l'inline d'origine.
function createReports({ onCallG, requireRead, requireWrite, db, HttpsError, FieldValue, scopedOpps, loadUsersMap, assertPlainId }) {
  // Exécute un rapport (filtres + regroupement + mesure) sur les opps VISIBLES par l'appelant. Le
  // pondéré est TIÉRÉ (config/projection) — source unique avec le cockpit.
  const runReport = onCallG("runReport", { memoryMiB: 256, timeoutSeconds: 60 }, async (req) => {
    await requireRead(req, "pipeline");
    const { applyReport } = require("../domain/report");
    const { normalizeTiers } = require("../domain/projection");
    const tiers = normalizeTiers((await db.doc("config/projection").get()).data() || undefined);
    const opps = await scopedOpps(req, ["bu", "am", "client", "stage", "amount", "probability", "forecastCategory"]);
    return { ok: true, ...applyReport(req.data?.def || req.data || {}, opps, tiers) };
  });

  const saveReport = onCallG("saveReport", { memoryMiB: 256, timeoutSeconds: 60 }, async (req) => {
    await requireWrite(req, "pipeline");
    const { validateReportDef } = require("../domain/report");
    const name = String(req.data?.name || "").trim().slice(0, 120);
    if (!name) throw new HttpsError("invalid-argument", "nom du rapport requis");
    const v = validateReportDef(req.data?.def);
    if (!v.ok) throw new HttpsError("invalid-argument", v.error);
    const usersMap = await loadUsersMap();
    const doc = { name, def: v.value, ownerUid: req.auth.uid, ownerName: (usersMap[req.auth.uid] && usersMap[req.auth.uid].name) || null, updatedAt: FieldValue.serverTimestamp() };
    let id = req.data?.id ? String(req.data.id) : null;
    if (id) { assertPlainId(id, "id rapport"); await db.doc(`reports/${id}`).set(doc, { merge: true }); }
    else { const ref = await db.collection("reports").add({ ...doc, createdAt: FieldValue.serverTimestamp() }); id = ref.id; }
    await db.collection("auditLog").add({ uid: req.auth.uid, action: "save_report", module: "pipeline", entity: "report", entityId: id, detail: { name }, ts: FieldValue.serverTimestamp() });
    return { ok: true, id };
  });

  // Définitions de rapport : PARTAGÉES entre les utilisateurs « pipeline » (ce sont des définitions, pas
  // des données d'enregistrement — l'exécution, elle, reste cadrée par la visibilité de chacun).
  const listReports = onCallG("listReports", { memoryMiB: 256, timeoutSeconds: 60 }, async (req) => {
    await requireRead(req, "pipeline");
    const snap = await db.collection("reports").limit(500).get();
    const reports = snap.docs.map((s) => ({ id: s.id, ...s.data() }))
      .sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
    return { ok: true, reports };
  });

  const deleteReport = onCallG("deleteReport", { memoryMiB: 256, timeoutSeconds: 60 }, async (req) => {
    await requireWrite(req, "pipeline");
    const id = assertPlainId(req.data?.id, "id rapport");
    const snap = await db.doc(`reports/${id}`).get();
    if (!snap.exists) throw new HttpsError("not-found", "rapport introuvable");
    // Seul le propriétaire ou la direction supprime un rapport partagé.
    if (snap.data().ownerUid !== req.auth.uid && req.auth.token?.nt360Role !== "direction") {
      throw new HttpsError("permission-denied", "réservé au propriétaire ou à la direction");
    }
    await db.doc(`reports/${id}`).delete();
    await db.collection("auditLog").add({ uid: req.auth.uid, action: "delete_report", module: "pipeline", entity: "report", entityId: id, ts: FieldValue.serverTimestamp() });
    return { ok: true };
  });

  return { runReport, saveReport, listReports, deleteReport };
}

module.exports = { createReports };
