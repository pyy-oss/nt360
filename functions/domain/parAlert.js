// Domain PUR — Alertes du cycle de vie des certifications (par_). Aucun I/O → testable.
// Liste de renouvellement MATÉRIALISÉE (pas un flux d'événements) : pour chaque certification proche de
// l'expiration (≤ 90 j) ou expirée, on classe l'urgence dans un palier J-90/60/30/7/0 (kit :
// ALERT_THRESHOLDS_DAYS). Le sweep quotidien (ou tout recompute) reconstruit la liste à date ; le palier
// est le SEUIL le plus serré dans lequel tombe la certif. todayIso INJECTÉ → pur & recalculable.

// Paliers d'alerte demandés (comme le kit). Ordre décroissant d'échéance.
const ALERT_THRESHOLDS_DAYS = [90, 60, 30, 7, 0];

const daysBetween = (a, b) => Math.ceil((new Date(a) - new Date(b)) / 86400000);

// Palier d'urgence d'une certif selon les jours restants. null au-delà de 90 j (pas encore d'alerte).
function alertBucket(daysLeft) {
  if (daysLeft <= 0) return "expired";
  if (daysLeft <= 7) return "j7";
  if (daysLeft <= 30) return "j30";
  if (daysLeft <= 60) return "j60";
  if (daysLeft <= 90) return "j90";
  return null;
}

/**
 * Liste de renouvellement : une entrée par certif ≤ 90 j (ou expirée), triée par urgence croissante.
 * certs = par_certifications (avec expiryDate + dénormalisations consultant/certif).
 */
function certRenewalWatch(certs, todayIso) {
  const items = [];
  for (const c of certs || []) {
    if (!c || !c.expiryDate) continue;
    const daysLeft = daysBetween(c.expiryDate, todayIso);
    const bucket = alertBucket(daysLeft);
    if (!bucket) continue;
    items.push({
      id: c.id, consultantId: c.consultantId, consultantName: c.consultantName || "", partnerId: c.partnerId,
      // managerUid dénormalisé (PA4) : destinataire de la relance de renouvellement de CE consultant.
      managerUid: c.managerUid || null,
      certName: c.certName || c.certificationCatalogId, expiryDate: c.expiryDate, daysLeft, bucket,
    });
  }
  items.sort((a, b) => a.daysLeft - b.daysLeft);
  return items;
}

// Compteurs par palier (pour les KPI de la carte alertes).
function watchCounts(items) {
  const counts = { expired: 0, j7: 0, j30: 0, j60: 0, j90: 0 };
  for (const it of items || []) if (counts[it.bucket] != null) counts[it.bucket] += 1;
  return counts;
}

module.exports = { ALERT_THRESHOLDS_DAYS, alertBucket, certRenewalWatch, watchCounts };
