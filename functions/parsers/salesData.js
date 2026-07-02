// Parseur feuille LIVE / Sales_DATA → opportunities/{extId|hash} (BUILD_KIT §17.5, §18.5).
// Module pur (testable). Étapes 1..9, proba défaut, actif=1-5 / veille=8 / conversion=6 vs 7.
const XLSX = require("xlsx");
const { fpKey, num, cleanBu, noAcc, cleanName } = require("../lib/ids");
const { headerKeys, val, toISO, hashId, safeId } = require("../lib/sheets");

/** Probabilités par défaut si `IdC` absent (§18.5). */
const DEFAULT_PROBA = { 1: 0.1, 2: 0.25, 3: 0.4, 4: 0.6, 5: 0.8, 8: 0.05 };

// Libellés canoniques des étapes (mot-clé → numéro).
const STAGE_KEYWORDS = [
  [1, "qualif"], [2, "montage"], [3, "transmis"], [4, "negoc"],
  [5, "contractual"], [6, "gagn"], [7, "perdu"], [8, "suspend"], [9, "annul"],
];
const STAGE_LABEL = {
  1: "1-Qualification", 2: "2-Montage", 3: "3-Transmise", 4: "4-Négociation",
  5: "5-Contractualisation", 6: "6-Gagné", 7: "7-Perdu", 8: "8-Suspendu", 9: "9-Annulé",
};

/** Normalise une étape (accents/casse/variantes) → numéro 1..9 ou 0 si inconnu. */
function normalizeStage(raw) {
  const s = noAcc(raw).trim();
  const lead = s.match(/^\s*([1-9])\b/); // "4-Négociation", "4 negociation", "4"
  if (lead) return parseInt(lead[1], 10);
  for (const [n, kw] of STAGE_KEYWORDS) if (s.includes(kw)) return n;
  return 0;
}

function pickSheet(wb) {
  const named = wb.SheetNames.find((n) => /live|sales|pipe|opport/i.test(n));
  return wb.Sheets[named || wb.SheetNames[0]];
}

/**
 * @param {import('xlsx').WorkBook} wb
 * @returns {{rows: object[], report: {rowsIn:number, rowsOk:number, rowsSkipped:number}}}
 */
function parseSalesData(wb) {
  const rows = XLSX.utils.sheet_to_json(pickSheet(wb), { defval: null });
  const out = [];
  const dupSeq = new Map(); // clé métier → nb d'occurrences déjà vues (idempotent, préserve les doublons légitimes)
  let rowsIn = 0;
  for (const r of rows) {
    rowsIn++;
    const keys = headerKeys(r);
    const amount = num(val(r, keys, "montant (ht)", "montant ht", "montant", "amount"));
    const stage = normalizeStage(val(r, keys, "statut", "stage", "etape", "étape"));
    const client = cleanName(val(r, keys, "client", "customer"));
    if (!stage || (!client && amount <= 0)) continue; // quarantaine : étape/ligne inexploitable

    const am = cleanName(val(r, keys, "new am", "sales", "am", "commercial"));
    const idc = val(r, keys, "idc", "id c");
    const idcNum = idc == null || idc === "" ? null : num(idc);
    const probability =
      idcNum != null && idcNum > 0 && idcNum <= 1 ? idcNum : DEFAULT_PROBA[stage] ?? 0;

    const fp = fpKey(val(r, keys, "n° fp", "n fp", "fp"));
    const closingDate = (((d) => (d && +d.slice(0, 4) >= 2018 && +d.slice(0, 4) <= 2030 ? d : null))(toISO(val(r, keys, "d prev", "closing", "date prev", "cloture")))); // rejet sentinelles 1899

    // ⚠️ NE PAS utiliser le terme "id" seul : il matche "IdC" (proba) → collisions massives.
    // Sans extId : hash sur une clé MÉTIER stable (FP + closing + client/montant/étape/AM)
    // + un index d'occurrence PARMI LES LIGNES IDENTIQUES. Indépendant de la position
    // absolue (rowsIn) → idempotent si des lignes non-identiques sont insérées/réordonnées,
    // tout en PRÉSERVANT les doublons légitimes (deux affaires identiques → seq 0,1 distincts).
    const extId = val(r, keys, "ext id", "extid", "opp id", "oppid");
    let oppId;
    if (extId) {
      oppId = safeId(extId);
    } else {
      const mkey = [client, amount, stage, am, fp || "", closingDate || ""].join("|");
      const seq = dupSeq.get(mkey) || 0;
      dupSeq.set(mkey, seq + 1);
      oppId = hashId(client, amount, stage, am, fp || "", closingDate || "", seq);
    }

    out.push({
      _id: oppId,
      oppId,
      fp,
      client,
      am,
      bu: cleanBu(val(r, keys, "domaine", "bu")),
      amount,
      stage,
      stageLabel: STAGE_LABEL[stage] || String(val(r, keys, "statut", "stage") || ""),
      probability,
      weighted: amount * probability,
      closingDate,
      marginPct: ((v) => (Math.abs(v) > 1.5 ? v / 100 : v))(num(val(r, keys, "mb%", "mb %", "% mb"))), // base 100→1, cohérent avec la fiche

      source: "salesData",
    });
  }
  return { rows: out, report: { rowsIn, rowsOk: out.length, rowsSkipped: rowsIn - out.length } };
}

module.exports = { parseSalesData, DEFAULT_PROBA, normalizeStage, STAGE_LABEL };
