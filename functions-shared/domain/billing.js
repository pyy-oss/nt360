// Tendance de facturation de l'exercice : par mois (janvier→décembre), le RÉALISÉ (factures datées)
// et le PLANIFIÉ (jalons de facturation). La trajectoire vers le 31/12 combine le réalisé pour les
// mois échus (≤ mois courant) et le planifié pour les mois à venir → projeté de facturation au 31/12.
// Module PUR (testable). Aucune donnée marge (facturation = revenu).

/**
 * @param {object[]} invoices factures {date, amountHt}
 * @param {object[]} milestones jalons À PLAT {date, amount} (tous projets confondus)
 * @param {number|string} fy exercice
 * @param {string} asOf date du jour (YYYY-MM-DD)
 */
function billingTrend(invoices, milestones, fy, asOf) {
  const y = String(fy);
  const curMonth = String(asOf || "").slice(0, 7);
  const months = [];
  for (let m = 1; m <= 12; m++) months.push(`${y}-${String(m).padStart(2, "0")}`);
  const realise = Object.fromEntries(months.map((m) => [m, 0]));
  const planifie = Object.fromEntries(months.map((m) => [m, 0]));
  for (const i of invoices || []) { const ym = String(i.date || "").slice(0, 7); if (ym in realise) realise[ym] += i.amountHt || 0; }
  for (const j of milestones || []) { const ym = String(j.date || "").slice(0, 7); if (ym in planifie) planifie[ym] += j.amount || 0; }
  let cumReal = 0, cumTraj = 0;
  const rows = months.map((m) => {
    const r = realise[m], p = planifie[m];
    // Trajectoire : réalisé pour les mois PASSÉS, planifié pour les mois À VENIR, et pour le mois COURANT
    // le MAX(réalisé, planifié) — sinon un jalon planifié ce mois-ci mais pas encore facturé (r=0) s'évapore
    // de la projection (ni dans le réalisé échu, ni dans le planifié « strictement futur »).
    const retenu = m < curMonth ? r : (m > curMonth ? p : Math.max(r, p));
    cumReal += r;
    cumTraj += retenu;
    return { month: m, realise: r, planifie: p, retenu, cumulRealise: cumReal, cumulTrajectoire: cumTraj };
  });
  const realiseYtd = months.filter((m) => m <= curMonth).reduce((s, m) => s + realise[m], 0);
  const planifieRestant = months.filter((m) => m > curMonth).reduce((s, m) => s + planifie[m], 0);
  // Reliquat planifié du mois COURANT non encore facturé (part du plan au-delà du réalisé du mois).
  const curPlanGap = Math.max(0, (planifie[curMonth] || 0) - (realise[curMonth] || 0));
  return {
    fy: Number(fy) || fy, months: rows,
    realiseYtd,                       // facturé réalisé à date (mois échus, mois courant inclus)
    planifieRestant,                  // planifié restant (jalons des mois strictement à venir)
    projeteDec: realiseYtd + planifieRestant + curPlanGap, // projeté 31/12 (inclut le reliquat du mois courant)
  };
}

module.exports = { billingTrend };
