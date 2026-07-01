// Parseur Facturation DF / Odoo account.move → invoices/{numero} (BUILD_KIT §17.3, §18.3).
// Module pur (testable). Dé-doublonnage par Numéro ; Σ factures d'un FP = son CAF Total.
const XLSX = require("xlsx");
const { fpKey, num, cleanBu } = require("../lib/ids");
const { headerKeys, val, toISO, safeId } = require("../lib/sheets");

// Choisit la 1re feuille pertinente (feuille "Facturation DF" sinon la 1re).
function pickSheet(wb) {
  const named = wb.SheetNames.find((n) => /factur|account|move|df/i.test(n));
  return wb.Sheets[named || wb.SheetNames[0]];
}

/**
 * @param {import('xlsx').WorkBook} wb
 * @returns {{rows: object[], report: {rowsIn:number, rowsOk:number, rowsSkipped:number}}}
 */
function parseFacturationDf(wb) {
  const rows = XLSX.utils.sheet_to_json(pickSheet(wb), { defval: null });
  const byNumero = new Map();
  let rowsIn = 0;
  for (const r of rows) {
    rowsIn++;
    const keys = headerKeys(r);
    const numero = String(
      val(r, keys, "numero", "numéro", "number") || ""
    ).trim();
    if (!numero) continue; // quarantaine : facture sans numéro
    const fp = fpKey(val(r, keys, "n° fp", "n fp", "reference", "référence"));
    const amountHt = num(
      val(r, keys, "montant ht", "total signe en devises", "total signé en devises", "montant")
    );
    const doc = {
      _id: safeId(numero),
      numero,
      fp,
      client: String(
        val(r, keys, "client", "nom d'affichage du partenaire", "partenaire") || ""
      ).trim(),
      bu: cleanBu(val(r, keys, "bu", "domaine")),
      date: toISO(val(r, keys, "date de facturation", "date")),
      amountHt,
      paymentStatus: String(
        val(r, keys, "statut de paiement", "statut", "payment") || ""
      ).trim(),
      source: "facturationDf",
    };
    byNumero.set(doc._id, doc); // dédup par Numéro (dernier gagne)
  }
  const out = [...byNumero.values()];
  return { rows: out, report: { rowsIn, rowsOk: out.length, rowsSkipped: rowsIn - out.length } };
}

module.exports = { parseFacturationDf };
