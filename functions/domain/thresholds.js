// Seuils métier ÉDITORIAUX — source unique côté serveur. Ce sont des hypothèses de pilotage
// (pas des faits), surchargées à chaud par `config/alerts` (édition en Admin). Regroupées ici
// pour éviter les déclarations dupliquées entre modules (alerts, dataQuality).
//
// Miroir côté client : web/src/lib/thresholds.ts (paliers de projection notamment) — garder alignés.
const ALERT_DEFAULTS = {
  concentration: 0.30,     // > 30 % du CAS sur un seul client → alerte concentration
  surfacturationPct: 0.005, // Σ factures > CAS × (1 + 0,5 %) → surfacturation
  rafEcartPct: 0.10,        // écart RAF vs (CAS − facturé) > 10 % → RAF incohérent
  dormantYears: 2,          // backlog dont l'année de PO ≤ exercice − 2 → dormant
  valorisationEcartPct: 0.30, // |CAS retenu (opp gagnée/fiche) − CAS P&L| / max > 30 % → écart de valorisation amont
};

module.exports = { ALERT_DEFAULTS };
