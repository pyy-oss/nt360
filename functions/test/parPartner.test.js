import { describe, it, expect } from "vitest";
const { validatePartner, validateCatalogEntry, validateRequirement, computeExpiry, DEFAULT_VALIDITY_MONTHS, validateBusinessPlan, bpAchievement } = require("../domain/parPartner");

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

  // Champs additifs (plan d'affaires + statut + échéance + validation) — miroir Partners_Status_Tracking.
  it("statut / échéance / validation : normalisés et optionnels", () => {
    const v = validatePartner({ ...base, status: "Platinum", renewalDate: "2026-01-31", validationStatus: "Valide" });
    expect(v.ok).toBe(true);
    expect(v.value.status).toBe("Platinum");
    expect(v.value.renewalDate).toBe("2026-01-31");
    expect(v.value.validationStatus).toBe("valide"); // normalisé en minuscules
    // Valeurs invalides ignorées (jamais imposées) : date non ISO, statut hors énumération.
    const w = validatePartner({ ...base, renewalDate: "31/12/2025", validationStatus: "peut-être" });
    expect(w.value.renewalDate).toBeUndefined();
    expect(w.value.validationStatus).toBeUndefined();
    // Aucun champ additif → aucun champ ajouté.
    expect(validatePartner(base).value.businessPlan).toBeUndefined();
  });

  it("validateBusinessPlan : ne garde que les champs ≥ 0 fournis, null si vide", () => {
    expect(validateBusinessPlan(null)).toBe(null);
    expect(validateBusinessPlan({})).toBe(null);
    const bp = validateBusinessPlan({ pipelineBp: 300000, pipelineYtd: 3000000, growthBp: 25, growthYtd: 20, bookingBp: -5, certBp: "x" });
    expect(bp).toEqual({ pipelineBp: 300000, pipelineYtd: 3000000, growthBp: 25, growthYtd: 20 }); // négatif et non-nombre écartés
  });

  it("bpAchievement : ratio par axe + % global = moyenne (reproduit la colonne du fichier)", () => {
    // Ligne KASPERSKY du fichier : pipeline 3M/300k=10, booking 215k/220k≈0.977, cert 8/6≈1.333, growth 20/25=0.8.
    const a = bpAchievement({ pipelineBp: 300000, pipelineYtd: 3000000, bookingBp: 220000, bookingYtd: 215000, certBp: 6, certYtd: 8, growthBp: 25, growthYtd: 20 });
    expect(a.pipeline).toBeCloseTo(10, 6);
    expect(a.growth).toBeCloseTo(0.8, 6);
    expect(a.global).toBeCloseTo((10 + 215000 / 220000 + 8 / 6 + 0.8) / 4, 6); // ≈ 3.2777
    // Objectif nul → ratio null, exclu de la moyenne (pas de division par zéro).
    const b = bpAchievement({ pipelineBp: 0, pipelineYtd: 100, growthBp: 25, growthYtd: 20 });
    expect(b.pipeline).toBe(null);
    expect(b.global).toBeCloseTo(0.8, 6);
    expect(bpAchievement({}).global).toBe(null);
  });

  it("plan d'affaires embarqué dans le référentiel validé", () => {
    const v = validatePartner({ ...base, businessPlan: { pipelineBp: 300000, pipelineYtd: 3000000 } });
    expect(v.value.businessPlan).toEqual({ pipelineBp: 300000, pipelineYtd: 3000000 });
  });
});
