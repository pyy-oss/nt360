// Parseur feuille P&L → orders/{fp} + orders.suppliers (BUILD_KIT §17.2).
// Module pur (testable). Matcher robuste (val) : les entêtes réels contiennent des
// espaces (" CAS ", " MB TOTAL ") et des colonnes proches (" MB TOTAL Manuel ").
const XLSX = require("xlsx");
const { fpKey, num, cleanBu, NOISE, cleanName } = require("../lib/ids");
const { headerKeys, val, safeId } = require("../lib/sheets");

/**
 * @param {import('xlsx').WorkBook} wb classeur contenant la feuille "P&L"
 * @returns {{rows: object[], report: {rowsIn:number, rowsOk:number, rowsSkipped:number}}}
 */
function parsePnl(wb) {
  const rows = XLSX.utils.sheet_to_json(wb.Sheets["P&L"], { defval: null });
  const byFp = new Map(); // dédup par FP (dernière ligne gagne)
  for (const r of rows) {
    const keys = headerKeys(r);
    const fp = fpKey(val(r, keys, "opp id"));
    const cas = num(val(r, keys, "cas"));
    if (!fp || cas <= 0) continue; // quarantaine : FP malformé / CAS non positif
    const suppliers = [];
    for (let i = 1; i <= 10; i++) {
      const amt = num(val(r, keys, `frns${i}`));
      const nm = cleanName(val(r, keys, `frns${i} n`));
      if (amt > 0 && !NOISE.has(nm)) suppliers.push({ name: nm, amount: amt });
    }
    byFp.set(safeId(fp), {
      _id: safeId(fp), // FP contient des '/' → sanitisé pour l'ID Firestore (champ fp conservé)
      fp,
      client: cleanName(val(r, keys, "customer")),
      bu: cleanBu(val(r, keys, "bu")),
      yearPo: parseInt(val(r, keys, "year po")) || 0,
      cas,
      raf: Math.max(num(val(r, keys, "raf total")), 0),
      mb: num(val(r, keys, "mb total")), // MB TOTAL, pas MB Réel / Manuel (§18.2)
      am: cleanName(val(r, keys, "am")),
      suppliers,
      source: "pnl",
    });
  }
  const out = [...byFp.values()];
  return { rows: out, report: { rowsIn: rows.length, rowsOk: out.length, rowsSkipped: rows.length - out.length } };
}

module.exports = { parsePnl };
