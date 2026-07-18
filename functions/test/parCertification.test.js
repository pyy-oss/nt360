import { describe, it, expect } from "vitest";
const { validateCertification, computeCertStatus, engineerRhStatus, EXPIRING_SOON_WINDOW_DAYS } = require("../domain/parCertification");

describe("parCertification — validation + statut de validité", () => {
  const base = { consultantId: "cons123", partnerId: "Fortinet", certificationCatalogId: "fortinet-nse4", obtainedDate: "2024-07-26" };

  it("valide une certif et normalise le partenaire/catalogue en slug", () => {
    const v = validateCertification(base);
    expect(v.ok).toBe(true);
    expect(v.value).toMatchObject({ consultantId: "cons123", partnerId: "fortinet", certificationCatalogId: "fortinet-nse4", obtainedDate: "2024-07-26", inTraining: false });
  });

  it("rejette une certif sans consultant / partenaire / date", () => {
    expect(validateCertification({ ...base, consultantId: "" }).ok).toBe(false);
    expect(validateCertification({ ...base, partnerId: "" }).ok).toBe(false);
    expect(validateCertification({ ...base, obtainedDate: "26/07/2024" }).ok).toBe(false);
  });

  it("rejette une année d'obtention implausible (discipline plausibleYear)", () => {
    expect(validateCertification({ ...base, obtainedDate: "1899-12-30" }).ok).toBe(false);
  });

  it("computeCertStatus : expired / expiring_soon (≤90 j) / active selon today injecté", () => {
    expect(computeCertStatus("2026-07-26", "2026-07-27")).toBe("expired");
    expect(computeCertStatus("2026-07-26", "2026-06-01")).toBe("expiring_soon"); // 55 j
    expect(computeCertStatus("2026-07-26", "2025-01-01")).toBe("active");
    // borne exacte : à J-90 pile, encore « bientôt » ; au-delà, active
    expect(computeCertStatus("2026-07-26", "2026-04-27")).toBe("expiring_soon"); // 90 j
    expect(computeCertStatus(null, "2026-07-26")).toBe("active"); // pas d'expiration ⇒ valide
  });

  it("engineerRhStatus : certifie > en_cours > a_certifier", () => {
    expect(engineerRhStatus({ hasActiveCert: true, inTraining: true })).toBe("certifie");
    expect(engineerRhStatus({ hasActiveCert: false, inTraining: true })).toBe("en_cours");
    expect(engineerRhStatus({ hasActiveCert: false, inTraining: false })).toBe("a_certifier");
  });

  it("la fenêtre 'bientôt expirée' vaut 90 jours (premier seuil d'alerte, Lot 4)", () => {
    expect(EXPIRING_SOON_WINDOW_DAYS).toBe(90);
  });
});
