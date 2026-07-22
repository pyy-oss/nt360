// VÉLOCITÉ COMMERCIALE (Lot 8b « niveau Salesforce ») — indicateurs de dynamique du pipeline sur un jeu
// d'opportunités : taux de gain, deal moyen, pipeline pondéré ouvert, et un INDICE DE VÉLOCITÉ (proxy à
// la Salesforce). Comble le volet « vélocité » de l'écart #8. Fonction PURE (aucun I/O) → testable.
//
// Indice de vélocité = nb d'opps ouvertes × taux de gain × deal moyen. On documente qu'il s'agit d'un
// proxy (la durée de cycle réelle nécessiterait des dates de création fiables, absentes des sources).

const { projectionWeight } = require("./projection");
const { isWonOpp, isLostOpp } = require("./oppLifecycle");
const { fpKey } = require("../lib/ids");

// `bookedFps` (Set de fpKey déjà au carnet P&L) : une opp active dont le FP porte DÉJÀ une commande est
// réalisée (comptée dans le CAS) → l'inclure dans le pondéré OUVERT la double-compterait, en rupture avec
// la parité `notBooked` du cockpit/atterrissage (invariant « même libellé = même nombre »). On l'exclut.
function salesVelocity(opps, tiers, bookedFps) {
  const booked = bookedFps instanceof Set ? bookedFps : new Set();
  const notBooked = (o) => { const k = o.fp ? fpKey(o.fp) : ""; return !(k && booked.has(k)); };
  let won = 0, lost = 0, wonAmt = 0, openCount = 0, openWeighted = 0, openAmt = 0;
  for (const o of opps || []) {
    const st = Number(o.stage) || 0;
    const amt = Number(o.amount) || 0;
    // Win rate : gagné = étape 6 ; perdu = étape 7 OU 9 (annulé) OU auto-périmé par âge (règle métier unique,
    // oppLifecycle) — sinon annulés + périmées échappaient au dénominateur → taux optimiste. Les périmées
    // sortent aussi du pipeline OUVERT (isLostOpp les capte avant la branche « active »).
    if (isWonOpp(o)) { won++; wonAmt += amt; continue; }
    if (isLostOpp(o)) { lost++; continue; }
    if (st >= 1 && st <= 5) {
      if (!notBooked(o)) continue; // déjà au carnet → hors pipeline ouvert (parité cockpit, anti-double-compte)
      // Pondéré TIÉRÉ (projectionWeight) et NON le champ linéaire persisté `weighted` : source unique
      // avec le cockpit Pipeline/Overview, sinon le même libellé « pipeline pondéré » affiche 2 valeurs.
      openCount++; openWeighted += projectionWeight(o, tiers); openAmt += amt;
    }
  }
  const closed = won + lost;
  const winRate = closed > 0 ? won / closed : 0;
  const avgDeal = won > 0 ? wonAmt / won : (openCount > 0 ? openAmt / openCount : 0);
  const velocityIndex = Math.round(openCount * winRate * avgDeal);
  return { openCount, openWeighted: Math.round(openWeighted), winRate, avgDeal: Math.round(avgDeal), won, lost, velocityIndex };
}

module.exports = { salesVelocity };
