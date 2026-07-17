// Funnel de conversion commercial à partir de l'HISTORIQUE des transitions d'étape (oppHistory).
// La source Sales_DATA n'a ni date de création ni historique → un vrai taux de conversion étape→étape
// n'est PAS dérivable rétroactivement. On journalise donc chaque changement d'étape (patch/board) dans
// oppHistory et on en dérive ici, à partir de MAINTENANT, un funnel réel. Il est cumulatif TANT QUE
// l'historique tient dans la fenêtre de lecture bornée de l'agrégat ; au-delà, c'est une fenêtre
// glissante sur les transitions les plus récentes — l'agrégat le signale via `truncated` (cf. audit
// intégral A1), à charge de l'UI de le présenter honnêtement. Fonction PURE (testable).
//
// @param {Array<{from?:number,to?:number,amount?:number,at?:any}>} history
// @returns {{transitions:{from:number,to:number,count:number,amount:number}[], won:number, lost:number,
//            advanced:number, regressed:number, winRate:number, total:number}}
function oppFunnel(history) {
  const trans = new Map(); // "from>to" → {from,to,count,amount}
  let won = 0, lost = 0, advanced = 0, regressed = 0, total = 0;
  for (const h of Array.isArray(history) ? history : []) {
    const from = Number(h && h.from) || 0;
    const to = Number(h && h.to) || 0;
    if (!to) continue; // transition inexploitable (pas d'étape cible)
    total++;
    const k = `${from}>${to}`;
    const e = trans.get(k) || { from, to, count: 0, amount: 0 };
    e.count++;
    e.amount += Number(h && h.amount) || 0;
    trans.set(k, e);
    if (to === 6) won++;             // passage en Gagné
    else if (to === 7) lost++;       // passage en Perdu
    if (to > from && to <= 5) advanced++;        // progression dans le funnel actif
    else if (from >= 1 && from <= 5 && to < from) regressed++; // recul dans le funnel actif
  }
  const transitions = [...trans.values()].sort((a, b) => (a.from - b.from) || (a.to - b.to));
  const winRate = (won + lost) > 0 ? won / (won + lost) : 0;
  return { transitions, won, lost, advanced, regressed, winRate, total };
}

// Taux de PROGRESSION par étape (« où meurent les deals ») dérivé des transitions : pour chaque étape
// ACTIVE de départ N (1-5), part des sorties qui PROGRESSENT (to > N, y compris Gagné) vs PERDUES (to=7)
// vs RECULENT (to < N). NB : dérivé d'ÉVÉNEMENTS de transition (la source n'a pas de date de création),
// c'est un taux de progression OBSERVÉ, pas un taux de conversion de cohorte. PUR.
function stageConversion(history) {
  const byStage = new Map();
  const ensure = (s) => { let e = byStage.get(s); if (!e) { e = { stage: s, out: 0, advanced: 0, regressed: 0, lost: 0, won: 0 }; byStage.set(s, e); } return e; };
  for (const h of Array.isArray(history) ? history : []) {
    const from = Number(h && h.from) || 0;
    const to = Number(h && h.to) || 0;
    if (from < 1 || from > 5 || !to) continue; // on ne mesure QUE les sorties d'une étape active
    const e = ensure(from);
    e.out++;
    if (to === 7) e.lost++;
    else if (to > from && to <= 6) { e.advanced++; if (to === 6) e.won++; } // progression funnel actif, Gagné (6) inclus ; 8·suspendu / 9·annulé ne sont PAS une avancée
    else if (to < from) e.regressed++; // from déjà borné 1-5 par le continue ci-dessus
    // to === from, ou sortie vers 8·suspendu / 9·annulé : ni progression ni recul
  }
  return [...byStage.values()]
    .map((e) => ({ ...e, advanceRate: e.out > 0 ? e.advanced / e.out : 0, lossRate: e.out > 0 ? e.lost / e.out : 0 }))
    .sort((a, b) => a.stage - b.stage);
}

module.exports = { oppFunnel, stageConversion };
