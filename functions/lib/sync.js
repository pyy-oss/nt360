// Sync Sales_DATA (BUILD_KIT §11) : remplace le lot source='salesData' dans opportunities,
// en PRÉSERVANT les saisies (source='saisie'). Dé-doublonnage par oppId (extId|hash).
// C'est le SEUL chemin d'un SNAPSHOT LIVE complet (le fichier sync/sales_data.xlsx est tout le pipeline),
// donc le seul endroit où l'on peut décider du sort des opps ABSENTES sans risque de mass-marquage.
const { parseSalesData } = require("../parsers/salesData");

/**
 * Diff pur : à partir des IDs salesData existants et des nouvelles lignes,
 * calcule les upserts et les opportunités FANTÔMES (disparues du fichier LIVE).
 * @param {string[]} existingSalesIds IDs des opportunités source='salesData' déjà en base
 * @param {object[]} newRows lignes parsées (source='salesData')
 */
function planSalesSync(existingSalesIds, newRows) {
  const newIds = new Set(newRows.map((r) => r._id));
  const toStale = existingSalesIds.filter((id) => !newIds.has(id));
  return { toUpsert: newRows, toStale, kept: newIds.size };
}

/**
 * Applique le sync sur Firestore. Lit les opportunités source='salesData', upsert les présentes (et les
 * RÉ-ACTIVE : stale=false), et marque FANTÔMES (I2, NON-DESTRUCTIF : stale=true, jamais supprimées) celles
 * absentes du fichier LIVE — exclues des agrégats pipeline (aggregate.js) et signalées en Qualité, mais
 * réversibles (un import ultérieur qui les ré-inclut les ré-active). Les 'saisie' ne sont jamais touchées.
 * @returns {Promise<{upserted:number, staled:number}>}
 */
async function applySalesSync(db, wb) {
  const { rows } = parseSalesData(wb);
  const snap = await db.collection("opportunities").where("source", "==", "salesData").get();
  const existingIds = snap.docs.map((d) => d.id);
  const { toUpsert, toStale } = planSalesSync(existingIds, rows);

  let batch = db.batch(), n = 0;
  const flush = async () => { if (n) { await batch.commit(); batch = db.batch(); n = 0; } };
  // Présentes : upsert + réactivation (stale:false) — une opp fantôme qui réapparaît dans LIVE revit.
  for (const r of toUpsert) { batch.set(db.doc(`opportunities/${r._id}`), { ...r, stale: false }, { merge: true }); if (++n % 400 === 0) await flush(); }
  // Absentes du snapshot LIVE : marquées fantômes (réversible) au lieu d'être supprimées.
  for (const id of toStale) { batch.set(db.doc(`opportunities/${id}`), { stale: true }, { merge: true }); if (++n % 400 === 0) await flush(); }
  await flush();
  return { upserted: toUpsert.length, staled: toStale.length };
}

module.exports = { planSalesSync, applySalesSync };
