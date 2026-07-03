// Prévision de trésorerie (cash forecast) — module PUR (testable).
// Échéancier mensuel glissant des encaissements ATTENDUS :
//   • AR contractuel  = créances émises non encaissées, positionnées au mois de leur échéance
//     (dueDate sinon date). Les créances SANS échéance → mois courant. Les créances ÉCHUES
//     (échéance passée) sont isolées en « en retard » (à recouvrer), hors échéancier futur.
//   • Backlog indicatif = RAF total (reste à facturer) étalé linéairement sur l'horizon.
//     C'est une PROJECTION (pas un contrat) — présentée à part, jamais mêlée à l'AR.
// Aucune date de règlement réelle en source → on n'invente pas de précision : l'AR est ancré sur
// les échéances réelles, le backlog est explicitement indicatif.

// Jour de comparaison « en retard » (lexical, chaînes ISO). Une échéance au MOIS seul
// (« 2026-07 ») est ramenée à la fin du mois : sinon une facture due en juillet serait déclarée
// en retard dès le 1er juillet. (Comparaison de chaînes uniquement → « -31 » factice sans risque.)
const cmpDay = (d) => { const s = String(d); return s.length <= 7 ? s + "-31" : s.slice(0, 10); };

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
    if (cmpDay(due) < today) { overdue += amt; overdueCount++; continue; }
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

/**
 * Décaissements fournisseurs attendus : échéancier des sorties de cash à partir des lignes BC
 * NON SOLDÉES (on doit encore payer), positionnées au mois de leur ETA (réel sinon contractuel).
 * SYMÉTRIQUE avec l'AR (cashflow) : ETA inconnue → mois courant ; ETA PASSÉE → isolée « en retard »
 * (overdue), HORS échéancier futur — sinon la position nette (AR − décaissements) serait biaisée
 * (elle nettait des payables échus empilés sur le mois courant contre un AR échu, lui, sorti).
 * @param {object[]} bcLines lignes BC (amountXof, status, etaReel, etaContrat)
 * @param {string} asOf date du jour (YYYY-MM-DD)
 * @param {{horizon?: number}} [opts]
 */
function decaissements(bcLines, asOf, opts = {}) {
  const horizon = Math.max(1, opts.horizon || 6);
  const today = asOf || new Date().toISOString().slice(0, 10);
  const months = monthList(today, horizon);
  const curMonth = months[0];
  const inHorizon = new Set(months);
  const out = Object.fromEntries(months.map((m) => [m, 0]));
  let beyond = 0, total = 0, overdue = 0, overdueCount = 0;

  const open = (bcLines || []).filter((b) => b.status !== "solde" && (b.amountXof || 0) > 0);
  for (const b of open) {
    const amt = b.amountXof || 0;
    total += amt;
    const eta = b.etaReel || b.etaContrat;
    if (!eta) { out[curMonth] += amt; continue; } // ETA inconnue → dû ce mois (comme AR sans échéance)
    if (cmpDay(eta) < today) { overdue += amt; overdueCount++; continue; } // ETA passée → isolée (comme AR échu)
    const mk = String(eta).slice(0, 7);
    if (inHorizon.has(mk)) out[mk] += amt;
    else beyond += amt;
  }
  return { months: months.map((m) => ({ month: m, out: out[m] })), total, beyond, overdue, overdueCount, openCount: open.length };
}

module.exports = { cashflow, decaissements, monthList };
