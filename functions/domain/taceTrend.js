// HISTORISATION TACE + TENDANCE (Lot 22 « 20/10 DirOps ») — série MENSUELLE du TACE constaté (Taux
// d'Activité Congés Exclus) et de l'occupation, dérivée du CRA (Lot 15). Répond à « le TACE s'améliore-t-il
// ou se dégrade-t-il ? » — une TENDANCE, pas un seul chiffre agrégé. DÉRIVÉ À LA DEMANDE des CRA (source
// de vérité) → toujours à jour, même après correction d'un mois passé (pas de snapshot périmé, cohérent
// avec la philosophie « tout se recalcule depuis la source » du recompute).
//
// Fonctions PURES (aucun I/O) → testables.

const WORKING_DAYS_PER_MONTH = 20; // cohérent avec timesheet / activityKpi

function num(v) { const n = Number(v); return Number.isFinite(n) && n >= 0 ? n : 0; }

// TACE + occupation d'UN groupe de CRA (un mois, éventuellement filtré par BU). workable = Σ(ouvrés − congés)
// = têtes × ouvrés − congés (définition « congés exclus »). tacePct/occupancyPct = null si dénominateur nul.
function monthPoint(rows, workingDays = WORKING_DAYS_PER_MONTH) {
  const billed = rows.reduce((s, t) => s + num(t.billedDays), 0);
  const leave = rows.reduce((s, t) => s + num(t.leaveDays), 0);
  const internal = rows.reduce((s, t) => s + num(t.internalDays), 0);
  const heads = new Set(rows.map((t) => t.consultantId)).size;
  const workable = Math.max(0, heads * workingDays - leave); // congés exclus
  const capacity = Math.max(0, heads * workingDays);
  return {
    headcount: heads, billedDays: billed, leaveDays: leave, internalDays: internal,
    tacePct: workable > 0 ? Math.round((billed / workable) * 100) : null,
    occupancyPct: capacity > 0 ? Math.round(((billed + internal) / capacity) * 100) : null,
  };
}

// Série mensuelle (global + par BU) + résumé de tendance : dernier, moyenne, écart vs mois précédent, pente
// (régression linéaire = points de TACE gagnés/perdus par mois) et direction. `months` = plage ordonnée.
function computeTaceTrend(timesheets, consultants, months, workingDays = WORKING_DAYS_PER_MONTH) {
  const buById = {};
  for (const c of consultants || []) buById[c.id] = c.bu || "—";
  const byMonth = {};
  for (const t of timesheets || []) { if (t && t.month) (byMonth[t.month] = byMonth[t.month] || []).push(t); }

  const series = (months || []).map((m) => {
    const rows = byMonth[m] || [];
    const p = monthPoint(rows, workingDays);
    const buMap = {};
    for (const t of rows) { const k = buById[t.consultantId] || "—"; (buMap[k] = buMap[k] || []).push(t); }
    const byBu = Object.entries(buMap)
      .map(([bu, rs]) => ({ bu, ...monthPoint(rs, workingDays) }))
      .sort((a, b) => (a.bu < b.bu ? -1 : 1));
    return { month: m, ...p, byBu };
  });

  // Résumé calculé sur les mois RENSEIGNÉS uniquement (tacePct != null) — un mois sans CRA ne compte pas.
  const pts = series.filter((s) => s.tacePct != null);
  const latest = pts.length ? pts[pts.length - 1].tacePct : null;
  const previous = pts.length > 1 ? pts[pts.length - 2].tacePct : null;
  const avg = pts.length ? Math.round(pts.reduce((s, p) => s + p.tacePct, 0) / pts.length) : null;
  const delta = latest != null && previous != null ? latest - previous : null;
  // Pente = régression linéaire (moindres carrés) du TACE sur l'index de mois renseigné (arrondie au 1/10).
  let slope = null;
  if (pts.length >= 2) {
    const n = pts.length;
    const xs = pts.map((_, i) => i);
    const ys = pts.map((p) => p.tacePct);
    const mx = xs.reduce((a, b) => a + b, 0) / n;
    const my = ys.reduce((a, b) => a + b, 0) / n;
    let numr = 0, den = 0;
    for (let i = 0; i < n; i++) { numr += (xs[i] - mx) * (ys[i] - my); den += (xs[i] - mx) ** 2; }
    slope = den > 0 ? Math.round((numr / den) * 10) / 10 : 0;
  }
  // Direction : au-delà de ±1 pt/mois on parle de tendance ; en deçà, on considère le TACE stable.
  const direction = slope == null ? "flat" : slope > 1 ? "up" : slope < -1 ? "down" : "flat";
  return { series, summary: { latest, previous, avg, delta, slope, direction, points: pts.length } };
}

module.exports = { WORKING_DAYS_PER_MONTH, monthPoint, computeTaceTrend };
