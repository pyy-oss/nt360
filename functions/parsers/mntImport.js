// Parseur du modèle d'import EN MASSE des contrats de maintenance (mnt_ — Lot 8). PUR (aucun I/O) :
// `parseMntContratsImport(wb)` transforme un classeur (lu par lib/xlsxRead.readWorkbook, exceljs) en
// lignes BRUTES { raw, line } que `domain/mntContrat.validateMntContrat` valide/normalise ensuite.
// L'import couvre l'EN-TÊTE du contrat (1 ligne = 1 affaire = 1 FP) ; les engagements SLA, structurés,
// restent saisis en fiche (le doc plat ne les porte pas). En-têtes FR rapprochés par `val()` (tolérant
// casse/accents/alias), dates converties en ISO, statut/périodicité mappés vers les CODES applicatifs.
const { sheetToJson } = require("../lib/xlsxRead");
const { headerKeys, val, toISO } = require("../lib/sheets");

// En-têtes du modèle, dans l'ordre des colonnes (guide de saisie + libellés attendus à l'export).
const MNT_TEMPLATE_HEADERS = [
  "N° FP", "Client", "BU", "AM", "Statut", "Périodicité", "Date début", "Date fin", "Montant engagé", "Devise",
];

// Normalisation « libellé → code » : minuscule + sans accents (l'Excel écrit « Actif », « Échu »… ;
// le domaine attend les CODES stables « actif », « echu »… — comme `stage`).
const deburr = (v) => String(v == null ? "" : v).trim().toLowerCase()
  .normalize("NFD").replace(/[̀-ͯ]/g, "");

const STATUT_MAP = { brouillon: "brouillon", actif: "actif", suspendu: "suspendu", echu: "echu", resilie: "resilie" };
function normStatut(v) { const s = deburr(v); return STATUT_MAP[s] || (s ? s : undefined); }
// Périodicité : « mensuel(le) » → mensuel, etc. (préfixe, tolère le genre).
function normEcheance(v) {
  const s = deburr(v);
  if (!s) return undefined;
  if (s.startsWith("mensuel")) return "mensuel";
  if (s.startsWith("trimestriel")) return "trimestriel";
  if (s.startsWith("annuel")) return "annuel";
  return s;
}
const txt = (v) => { const s = (v == null ? "" : String(v)).trim(); return s === "" ? undefined : s; };
function parseDate(v) { if (v == null || v === "") return undefined; return toISO(v) || undefined; }

function pickSheet(wb) {
  const named = wb.SheetNames.find((n) => /contrat|maint|mnt|import/i.test(n));
  return wb.Sheets[named || wb.SheetNames[0]];
}

/**
 * @param {{SheetNames:string[], Sheets:object}} wb classeur (lib/xlsxRead.readWorkbook)
 * @returns {{rows: {raw:object, line:number}[], report:{rowsIn:number, rowsParsed:number}}}
 */
function parseMntContratsImport(wb) {
  const raw = sheetToJson(pickSheet(wb), { defval: null });
  const rows = [];
  let rowsIn = 0;
  raw.forEach((r, i) => {
    rowsIn++;
    const keys = headerKeys(r);
    const fp = txt(val(r, keys, "n° fp", "n fp", "fp", "numéro fp", "numero fp"));
    const client = txt(val(r, keys, "client", "customer"));
    // Ligne entièrement vide (ni FP ni client) → ignorée silencieusement.
    if (!fp && !client) return;
    const rec = {
      fp,
      client,
      bu: txt(val(r, keys, "bu", "domaine")),
      am: txt(val(r, keys, "am", "commercial", "responsable")),
      statut: normStatut(val(r, keys, "statut", "état", "etat")),
      echeanceType: normEcheance(val(r, keys, "périodicité", "periodicite", "échéance", "echeance", "facturation")),
      dateDebut: parseDate(val(r, keys, "date début", "date debut", "début", "debut", "date de début", "date de debut")),
      dateFin: parseDate(val(r, keys, "date fin", "fin", "date de fin")),
      montantEngage: val(r, keys, "montant engagé", "montant engage", "montant", "montant annuel"),
      deviseEngage: txt(val(r, keys, "devise")),
    };
    rows.push({ raw: rec, line: i + 2 }); // +2 : la ligne 1 est l'en-tête
  });
  return { rows, report: { rowsIn, rowsParsed: rows.length } };
}

module.exports = { MNT_TEMPLATE_HEADERS, parseMntContratsImport };
