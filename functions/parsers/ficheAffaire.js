// Parseur fiche affaire → projectSheets/{fp} + bcLines/{fp}_{i} (BUILD_KIT §17.4).
// Lecture CELLULAIRE via SheetJS : aucun correctif dataValidation requis
// (SheetJS tolère les `sqref` mal formés, contrairement à openpyxl). §18.4.
const { sheetToJson } = require("../lib/xlsxRead");
const { fpKey, num, noAcc, cleanName } = require("../lib/ids");
const { safeId, hashId } = require("../lib/sheets");

// Une feuille est une fiche affaire si elle porte le marqueur CELLULAIRE distinctif « N° DE FP »
// (≠ colonne « N° FP » d'un P&L/DF), OU le couple « prix de revient » + « prix de vente » propre
// à la fiche. « Prix de revient » SEUL ne suffit PAS : un P&L peut avoir cette colonne et serait
// alors reclassé « fiche » (exclusive) → perte silencieuse de tout le classeur.
function sheetIsFiche(ws) {
  if (!ws) return false;
  const flat = sheetToJson(ws, { header: 1 })
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
  const aoa = sheetToJson(ws, {
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
  // Cellule qui contient TOUS les fragments donnés (normalisés) — sert à cibler la bonne variante
  // d'un montant (ex. la ligne « … (XOF) » plutôt que « … (EN DEVISE) »).
  const findWith = (...parts) => {
    const P = parts.map(noAcc);
    return cells.find((x) => typeof x.v === "string" && P.every((p) => noAcc(x.v).includes(p)));
  };
  // Dernière cellule NUMÉRIQUE à droite du label (droite→gauche) : ignore une cellule d'unité en fin
  // de ligne (« XOF », « FCFA », note) qui, prise comme valeur, donnerait 0 (audit F2).
  const numRowOf = (cell) => {
    if (!cell) return null;
    const row = aoa[cell.ri] || [];
    for (let k = row.length - 1; k > cell.ci; k--) {
      const v = row[k];
      if (v == null || v === "") continue;
      if (typeof v === "number" && Number.isFinite(v)) return v;
      const n = num(v); if (n) return n; // chaîne numérique tolérante (« 1 085 668 »)
    }
    return null;
  };
  // Montant d'un poste : priorité au montant en XOF (converti) sur le montant « en devise » d'une fiche
  // USD/EUR (audit F1), puis repli sur le libellé « NEURONES », puis sur le libellé générique — la
  // détection accepte déjà « prix de vente » sans « neurones », l'extraction doit suivre.
  const amount = (base) =>
    numRowOf(findWith(base, "xof")) ?? numRowOf(findWith(base, "neurones")) ?? numRowOf(findWith(base)) ?? 0;

  const fp = fpKey(rightOf("N° DE FP"));
  const sid = safeId(fp); // FP contient des '/' → sanitisé pour les IDs Firestore
  const costTotal = num(amount("prix de revient"));
  const saleTotal = num(amount("prix de vente"));
  const margin = num(amount("marge brute"));
  // %MB CALCULÉ (marge / vente) plutôt que lu dans la colonne « % » de la fiche. L'ancienne heuristique
  // base-100 (v>1.5 ? v/100 : v) inversait le signal des faibles marges : une marge réelle de 1 %
  // stockée « 1 » n'était pas divisée → affichée 100 % (donc « saine »), masquant l'affaire à faible
  // marge. marge/vente est non ambigu (les deux montants sont extraits en XOF, fiables). Cf. audit.
  const marginPct = saleTotal > 0 ? margin / saleTotal : 0;
  const sheet = {
    _id: sid,
    fp,
    client: String(rightOf("CLIENT") || "").trim(),
    affaire: String(rightOf("AFFAIRE") || "").trim(),
    commercial: String(rightOf("COMMERCIAL") || "").trim(),
    costTotal, saleTotal, margin, marginPct,
    source: "fiche",
  };

  // Table BC : en-tête = ligne contenant "fournisseur" ; données jusqu'à "TOTAL" (colonne B). §18.4
  const bc = [];
  const dupSeq = new Map(); // clé métier de ligne → occurrences (préserve les lignes identiques distinctes)
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
      if ((frn && frn !== "0") || xof > 0) {
        const supplier = cleanName(frn); // clé fournisseur canonique (compacte espaces, ADR-P20)
        const bcNumber = cB >= 0 ? String(row[cB] || "").trim() : "";
        const description = cD >= 0 ? String(row[cD] || "").trim() : "";
        // ID par CLÉ MÉTIER (fournisseur/n° BC/description) + occurrence, PAS par position de ligne :
        // deux onglets partageant le MÊME FP produisaient sinon des ids positionnels IDENTIQUES
        // (`sid_0, sid_1…`) qui s'écrasaient en aval (applyWrites fusionne par chemin) → perte
        // silencieuse des lignes du 1er onglet (cf. audit intégral I3). Désormais : lignes identiques
        // en double → même id → fusionnées (pas de double-compte) ; lignes distinctes → ids distincts
        // → toutes conservées. Le seq d'occurrence sépare deux lignes réellement identiques du même FP.
        const mkey = [supplier, bcNumber, description].join("|");
        const seq = dupSeq.get(mkey) || 0;
        dupSeq.set(mkey, seq + 1);
        bc.push({
          _id: `${sid}_${hashId(supplier, bcNumber, description, seq)}`,
          fp,
          lineIndex: bc.length,
          bcNumber,
          description,
          supplier,
          expenseType: cT >= 0 ? String(row[cT] || "").trim() : "",
          currency: "XOF",
          amountXof: xof,
          status: "a_emettre",
          source: "fiche", // permet le nettoyage des lignes orphelines au ré-import
        });
      }
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
