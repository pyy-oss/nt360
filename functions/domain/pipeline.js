// Pipeline pondéré (BUILD_KIT §7, §18.5).
// Actif = étapes 1-5, veille = 8, conversion = 6 (gagné) vs 7 (perdu).
// Pondéré = Σ(montant × proba). Phasage par mois de closingDate.
const { sum } = require("./chaine");
const { groupSum } = require("./backlog");

const isActive = (o) => o.stage >= 1 && o.stage <= 5;

function pipeline(opps) {
  const active = opps.filter(isActive);
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
  const topOpps = [...active]
    .sort((a, b) => (b.weighted || 0) - (a.weighted || 0))
    .slice(0, 10)
    .map((o) => ({ oppId: o.oppId, client: o.client, am: o.am, bu: o.bu, amount: o.amount, weighted: o.weighted, stage: o.stage }));

  const wonCount = won.length, lostCount = lost.length;
  return {
    tot: { brut: sum(active, (o) => o.amount), weighted: sum(active, (o) => o.weighted), count: active.length },
    susp: { brut: sum(suspended, (o) => o.amount), count: suspended.length },
    byStage,
    byAM: groupSum(active, (o) => o.am, (o) => o.weighted),
    byBU: groupSum(active, (o) => o.bu, (o) => o.weighted),
    byMonth: groupSum(active, month, (o) => o.weighted),
    conv: wonCount + lostCount > 0 ? wonCount / (wonCount + lostCount) : 0,
    wonCount,
    lostCount,
    topOpps,
  };
}

module.exports = { pipeline, isActive };
