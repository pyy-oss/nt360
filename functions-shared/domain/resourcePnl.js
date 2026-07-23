// RENTABILITÉ PAR RESSOURCE (Lot 17 « 20/10 DirOps ») — le P&L par consultant, dérivé du CRA constaté
// (Lot 15) et de l'annuaire (Lot 11) : CA réel = jours FACTURÉS × TJM cible ; coût = jours ouvrés de la
// période × CJM (le consultant est payé tous les jours, staffé ou non → coût de banc inclus) ; marge =
// CA − coût. Agrégé global + par BU + par grade. DONNÉE CONFIDENTIELLE (coût/marge) → droit « rentabilite ».
//
// Fonctions PURES (aucun I/O) → testables.

const WORKING_DAYS_PER_MONTH = 20; // cohérent avec activityKpi / timesheet
const { coveringRate } = require("./preBilling");

// CA réel d'un consultant = jours FACTURÉS × TJM. PARITÉ STRICTE avec la pré-facturation (preBilling) :
// TJM = taux CONTRACTUALISÉ de l'affectation couvrant CHAQUE mois (coveringRate, non ambigu) en priorité,
// repli sur le TJM cible de l'annuaire. Sans `ctx` (byMonth + assignments), repli historique = billed ×
// tjmTarget. Sans cette parité, Rentabilité et Pré-facturation affichaient DEUX « CA » différents pour le
// même consultant (target vs contrat). Renvoie { caReal, hasRate }.
function realRevenue(consultant, agg, ctx) {
  const tjmTarget = Number(consultant && consultant.tjmTarget);
  const targetOk = Number.isFinite(tjmTarget) && tjmTarget > 0;
  const rows = ctx && ctx.byMonth ? ctx.byMonth[consultant.id] : null;
  if (!rows || !rows.length) {
    // Repli période-globale (rétro-compat / pas de détail mensuel) : billed × TJM cible.
    const billed = Number(agg && agg.billedDays) || 0;
    return { caReal: targetOk ? Math.round(billed * tjmTarget) : 0, hasRate: targetOk };
  }
  let caReal = 0, hasRate = false;
  for (const m of rows) { // { month, billedDays }
    const cover = coveringRate(ctx.assignments, consultant.id, m.month);
    const tjm = cover.tjm != null ? cover.tjm : (targetOk ? tjmTarget : null);
    if (tjm != null) { hasRate = true; caReal += Math.round((Number(m.billedDays) || 0) * tjm); }
  }
  return { caReal, hasRate };
}

// P&L d'un consultant. `agg` = { billedDays, months } issu du CRA (computeConstat). tjm/cjm de l'annuaire.
// `ctx` (optionnel) = { byMonth: {id:[{month,billedDays}]}, assignments } → CA au taux contractualisé.
// `structureRate` (0..1, ADR-P22) = frais de STRUCTURE (SG&A) en % du CA → marge NETTE. Défaut 0 → nette = brute.
function consultantPnl(consultant, agg, ctx, structureRate) {
  const billed = Number(agg && agg.billedDays) || 0;
  const monthsN = Math.max(0, Number(agg && agg.months) || 0);
  const cjm = Number(consultant && consultant.cjm);
  const { caReal, hasRate } = realRevenue(consultant, agg, ctx);
  const missingTjm = !hasRate; // aucun taux exploitable (ni contrat couvrant, ni TJM cible)
  const missingCjm = !Number.isFinite(cjm);
  const cost = missingCjm ? null : Math.round(monthsN * WORKING_DAYS_PER_MONTH * cjm); // inclut déjà le coût de banc
  const margin = cost != null ? caReal - cost : null; // marge BRUTE (CA − coût M-O, banc compris)
  const marginPct = cost != null && caReal > 0 ? Math.round(margin / caReal * 100) : null;
  // Marge NETTE = marge brute − frais de structure (SG&A = taux × CA). Taux 0 (défaut) → nette = brute.
  const sr = Number(structureRate);
  const rate = Number.isFinite(sr) && sr > 0 ? Math.min(1, sr) : 0;
  const structureCost = Math.round(caReal * rate);
  const marginNette = margin != null ? margin - structureCost : null;
  const marginNettePct = marginNette != null && caReal > 0 ? Math.round(marginNette / caReal * 100) : null;
  return {
    id: consultant.id, name: consultant.name || null, bu: consultant.bu || null, grade: consultant.grade || null,
    // `missingTjm`/`missingCjm` EXPOSÉS pour signaler « TJM/CJM à définir » (sinon un consultant à coût sans
    // TJM apparaît en perte sans explication et tire la marge globale vers le bas silencieusement).
    billedDays: billed, caReal, cost, margin, marginPct, missingTjm, missingCjm,
    structureCost, marginNette, marginNettePct, // ADR-P22 (marge nette de frais de structure)
  };
}

