// Pipeline pondéré (BUILD_KIT §7, §18.5).
// Actif = étapes 1-5, veille = 8, conversion = 6 (gagné) vs 7 (perdu).
// « Pondéré » = PROJECTION tiérée UNIQUE (chaine.projectionWeight : 100 % si IdC ≥ 90 %, 20 % si
// 70-90 %, 10 % si 50-70 %, 0 sinon). Le KPI Pondéré, les ventilations, le funnel par étape et
// l'analyse de closing utilisent tous cette même règle (cohérence avec l'atterrissage).
const { sum, projectionWeight } = require("./chaine");
const { groupSum } = require("./backlog");

const CONFIANCE_MIN = 0.9;
const isActive = (o) => o.stage >= 1 && o.stage <= 5;
// Éligible « certain » (IdC ≥ 90 %) — conservé pour les certitudes.
const isEligible = (o) => isActive(o) && (o.probability || 0) >= CONFIANCE_MIN;

// Analyse temporelle du closing (D Prev) sur les opps ACTIVES — uniquement à partir de la
// closingDate réelle (aucune date de création/étape en source → pas de vélocité/âge inventés).
function closingAnalysis(active, asOf) {
  const today = String(asOf);
  const ym = today.slice(0, 7), yr = today.slice(0, 4);
  const q = Math.floor((Number(today.slice(5, 7)) - 1) / 3);
  const mk = () => ({ brut: 0, pond: 0, count: 0 });
  const B = { retard: mk(), mois: mk(), trim: mk(), plus: mk(), sans: mk() };
  const stale = [];
  for (const o of active) {
    const d = o.closingDate ? String(o.closingDate) : "";
    let key;
    if (!d) key = "sans";
    else if (d < today) key = "retard"; // clôture prévue déjà passée → à requalifier
    else if (d.slice(0, 7) === ym) key = "mois";
    else if (d.slice(0, 4) === yr && Math.floor((Number(d.slice(5, 7)) - 1) / 3) === q) key = "trim";
    else key = "plus";
    B[key].brut += o.amount || 0; B[key].pond += projectionWeight(o); B[key].count++;
    if (key === "retard") stale.push(o);
  }
  const staleTop = stale
    .sort((a, b) => projectionWeight(b) - projectionWeight(a))
    .slice(0, 10)
    .map((o) => ({ oppId: o.oppId, client: o.client, am: o.am, amount: o.amount, weighted: projectionWeight(o), closingDate: o.closingDate, stageLabel: o.stageLabel }));
  return { buckets: B, staleCount: stale.length, staleBrut: stale.reduce((s, o) => s + (o.amount || 0), 0), staleTop };
}

function pipeline(opps, asOf) {
  const active = opps.filter(isActive);
  const projected = active.filter((o) => projectionWeight(o) > 0); // contribuent à la projection (IdC ≥ 50 %)
  const suspended = opps.filter((o) => o.stage === 8);
  const won = opps.filter((o) => o.stage === 6);
  const lost = opps.filter((o) => o.stage === 7);

  const byStage = {};
  for (const o of opps) {
    const s = o.stage || 0;
    byStage[s] = byStage[s] || { count: 0, amount: 0, weighted: 0 };
    byStage[s].count++;
    byStage[s].amount += o.amount || 0;
    byStage[s].weighted += projectionWeight(o); // funnel = projection tiérée
  }

  const month = (o) => (o.closingDate ? String(o.closingDate).slice(0, 7) : "?");
  // Top opportunités contribuant à la projection, triées par montant PROJETÉ.
  const topOpps = [...projected]
    .sort((a, b) => projectionWeight(b) - projectionWeight(a))
    .slice(0, 10)
    .map((o) => ({ oppId: o.oppId, client: o.client, am: o.am, bu: o.bu, amount: o.amount, weighted: projectionWeight(o), stage: o.stage, probability: o.probability }));

  // Conversion par commercial (AM) : gagné / perdu / taux + pipeline actif projeté.
  const ams = [...new Set(opps.map((o) => o.am).filter(Boolean))];
  const byAmConv = ams
    .map((am) => {
      const w = won.filter((o) => o.am === am).length;
      const l = lost.filter((o) => o.am === am).length;
      const act = active.filter((o) => o.am === am);
      return { am, won: w, lost: l, conv: w + l > 0 ? w / (w + l) : 0, activeCount: act.length, weighted: sum(act, projectionWeight) };
    })
    .filter((x) => x.won + x.lost + x.activeCount > 0)
    .sort((a, b) => (b.weighted - a.weighted) || (b.won - a.won));

  const wonCount = won.length, lostCount = lost.length;
  return {
    // brut = toute la funnel active ; « pondéré » = PROJECTION tiérée (100/20/10) des actives.
    tot: { brut: sum(active, (o) => o.amount), weighted: sum(active, projectionWeight), count: active.length, countConf: projected.length },
    susp: { brut: sum(suspended, (o) => o.amount), count: suspended.length },
    confianceMin: CONFIANCE_MIN,
    byStage,
    byAM: groupSum(active, (o) => o.am, projectionWeight),
    byBU: groupSum(active, (o) => o.bu, projectionWeight),
    byMonth: groupSum(active, month, projectionWeight),
    conv: wonCount + lostCount > 0 ? wonCount / (wonCount + lostCount) : 0,
    wonCount,
    lostCount,
    byAmConv,
    topOpps,
    // Analyse du closing (D Prev) : seulement si asOf fourni (sinon null, rétro-compat).
    closing: asOf ? closingAnalysis(active, asOf) : null,
  };
}

module.exports = { pipeline, closingAnalysis, isActive, isEligible, CONFIANCE_MIN };
