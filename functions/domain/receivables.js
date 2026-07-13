// Créances clients (Cash / DSO) : encours facturé non encaissé, balance âgée par ancienneté
// d'échéance, et DSO indicatif. Module PUR (testable).
const DAY = 86400000;
const days = (a, b) => Math.floor((Date.parse(a) - Date.parse(b)) / DAY);

// AVOIRS (notes de crédit — factures à montant NÉGATIF). Le CAF (chiffre d'affaires facturé) les
// nette déjà côté revenu ; mais l'AR / la trésorerie les IGNORAIENT (filtre `> 0`) → l'encours à
// recouvrer était SUR-ESTimé (audit cash HIGH : un client crédité d'un avoir semblait devoir le
// brut). On NETTE l'avoir PAR CLIENT contre ses factures ouvertes positives, borné au montant dû
// (un avoir excédentaire ne réduit pas la dette d'un AUTRE client, ni ne crée d'AR négatif).
// Renvoie les positives (à âger), le net par client, et les avoirs totaux / imputés. PUR, partagé.
function splitAvoirs(open) {
  const positives = [], posByClient = {}, avoirByClient = {};
  let avoirsTotal = 0;
  for (const i of open || []) {
    const amt = i.amountHt || 0;
    const cl = i.client || "—";
    if (amt > 0) { positives.push(i); posByClient[cl] = (posByClient[cl] || 0) + amt; }
    else if (amt < 0) { avoirByClient[cl] = (avoirByClient[cl] || 0) + (-amt); avoirsTotal += -amt; }
  }
  const netByClient = {};
  let avoirsApplied = 0;
  for (const [cl, pos] of Object.entries(posByClient)) {
    const applied = Math.min(avoirByClient[cl] || 0, pos); // borné à la dette du client
    avoirsApplied += applied;
    netByClient[cl] = pos - applied;
  }
  return { positives, posByClient, netByClient, avoirsTotal, avoirsApplied };
}

/**
 * @param {object[]} invoices factures (invoices/*) : {amountHt, date, dueDate, paid, client}
 * @param {string} asOf date du jour (YYYY-MM-DD)
 */
function receivables(invoices, asOf) {
  const today = asOf || new Date().toISOString().slice(0, 10);
  // Ouvertes = non encaissées, montant non nul (positives = créances, négatives = avoirs à imputer).
  const openAll = (invoices || []).filter((i) => !i.paid && (i.amountHt || 0) !== 0);
  const { positives: open, netByClient, avoirsTotal, avoirsApplied } = splitAvoirs(openAll);
  const buckets = { notDue: 0, b0_30: 0, b31_60: 0, b61_90: 0, b90p: 0 };
  let grossAR = 0, overdue = 0, overdueCount = 0;

  for (const i of open) {
    const amt = i.amountHt || 0;
    grossAR += amt;
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

  // AR NET des avoirs = brut âgé − avoirs imputés par client. C'est l'encours réellement recouvrable
  // (cohérent avec le CAF qui nette déjà les avoirs). Les seaux d'ancienneté restent BRUTS (on âge
  // les factures ouvertes réelles) → grossAR exposé à part pour la cohérence Σ seaux = grossAR.
  const totalAR = Math.max(grossAR - avoirsApplied, 0);

  // DSO indicatif = AR net / (CAF facturé net sur 365 jours glissants ÷ 365). Le CAF nette déjà les
  // avoirs (amountHt négatifs inclus dans la somme) → numérateur et dénominateur cohérents.
  const billed365 = (invoices || []).reduce((s, i) => {
    const d = i.date; if (!d) return s;
    const age = days(today, d);
    return age >= 0 && age <= 365 ? s + (i.amountHt || 0) : s; // avoirs (négatifs) nettés
  }, 0);
  // Borné à 999 j : une cadence de facturation très faible devant l'encours ferait exploser le
  // ratio (encours/cadence) vers des valeurs aberrantes (ex. 3 650 000 j). Au-delà, non significatif.
  const dso = billed365 > 0 ? Math.min(999, Math.round(totalAR / (billed365 / 365))) : 0;

  const topAR = Object.entries(netByClient)
    .map(([key, value]) => ({ key, value }))
    .filter((r) => r.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, 10);

  return { totalAR, grossAR, avoirs: avoirsApplied, avoirsTotal, overdue, overdueCount, openCount: open.length, buckets, dso, topAR };
}

module.exports = { receivables, splitAvoirs };
