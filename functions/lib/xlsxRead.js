// Lecture/écriture de classeurs via exceljs (remplace xlsx@0.18 — CVE-2023-30533 : pollution de
// prototype à l'analyse). Le parsing d'un fichier UPLOADÉ (donnée non fiable) ne passe plus par xlsx.
//
// Stratégie « faible churn » : `readWorkbook(buf)` (ASYNC — exceljs charge de façon asynchrone) rend un
// classeur de forme IDENTIQUE à celle attendue par les parseurs (`{ SheetNames, Sheets }`), chaque
// feuille portant une AOA (array-of-arrays) pré-extraite. `sheetToJson(ws, opts)` reste PUR/SYNC et
// reproduit fidèlement le sous-ensemble de `XLSX.utils.sheet_to_json` réellement utilisé
// (`header:1`, mode objets, `defval`, `range`). Les parseurs et `buildWrites` restent donc synchrones.
const ExcelJS = require("exceljs");

// Normalise une valeur de cellule exceljs vers un primitif « à la xlsx cellDates:true » :
// string / number / boolean / Date / null. Résout richText, hyperlink, formule (→ résultat).
function normCell(v) {
  if (v == null) return null;
  const t = typeof v;
  if (t === "string" || t === "number" || t === "boolean") return v;
  if (v instanceof Date) return v;
  if (typeof v === "object") {
    if (Array.isArray(v.richText)) return v.richText.map((p) => (p && p.text) || "").join("");
    if ("text" in v && ("hyperlink" in v || Object.keys(v).length <= 2)) return v.text == null ? null : v.text; // hyperlink
    if ("formula" in v || "sharedFormula" in v) return normCell(v.result); // formule → valeur calculée
    if ("error" in v) return null; // #DIV/0!, #N/A… : pas une donnée exploitable
    if ("result" in v) return normCell(v.result);
  }
  return null;
}

// Extrait une feuille exceljs en AOA dense (colonnes 0-indexées). Les cellules fusionnées NON maîtresses
// sont vidées (parité xlsx : seule la cellule haut-gauche d'une fusion porte la valeur).
function sheetToAoa(ws) {
  const aoa = [];
  const rowCount = ws.rowCount || 0;
  const colCount = ws.columnCount || 0;
  for (let r = 1; r <= rowCount; r++) {
    const row = ws.getRow(r);
    const arr = new Array(colCount).fill(null);
    for (let c = 1; c <= colCount; c++) {
      const cell = row.getCell(c);
      // cell.master pointe sur elle-même hors fusion ; sur une fusion, seules les maîtresses gardent la valeur.
      if (cell.master && cell.master !== cell) { arr[c - 1] = null; continue; }
      arr[c - 1] = normCell(cell.value);
    }
    aoa.push(arr);
  }
  return aoa;
}

/**
 * Charge un tampon XLSX en classeur { SheetNames, Sheets }. ASYNC (exceljs).
 * @param {Buffer|Uint8Array|ArrayBuffer} buf
 * @returns {Promise<{SheetNames:string[], Sheets:Record<string,{_aoa:any[][]}>}>}
 */
async function readWorkbook(buf) {
  const wb = new ExcelJS.Workbook();
  // exceljs accepte un Buffer Node ou un ArrayBuffer ; on normalise en Buffer.
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  await wb.xlsx.load(b);
  const SheetNames = [];
  const Sheets = {};
  wb.eachSheet((ws) => {
    // eachSheet ne visite que les feuilles existantes ; l'ordre suit l'index du classeur.
    SheetNames.push(ws.name);
    Sheets[ws.name] = { _aoa: sheetToAoa(ws) };
  });
  return { SheetNames, Sheets };
}

const isEmpty = (v) => v == null || v === "";

/**
 * Reproduit XLSX.utils.sheet_to_json pour le sous-ensemble utilisé par le code.
 * @param {{_aoa:any[][]}} ws feuille (issue de readWorkbook)
 * @param {{header?:1, defval?:any, range?:number, raw?:boolean}} [opts]
 * @returns {any[]} AOA (header:1) OU tableau d'objets (mode par en-tête)
 */
function sheetToJson(ws, opts = {}) {
  const aoa = (ws && ws._aoa) || [];
  const start = typeof opts.range === "number" ? opts.range : 0;
  const body = aoa.slice(start);
  const hasDefval = Object.prototype.hasOwnProperty.call(opts, "defval");
  const defval = opts.defval;

  // Mode AOA (header:1) : renvoie les lignes telles quelles ; comble les vides par defval si fourni.
  if (opts.header === 1) {
    return body.map((row) => {
      const r = (row || []).map((v) => (isEmpty(v) ? (hasDefval ? defval : undefined) : v));
      return r;
    });
  }

  // Mode objets : 1re ligne = en-têtes. Clés dédupliquées (suffixe _N, comme xlsx). Colonnes à en-tête
  // vide ignorées. Lignes entièrement vides sautées. Cellule vide → defval si fourni, sinon clé omise.
  const headerRow = body[0] || [];
  const keys = [];
  const seen = Object.create(null);
  headerRow.forEach((h, c) => {
    if (isEmpty(h)) { keys[c] = null; return; }
    let k = String(h);
    if (seen[k] != null) { seen[k] += 1; k = `${k}_${seen[k]}`; } else { seen[k] = 0; }
    keys[c] = k;
  });
  const out = [];
  for (let i = 1; i < body.length; i++) {
    const row = body[i] || [];
    // Ligne vide (aucune cellule non vide sous une colonne à en-tête) → ignorée (parité xlsx).
    let any = false;
    const obj = {};
    for (let c = 0; c < keys.length; c++) {
      const key = keys[c];
      if (key == null) continue;
      const v = row[c];
      if (isEmpty(v)) { if (hasDefval) obj[key] = defval; continue; }
      obj[key] = v; any = true;
    }
    if (any) out.push(obj);
  }
  return out;
}

/**
 * Écrit une matrice [en-tête, ...lignes] en classeur XLSX encodé base64 (export). ASYNC (exceljs).
 * @param {any[][]} aoa
 * @param {string} [sheetName]
 * @returns {Promise<string>} base64
 */
async function aoaToXlsxBase64(aoa, sheetName) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sheetName || "Feuille1");
  for (const row of aoa) ws.addRow(row);
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf).toString("base64");
}

module.exports = { readWorkbook, sheetToJson, aoaToXlsxBase64 };
