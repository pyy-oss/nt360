// RENTABILITÉ PAR RESSOURCE (Lot 17 « 20/10 DirOps ») — le P&L par consultant, dérivé du CRA constaté
// (Lot 15) et de l'annuaire (Lot 11) : CA réel = jours FACTURÉS × TJM cible ; coût = jours ouvrés de la
// période × CJM (le consultant est payé tous les jours, staffé ou non → coût de banc inclus) ; marge =
// CA − coût. Agrégé global + par BU + par grade. DONNÉE CONFIDENTIELLE (coût/marge) → droit « rentabilite ».
//
// Fonctions PURES (aucun I/O) → testables.

const WORKING_DAYS_PER_MONTH = 20; // cohérent avec activityKpi / timesheet

// P&L d'un consultant. `agg` = { billedDays, months } issu du CRA (computeConstat). tjm/cjm de l'annuaire.
function consultantPnl(consultant, agg) {
  const billed = Number(agg && agg.billedDays) || 0;
  const monthsN = Math.max(0, Number(agg && agg.months) || 0);
  const tjm = Number(consultant && consultant.tjmTarget);
  const cjm = Number(consultant && consultant.cjm);
  const caReal = Number.isFinite(tjm) ? Math.round(billed * tjm) : 0;
  const cost = Number.isFinite(cjm) ? Math.round(monthsN * WORKING_DAYS_PER_MONTH * cjm) : null;
  const margin = cost != null ? caReal - cost : null;
  const marginPct = cost != null && caReal > 0 ? Math.round(margin / caReal * 100) : null;
  return {
    id: consultant.id, name: consultant.name || null, bu: consultant.bu || null, grade: consultant.grade || null,
    billedDays: billed, caReal, cost, margin, marginPct,
  };
}

function sumBy(rows, keyFn) {
  const map = {};
  for (const r of rows) {
    const k = keyFn(r) || "—";
    const g = map[k] || (map[k] = { key: k, headcount: 0, billedDays: 0, caReal: 0, cost: 0, margin: 0, _hasCost: false });
    g.headcount += 1; g.billedDays += r.billedDays; g.caReal += r.caReal;
    if (r.cost != null) { g.cost += r.cost; g.margin += (r.margin || 0); g._hasCost = true; }
  }
  return Object.values(map).map((g) => ({
    key: g.key, headcount: g.headcount, billedDays: g.billedDays, caReal: g.caReal,
    cost: g._hasCost ? g.cost : null, margin: g._hasCost ? g.margin : null,
    marginPct: g._hasCost && g.caReal > 0 ? Math.round(g.margin / g.caReal * 100) : null,
  })).sort((a, b) => (b.margin || 0) - (a.margin || 0));
}

// Rentabilité de tout l'effectif renseigné au CRA sur la plage. `constatByConsultant` = { id: {billedDays, months} }.
function computeResourcePnl(consultants, constatByConsultant) {
  const rows = (consultants || [])
    .filter((c) => constatByConsultant && constatByConsultant[c.id])
    .map((c) => consultantPnl(c, constatByConsultant[c.id]))
    .sort((a, b) => (b.margin || 0) - (a.margin || 0));
  const totCa = rows.reduce((s, r) => s + r.caReal, 0);
  const withCost = rows.filter((r) => r.cost != null);
  const totCost = withCost.reduce((s, r) => s + r.cost, 0);
  const totMargin = withCost.reduce((s, r) => s + (r.margin || 0), 0);
  const global = {
    headcount: rows.length, billedDays: rows.reduce((s, r) => s + r.billedDays, 0),
    caReal: totCa, cost: withCost.length ? totCost : null,
    margin: withCost.length ? totMargin : null,
    marginPct: withCost.length && totCa > 0 ? Math.round(totMargin / totCa * 100) : null,
  };
  return { global, byBu: sumBy(rows, (r) => r.bu), byGrade: sumBy(rows, (r) => r.grade), rows };
}

module.exports = { WORKING_DAYS_PER_MONTH, consultantPnl, computeResourcePnl };
