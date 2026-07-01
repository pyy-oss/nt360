// Sync Sales_DATA (BUILD_KIT §11) : remplace le lot source='salesData' dans opportunities,
// en PRÉSERVANT les saisies (source='saisie'). Dé-doublonnage par oppId (extId|hash).
const { parseSalesData } = require("../parsers/salesData");

/**
 * Diff pur : à partir des IDs salesData existants et des nouvelles lignes,
 * calcule les upserts et les suppressions (lignes disparues du fichier).
 * @param {string[]} existingSalesIds IDs des opportunités source='salesData' déjà en base
 * @param {object[]} newRows lignes parsées (source='salesData')
 */
function planSalesSync(existingSalesIds, newRows) {
  const newIds = new Set(newRows.map((r) => r._id));
  const toDelete = existingSalesIds.filter((id) => !newIds.has(id));
  return { toUpsert: newRows, toDelete, kept: newIds.size };
}

/**
 * Applique le sync sur Firestore. Lit les opportunités source='salesData',
 * upsert les nouvelles, supprime celles absentes du fichier. Les 'saisie' ne sont
 * jamais touchées (filtre sur source).
 * @returns {Promise<{upserted:number, deleted:number}>}
 */
async function applySalesSync(db, wb) {
  const { rows } = parseSalesData(wb);
  const snap = await db.collection("opportunities").where("source", "==", "salesData").get();
  const existingIds = snap.docs.map((d) => d.id);
  const { toUpsert, toDelete } = planSalesSync(existingIds, rows);

  let batch = db.batch(), n = 0;
  const flush = async () => { if (n) { await batch.commit(); batch = db.batch(); n = 0; } };
  for (const r of toUpsert) { batch.set(db.doc(`opportunities/${r._id}`), r, { merge: true }); if (++n % 400 === 0) await flush(); }
  for (const id of toDelete) { batch.delete(db.doc(`opportunities/${id}`)); if (++n % 400 === 0) await flush(); }
  await flush();
  return { upserted: toUpsert.length, deleted: toDelete.length };
}

module.exports = { planSalesSync, applySalesSync };
