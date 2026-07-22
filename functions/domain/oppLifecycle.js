// Cycle de vie d'une opportunité — règles déduites de la FORMULE SOURCE de la feuille LIVE (Sales_DATA).
// RÈGLE D'AUTO-PERTE PAR ÂGE : la source déclare PERDUE toute affaire de plus d'un an dont la confiance
// (IdC) est ≤ 90 % — cf. `SI(ET([@Age Auto]>=366;[@IdC]<=90%);"9-LOST";…)`. On la réplique côté agrégat
// pour ne pas laisser une affaire périmée gonfler le pipeline pondéré / le funnel (dérive). PURE (testable).
const { p01 } = require("./projection"); // normalisation d'échelle IdC (0-100 saisi ⇄ 0-1 calcul)
const { plausibleYear } = require("../lib/ids"); // millésime borné (jamais une année de closing aberrante)
const AGE_LOST_DAYS = 366;
const AGE_LOST_IDC = 0.90;

/**
 * Vrai si l'opportunité (source LIVE, étape ACTIVE 1-5) est périmée selon la règle source d'auto-perte
 * par âge → à EXCLURE du pipeline actif et à signaler en Qualité. Non-destructif (purement calculé).
 * Les affaires sans `ageDays` connu ne sont JAMAIS exclues (fail-safe : pas d'âge → pas de verdict).
 * @param {{source?:string, stage?:number, ageDays?:number, probability?:number}} o
 */
function isAgedLost(o) {
  if (!o || o.source !== "salesData") return false;
  const stage = Number(o.stage) || 0;
  if (stage < 1 || stage > 5) return false; // déjà gagnée/perdue/suspendue/annulée : hors périmètre
  const age = Number(o.ageDays);
  if (!Number.isFinite(age) || age < AGE_LOST_DAYS) return false;
  return p01(Number(o.probability)) <= AGE_LOST_IDC;
}

/**
 * Vrai si l'opportunité est DORMANTE : OUVERTE (étape 1-5) mais dont l'ANNÉE de clôture prévue
 * (`closingDate`) est ANTÉRIEURE à l'exercice courant (`currentFy`). Une D Prev d'un millésime révolu
 * jamais reclassée gonfle la prévision cumulée (« Tout ») avec un espoir périmé → à EXCLURE sur option
 * et à surfacer en tuile dédiée. Millésime BORNÉ (plausibleYear) : un closingDate aberrant (1900) n'est
 * jamais « dormant » (fail-safe, comme isAgedLost pour l'âge). PURE.
 * @param {{stage?:number, closingDate?:string}} o
 * @param {number} currentFy exercice courant (max yearPo borné)
 */
function isDormantClosing(o, currentFy) {
  if (!o) return false;
  const fy = Number(currentFy) || 0;
  if (!fy) return false; // pas d'exercice connu → pas de verdict
  const stage = Number(o.stage) || 0;
  if (stage < 1 || stage > 5) return false; // gagnée/perdue/suspendue/annulée : hors périmètre
  const y = plausibleYear(Number(String(o.closingDate || "").slice(0, 4)));
  return y > 0 && y < fy;
}

// TAUX DE TRANSFORMATION (win rate) — définition MÉTIER UNIQUE, partagée par tous les calculs de conversion
// (pipeline.byAmConv/conv, am360.conv, velocity.winRate, front winLossBySegment). Un « gagné » = étape 6.
// Un « perdu » = étape 7 (Perdu) OU étape 9 (Annulé — un deal annulé est un non-gagné) OU auto-périmé par
// âge (isAgedLost : la source déclare « 9-LOST » une affaire > 366 j à IdC ≤ 90 %, mais sans re-stager l'opp
// côté données → elle reste 1-5). Sans ces deux ajouts, le dénominateur du win rate omettait des pertes
// réelles → taux structurellement OPTIMISTE, hors de la bande métier ESN (~15-25 %). Cf. audit commercial DC/DG.
function isWonOpp(o) { return o && Number(o.stage) === 6; }
function isLostOpp(o) {
  if (!o) return false;
  const s = Number(o.stage);
  return s === 7 || s === 9 || isAgedLost(o);
}

module.exports = { isAgedLost, isDormantClosing, isWonOpp, isLostOpp, AGE_LOST_DAYS, AGE_LOST_IDC };
