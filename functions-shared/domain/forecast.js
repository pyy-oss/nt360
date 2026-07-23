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

// Normalisation du commercial IDENTIQUE à AM 360° (domain/am360) — regroupe « Kouame »/« KOUAME » et
// rattache les sans-AM à « — » (sinon un même vendeur se scinderait entre le forecast et AM 360°).
const normAm = (a) => (a && String(a).trim().toUpperCase()) || "—";

/**
 * Ventilation du roll-up par COMMERCIAL (AM) — mêmes règles CUMULATIVES que rollupForecast, par AM.
 * Débloque le « forecast review » 1:1 : voir Commit/Best Case/Pipeline de CHAQUE commercial.
 * @param {object[]} opps       opportunités (gagnées stage 6 ignorées — portées par le carnet)
 * @param {Map<string,{amount:number,count:number}>} closedByAm réalisé CAS du carnet de l'exercice, par AM
 * @returns {{am:string,closed:number,commit:number,bestCase:number,pipeline:number,counts:object}[]} trié par pipeline décroissant
 * PUR (aucun I/O).
 */
function rollupForecastByAm(opps, closedByAm) {
  const byAm = new Map();
  const ensure = (am) => {
    let e = byAm.get(am);
    if (!e) { e = { am, closed: 0, commit: 0, bestCase: 0, pipeline: 0, counts: { closed: 0, commit: 0, bestCase: 0, pipeline: 0 } }; byAm.set(am, e); }
    return e;
  };
  // Réalisé (carnet de l'exercice) par commercial.
  const cba = closedByAm instanceof Map ? closedByAm : new Map();
  for (const [am, v] of cba) { const e = ensure(normAm(am)); e.closed += Number(v && v.amount) || 0; e.counts.closed += Number(v && v.count) || 0; }
  // Ouvertes catégorisées par commercial (gagnées ignorées ; omitted = perdu/suspendu/annulé/hors [1..5]).
  for (const o of opps || []) {
    if ((Number(o.stage) || 0) === WON_STAGE) continue;
    const cat = effectiveCategory(o);
    if (cat === "omitted") continue;
    const e = ensure(normAm(o.am));
    const amount = Number(o.amount) || 0;
    if (cat === "commit") { e.commit += amount; e.counts.commit++; }
    else if (cat === "best_case") { e.bestCase += amount; e.counts.bestCase++; }
    else { e.pipeline += amount; e.counts.pipeline++; }
  }
  // Cumul façon Salesforce (Pipeline ⊇ Best Case ⊇ Commit ⊇ Closed), par commercial.
  const out = [...byAm.values()].map((e) => { e.commit += e.closed; e.bestCase += e.commit; e.pipeline += e.bestCase; return e; });
  out.sort((a, b) => b.pipeline - a.pipeline || String(a.am).localeCompare(String(b.am)));
  return out;
}

module.exports = { FORECAST_CATEGORIES, WON_STAGE, LOST_STAGE, OPEN_MIN, OPEN_MAX, defaultCategory, effectiveCategory, rollupForecast, rollupForecastByAm };
