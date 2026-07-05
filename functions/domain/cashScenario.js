// Prévision cash AVANCÉE : scénarios best / base / worst de position de trésorerie, mois par mois,
// et détection de la TENSION (mois où la position cumulée pire passe sous le plancher). Module PUR
// (testable). Part de l'échéancier déjà calculé (cashflow : AR par mois d'échéance + échus ;
// decaissements : sorties par ETA + échus) et applique des hypothèses TRANSPARENTES et bornées :
//   • Encaissements : AR à l'échéance × taux de recouvrement ; échus recouvrés plus ou moins vite.
//   • Décaissements : sorties planifiées + payables échus payés plus ou moins tôt.
// Paramètres par défaut prudents (surchargeable). Aucune donnée de marge. Aucune donnée bancaire
// externe : la position cumule les FLUX à partir d'un solde d'ouverture (0 par défaut).
const r = (n) => Math.round(n);

const DEFAULTS = {
  collectBase: 0.95,   // taux de recouvrement de l'AR à échoir — scénario base
  collectWorst: 0.85,  // ... scénario worst
  recoveryMonths: 3,   // étalement du recouvrement des échus — base
  recoveryWorst: 0.8,  // fraction des échus finalement recouvrée — worst (le reste = perte sur l'horizon)
  opening: 0,          // solde d'ouverture (position cumulée = solde + Σ flux nets)
  tensionFloor: 0,     // plancher de tension (position cumulée sous ce seuil = tension)
};

/**
 * @param {object} input { asOf, months:[{month, ar, out}], overdueAr, overduePay }
 * @param {object} [params] surcharges des hypothèses (voir DEFAULTS)
 */
function cashScenario(input, params = {}) {
  const P = { ...DEFAULTS, ...(params || {}) };
  const months = Array.isArray(input.months) ? input.months : [];
  const H = months.length;
  const ar = months.map((m) => m.ar || 0);
  const out = months.map((m) => m.out || 0);
  const overdueAr = input.overdueAr || 0;
  const overduePay = input.overduePay || 0;

  // Étale un montant sur `count` premiers mois (borné à l'horizon) ; `first` le met au mois 1.
  const spread = (amount, count) => {
    const a = new Array(H).fill(0);
    if (H === 0) return a;
    const c = Math.min(H, Math.max(1, count));
    for (let k = 0; k < c; k++) a[k] = amount / c;
    return a;
  };
  const first = (amount) => { const a = new Array(H).fill(0); if (H) a[0] = amount; return a; };

  // Encaissements : best recouvre les échus tout de suite et l'AR à 100 % ; worst recouvre lentement
  // et partiellement, et applique une décote au recouvrement de l'AR à échoir.
  const recBest = first(overdueAr);
  const recBase = spread(overdueAr, P.recoveryMonths);
  const recWorst = spread(overdueAr * P.recoveryWorst, H);
  const encBest = ar.map((v, k) => v + recBest[k]);
  const encBase = ar.map((v, k) => v * P.collectBase + recBase[k]);
  const encWorst = ar.map((v, k) => v * P.collectWorst + recWorst[k]);

  // Décaissements : best diffère les payables échus (étalés → sortie proche plus faible) ; worst les
  // paie tous dès le 1er mois (sortie proche maximale). Les sorties planifiées (par ETA) sont communes.
  const payBest = spread(overduePay, H);
  const payBase = spread(overduePay, P.recoveryMonths);
  const payWorst = first(overduePay);
  const decBest = out.map((v, k) => v + payBest[k]);
  const decBase = out.map((v, k) => v + payBase[k]);
  const decWorst = out.map((v, k) => v + payWorst[k]);

  let cB = P.opening, cM = P.opening, cW = P.opening;
  const rows = months.map((m, k) => {
    const nB = encBest[k] - decBest[k], nM = encBase[k] - decBase[k], nW = encWorst[k] - decWorst[k];
    cB += nB; cM += nM; cW += nW;
    return {
      month: m.month,
      enc: { best: r(encBest[k]), base: r(encBase[k]), worst: r(encWorst[k]) },
      dec: { best: r(decBest[k]), base: r(decBase[k]), worst: r(decWorst[k]) },
      net: { best: r(nB), base: r(nM), worst: r(nW) },
      cum: { best: r(cB), base: r(cM), worst: r(cW) },
    };
  });

  // Tension = position cumulée PIRE (worst) sous le plancher : premier mois, nombre de mois, creux.
  let firstMonth = null, monthsCount = 0, trough = { month: null, value: H ? Infinity : 0 };
  for (const row of rows) {
    if (row.cum.worst < P.tensionFloor) { monthsCount++; if (!firstMonth) firstMonth = row.month; }
    if (row.cum.worst < trough.value) trough = { month: row.month, value: row.cum.worst };
  }
  return {
    asOf: input.asOf, horizon: H, opening: P.opening, params: P, months: rows,
    tension: { floor: P.tensionFloor, firstMonth, monthsCount, trough },
  };
}

module.exports = { cashScenario, CASH_SCENARIO_DEFAULTS: DEFAULTS };
