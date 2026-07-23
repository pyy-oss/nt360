// Parseur du MODÈLE d'import/export en masse des opportunités (BUILD_KIT — Lot 9). Deux fonctions :
//   • buildTemplateAoa(opps) → matrice [en-tête, ...lignes] pour XLSX.utils.aoa_to_sheet (EXPORT round-trip).
//   • parseOpportunitiesImport(wb) → lignes NORMALISÉES { oppId, fp, values, line } (RE-IMPORT).
// L'export écrit les en-têtes EXACTS ci-dessous ; `val()` (lib/sheets) les rapproche d'abord par égalité
// normalisée → un aller-retour SANS édition ne produit AUCUN changement (cf. domain/oppImport sameField).
// Seules les cellules RENSEIGNÉES peuplent `values` (mise à jour non effaçante côté domaine).
const { sheetToJson } = require("../lib/xlsxRead");
const { fpKey, num, cleanBu, cleanName, cleanPerson, noAcc } = require("../lib/ids");
const { headerKeys, val, valLabel, toISO } = require("../lib/sheets");
const { normalizeStage } = require("./salesData");

// En-têtes du modèle, dans l'ordre des colonnes. « Opp ID » et « N° FP » sont les clés de MATCH ;
// « Source » est informatif (lecture seule). Les intitulés portent le format attendu pour guider la saisie.
const TEMPLATE_HEADERS = [
  "Opp ID", "N° FP", "Client", "Désignation", "AM", "BU", "Montant", "Étape (1-9)",
  "IdC (%)", "MB prév. (%)", "DR (Oui/Non)", "D Prev", "Prochaine action",
  "Échéance action", "Motif de perte", "Source",
];

// Ligne d'export d'une opportunité (ordre = TEMPLATE_HEADERS). Valeurs BRUTES (nombres/ISO) pour un
// aller-retour fidèle ; DR en « Oui »/« Non » (lisible + re-parsé). Vide = « — » implicite (cellule vide).
function templateRow(o) {
  return [
    o.oppId || o.id || "", o.fp || "", o.client || "", o.designation || "", o.am || "", o.bu || "",
    o.amount ?? "", o.stage ?? "", o.probability ?? "", o.mbPrev ?? "", o.dr ? "Oui" : "Non",
    o.closingDate || "", o.nextStep || "", o.nextStepDate || "", o.lostReason || "", o.source || "",
  ];
}

/** Matrice tableur (en-tête + 1 ligne/opp) prête pour XLSX.utils.aoa_to_sheet. PUR. */
function buildTemplateAoa(opps) {
  return [TEMPLATE_HEADERS, ...(opps || []).map(templateRow)];
}

// ---- Coercitions par cellule : renvoient `undefined` si la cellule est VIDE (→ champ non fourni). ----
const txt = (v) => { const s = (v == null ? "" : String(v)).trim(); return s === "" ? undefined : s; };
// Présence numérique : `undefined` si vide OU si la cellule ne contient AUCUN chiffre (bruit texte comme
// « N/A », « à revoir »). Sans le garde-chiffre, `num("N/A")` renvoie 0 → le montant serait mis à 0 (écrasement
// silencieux) au lieu d'être laissé intact. Un vrai « 0 » (nombre ou chaîne « 0 ») contient un chiffre → conservé.
function numPresent(v) {
  if (v == null || v === "") return undefined;
  // Cellule DÉJÀ numérique (exceljs) : la renvoyer TELLE QUELLE. Surtout NE PAS la stringifier :
  // String(286322054.17791206) exposait la décimale complète à num(), qui prenait alors le « . » pour un
  // séparateur de milliers et le retirait → montant ×10^(décimales) (corruption « ×1 milliard » à l'import
  // LIVE/Sales). Seules les cellules TEXTE (« 12,5 % », « N/A ») passent par le parsing localisé de num().
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
  if (!/[0-9]/.test(String(v))) return undefined;
  const n = num(String(v).replace(/%/g, ""));
  return Number.isFinite(n) ? n : undefined;
}
function parseStage(v) { if (v == null || v === "") return undefined; const s = normalizeStage(v); return s >= 1 && s <= 9 ? s : undefined; }
function parseProba(v) {
  if (v == null || v === "") return undefined;
  const n = num(String(v).replace(/%/g, ""));
  if (!Number.isFinite(n)) return undefined;
  // IdC en POURCENTAGE (0-100), échelle canonique de l'app. « 90 » ou « 90% » → 90. Une valeur
  // historique en 0-1 (« 0,9 ») reste acceptée telle quelle (p01 la normalise au calcul). Borné [0,100].
  return Math.min(100, Math.max(0, n));
}
function parsePct(v) { const n = numPresent(v); return n === undefined ? undefined : Math.min(100, Math.max(0, n)); }
function parseDate(v) { if (v == null || v === "") return undefined; return toISO(v) || undefined; }
// BU : `undefined` si la cellule est VIDE (champ non touché) — sinon canonicalise. `cleanBu` renvoyant
// TOUJOURS une valeur non vide (« AUTRE » par défaut), il faut tester le vide AVANT, sans quoi une colonne
// BU laissée vide écraserait la vraie BU en « AUTRE » (violation de la garantie « cellule vide = non touché »).
function parseBu(v) { const s = txt(v); return s === undefined ? undefined : cleanBu(s); }
const DR_TRUE = new Set(["oui", "o", "yes", "y", "true", "vrai", "1", "x", "✓"]);
function parseDr(v) {
  if (v == null) return undefined;
  const s = String(v).trim().toLowerCase();
  if (s === "") return undefined;
  return DR_TRUE.has(s);
}

