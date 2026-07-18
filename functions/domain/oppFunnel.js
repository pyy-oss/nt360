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

// TEMPS PAR ÉTAPE (« time-in-stage ») dérivé du MÊME journal des transitions (oppHistory). Pour une opp,
// deux transitions consécutives e_i → e_{i+1} (triées par horodatage) encadrent un SÉJOUR : entre e_i.at
// (l'opp est entrée en étape e_i.to) et e_{i+1}.at (elle en sort), elle a passé (e_{i+1}.at − e_i.at) dans
// l'étape e_i.to. On agrège la DURÉE MOYENNE de séjour par étape ACTIVE (1-5). On ne compte QUE les séjours
// CLOS (entrée ET sortie journalisées) : l'étape courante d'une opp (entrée sans sortie) n'a pas de fin, donc
// pas de durée inventée. Comme le funnel, la mesure se construit à partir de MAINTENANT et sur la même
// fenêtre glissante. Attend des événements avec `atMs` (ms epoch) déjà résolu (parité slippage). PUR.
const DAY_MS = 86400000;
function stageDwell(events) {
  const byOpp = new Map();
  for (const e of Array.isArray(events) ? events : []) {
    const id = String((e && e.oppId) || "");
    if (!id) continue; // sans oppId, impossible de reconstituer une trajectoire
    let g = byOpp.get(id); if (!g) { g = []; byOpp.set(id, g); }
    g.push(e);
  }
  const acc = new Map(); // stage → { stage, totalMs, count }
  for (const evs of byOpp.values()) {
    evs.sort((a, b) => (Number(a.atMs) || 0) - (Number(b.atMs) || 0));
    for (let i = 0; i < evs.length - 1; i++) {
      const stage = Number(evs[i].to) || 0; // étape occupée APRÈS la transition e_i
      if (stage < 1 || stage > 5) continue;  // durée de séjour n'a de sens que dans le funnel actif
      const dtMs = (Number(evs[i + 1].atMs) || 0) - (Number(evs[i].atMs) || 0);
      if (!(dtMs > 0)) continue; // horodatages manquants/incohérents → séjour ignoré
      const a = acc.get(stage) || { stage, totalMs: 0, count: 0 };
      a.totalMs += dtMs; a.count++; acc.set(stage, a);
    }
  }
  return [...acc.values()]
    .map((a) => ({ stage: a.stage, count: a.count, avgDays: Math.round(a.totalMs / a.count / DAY_MS) }))
    .sort((a, b) => a.stage - b.stage);
}

module.exports = { oppFunnel, stageConversion, stageDwell };
