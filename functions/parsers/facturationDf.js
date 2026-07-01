// Parseur Facturation DF / Odoo account.move → invoices/{numero} (BUILD_KIT §17.3).
// STUB F0 — implémentation + tests de non-régression en F2 (§18.3 : 858 factures 2024+,
// rythme mensuel moyen 6 derniers mois = 447 975 335 FCFA ; Σ factures d'un FP = son CAF Total).
const { fpKey, num, cleanBu } = require("../lib/ids");

/**
 * @param {import('xlsx').WorkBook} wb classeur Facturation DF ou export Odoo account.move
 * @returns {{rows: object[], report: {rowsIn:number, rowsOk:number}}}
 */
function parseFacturationDf(wb) {
  // TODO(F2) : mapping Odoo (Nom d'affichage du partenaire→Client, Date de facturation→Date,
  // Numéro→numero, Référence→fp, Total signé en devises/Montant HT→amountHt) ; dédup par Numéro.
  void wb, fpKey, num, cleanBu;
  return { rows: [], report: { rowsIn: 0, rowsOk: 0 } };
}

module.exports = { parseFacturationDf };
