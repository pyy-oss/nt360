// Parseur fiche affaire → projectSheets/{fp} + bcLines/{fp}_{i} (BUILD_KIT §17.4).
// Lecture CELLULAIRE via SheetJS : aucun correctif dataValidation requis
// (SheetJS tolère les `sqref` mal formés, contrairement à openpyxl). §18.4.
const XLSX = require("xlsx");
const { fpKey, num, noAcc } = require("../lib/ids");
const { safeId } = require("../lib/sheets");

// Une feuille est une fiche affaire si elle porte le marqueur CELLULAIRE distinctif « N° DE FP »
// (≠ colonne « N° FP » d'un P&L/DF), OU le couple « prix de revient » + « prix de vente » propre
// à la fiche. « Prix de revient » SEUL ne suffit PAS : un P&L peut avoir cette colonne et serait
// alors reclassé « fiche » (exclusive) → perte silencieuse de tout le classeur.
function sheetIsFiche(ws) {
  if (!ws) return false;
  const flat = XLSX.utils.sheet_to_json(ws, { header: 1 })
    .flat().filter((v) => typeof v === "string").map(noAcc);
  const hasFp = flat.some((s) => s.includes("n° de fp") || s.includes("n de fp"));
  const hasRevient = flat.some((s) => s.includes("prix de revient"));
  const hasVente = flat.some((s) => s.includes("prix de vente"));
  return hasFp || (hasRevient && hasVente);
}

/**
 * Parse UNE feuille de fiche affaire.
 * @param {import('xlsx').WorkSheet} ws feuille fiche affaire
 * @returns {{sheet: object, bcLines: object[]}}
 */
function parseFicheSheet(ws) {
  const aoa = XLSX.utils.sheet_to_json(ws, {
    header: 1,
    raw: true,
    defval: null,
  });

  // Index de toutes les cellules non vides, pour un scan par label.
  const cells = [];
  aoa.forEach((row, ri) =>
    row && row.forEach((v, ci) => {
      if (v != null && v !== "") cells.push({ ri, ci, v });
    })
  );
  const find = (lbl) => {
    const L = noAcc(lbl);
    // Priorité au libellé de CHAMP (cellule qui COMMENCE par le label, ex. "AFFAIRE :"),
    // pour ne pas confondre avec un titre le contenant (ex. "IDENTIFICATION DE L'AFFAIRE").
    return cells.find((x) => typeof x.v === "string" && noAcc(x.v).trimStart().startsWith(L))
      || cells.find((x) => typeof x.v === "string" && noAcc(x.v).includes(L));
  };
  const rightOf = (lbl) => {
    const c = find(lbl);
    if (!c) return null;
    const row = aoa[c.ri] || [];
    for (let k = c.ci + 1; k < row.length; k++) if (row[k] != null && row[k] !== "") return row[k];
    return null;
  };
  const lastOf = (lbl) => {
    const c = find(lbl);
    if (!c) return null;
    const row = aoa[c.ri] || [];
    let last = null;
    for (let k = c.ci + 1; k < row.length; k++) if (row[k] != null && row[k] !== "") last = row[k];
    return last;
  };

  const fp = fpKey(rightOf("N° DE FP"));
  const sid = safeId(fp); // FP contient des '/' → sanitisé pour les IDs Firestore
  const sheet = {
    _id: sid,
    fp,
    client: String(rightOf("CLIENT") || "").trim(),
    affaire: String(rightOf("AFFAIRE") || "").trim(),
    commercial: String(rightOf("COMMERCIAL") || "").trim(),
    costTotal: num(lastOf("PRIX DE REVIENT")),
    saleTotal: num(lastOf("PRIX DE VENTE NEURONES")),
    margin: num(lastOf("MARGE BRUTE NEURONES")),
    marginPct: ((v) => (Math.abs(v) > 1.5 ? v / 100 : v))(num(lastOf("% DE MARGE BRUTE"))), // base 100→1 sur |v| (gère marges négatives / faibles)
    source: "fiche",
  };

  // Table BC : en-tête = ligne contenant "fournisseur" ; données jusqu'à "TOTAL" (colonne B). §18.4
  const bc = [];
  let hr = -1;
  const col = {};
  aoa.forEach((row, ri) => {
    // En-tête = ligne dont une cellule CONTIENT « fournisseur » (tolère « FOURNISSEUR PRINCIPAL »…).
    if (row && row.some((v) => typeof v === "string" && noAcc(v).includes("fournisseur"))) {
      hr = ri;
      row.forEach((v, ci) => {
        if (typeof v === "string") col[noAcc(v).trim()] = ci;
      });
    }
  });
  const pick = (...k) => {
    for (const key in col) if (k.some((s) => key.includes(s))) return col[key];
    return -1;
  };
  const cF = pick("fournisseur");
  const cX = pick("charges en xof", "montant xof", "mt xof"); // synonymes de la colonne montant XOF
  const cT = pick("type");
  const cB = pick("bc");
  const cD = pick("description");

  if (hr >= 0)
    for (let ri = hr + 1; ri < aoa.length; ri++) {
      const row = aoa[ri] || [];
      const b = row[1];
      if (typeof b === "string" && noAcc(b).includes("total")) break;
      const frn = cF >= 0 ? String(row[cF] || "").trim() : "";
      const xof = cX >= 0 ? num(row[cX]) : 0;
      if ((frn && frn !== "0") || xof > 0)
        bc.push({
          _id: `${sid}_${bc.length}`,
          fp,
          lineIndex: bc.length,
          bcNumber: cB >= 0 ? String(row[cB] || "").trim() : "",
          description: cD >= 0 ? String(row[cD] || "").trim() : "",
          supplier: frn.toUpperCase(),
          expenseType: cT >= 0 ? String(row[cT] || "").trim() : "",
          currency: "XOF",
          amountXof: xof,
          status: "a_emettre",
        });
    }

  return { sheet, bcLines: bc };
}

/**
 * Compat : parse la 1re feuille (un classeur = une fiche).
 * @param {import('xlsx').WorkBook} wb
 * @returns {{sheet: object, bcLines: object[]}}
 */
function parseFiche(wb) {
  return parseFicheSheet(wb.Sheets[wb.SheetNames[0]]);
}

/**
 * Parse TOUTES les fiches d'un classeur : une fiche par onglet (import groupé).
 * Ne retient que les feuilles ressemblant à une fiche et dont le FP est renseigné.
 * @param {import('xlsx').WorkBook} wb
 * @returns {{sheet: object, bcLines: object[]}[]}
 */
function parseFicheAll(wb) {
  const out = [];
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    if (!sheetIsFiche(ws)) continue;
    const r = parseFicheSheet(ws);
    if (r.sheet.fp) out.push(r);
  }
  // Repli : classeur détecté « fiche » mais aucun onglet marqué → tenter la 1re feuille.
  if (!out.length) {
    const r = parseFicheSheet(wb.Sheets[wb.SheetNames[0]]);
    if (r.sheet.fp) out.push(r);
  }
  return out;
}

module.exports = { parseFiche, parseFicheAll, parseFicheSheet, sheetIsFiche };