function pickSheet(wb) {
  const named = wb.SheetNames.find((n) => /opport|opps?|live|sales|pipe|import/i.test(n));
  return wb.Sheets[named || wb.SheetNames[0]];
}

/**
 * @param {{SheetNames:string[], Sheets:object}} wb classeur lu par lib/xlsxRead.readWorkbook (exceljs)
 * @returns {{rows: {oppId:string, fp:string, values:object, line:number}[], report:{rowsIn:number, rowsParsed:number}}}
 */
function parseOpportunitiesImport(wb) {
  const raw = sheetToJson(pickSheet(wb), { defval: null });
  const rows = [];
  let rowsIn = 0;
  raw.forEach((r, i) => {
    rowsIn++;
    const keys = headerKeys(r);
    // Opp ID : JAMAIS « id » seul (matcherait « IdC »). N° FP : clé naturelle normalisée.
    const oppId = String(val(r, keys, "opp id", "oppid") || "").trim();
    const fp = fpKey(val(r, keys, "n° fp", "n fp", "fp"));
    const values = {};
    const put = (k, v) => { if (v !== undefined) values[k] = v; };
    put("client", txt(cleanName(val(r, keys, "client", "customer"))));
    put("designation", txt(valLabel(r, keys, "désignation", "designation", "description du projet", "description projet", "objet", "affaire", "projet", "intitulé", "intitule", "description")));
    put("am", txt(cleanPerson(val(r, keys, "am", "new am", "commercial", "sales"))));
    put("bu", parseBu(val(r, keys, "bu", "domaine")));
    put("amount", numPresent(val(r, keys, "montant (ht)", "montant ht", "montant", "amount")));
    put("stage", parseStage(val(r, keys, "étape (1-9)", "étape", "etape", "statut", "stage")));
    put("probability", parseProba(val(r, keys, "idc (0-1)", "idc", "id c", "proba", "probabilité", "probabilite")));
    // MB (marge brute prév., en %) : l'onglet LIVE l'intitule « MB » nu, l'export « MB prév. (%) », d'autres
    // sources « MB TOTAL ». Les libellés EXPLICITES passent par val() (inclusion sûre) ; le « MB » NU se
    // matche par ÉGALITÉ exacte car « mb » en sous-chaîne capterait « Nombre… » (nombre ⊇ mb) → faux positif.
    // La valeur est déjà en points de % (ex. 20 = 20 %), bornée [0,100] par parsePct.
    const mbExactKey = keys.find((k) => noAcc(k).trim() === "mb");
    const mbLabelled = val(r, keys, "mb prév. (%)", "mb prév", "mb prev", "mb prévisionnel", "mb previsionnel", "mb total");
    put("mbPrev", parsePct((mbLabelled != null && mbLabelled !== "") ? mbLabelled : (mbExactKey ? r[mbExactKey] : undefined)));
    put("dr", parseDr(val(r, keys, "dr (oui/non)", "dr")));
    put("closingDate", parseDate(val(r, keys, "d prev", "closing", "date prev", "clôture", "cloture")));
    put("nextStep", txt(val(r, keys, "prochaine action", "next step")));
    put("nextStepDate", parseDate(val(r, keys, "échéance action", "echeance action", "next step date")));
    put("lostReason", txt(val(r, keys, "motif de perte", "motif perte", "lost reason", "raison perte")));
    if (!oppId && !fp && Object.keys(values).length === 0) return; // ligne entièrement vide → ignorée
    rows.push({ oppId, fp, values, line: i + 2 }); // +2 : la ligne 1 est l'en-tête
  });
  return { rows, report: { rowsIn, rowsParsed: rows.length } };
}

module.exports = { TEMPLATE_HEADERS, buildTemplateAoa, parseOpportunitiesImport };
