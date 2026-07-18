// Module Partenariats & Certifications (par_) — LECTURE PURE du drapeau de fonctionnalité (ADR-P01).
// Même patron que le module Contrats de maintenance (functions/domain/mntFeature.js) : le module
// s'éteint SANS redéploiement via l'overlay config/parFeature { enabled: boolean }. Drapeau ABSENT ou
// enabled ≠ true ⇒ éteint : l'ERP est alors STRICTEMENT celui d'avant (aucune surface par_*). Défaut =
// éteint par l'ABSENCE du document (aucune donnée à créer). Miroir front : web/src/lib/parFeature.ts.
function isParEnabled(cfg) {
  return !!cfg && cfg.enabled === true;
}

module.exports = { isParEnabled };
