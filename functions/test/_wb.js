// Fabriques de classeurs pour les tests, après la migration xlsx → exceljs.
//  - wbFromRows / wbFromAoa / wbMulti : construisent DIRECTEMENT la forme { SheetNames, Sheets:{_aoa} }
//    attendue par les parseurs (synchrone, aucun binaire) — remplace XLSX.utils.*.
//  - bufFromSheets : produit un VRAI tampon .xlsx via exceljs (asynchrone), pour exercer le chemin de
//    lecture binaire (parseBuffer / readWorkbook).
const ExcelJS = require("exceljs");

// En-têtes = union des clés dans l'ordre de première apparition (parité XLSX.utils.json_to_sheet).
function rowsToAoa(rows) {
  const keys = [];
  for (const r of rows) for (const k of Object.keys(r)) if (!keys.includes(k)) keys.push(k);
  return [keys, ...rows.map((r) => keys.map((k) => (k in r ? r[k] : null)))];
}
const sheet = (aoa) => ({ _aoa: aoa });

function wbFromRows(name, rows) { return { SheetNames: [name], Sheets: { [name]: sheet(rowsToAoa(rows)) } }; }
function wbFromAoa(name, aoa) { return { SheetNames: [name], Sheets: { [name]: sheet(aoa) } }; }
function wbMulti(sheets) {
  const SheetNames = []; const Sheets = {};
  for (const s of sheets) { SheetNames.push(s.name); Sheets[s.name] = sheet(s.aoa || rowsToAoa(s.rows || [])); }
  return { SheetNames, Sheets };
}

// Tampon .xlsx réel (exceljs). `sheets` : [{ name, rows }] ou [{ name, aoa }].
async function bufFromSheets(sheets) {
  const wb = new ExcelJS.Workbook();
  for (const s of sheets) {
    const ws = wb.addWorksheet(s.name);
    const aoa = s.aoa || rowsToAoa(s.rows || []);
    for (const row of aoa) ws.addRow((row || []).map((v) => (v == null ? null : v)));
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}
// Raccourci mono-feuille.
const bufFromRows = (name, rows) => bufFromSheets([{ name, rows }]);

module.exports = { rowsToAoa, wbFromRows, wbFromAoa, wbMulti, bufFromSheets, bufFromRows };
