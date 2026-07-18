import { describe, it, expect } from "vitest";
const { validatePartner, validateCatalogEntry, validateRequirement, computeExpiry, DEFAULT_VALIDITY_MONTHS } = require("../domain/parPartner");

// Référentiel partenaire (par_) — validation PURE. Miroir front : web/src/lib/parPartner.ts.
describe("parPartner — validation du référentiel", () => {
  const base = {
    id: "Dell", name: "Dell Technologies", programName: "Dell Partner Program",
    tiers: [{ id: "gold", name: "Gold", rank: 2 }, { id: "authorized", name: "Authorized", rank: 1 }],
    competencies: [{ id: "server", name: "Server" }],
    certificationCatalog: [{ id: "dell-server-pro", competencyId: "server", code: "DCP", name: "Dell Server Pro", level: "professional", validityMonths: 24 }],
    requirements: [{ tierId: "gold", certIdOrCompetencyId: "server", minCount: 1, requiredRole: "SE" }],
  };

  it("normalise l'id en slug et conserve les structures embarquées", () => {
    const v = validatePartner(base);
    expect(v.ok).toBe(true);
    expect(v.value.id).toBe("dell"); // slug
    expect(v.value.tiers).toHaveLength(2);
    expect(v.value.certificationCatalog[0].validityMonths).toBe(24);
    expect(v.value.requirements[0]).toMatchObject({ tierId: "gold", certIdOrCompetencyId: "server", minCount: 1, requiredRole: "SE" });
  });

  it("rejette un partenaire sans id ou sans nom", () => {
    expect(validatePartner({ name: "X" }).ok).toBe(false);
    expect(validatePartner({ id: "x" }).ok).toBe(false);
  });

  it("intégrité référentielle : une exigence pointant un niveau inconnu est rejetée", () => {
    const v = validatePartner({ ...base, requirements: [{ tierId: "platinum", certIdOrCompetencyId: "server", minCount: 1 }] });
    expect(v.ok).toBe(false);
    expect(v.error).toMatch(/niveau inconnu/);
  });

  it("intégrité référentielle : une exigence pointant une cible fantôme est rejetée", () => {
    const v = validatePartner({ ...base, requirements: [{ tierId: "gold", certIdOrCompetencyId: "inexistant", minCount: 1 }] });
    expect(v.ok).toBe(false);
    expect(v.error).toMatch(/cible inconnue/);
  });

  it("intégrité référentielle : une certif rattachée à une compétence inconnue est rejetée", () => {
    const v = validatePartner({ ...base, certificationCatalog: [{ id: "c1", competencyId: "ghost", name: "X", level: "expert" }] });
    expect(v.ok).toBe(false);
    expect(v.error).toMatch(/compétence inconnue/);
  });

  it("catalogue : niveau hors énumération rejeté ; validité par défaut si absente", () => {
    expect(validateCatalogEntry({ id: "c", competencyId: "server", name: "X", level: "grandmaster" }).ok).toBe(false);
    const v = validateCatalogEntry({ id: "c", competencyId: "server", name: "X", level: "expert" });
    expect(v.value.validityMonths).toBe(DEFAULT_VALIDITY_MONTHS);
  });

  it("exigence : minimum < 1 rejeté (un quota vide n'a pas de sens)", () => {
    expect(validateRequirement({ tierId: "gold", certIdOrCompetencyId: "server", minCount: 0 }).ok).toBe(false);
  });

  it("computeExpiry : obtention + validité (mois), ISO AAAA-MM-JJ", () => {
    expect(computeExpiry("2024-07-26", 24)).toBe("2026-07-26");
    expect(computeExpiry("2024-01-15", 24)).toBe("2026-01-15");
    // Débordement de fin de mois : arithmétique `setMonth` naïve (comme le kit) — Jan 31 + 1 mois glisse
    // en mars. Immatériel pour l'alerte J-90/60/30 ; documenté plutôt que masqué.
    expect(computeExpiry("2024-01-31", 1)).toBe("2024-03-02");
    expect(computeExpiry("pas-une-date", 24)).toBe(null);
  });
});
