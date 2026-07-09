// KPI D'ACTIVITÉ (Lot 13 « 20/10 DirOps ») — indicateurs de pilotage d'une ESN dérivés du plan de charge
// (Lot 12) et de l'annuaire (Lot 11) : TAUX D'OCCUPATION prévisionnel, INTERCONTRAT, jours facturables,
// CA staffé prévisionnel et marge prévisionnelle (avec coût de banc). Prévisionnel : basé sur les
// affectations planifiées (pas un CRA réel) — honnête sur sa nature. Confidentialité du coût gérée en amont.
//
// Fonctions PURES (aucun I/O) → testables.

const WORKING_DAYS_PER_MONTH = 20; // hypothèse standard de jours ouvrés facturables par mois (paramétrable)

function coversMonth(a, m) { return a && a.startMonth <= m && a.endMonth >= m; }

// KPI d'un consultant sur la plage `months`. `cost` = CJM connu et autorisé (sinon null → pas de marge).
function consultantKpi(consultant, assignments, months, cost) {
  const active = (consultant.status || "active") === "active";
  const mine = (assignments || []).filter((a) => a.consultantId === consultant.id);
  let occSum = 0, idleMonths = 0, billableDays = 0, revenue = 0;
  for (const m of months) {
    const covering = mine.filter((a) => coversMonth(a, m));
    const alloc = Math.min(100, covering.reduce((s, a) => s + (Number(a.allocationPct) || 0), 0));
    occSum += alloc;
    if (active && alloc === 0) idleMonths += 1;
    for (const a of covering) {
      const days = (Number(a.allocationPct) || 0) / 100 * WORKING_DAYS_PER_MONTH;
      billableDays += days;
      if (a.tjmBilled != null) revenue += days * Number(a.tjmBilled);
    }
  }
  const nMonths = Math.max(1, months.length);
  const occupancyPct = Math.round(occSum / nMonths);
  // Coût de BANC : un consultant actif coûte tous les mois, staffé ou non (CJM × jours ouvrés).
  const marginForecast = cost != null ? Math.round(revenue - (active ? cost * WORKING_DAYS_PER_MONTH * nMonths : 0)) : null;
  return {
    id: consultant.id, name: consultant.name || null, bu: consultant.bu || null, status: consultant.status || "active",
    occupancyPct, idleMonths, billableDays: Math.round(billableDays), revenueForecast: Math.round(revenue), marginForecast,
  };
}

// Agrège les KPI de tout l'effectif + par BU + global. `canCost` gouverne l'exposition marge/coût.
function computeActivity(consultants, assignments, months, costById, canCost) {
  const rows = (consultants || []).map((c) => consultantKpi(c, assignments, months, canCost ? (costById && costById[c.id]) ?? null : null));
  const activeRows = rows.filter((r) => r.status === "active");
  const nActive = activeRows.length || 1;
  const global = {
    headcount: rows.length,
    active: activeRows.length,
    occupancyPct: Math.round(activeRows.reduce((s, r) => s + r.occupancyPct, 0) / nActive),
    // Taux d'intercontrat : part des mois-consultants actifs non staffés sur la plage.
    intercontratPct: Math.round(activeRows.reduce((s, r) => s + r.idleMonths, 0) / (nActive * Math.max(1, months.length)) * 100),
    revenueForecast: rows.reduce((s, r) => s + (r.revenueForecast || 0), 0),
    marginForecast: canCost ? rows.reduce((s, r) => s + (r.marginForecast || 0), 0) : null,
  };
  // Par BU : occupation moyenne + effectif.
  const buMap = {};
  for (const r of rows) { const k = r.bu || "—"; (buMap[k] || (buMap[k] = [])).push(r); }
  const byBu = Object.entries(buMap).map(([bu, rs]) => {
    const act = rs.filter((r) => r.status === "active");
    return {
      bu, headcount: rs.length, active: act.length,
      occupancyPct: act.length ? Math.round(act.reduce((s, r) => s + r.occupancyPct, 0) / act.length) : 0,
      revenueForecast: rs.reduce((s, r) => s + (r.revenueForecast || 0), 0),
      marginForecast: canCost ? rs.reduce((s, r) => s + (r.marginForecast || 0), 0) : null,
    };
  }).sort((a, b) => b.headcount - a.headcount);
  return { global, byBu, rows: rows.sort((a, b) => a.occupancyPct - b.occupancyPct) };
}

module.exports = { WORKING_DAYS_PER_MONTH, consultantKpi, computeActivity };
