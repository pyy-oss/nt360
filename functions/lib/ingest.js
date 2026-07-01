// Cœur d'ingestion pur (BUILD_KIT §9) : détection du type + construction des écritures
// déterministes. Sans dépendance Firebase ⇒ testable (tests de non-régression §18).
const XLSX = require("xlsx");
const { noAcc } = require("./ids");
const { parsePnl } = require("../parsers/pnl");
const { parseFacturationDf } = require("../parsers/facturationDf");
const { parseFiche } = require("../parsers/ficheAffaire");
const { parseSalesData } = require("../parsers/salesData");

const PARSERS = { pnl: parsePnl, facturationDf: parseFacturationDf, fiche: parseFiche, salesData: parseSalesData };

// En-têtes de la 1re ligne d'une feuille (normalisés).
function headerSet(ws) {
  if (!ws) return new Set();
  const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, range: 0 });
  const first = (aoa[0] || []).map((v) => noAcc(v));
  return new Set(first);
}
const has = (set, ...terms) => terms.some((t) => [...set].some((h) => h.includes(noAcc(t))));

/**
 * Détecte le type de source par signatures de colonnes/cellules (§9, §17).
 * @returns {'pnl'|'facturationDf'|'fiche'|'salesData'|null}
 */
function detectKind(wb) {
  // fiche : formulaire cellulaire avec le label "N° DE FP".
  const aoa0 = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 });
  const flat = aoa0.flat().filter((v) => typeof v === "string").map(noAcc);
  if (flat.some((s) => s.includes("n° de fp") || s.includes("n de fp") || s.includes("prix de revient")))
    return "fiche";

  for (const name of wb.SheetNames) {
    const h = headerSet(wb.Sheets[name]);
    const nn = noAcc(name);
    if ((nn.includes("p&l") || nn.includes("pnl")) && has(h, "opp id", "cas")) return "pnl";
    if (has(h, "opp id") && has(h, "cas") && has(h, "raf total")) return "pnl";
    if (has(h, "idc", "id c") || (has(h, "statut") && has(h, "d prev"))) return "salesData";
    if (has(h, "numero", "numéro") && has(h, "montant ht", "total signe en devises", "reference", "n° fp"))
      return "facturationDf";
    if (has(h, "nom d'affichage du partenaire")) return "facturationDf";
  }
  return null;
}

/** Chemin Firestore déterministe par type. */
function pathFor(kind, id) {
  return { pnl: `orders/${id}`, facturationDf: `invoices/${id}`, salesData: `opportunities/${id}` }[kind];
}

/**
 * Construit la liste d'écritures {path, data} + le rapport, sans toucher Firestore.
 * @returns {{kind:string, writes:{path:string,data:object}[], report:object}}
 */
function buildWrites(wb) {
  const kind = detectKind(wb);
  if (!kind) return { kind: null, writes: [], report: { rowsIn: 0, rowsOk: 0, rowsSkipped: 0, error: "type inconnu" } };

  if (kind === "fiche") {
    const { sheet, bcLines } = parseFiche(wb);
    if (!sheet.fp) return { kind, writes: [], report: { rowsIn: 1, rowsOk: 0, rowsSkipped: 1, error: "FP manquant" } };
    const writes = [
      { path: `projectSheets/${sheet._id}`, data: sheet },
      ...bcLines.map((b) => ({ path: `bcLines/${b._id}`, data: b })),
    ];
    return { kind, writes, report: { rowsIn: bcLines.length + 1, rowsOk: writes.length, rowsSkipped: 0 } };
  }

  const { rows, report } = PARSERS[kind](wb);
  const writes = rows.map((r) => ({ path: pathFor(kind, r._id), data: r }));
  return { kind, writes, report };
}

/** Année fiscale courante = max(yearPo) sur les commandes (§7). */
function fiscalYearFromOrders(orders) {
  return orders.reduce((mx, o) => Math.max(mx, o.yearPo || 0), 0);
}

module.exports = { detectKind, buildWrites, pathFor, fiscalYearFromOrders, PARSERS };
