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
    // Trajectoire : réalisé pour les mois échus (≤ mois courant), planifié pour les mois à venir.
    const retenu = m <= curMonth ? r : p;
    cumReal += r;
    cumTraj += retenu;
    return { month: m, realise: r, planifie: p, retenu, cumulRealise: cumReal, cumulTrajectoire: cumTraj };
  });
  const realiseYtd = months.filter((m) => m <= curMonth).reduce((s, m) => s + realise[m], 0);
  const planifieRestant = months.filter((m) => m > curMonth).reduce((s, m) => s + planifie[m], 0);
  return {
    fy: Number(fy) || fy, months: rows,
    realiseYtd,                       // facturé réalisé à date (mois échus)
    planifieRestant,                  // planifié restant (jalons des mois à venir)
    projeteDec: realiseYtd + planifieRestant, // projeté de facturation au 31/12
  };
}

module.exports = { billingTrend };
