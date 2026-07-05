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
 * Décaissements fournisseurs attendus. RÈGLE SOA : seule une FACTURE fournisseur est due — on ne
 * paie pas un BC non encore facturé. Le PAYABLE (position de trésorerie) = BC au statut « facturé »
 * (non payés), positionné au mois de son ETA (réel sinon contractuel). ETA inconnue → mois courant ;
 * ETA passée → isolée « en retard » (overdue), HORS échéancier futur (symétrique avec l'AR).
 * Les BC NON facturés (a_emettre/emis/livre) forment un ENGAGEMENT à venir (engaged*), compté À PART
 * — sortie de cash POTENTIELLE, hors position nette de base (repris en scénario prudent).
 * @param {object[]} bcLines lignes BC (amountXof, status, etaReel, etaContrat)
 * @param {string} asOf date du jour (YYYY-MM-DD)
 * @param {{horizon?: number}} [opts]
 */
const COMMITTED_BC = new Set(["a_emettre", "emis", "livre"]);
function decaissements(bcLines, asOf, opts = {}) {
  const horizon = Math.max(1, opts.horizon || 6);
  const today = asOf || new Date().toISOString().slice(0, 10);
  const months = monthList(today, horizon);
  const curMonth = months[0];
  const inHorizon = new Set(months);
  const out = Object.fromEntries(months.map((m) => [m, 0]));
  const engagedOut = Object.fromEntries(months.map((m) => [m, 0]));
  let beyond = 0, total = 0, overdue = 0, overdueCount = 0, payableCount = 0;
  let engagedTotal = 0, engagedCount = 0, engagedBeyond = 0;
  let etaKnown = 0, noEtaCount = 0; // fiabilité de la prévision : part du payable à ETA connue

  for (const b of bcLines || []) {
    const amt = b.amountXof || 0;
    if (amt <= 0) continue;
    const eta = b.etaReel || b.etaContrat;
    const mk = eta ? String(eta).slice(0, 7) : null;
    if (b.status === "facture") {
      // PAYABLE : facture fournisseur due (règle SOA).
      total += amt; payableCount++;
      if (!eta) { out[curMonth] += amt; noEtaCount++; continue; }
      etaKnown += amt;
      if (cmpDay(eta) < today) { overdue += amt; overdueCount++; continue; }
      if (inHorizon.has(mk)) out[mk] += amt; else beyond += amt;
    } else if (COMMITTED_BC.has(b.status)) {
      // ENGAGEMENT : commandé non facturé → sortie potentielle, hors position nette de base.
      engagedTotal += amt; engagedCount++;
      if (!eta || cmpDay(eta) < today) { engagedOut[curMonth] += amt; continue; } // pas d'ETA / ETA passée → imminent
      if (inHorizon.has(mk)) engagedOut[mk] += amt; else engagedBeyond += amt;
    }
    // status 'solde' (payé) → hors compte.
  }
  return {
    months: months.map((m) => ({ month: m, out: out[m], engaged: engagedOut[m] })),
    total, beyond, overdue, overdueCount, openCount: payableCount,
    etaKnown, noEtaCount, etaCompleteness: total > 0 ? etaKnown / total : 1,
    engagedTotal, engagedCount, engagedBeyond,
  };
}

module.exports = { cashflow, decaissements, monthList };
