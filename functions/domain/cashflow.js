// Prévision de trésorerie (cash forecast) — module PUR (testable).
// Échéancier mensuel glissant des encaissements ATTENDUS :
//   • AR contractuel  = créances émises non encaissées, positionnées au mois de leur échéance
//     (dueDate sinon date). Les créances SANS échéance → mois courant. Les créances ÉCHUES
//     (échéance passée) sont isolées en « en retard » (à recouvrer), hors échéancier futur.
//   • Backlog indicatif = RAF total (reste à facturer) étalé linéairement sur l'horizon.
//     C'est une PROJECTION (pas un contrat) — présentée à part, jamais mêlée à l'AR.
// Aucune date de règlement réelle en source → on n'invente pas de précision : l'AR est ancré sur
// les échéances réelles, le backlog est explicitement indicatif.

function monthList(asOf, horizon) {
  const [y0, m0] = String(asOf).split("-").map(Number); // m0 : 1..12
  const out = [];
  for (let k = 0; k < horizon; k++) {
    const idx = (m0 - 1) + k;
    const yy = y0 + Math.floor(idx / 12);
    const mm = (idx % 12) + 1;
    out.push(`${yy}-${String(mm).padStart(2, "0")}`);
  }
  return out;
}

/**
 * @param {object[]} invoices factures (invoices/*) : {amountHt, date, dueDate, paid}
 * @param {object[]} orders commandes fusionnées (raf par FP)
 * @param {string} asOf date du jour (YYYY-MM-DD)
 * @param {{horizon?: number}} [opts] horizon en mois (défaut 6)
 */
function cashflow(invoices, orders, asOf, opts = {}) {
  const horizon = Math.max(1, opts.horizon || 6);
  const today = asOf || new Date().toISOString().slice(0, 10);
  const months = monthList(today, horizon);
  const curMonth = months[0];
  const inHorizon = new Set(months);
  const monthOf = (d) => String(d).slice(0, 7);

  const open = (invoices || []).filter((i) => !i.paid && (i.amountHt || 0) > 0);
  const ar = Object.fromEntries(months.map((m) => [m, 0]));
  let overdue = 0, overdueCount = 0, beyond = 0;

  for (const i of open) {
    const amt = i.amountHt || 0;
    const due = i.dueDate || i.date;
    if (!due) { ar[curMonth] += amt; continue; } // échéance inconnue → attendu ce mois
    // « En retard » au JOUR (comme receivables) : une échéance déjà passée, même DANS le mois
    // courant, compte comme échue → cohérence des deux tuiles « En retard » sur la même page.
    if (String(due) < today) { overdue += amt; overdueCount++; continue; }
    const mk = monthOf(due);
    if (inHorizon.has(mk)) ar[mk] += amt;
    else beyond += amt; // au-delà de l'horizon
  }

  // Backlog RAF (glissant, toutes commandes ouvertes) étalé également sur l'horizon : INDICATIF.
  const totalRaf = (orders || []).reduce((s, o) => s + (o.raf || 0), 0);
  const backlogPerMonth = totalRaf / horizon;

  let cumAr = 0;
  const rowsMonthly = months.map((m) => {
    cumAr += ar[m];
    return { month: m, ar: ar[m], backlog: Math.round(backlogPerMonth), cumulAr: cumAr };
  });

  const totalAR = open.reduce((s, i) => s + (i.amountHt || 0), 0);
  const arHorizon = months.reduce((s, m) => s + ar[m], 0);
  return {
    asOf: today, horizon, months: rowsMonthly,
    overdue, overdueCount, beyond,
    totalAR, arHorizon, totalRaf, openCount: open.length,
  };
}

module.exports = { cashflow, monthList };
