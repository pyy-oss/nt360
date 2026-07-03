// Parseur feuille P&L → orders/{fp} + orders.suppliers (BUILD_KIT §17.2).
// Module pur (testable). Matcher robuste (val) : les entêtes réels contiennent des
// espaces (" CAS ", " MB TOTAL ") et des colonnes proches (" MB TOTAL Manuel ").
const XLSX = require("xlsx");
const { fpKey, num, cleanBu, NOISE, cleanName, noAcc, plausibleYear } = require("../lib/ids");
const { headerKeys, val, valLabel, safeId } = require("../lib/sheets");

// Choisit la feuille P&L en s'ALIGNANT sur la détection (ingest.hasPnl) plutôt que sur un
// nom littéral "P&L" : 1re feuille dont l'entête porte opp id + cas + raf total ; repli sur
// une feuille nommée P&L/PnL ; sinon 1re feuille. Évite un import silencieusement vide (§17.2).
function pickSheet(wb) {
  const hdrHas = (ws, ...terms) => {
    if (!ws) return false;
    const hdr = (XLSX.utils.sheet_to_json(ws, { header: 1, range: 0 })[0] || []).map((v) => noAcc(v).trim());
    return terms.every((t) => hdr.some((h) => h.includes(noAcc(t))));
  };
  const byHeader = wb.SheetNames.find((n) => hdrHas(wb.Sheets[n], "opp id", "cas", "raf total"));
  if (byHeader) return wb.Sheets[byHeader];
  const byName = wb.SheetNames.find((n) => /p\s*&?\s*l|pnl/i.test(n));
  return wb.Sheets[byName || wb.SheetNames[0]];
}

/**
 * @param {import('xlsx').WorkBook} wb classeur contenant la feuille P&L
 * @returns {{rows: object[], report: {rowsIn:number, rowsOk:number, rowsSkipped:number}}}
 */
function parsePnl(wb) {
  const rows = XLSX.utils.sheet_to_json(pickSheet(wb), { defval: null });
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
      // Description / désignation de l'affaire (objet de la commande) — colonnes possibles variées.
      designation: String(valLabel(r, keys, "désignation", "designation", "objet", "affaire", "projet", "libellé", "libelle", "intitulé", "intitule", "description") || "").trim(),
      bu: cleanBu(val(r, keys, "bu")),
      yearPo: plausibleYear(parseInt(val(r, keys, "year po")) || 0), // fenêtre glissante, rejet sentinelles 1900
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
