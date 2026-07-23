// CALIBRATION EMPIRIQUE du scoring (R6 « #20 → 10 ») — dérive les paramètres du modèle de scoring des
// RÉSULTATS HISTORIQUES réels (opportunités gagnées / perdues) au lieu de constantes choisies à la main.
// Le modèle reste EXPLICABLE et déterministe (façon Einstein Scoring transparent) — mais sa base et ses
// poids de catégorie de prévision sont désormais ANCRÉS DANS LES DONNÉES : taux de gain observé global
// et par catégorie. Sous échantillon insuffisant, on retombe proprement sur l'heuristique (calib=null).
//
// Fonction PURE (aucun I/O) → testable. `closed` = opportunités fermées : gagnées (won:true) ou perdues.

const MIN_SAMPLE = 20;        // en-dessous, la base empirique n'est pas fiable → pas de calibration
const MIN_CAT_SAMPLE = 8;     // en-dessous par catégorie, on n'ajuste pas ce poids de catégorie

// `closed` : [{ won: boolean, forecastCategory?: string }]. Renvoie null si l'historique est trop maigre.
function calibrate(closed) {
  const rows = (closed || []).filter((o) => o && typeof o.won === "boolean");
  const n = rows.length;
  if (n < MIN_SAMPLE) return null;
  const wins = rows.filter((o) => o.won).length;
  const base = wins / n;                                  // taux de gain observé global (0..1)
  // Taux de gain par catégorie de prévision effective (uniquement celles suffisamment peuplées).
  const byCategory = {};
  for (const cat of ["commit", "best_case", "pipeline", "omitted"]) {
    const sub = rows.filter((o) => o.forecastCategory === cat);
    if (sub.length >= MIN_CAT_SAMPLE) byCategory[cat] = sub.filter((o) => o.won).length / sub.length;
  }
  return { n, base, byCategory };
}

// Convertit un taux (0..1) en points signés autour de 50 (borné pour éviter des extrêmes sur petits n).
function rateToImpact(rate, ref = 0.5) {
  return Math.max(-45, Math.min(45, Math.round((rate - ref) * 100)));
}

module.exports = { calibrate, rateToImpact, MIN_SAMPLE, MIN_CAT_SAMPLE };
