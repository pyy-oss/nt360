// Parseur feuille P&L → orders/{fp} + orders.suppliers (BUILD_KIT §17.2).
// Module pur (aucune dépendance Firebase) ⇒ testable en non-régression (§18.2).
const XLSX = require("xlsx");
const { fpKey, num, cleanBu, NOISE } = require("../lib/ids");

/**
 * @param {import('xlsx').WorkBook} wb classeur contenant la feuille "P&L"
 * @returns {{rows: object[], report: {rowsIn:number, rowsOk:number}}}
 */
function parsePnl(wb) {
  const rows = XLSX.utils.sheet_to_json(wb.Sheets["P&L"], { defval: null });
  const out = [];
  for (const r of rows) {
    const fp = fpKey(r["Opp ID"]);
    const cas = num(r["CAS"]);
    if (!fp || cas <= 0) continue; // quarantaine : FP malformé / CAS non positif
    const suppliers = [];
    for (let i = 1; i <= 10; i++) {
      const amt = num(r[`Frns${i}`]);
      const nm = String(r[`Frns${i} N`] || "").trim().toUpperCase();
      if (amt > 0 && !NOISE.has(nm)) suppliers.push({ name: nm, amount: amt });
    }
    out.push({
      _id: fp,
      fp,
      client: String(r["Customer"] || ""),
      bu: cleanBu(r["BU"]),
      yearPo: parseInt(r["Year PO"]) || 0,
      cas,
      raf: Math.max(num(r["RAF TOTAL"]), 0),
      mb: num(r["MB TOTAL"]), // MB TOTAL, pas MB Réel (§18.2)
      am: String(r["AM"] || ""),
      suppliers,
      source: "pnl",
    });
  }
  return { rows: out, report: { rowsIn: rows.length, rowsOk: out.length } };
}

module.exports = { parsePnl };
