// Parseur feuille LIVE / Sales_DATA → opportunities/{extId|hash} (BUILD_KIT §17.5).
// STUB F0 — implémentation + tests de non-régression en F2/F6 (§18.5 : étapes 1..9,
// proba défaut {1:.10,2:.25,3:.40,4:.60,5:.80,8:.05}, actif=1-5, veille=8, conversion=6 vs 7).
const { fpKey, num, cleanBu } = require("../lib/ids");

/** Probabilités par défaut si `IdC` absent (§18.5). */
const DEFAULT_PROBA = { 1: 0.1, 2: 0.25, 3: 0.4, 4: 0.6, 5: 0.8, 8: 0.05 };

/**
 * @param {import('xlsx').WorkBook} wb classeur contenant la feuille LIVE
 * @returns {{rows: object[], report: {rowsIn:number, rowsOk:number}}}
 */
function parseSalesData(wb) {
  // TODO(F2/F6) : normaliser étapes (accents/casse), oppId = extId sinon hash(client+montant+etape),
  // source:"salesData" ; le remplacement de lot préserve source:"saisie".
  void wb, fpKey, num, cleanBu, DEFAULT_PROBA;
  return { rows: [], report: { rowsIn: 0, rowsOk: 0 } };
}

module.exports = { parseSalesData, DEFAULT_PROBA };
