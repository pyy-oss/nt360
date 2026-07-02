// Cœur d'ingestion pur (BUILD_KIT §9) : détection des sources présentes + construction
// des écritures déterministes. Un classeur peut contenir PLUSIEURS sources
// (PIPELINE_NT_CI_Inventory.xlsx regroupe P&L + LIVE + Facturation DF). Sans dépendance
// Firebase ⇒ testable (tests de non-régression §18).
const XLSX = require("xlsx");
const { noAcc } = require("./ids");
const { parsePnl } = require("../parsers/pnl");
const { parseFacturationDf } = require("../parsers/facturationDf");
const { parseFiche, parseFicheAll, sheetIsFiche } = require("../parsers/ficheAffaire");
const { parseSalesData } = require("../parsers/salesData");
const { parseLogistics } = require("../parsers/logistics");

const PARSERS = { pnl: parsePnl, facturationDf: parseFacturationDf, fiche: parseFiche, salesData: parseSalesData, logistics: parseLogistics };

function headerSet(ws) {
  if (!ws) return new Set();
  const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, range: 0 });
  // Array.from densifie les tableaux creux (les trous → undefined → "" via noAcc),
  // sinon new Set(sparse) matérialiserait des undefined et casserait h.includes().
  return new Set(Array.from(aoa[0] || [], (v) => noAcc(v).trim()));
}
const has = (set, ...terms) => terms.some((t) => [...set].some((h) => h.includes(noAcc(t))));

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
    return has(h, "idc", "id c") || (has(h, "statut") && has(h, "d prev"));
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

/** Types de sources présents dans le classeur (fiche est exclusive). */
function detectKinds(wb) {
  if (isFiche(wb)) return ["fiche"];
  const kinds = [];
  if (hasPnl(wb)) kinds.push("pnl");
  if (hasLive(wb)) kinds.push("salesData");
  if (hasDf(wb)) kinds.push("facturationDf");
  if (hasLogistics(wb)) kinds.push("logistics");
  return kinds;
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
  const kinds = detectKinds(wb);
  const writes = [];
  const byKind = {};
  let rowsIn = 0, rowsOk = 0, rowsSkipped = 0;

  for (const kind of kinds) {
    if (kind === "fiche") {
      const fiches = parseFicheAll(wb); // une fiche par onglet (import groupé)
      if (!fiches.length) { byKind.fiche = { rowsIn: 1, rowsOk: 0, rowsSkipped: 1, error: "FP manquant" }; continue; }
      let ok = 0;
      for (const { sheet, bcLines } of fiches) {
        writes.push({ path: `projectSheets/${sheet._id}`, data: sheet });
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
