// Module Contrats de maintenance (mnt_) — LECTURE PURE du drapeau de fonctionnalité (ADR-009).
// Le module s'éteint SANS redéploiement via l'overlay config/mntFeature { enabled: boolean }, sur le
// même patron que les autres overlays config/* (Phase 0 §4.4). Drapeau ABSENT ou enabled ≠ true ⇒
// éteint : l'ERP est alors STRICTEMENT celui d'avant (aucune surface mnt_*). Défaut = éteint par
// l'ABSENCE du document (pas de donnée à créer). Miroir front : web/src/lib/mntFeature.ts.
function isMntEnabled(cfg) {
  return !!cfg && cfg.enabled === true;
}

module.exports = { isMntEnabled };
