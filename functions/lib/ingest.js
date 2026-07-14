// Cœur d'ingestion pur (BUILD_KIT §9) : détection des sources présentes + construction
// des écritures déterministes. Un classeur peut contenir PLUSIEURS sources
// (PIPELINE_NT_CI_Inventory.xlsx regroupe P&L + LIVE + Facturation DF). Sans dépendance
// Firebase ⇒ testable (tests de non-régression §18).
const { sheetToJson } = require("./xlsxRead");
const { noAcc } = require("./ids");
const { parsePnl } = require("../parsers/pnl");
const { parseFacturationDf } = require("../parsers/facturationDf");
const { parseFiche, parseFicheAll, sheetIsFiche } = require("../parsers/ficheAffaire");
const { parseSalesData } = require("../parsers/salesData");
const { parseLogistics } = require("../parsers/logistics");

const PARSERS = { pnl: parsePnl, facturationDf: parseFacturationDf, fiche: parseFiche, salesData: parseSalesData, logistics: parseLogistics };

function headerSet(ws) {
  if (!ws) return new Set();
  const aoa = sheetToJson(ws, { header: 1, range: 0 });
  // Array.from densifie les tableaux creux (les trous → undefined → "" via noAcc),
  // sinon new Set(sparse) matérialiserait des undefined et casserait h.includes().
  return new Set(Array.from(aoa[0] || [], (v) => noAcc(v).trim()));
}
const has = (set, ...terms) => terms.some((t) => [...set].some((h) => h.includes(noAcc(t))));
// Correspondance EXACTE d'en-tête (token normalisé) — évite les faux positifs par sous-chaîne
// (ex. « id c » ne doit PAS matcher « valid client »).
const hasExact = (set, ...terms) => terms.some((t) => set.has(noAcc(t)));

// Fiche détectée sur N'IMPORTE QUEL onglet → gère les classeurs multi-fiches (1 fiche/onglet).
function isFiche(wb) {
  return wb.SheetNames.some((n) => sheetIsFiche(wb.Sheets[n]));
}
function hasPnl(wb) {
  return wb.SheetNames.some((n) => {
    const h = headerSet(wb.Sheets[n]);
    return has(h, "opp id") && has(h, "cas") && has(h, "raf total");
  });
}
function hasLive(wb) {
  return wb.SheetNames.some((n) => {
    const h = headerSet(wb.Sheets[n]);
    return hasExact(h, "idc", "id c") || (has(h, "statut") && has(h, "d prev"));
  });
}
function hasDf(wb) {
  return wb.SheetNames.some((n) => {
    const h = headerSet(wb.Sheets[n]);
    return (has(h, "numero", "numéro") && has(h, "montant ht", "total signe en devises", "reference", "n° fp"))
      || has(h, "nom d'affichage du partenaire");
  });
}
// Suivi logistique des BC fournisseurs (feuille « PO List ») : n° de BC + fournisseur + nature.
function hasLogistics(wb) {
  return wb.SheetNames.some((n) => {
    const h = headerSet(wb.Sheets[n]);
    return has(h, "po n", "n° bc", "n bc") && has(h, "fournisseur") && has(h, "nature", "montant xof");
  });
}

/** Types NON-fiche présents dans le classeur (P&L / LIVE / DF / logistics). */
function detectNonFiche(wb) {
  const kinds = [];
  if (hasPnl(wb)) kinds.push("pnl");
  if (hasLive(wb)) kinds.push("salesData");
  if (hasDf(wb)) kinds.push("facturationDf");
  if (hasLogistics(wb)) kinds.push("logistics");
  return kinds;
}

/** Types de sources présents dans le classeur (fiche est exclusive à la détection). */
function detectKinds(wb) {
  if (isFiche(wb)) return ["fiche"];
  return detectNonFiche(wb);
}

/** Compat : 1er type détecté (utilisé par certains tests). */
function detectKind(wb) {
  return detectKinds(wb)[0] || null;
}

function pathFor(kind, id) {
  return { pnl: `orders/${id}`, facturationDf: `invoices/${id}`, salesData: `opportunities/${id}`, logistics: `bcLines/${id}` }[kind];
}

/**
 * Construit toutes les écritures {path, data} + rapport, sans toucher Firestore.
 * @returns {{kinds:string[], writes:{path,data}[], report:object}}
 */
function buildWrites(wb) {
  let kinds = detectKinds(wb);
  // Repli ANTI-PERTE SILENCIEUSE (#1) : un classeur classé « fiche » mais dont AUCUNE fiche n'est
  // réellement parsable (faux positif — ex. un P&L contenant « prix de revient » + « prix de vente »)
  // était jeté en entier (rapport « fiche · 0 l. »). On retombe alors sur les AUTRES types s'il y en a
  // (P&L/LIVE/DF/logistics), pour ne pas perdre le classeur. S'il n'y a rien d'autre, on garde « fiche »
  // (le rapport « FP manquant » reste pertinent).
  let ficheCache = null;
  if (kinds.length === 1 && kinds[0] === "fiche") {
    ficheCache = parseFicheAll(wb);
    if (!ficheCache.length) { const nf = detectNonFiche(wb); if (nf.length) kinds = nf; }
  }
  const writes = [];
  const byKind = {};
  let rowsIn = 0, rowsOk = 0, rowsSkipped = 0;

  for (const kind of kinds) {
    if (kind === "fiche") {
      const fiches = ficheCache || parseFicheAll(wb); // une fiche par onglet (import groupé) — réutilise le cache du repli
      if (!fiches.length) { byKind.fiche = { rowsIn: 1, rowsOk: 0, rowsSkipped: 1, error: "FP manquant" }; continue; }
      let ok = 0;
      for (const { sheet, bcLines } of fiches) {
        // Marge de la fiche (coût/vente/marge/%MB) isolée dans projectSheetsMargin/{id} (lecture
        // « Rentabilité ») ; le doc de base ne porte que l'identité (FP/client/affaire/commercial).
        const { costTotal, saleTotal, margin, marginPct, ...sbase } = sheet;
        writes.push({ path: `projectSheets/${sheet._id}`, data: sbase });
        writes.push({ path: `projectSheetsMargin/${sheet._id}`, data: { _id: sheet._id, fp: sheet.fp, costTotal, saleTotal, margin, marginPct } });
        bcLines.forEach((b) => writes.push({ path: `bcLines/${b._id}`, data: b }));
        ok += bcLines.length + 1;
      }
      const rep = { rowsIn: ok, rowsOk: ok, rowsSkipped: 0, fiches: fiches.length };
      byKind.fiche = rep; rowsIn += rep.rowsIn; rowsOk += rep.rowsOk;
    } else {
      const { rows, report } = PARSERS[kind](wb);
      rows.forEach((r) => writes.push({ path: pathFor(kind, r._id), data: r }));
      byKind[kind] = report;
      rowsIn += report.rowsIn || 0; rowsOk += report.rowsOk || 0; rowsSkipped += report.rowsSkipped || 0;
    }
  }

  return {
    kinds,
    writes,
    report: { kinds, byKind, rowsIn, rowsOk, rowsSkipped, ...(kinds.length ? {} : { error: "aucune source reconnue" }) },
  };
}

/** Année fiscale courante = max(yearPo) sur les commandes (§7). */
function fiscalYearFromOrders(orders) {
  return orders.reduce((mx, o) => Math.max(mx, o.yearPo || 0), 0);
}

module.exports = { detectKind, detectKinds, buildWrites, pathFor, fiscalYearFromOrders, PARSERS };
