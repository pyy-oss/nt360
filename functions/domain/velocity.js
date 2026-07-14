// VÉLOCITÉ COMMERCIALE (Lot 8b « niveau Salesforce ») — indicateurs de dynamique du pipeline sur un jeu
// d'opportunités : taux de gain, deal moyen, pipeline pondéré ouvert, et un INDICE DE VÉLOCITÉ (proxy à
// la Salesforce). Comble le volet « vélocité » de l'écart #8. Fonction PURE (aucun I/O) → testable.
//
// Indice de vélocité = nb d'opps ouvertes × taux de gain × deal moyen. On documente qu'il s'agit d'un
// proxy (la durée de cycle réelle nécessiterait des dates de création fiables, absentes des sources).

const { projectionWeight } = require("./projection");
const { isAgedLost } = require("./oppLifecycle");

function salesVelocity(opps, tiers) {
  let won = 0, lost = 0, wonAmt = 0, openCount = 0, openWeighted = 0, openAmt = 0;
  for (const o of opps || []) {
    const st = Number(o.stage) || 0;
    const amt = Number(o.amount) || 0;
    if (st === 6) { won++; wonAmt += amt; }
    else if (st === 7) { lost++; }
    else if (st >= 1 && st <= 5) {
      // Périmée par âge : exclue du pipeline actif, comme les agrégats (aggregate.js) → l'assiette
      // « ouvertes » du VelocityStrip colle aux en-têtes de colonnes du Board.
      if (isAgedLost(o)) continue;
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
