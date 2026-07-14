// HANDLER — Assainissement (suppression d'enregistrements + annulation) : extraction hors du monolithe
// index.js (patron R3). Deux callables gouvernés par le module RBAC de la donnée, audités, recompute
// derrière. Fabrique `createSanitize(deps)` à injection : aucun global d'index.js référencé. Exports
// déclarés dans index.js (garde-fou de déploiement par nom). Comportement identique à l'inline d'origine.

// Collections assainissables (suppression) → module RBAC gouvernant.
const DELETABLE = { orders: "import", invoices: "import", bcLines: "bc", projectSheets: "rentabilite", opportunities: "pipeline" };
// Objets annulables → overlay config par module (lisible au bon niveau RBAC ; écriture réservée au callable).
const CANCELLABLE = { orders: { module: "import", doc: "config/cancelOrders" }, invoices: { module: "import", doc: "config/cancelInvoices" } };

function createSanitize({ onCallG, HttpsError, db, FieldValue, requireWrite, assertPlainId, requestRecompute }) {
  // SUPPRESSION d'un/plusieurs enregistrement(s) erroné(s)/fantôme(s). Les imports delta n'effacent JAMAIS
  // → seul l'app peut retirer un record obsolète. Le DELTA reste prioritaire (ré-import réintroduit).
  const deleteRecords = onCallG("deleteRecords", { memoryMiB: 256, timeoutSeconds: 300 }, async (req) => {
    const d = req.data || {};
    const collection = String(d.collection || "");
    const module = DELETABLE[collection];
    if (!module) throw new HttpsError("invalid-argument", "collection non assainissable");
    await requireWrite(req, module);
    // Rejette les id vides OU contenant « / » (segments de chemin imbriqués inattendus) — défense en profondeur.
    const ids = (Array.isArray(d.ids) ? d.ids : []).map((x) => String(x || "")).filter((x) => x && !x.includes("/")).slice(0, 1000);
    if (!ids.length) throw new HttpsError("invalid-argument", "aucun identifiant fourni");
    // Fenêtre selon le NOMBRE D'OPÉRATIONS par id : projectSheets enfile 2 suppressions par id
    // (fiche + doc marge isolé) → 200×2 = 400 ≤ 500 (limite dure Firestore d'écritures/commit).
    const step = collection === "projectSheets" ? 200 : 400;
    for (let i = 0; i < ids.length; i += step) {
      const batch = db.batch();
      for (const id of ids.slice(i, i + step)) {
        batch.delete(db.doc(`${collection}/${id}`));
        if (collection === "projectSheets") batch.delete(db.doc(`projectSheetsMargin/${id}`)); // marge isolée liée
      }
      await batch.commit();
    }
    await db.collection("auditLog").add({
      uid: req.auth.uid, action: "delete_records", module, entity: collection, entityId: String(ids.length),
      // Traçabilité au NIVEAU RECORD : ids réellement supprimés (bornés à 500 pour rester sous la limite du doc).
      detail: { collection, count: ids.length, ids: ids.slice(0, 500), truncated: ids.length > 500 }, ts: FieldValue.serverTimestamp(),
    });
    await requestRecompute();
    return { ok: true, count: ids.length };
  });

  // ANNULATION (statut « Annulée » persistant, overlay config/cancel* qui SURVIT aux ré-imports delta).
  const setCancellation = onCallG("setCancellation", { memoryMiB: 256, timeoutSeconds: 300 }, async (req) => {
    const d = req.data || {};
    const collection = String(d.collection || "");
    const spec = CANCELLABLE[collection];
    if (!spec) throw new HttpsError("invalid-argument", "objet non annulable");
    await requireWrite(req, spec.module);
    const id = String(d.id || "");
    if (!id) throw new HttpsError("invalid-argument", "identifiant requis");
    assertPlainId(id, "identifiant");
    const cancelled = d.cancelled !== false; // défaut = annuler
    const ref = db.doc(spec.doc);
    // ATOMIQUE (runTransaction) : le read-modify-write de la liste d'annulations doit être sérialisé —
    // deux annulations concurrentes non transactionnelles en perdraient une (2e écrase 1re). Cf. audit P0-A.
    await db.runTransaction(async (tx) => {
      const cur = (await tx.get(ref)).data() || {};
      const list = (Array.isArray(cur.items) ? cur.items : []).filter((e) => e && e.id !== id);
      if (cancelled) {
        list.push({ id, label: String(d.label || "").slice(0, 120), client: String(d.client || "").slice(0, 120), uid: req.auth.uid, ts: Date.now() });
      }
      tx.set(ref, { items: list.slice(0, 5000), updatedAt: FieldValue.serverTimestamp() }, { merge: false });
    });
    await db.collection("auditLog").add({
      uid: req.auth.uid, action: cancelled ? "cancel_record" : "restore_record", module: spec.module,
      entity: collection, entityId: id, detail: { collection }, ts: FieldValue.serverTimestamp(),
    });
    await requestRecompute(); // exclusion → impacte carnet/CAS/backlog/facturation/cash/rentabilité/qualité
    return { ok: true, id, cancelled };
  });

  return { deleteRecords, setCancellation };
}

module.exports = { createSanitize };
