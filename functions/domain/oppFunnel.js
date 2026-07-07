// Funnel de conversion commercial à partir de l'HISTORIQUE des transitions d'étape (oppHistory).
// La source Sales_DATA n'a ni date de création ni historique → un vrai taux de conversion étape→étape
// n'est PAS dérivable rétroactivement. On journalise donc chaque changement d'étape (patch/board) dans
// oppHistory et on en dérive ici, à partir de MAINTENANT, un funnel réel (cumulatif dans le temps).
// Fonction PURE (testable).
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

module.exports = { oppFunnel };
