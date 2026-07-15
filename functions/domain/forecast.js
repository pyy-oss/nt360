// PRÉVISION COMMERCIALE GOUVERNABLE (Lot 5 « niveau Salesforce ») — catégories de prévision posées
// par le commercial, DISTINCTES de l'étape : le commercial ENGAGE une prévision (Commit) plutôt que de
// laisser la probabilité d'étape décider seule. Comble l'écart #5 de l'audit (prévision non gouvernable).
// Catégories CUMULATIVES façon Salesforce : Pipeline ⊇ Best Case ⊇ Commit ⊇ Closed (gagné).
//
// Fonctions PURES (aucun I/O) → testables.

const FORECAST_CATEGORIES = ["omitted", "pipeline", "best_case", "commit"];
const WON_STAGE = 6;   // Gagné (closed won)
const LOST_STAGE = 7;  // Perdu
// Étapes OUVERTES et actives (1-Qualification … 5-Contractualisation). Les étapes hors de cette
// plage — perdu (7), suspendu (8), annulé (9) — ne sont PAS du pipeline prévisionnel : les traiter
// comme « omitted » (parité avec l'assiette `active` du cockpit, overviewCalc : stage ∈ [1..5]).
const OPEN_MIN = 1, OPEN_MAX = 5;

// Catégorie par défaut d'une opportunité quand le commercial n'en a POSÉ aucune. Dérivée de l'ÉTAPE
// d'avancement (le commercial garde la main : une catégorie posée prime toujours, cf. effectiveCategory) :
//   5-Contractualisation → commit (quasi-engagé)  ·  4-Négociation → best_case  ·  1-3 → pipeline.
// Le gagné (6) est porté par le carnet (rollup l'ignore) ; perdu/suspendu/annulé (7/8/9) et tout millésime
// hors [1..5] → omitted (hors prévision). AVANT : toute ouverte retombait sur « pipeline » → Commit et Best
// Case restaient collés au carnet (paliers indifférenciés) ; et 8/9 gonflaient à tort le pipeline.
function defaultCategory(opp) {
  const stage = Number(opp && opp.stage) || 0;
  if (stage === WON_STAGE) return "commit";
  if (stage === 5) return "commit";
  if (stage === 4) return "best_case";
  if (stage >= OPEN_MIN && stage <= 3) return "pipeline";
  return "omitted";
}

// Catégorie effective (posée sinon défaut), validée contre la liste.
function effectiveCategory(opp) {
  const c = opp && opp.forecastCategory;
  return FORECAST_CATEGORIES.includes(c) ? c : defaultCategory(opp);
}

// Roll-up cumulatif des montants par catégorie de prévision (façon Salesforce : Pipeline ⊇ Best Case
// ⊇ Commit ⊇ Closed). Le GAGNÉ (`closed`) est FOURNI PAR L'APPELANT depuis le CARNET de commandes de
// l'exercice (CAS par `yearPo`) — même autorité que le cockpit (overviewCalc/aggregate) : l'année de
// gain fiable est celle de la commande, PAS la `closingDate` (date de clôture PRÉVUE, souvent nulle ou
// d'un autre millésime sur une opp gagnée). Les opps GAGNÉES (stage 6) ne sont donc PAS recomptées ici
// (le carnet les porte → zéro double-compte). Seules les OUVERTES (1-5) alimentent commit/best_case/
// pipeline selon la catégorie POSÉE par le commercial (indépendante de l'étape) ; le défaut d'une
// ouverte non catégorisée est « pipeline ». Renvoie aussi le nombre d'items par palier
// (`counts.closed` = nombre de COMMANDES de l'exercice).
function rollupForecast(opps, closedAmount = 0, closedCount = 0) {
  const r = {
    closed: Number(closedAmount) || 0, commit: 0, bestCase: 0, pipeline: 0,
    counts: { closed: Number(closedCount) || 0, commit: 0, bestCase: 0, pipeline: 0, omitted: 0 },
  };
  for (const o of opps || []) {
    const amount = Number(o.amount) || 0;
    const stage = Number(o.stage) || 0;
    if (stage === WON_STAGE) continue; // gagné → porté par le carnet, jamais recompté ici
    const cat = effectiveCategory(o);
    if (cat === "omitted") { r.counts.omitted++; continue; } // perdu/suspendu/annulé/exclu
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

module.exports = { FORECAST_CATEGORIES, WON_STAGE, LOST_STAGE, OPEN_MIN, OPEN_MAX, defaultCategory, effectiveCategory, rollupForecast };