function sumBy(rows, keyFn) {
  const map = {};
  for (const r of rows) {
    const k = keyFn(r) || "—";
    const g = map[k] || (map[k] = { key: k, headcount: 0, billedDays: 0, caReal: 0, caCost: 0, cost: 0, margin: 0, structureCost: 0, marginNette: 0, _hasCost: false });
    g.headcount += 1; g.billedDays += r.billedDays; g.caReal += r.caReal;
    g.structureCost += (r.structureCost || 0); // frais de structure imputés (ADR-P22) — sur TOUT le CA du groupe
    // `caCost` = CA de la SEULE population à coût connu → dénominateur du taux de marge (cohérence des
    // populations : numérateur `margin` et dénominateur doivent porter sur le MÊME sous-ensemble, sinon
    // le taux est dilué par le CA de consultants sans CJM).
    if (r.cost != null) { g.cost += r.cost; g.margin += (r.margin || 0); g.marginNette += (r.marginNette || 0); g.caCost += r.caReal; g._hasCost = true; }
  }
  return Object.values(map).map((g) => ({
    key: g.key, headcount: g.headcount, billedDays: g.billedDays, caReal: g.caReal,
    cost: g._hasCost ? g.cost : null, margin: g._hasCost ? g.margin : null,
    marginPct: g._hasCost && g.caCost > 0 ? Math.round(g.margin / g.caCost * 100) : null,
    // Marge nette agrégée (ADR-P22) : même population que la marge brute (coût connu).
    structureCost: g._hasCost ? g.structureCost : null,
    marginNette: g._hasCost ? g.marginNette : null,
    marginNettePct: g._hasCost && g.caCost > 0 ? Math.round(g.marginNette / g.caCost * 100) : null,
  })).sort((a, b) => (b.margin || 0) - (a.margin || 0));
}

// Rentabilité de tout l'effectif renseigné au CRA sur la plage. `constatByConsultant` = { id: {billedDays, months} }.
// `ctx` (optionnel) = { byMonth: {id:[{month,billedDays}]}, assignments } → CA au taux contractualisé (parité
// pré-facturation). Sans lui, CA = billed × TJM cible (rétro-compat).
// `opts.structureRate` (0..1, ADR-P22) = frais de structure (SG&A) en % du CA → marge NETTE. Défaut 0 → nette = brute.
function computeResourcePnl(consultants, constatByConsultant, ctx, opts) {
  const structureRate = opts && opts.structureRate;
  const rows = (consultants || [])
    .filter((c) => constatByConsultant && constatByConsultant[c.id])
    .map((c) => consultantPnl(c, constatByConsultant[c.id], ctx, structureRate))
    .sort((a, b) => (b.margin || 0) - (a.margin || 0));
  const totCa = rows.reduce((s, r) => s + r.caReal, 0);
  const withCost = rows.filter((r) => r.cost != null);
  const totCost = withCost.reduce((s, r) => s + r.cost, 0);
  const totMargin = withCost.reduce((s, r) => s + (r.margin || 0), 0);
  const totStructure = withCost.reduce((s, r) => s + (r.structureCost || 0), 0);
  const totMarginNette = withCost.reduce((s, r) => s + (r.marginNette || 0), 0);
  // Taux de marge global : dénominateur = CA de la SEULE population à coût connu (parité numérateur/
  // dénominateur), pas le CA de TOUT l'effectif — sinon le taux est sous-estimé (dilué).
  const caWithCost = withCost.reduce((s, r) => s + r.caReal, 0);
  const global = {
    headcount: rows.length, billedDays: rows.reduce((s, r) => s + r.billedDays, 0),
    caReal: totCa, cost: withCost.length ? totCost : null,
    margin: withCost.length ? totMargin : null,
    marginPct: withCost.length && caWithCost > 0 ? Math.round(totMargin / caWithCost * 100) : null,
    // Marge nette globale (ADR-P22) : même population (coût connu). structureCost sur TOUT le CA à coût connu.
    structureCost: withCost.length ? totStructure : null,
    marginNette: withCost.length ? totMarginNette : null,
    marginNettePct: withCost.length && caWithCost > 0 ? Math.round(totMarginNette / caWithCost * 100) : null,
  };
  return { global, byBu: sumBy(rows, (r) => r.bu), byGrade: sumBy(rows, (r) => r.grade), rows };
}

module.exports = { WORKING_DAYS_PER_MONTH, consultantPnl, computeResourcePnl };
