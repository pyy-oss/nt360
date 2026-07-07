// Cycle de vie d'une opportunité — règles déduites de la FORMULE SOURCE de la feuille LIVE (Sales_DATA).
// RÈGLE D'AUTO-PERTE PAR ÂGE : la source déclare PERDUE toute affaire de plus d'un an dont la confiance
// (IdC) est ≤ 90 % — cf. `SI(ET([@Age Auto]>=366;[@IdC]<=90%);"9-LOST";…)`. On la réplique côté agrégat
// pour ne pas laisser une affaire périmée gonfler le pipeline pondéré / le funnel (dérive). PURE (testable).
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
  return Number(o.probability) <= AGE_LOST_IDC;
}

module.exports = { isAgedLost, AGE_LOST_DAYS, AGE_LOST_IDC };
