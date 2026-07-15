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
function consultantPnl(consultant, agg, ctx) {
  const billed = Number(agg && agg.billedDays) || 0;
  const monthsN = Math.max(0, Number(agg && agg.months) || 0);
  const cjm = Number(consultant && consultant.cjm);
  const { caReal, hasRate } = realRevenue(consultant, agg, ctx);
  const missingTjm = !hasRate; // aucun taux exploitable (ni contrat couvrant, ni TJM cible)
  const missingCjm = !Number.isFinite(cjm);
  const cost = missingCjm ? null : Math.round(monthsN * WORKING_DAYS_PER_MONTH * cjm);
  const margin = cost != null ? caReal - cost : null;
  const marginPct = cost != null && caReal > 0 ? Math.round(margin / caReal * 100) : null;
  return {
    id: consultant.id, name: consultant.name || null, bu: consultant.bu || null, grade: consultant.grade || null,
    // `missingTjm`/`missingCjm` EXPOSÉS pour signaler « TJM/CJM à définir » (sinon un consultant à coût sans
    // TJM apparaît en perte sans explication et tire la marge globale vers le bas silencieusement).
    billedDays: billed, caReal, cost, margin, marginPct, missingTjm, missingCjm,
  };
}

function sumBy(rows, keyFn) {
  const map = {};
  for (const r of rows) {
    const k = keyFn(r) || "—";
    const g = map[k] || (map[k] = { key: k, headcount: 0, billedDays: 0, caReal: 0, caCost: 0, cost: 0, margin: 0, _hasCost: false });
    g.headcount += 1; g.billedDays += r.billedDays; g.caReal += r.caReal;
    // `caCost` = CA de la SEULE population à coût connu → dénominateur du taux de marge (cohérence des
    // populations : numérateur `margin` et dénominateur doivent porter sur le MÊME sous-ensemble, sinon
    // le taux est dilué par le CA de consultants sans CJM).
    if (r.cost != null) { g.cost += r.cost; g.margin += (r.margin || 0); g.caCost += r.caReal; g._hasCost = true; }
  }
  return Object.values(map).map((g) => ({
    key: g.key, headcount: g.headcount, billedDays: g.billedDays, caReal: g.caReal,
    cost: g._hasCost ? g.cost : null, margin: g._hasCost ? g.margin : null,
    marginPct: g._hasCost && g.caCost > 0 ? Math.round(g.margin / g.caCost * 100) : null,
  })).sort((a, b) => (b.margin || 0) - (a.margin || 0));
}

// Rentabilité de tout l'effectif renseigné au CRA sur la plage. `constatByConsultant` = { id: {billedDays, months} }.
// `ctx` (optionnel) = { byMonth: {id:[{month,billedDays}]}, assignments } → CA au taux contractualisé (parité
// pré-facturation). Sans lui, CA = billed × TJM cible (rétro-compat).
function computeResourcePnl(consultants, constatByConsultant, ctx) {
  const rows = (consultants || [])
    .filter((c) => constatByConsultant && constatByConsultant[c.id])
    .map((c) => consultantPnl(c, constatByConsultant[c.id], ctx))
    .sort((a, b) => (b.margin || 0) - (a.margin || 0));
  const totCa = rows.reduce((s, r) => s + r.caReal, 0);
  const withCost = rows.filter((r) => r.cost != null);
  const totCost = withCost.reduce((s, r) => s + r.cost, 0);
  const totMargin = withCost.reduce((s, r) => s + (r.margin || 0), 0);
  // Taux de marge global : dénominateur = CA de la SEULE population à coût connu (parité numérateur/
  // dénominateur), pas le CA de TOUT l'effectif — sinon le taux est sous-estimé (dilué).
  const caWithCost = withCost.reduce((s, r) => s + r.caReal, 0);
  const global = {
    headcount: rows.length, billedDays: rows.reduce((s, r) => s + r.billedDays, 0),
    caReal: totCa, cost: withCost.length ? totCost : null,
    margin: withCost.length ? totMargin : null,
    marginPct: withCost.length && caWithCost > 0 ? Math.round(totMargin / caWithCost * 100) : null,
  };
  return { global, byBu: sumBy(rows, (r) => r.bu), byGrade: sumBy(rows, (r) => r.grade), rows };
}

module.exports = { WORKING_DAYS_PER_MONTH, consultantPnl, computeResourcePnl };
