// Pipeline pondéré (BUILD_KIT §7, §18.5).
// Actif = étapes 1-5, veille = 8, conversion = 6 (gagné) vs 7 (perdu).
// Pondéré = Σ(montant × proba). Phasage par mois de closingDate.
const { sum } = require("./chaine");
const { groupSum } = require("./backlog");

// Indice de confiance minimum pour le pipeline PONDÉRÉ (règle métier).
const CONFIANCE_MIN = 0.9;
const isActive = (o) => o.stage >= 1 && o.stage <= 5;
// Éligible au pondéré : actif (donc non perdu/annulé/suspendu) ET IdC ≥ 90 %.
const isEligible = (o) => isActive(o) && (o.probability || 0) >= CONFIANCE_MIN;

function pipeline(opps) {
  const active = opps.filter(isActive);
  const eligible = opps.filter(isEligible);
  const suspended = opps.filter((o) => o.stage === 8);
  const won = opps.filter((o) => o.stage === 6);
  const lost = opps.filter((o) => o.stage === 7);

  const byStage = {};
  for (const o of opps) {
    const s = o.stage || 0;
    byStage[s] = byStage[s] || { count: 0, amount: 0, weighted: 0 };
    byStage[s].count++;
    byStage[s].amount += o.amount || 0;
    byStage[s].weighted += o.weighted || 0;
  }

  const month = (o) => (o.closingDate ? String(o.closingDate).slice(0, 7) : "?");
  // Top opportunités : celles éligibles (IdC ≥ 90 %), triées par montant pondéré.
  const topOpps = [...eligible]
    .sort((a, b) => (b.weighted || 0) - (a.weighted || 0))
    .slice(0, 10)
    .map((o) => ({ oppId: o.oppId, client: o.client, am: o.am, bu: o.bu, amount: o.amount, weighted: o.weighted, stage: o.stage, probability: o.probability }));

  // Conversion par commercial (AM) : gagné / perdu / taux de transformation + pipeline actif pondéré.
  const ams = [...new Set(opps.map((o) => o.am).filter(Boolean))];
  const byAmConv = ams
    .map((am) => {
      const w = won.filter((o) => o.am === am).length;
      const l = lost.filter((o) => o.am === am).length;
      const act = active.filter((o) => o.am === am);
      return { am, won: w, lost: l, conv: w + l > 0 ? w / (w + l) : 0, activeCount: act.length, weighted: sum(eligible.filter((o) => o.am === am), (o) => o.weighted) };
    })
    .filter((x) => x.won + x.lost + x.activeCount > 0)
    .sort((a, b) => (b.weighted - a.weighted) || (b.won - a.won));

  const wonCount = won.length, lostCount = lost.length;
  return {
    // brut = toute la funnel active ; pondéré = éligibles (non perdu/suspendu, IdC ≥ 90 %).
    tot: { brut: sum(active, (o) => o.amount), weighted: sum(eligible, (o) => o.weighted), count: active.length, countConf: eligible.length },
    susp: { brut: sum(suspended, (o) => o.amount), count: suspended.length },
    confianceMin: CONFIANCE_MIN,
    byStage,
    byAM: groupSum(eligible, (o) => o.am, (o) => o.weighted),
    byBU: groupSum(eligible, (o) => o.bu, (o) => o.weighted),
    byMonth: groupSum(eligible, month, (o) => o.weighted),
    conv: wonCount + lostCount > 0 ? wonCount / (wonCount + lostCount) : 0,
    wonCount,
    lostCount,
    byAmConv,
    topOpps,
  };
}

module.exports = { pipeline, isActive, isEligible, CONFIANCE_MIN };
