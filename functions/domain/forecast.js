// PRÉVISION COMMERCIALE GOUVERNABLE (Lot 5 « niveau Salesforce ») — catégories de prévision posées
// par le commercial, DISTINCTES de l'étape : le commercial ENGAGE une prévision (Commit) plutôt que de
// laisser la probabilité d'étape décider seule. Comble l'écart #5 de l'audit (prévision non gouvernable).
// Catégories CUMULATIVES façon Salesforce : Pipeline ⊇ Best Case ⊇ Commit ⊇ Closed (gagné).
//
// Fonctions PURES (aucun I/O) → testables.

const FORECAST_CATEGORIES = ["omitted", "pipeline", "best_case", "commit"];
const WON_STAGE = 6;   // Gagné (closed won)
const LOST_STAGE = 7;  // Perdu

// Catégorie par défaut d'une opportunité (si le commercial n'en a pas posé) : gagné → commit,
// perdu → omitted, sinon pipeline. Le commercial peut la remonter (best_case / commit) ou l'exclure.
function defaultCategory(opp) {
  const stage = Number(opp && opp.stage) || 0;
  if (stage === WON_STAGE) return "commit";
  if (stage === LOST_STAGE) return "omitted";
  return "pipeline";
}

// Catégorie effective (posée sinon défaut), validée contre la liste.
function effectiveCategory(opp) {
  const c = opp && opp.forecastCategory;
  return FORECAST_CATEGORIES.includes(c) ? c : defaultCategory(opp);
}

// Roll-up cumulatif des montants par catégorie de prévision. `closed` = gagné ; `commit` = closed +
// open marqués commit ; `bestCase` = commit + open best_case ; `pipeline` = bestCase + open pipeline.
// Les perdues et les « omitted » sont exclues. Renvoie aussi le nombre d'opps par palier.
function rollupForecast(opps) {
  const r = { closed: 0, commit: 0, bestCase: 0, pipeline: 0, counts: { closed: 0, commit: 0, bestCase: 0, pipeline: 0, omitted: 0 } };
  for (const o of opps || []) {
    const amount = Number(o.amount) || 0;
    const stage = Number(o.stage) || 0;
    if (stage === WON_STAGE) { r.closed += amount; r.counts.closed++; continue; }
    if (stage === LOST_STAGE) { r.counts.omitted++; continue; }
    const cat = effectiveCategory(o);
    if (cat === "omitted") { r.counts.omitted++; continue; }
    if (cat === "commit") { r.commit += amount; r.counts.commit++; }
    else if (cat === "best_case") { r.bestCase += amount; r.counts.bestCase++; }
    else { r.pipeline += amount; r.counts.pipeline++; } // pipeline
  }
  // Cumul façon Salesforce : chaque palier inclut les plus engagés.
  r.commit += r.closed;
  r.bestCase += r.commit;
  r.pipeline += r.bestCase;
  return r;
}

module.exports = { FORECAST_CATEGORIES, WON_STAGE, LOST_STAGE, defaultCategory, effectiveCategory, rollupForecast };
