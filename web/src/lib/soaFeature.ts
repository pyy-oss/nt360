// Miroir front du drapeau « Vérité du coût » (ADR-P21, cf. functions/domain/soaFeature.js). Quand ACTIF,
// le solde du compte fournisseur (SOA) dérive des factures fournisseur réelles. Défaut = éteint (absence du doc).
export function isSoaFromInvoices(cfg?: { enabled?: boolean } | null): boolean {
  return !!cfg && cfg.enabled === true;
}
