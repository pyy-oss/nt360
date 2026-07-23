// Drapeau de fonctionnalité « Vérité du coût » (ADR-P21) — LECTURE PURE de l'overlay config/soaFeature
// { enabled: boolean }, même patron que mntFeature/parFeature (Phase 0 §4.4). Quand ACTIF, le SOLDE du
// compte fournisseur (SOA) dérive des FACTURES FOURNISSEUR RÉELLES (collection supplierInvoices) et non
// plus du statut « facturé » d'un BC posé à la main. Drapeau ABSENT ou enabled ≠ true ⇒ ÉTEINT : le SOA
// est STRICTEMENT celui d'avant (solde piloté par le statut BC). Défaut = éteint par l'ABSENCE du document.
// Miroir front : web/src/lib/soaFeature.ts.
function isSoaFromInvoices(cfg) {
  return !!cfg && cfg.enabled === true;
}

module.exports = { isSoaFromInvoices };
