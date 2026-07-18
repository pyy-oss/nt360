// Domain PUR — Certification d'un ingénieur (par_). Aucun I/O → testable. Miroir front : Lot 6.
// ADR-P03 : une certification RÉFÉRENCE un consultant existant (consultantId) — on ne crée PAS un second
// annuaire de personnes. Stockée en collection top-level par_certifications (et non en sous-collection de
// consultants, callable-only + CJM confidentiel) : la donnée de certif (partenaire, dates, statut) N'EST
// PAS confidentielle et se lit sous le droit `partenariats`, jamais sous l'accès au coût du consultant.
const { plausibleYear } = require("../lib/ids");

// Statut de validité (code applicatif ; libellés FR à l'affichage). Fenêtre « bientôt expirée » = 90 j
// (comme le kit) — c'est aussi le premier seuil d'alerte du cycle de vie (Lot 4).
const CERT_STATUSES = ["active", "expiring_soon", "expired"];
const EXPIRING_SOON_WINDOW_DAYS = 90;
// Statut RH d'un ingénieur pour un besoin : certifié / en cours / à certifier (alimente les quotas, Lot 4).
const RH_STATUSES = ["certifie", "en_cours", "a_certifier"];

const isoDate = (v) => { const s = String(v == null ? "" : v).slice(0, 10); return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null; };
const slug = (v) => { const s = String(v == null ? "" : v).trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, ""); return s || null; };
const daysBetween = (a, b) => Math.ceil((new Date(a) - new Date(b)) / 86400000);

/**
 * Normalise + valide une certification (forme). { ok, error?, value? }. La résolution du partenaire/du
 * catalogue (donc la date d'expiration et le statut) est faite par le handler (I/O sur par_partners).
 * value.obtainedDate est ISO plausible ; consultantId/partnerId/certificationCatalogId sont requis.
 */
function validateCertification(d) {
  const o = d || {};
  const consultantId = String(o.consultantId == null ? "" : o.consultantId).trim().slice(0, 128);
  if (!consultantId) return { ok: false, error: "consultant requis (consultantId)" };
  const partnerId = slug(o.partnerId);
  if (!partnerId) return { ok: false, error: "partenaire requis (partnerId)" };
  const certificationCatalogId = slug(o.certificationCatalogId);
  if (!certificationCatalogId) return { ok: false, error: "certification requise (certificationCatalogId)" };
  const obtainedDate = isoDate(o.obtainedDate);
  if (!obtainedDate) return { ok: false, error: "date d'obtention invalide (AAAA-MM-JJ)" };
  // Discipline plausibleYear de l'ERP (comme le carnet/l'échéancier) : une année aberrante fausserait
  // l'expiration et les alertes de renouvellement. Rejetée à la frontière.
  if (!plausibleYear(obtainedDate.slice(0, 4))) return { ok: false, error: "année d'obtention implausible" };
  const value = { consultantId, partnerId, certificationCatalogId, obtainedDate, inTraining: o.inTraining === true };
  const credentialId = String(o.credentialId == null ? "" : o.credentialId).trim().slice(0, 80);
  if (credentialId) value.credentialId = credentialId;
  return { ok: true, value };
}

// Statut de validité d'une certif à une date donnée (ISO), à partir de sa date d'expiration. PUR.
// Le todayIso est INJECTÉ (pas de Date.now ici) → testable et recalculable par le sweep quotidien (Lot 4).
function computeCertStatus(expiryDateIso, todayIso) {
  if (!expiryDateIso) return "active"; // pas d'expiration connue ⇒ considérée valide
  const d = daysBetween(expiryDateIso, todayIso);
  if (d <= 0) return "expired";
  if (d <= EXPIRING_SOON_WINDOW_DAYS) return "expiring_soon";
  return "active";
}

// Statut RH d'un ingénieur pour un besoin donné (mirror kit computeEngineerRhStatus). PUR.
function engineerRhStatus({ hasActiveCert, inTraining }) {
  if (hasActiveCert) return "certifie";
  if (inTraining) return "en_cours";
  return "a_certifier";
}

module.exports = {
  CERT_STATUSES, EXPIRING_SOON_WINDOW_DAYS, RH_STATUSES,
  validateCertification, computeCertStatus, engineerRhStatus, daysBetween,
};
