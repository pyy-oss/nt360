// HANDLER — Objectifs (R/O CODIR) : extraction hors du monolithe index.js (patron R3). Cibles CAS /
// facturé / marge par périmètre (global|bu|commercial|client) et millésime ; alimentent atterrissage,
// R/O par AM, écarts d'objectif. Fabrique `createObjectives(deps)` à injection : aucun global d'index.js
// référencé. Exports déclarés dans index.js (garde-fou de déploiement par nom). Comportement identique.
const OBJ_SCOPES = new Set(["global", "bu", "commercial", "client"]);
const objectiveKey = (o) => `${o.fiscalYear}_${o.scope}_${o.scopeValue}`;

function createObjectives({ onCallG, HttpsError, db, FieldValue, requireWrite, assertPlainId, requestRecompute }) {
  // Recompute ciblé (needObj : atterrissage / ams / pipeline / news / alerts) → R/O et écarts se rafraîchissent.
  const RECOMPUTE_OBJ = ["atterrissage", "ams", "pipeline", "news", "alerts"];

  const upsertObjective = onCallG("upsertObjective", { memoryMiB: 512, timeoutSeconds: 120 }, async (req) => {
    await requireWrite(req, "objectifs");
    const d = req.data || {};
    const fiscalYear = Math.trunc(Number(d.fiscalYear) || 0);
    if (fiscalYear < 2000) throw new HttpsError("invalid-argument", "année d'objectif invalide (ex. 2026)");
    const scope = String(d.scope || "global");
    if (!OBJ_SCOPES.has(scope)) throw new HttpsError("invalid-argument", "périmètre invalide (global|bu|commercial|client)");
    // Périmètre global → une seule valeur « all » ; sinon valeur de périmètre requise (BU / AM / client).
    const scopeValue = scope === "global" ? "all" : String(d.scopeValue || "").trim();
    if (!scopeValue) throw new HttpsError("invalid-argument", "valeur de périmètre requise (BU / commercial / client)");
    const nn = (v) => Math.max(0, Number(v) || 0); // cibles jamais négatives
    const obj = {
      fiscalYear, scope, scopeValue,
      label: d.label ? String(d.label).trim().slice(0, 200) : null,
      targetCas: nn(d.targetCas), targetInvoiced: nn(d.targetInvoiced),
      targetMargin: nn(d.targetMargin), targetMarginPct: nn(d.targetMarginPct),
      updatedAt: FieldValue.serverTimestamp(),
    };
    const id = objectiveKey(obj);
    await db.doc(`objectives/${id}`).set(obj, { merge: true });
    await db.collection("auditLog").add({
      uid: req.auth.uid, action: "upsert_objective", module: "objectifs", entity: "objective", entityId: id,
      detail: { fiscalYear, scope, scopeValue, targetCas: obj.targetCas, targetInvoiced: obj.targetInvoiced, targetMargin: obj.targetMargin }, ts: FieldValue.serverTimestamp(),
    });
    await requestRecompute(RECOMPUTE_OBJ);
    return { ok: true, id };
  });

  const deleteObjective = onCallG("deleteObjective", { memoryMiB: 256, timeoutSeconds: 120 }, async (req) => {
    await requireWrite(req, "objectifs");
    const id = String(req.data?.id || "").trim();
    if (!id) throw new HttpsError("invalid-argument", "id objectif requis");
    assertPlainId(id, "id objectif");
    await db.doc(`objectives/${id}`).delete();
    await db.collection("auditLog").add({
      uid: req.auth.uid, action: "delete_objective", module: "objectifs", entity: "objective", entityId: id,
      detail: {}, ts: FieldValue.serverTimestamp(),
    });
    await requestRecompute(RECOMPUTE_OBJ);
    return { ok: true, id };
  });

  return { upsertObjective, deleteObjective };
}

module.exports = { createObjectives };
