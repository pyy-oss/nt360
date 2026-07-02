// Créances clients (Cash / DSO) : encours facturé non encaissé, balance âgée par ancienneté
// d'échéance, et DSO indicatif. Module PUR (testable).
const DAY = 86400000;
const days = (a, b) => Math.floor((Date.parse(a) - Date.parse(b)) / DAY);

/**
 * @param {object[]} invoices factures (invoices/*) : {amountHt, date, dueDate, paid, client}
 * @param {string} asOf date du jour (YYYY-MM-DD)
 */
function receivables(invoices, asOf) {
  const today = asOf || new Date().toISOString().slice(0, 10);
  const open = (invoices || []).filter((i) => !i.paid && (i.amountHt || 0) > 0); // créances ouvertes
  const buckets = { notDue: 0, b0_30: 0, b31_60: 0, b61_90: 0, b90p: 0 };
  const byClient = {};
  let totalAR = 0, overdue = 0, overdueCount = 0;

  for (const i of open) {
    const amt = i.amountHt || 0;
    totalAR += amt;
    byClient[i.client || "—"] = (byClient[i.client || "—"] || 0) + amt;
    const ref = i.dueDate || i.date; // échéance sinon date de facture
    const late = ref ? days(today, ref) : NaN; // > 0 : en retard
    // Échéance inconnue OU illisible (NaN) → NON exigible (notDue) : ne pas la compter en
    // retard (cohérence Σ seaux de retard = overdue), ni la classer arbitrairement en > 90 j.
    if (!Number.isFinite(late) || late <= 0) buckets.notDue += amt;
    else {
      overdue += amt; overdueCount++;
      if (late <= 30) buckets.b0_30 += amt;
      else if (late <= 60) buckets.b31_60 += amt;
      else if (late <= 90) buckets.b61_90 += amt;
      else buckets.b90p += amt;
    }
  }

  // DSO indicatif = AR / (facturé sur 365 jours glissants ÷ 365). Sans dates de règlement,
  // c'est une approximation « encours vs cadence de facturation », pas un DSO comptable exact.
  const billed365 = (invoices || []).reduce((s, i) => {
    const d = i.date; if (!d) return s;
    const age = days(today, d);
    return age >= 0 && age <= 365 ? s + (i.amountHt || 0) : s;
  }, 0);
  const dso = billed365 > 0 ? Math.round(totalAR / (billed365 / 365)) : 0;

  const topAR = Object.entries(byClient)
    .map(([key, value]) => ({ key, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 10);

  return { totalAR, overdue, overdueCount, openCount: open.length, buckets, dso, topAR };
}

module.exports = { receivables };
