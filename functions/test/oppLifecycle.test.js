import { describe, it, expect } from "vitest";
const { isAgedLost, AGE_LOST_DAYS, AGE_LOST_IDC } = require("../domain/oppLifecycle");

// Règle source LIVE : SI(ET([@Age Auto]>=366;[@IdC]<=90%);"9-LOST";…) — auto-perte par âge.
const opp = (over) => ({ source: "salesData", stage: 3, ageDays: 400, probability: 0.6, ...over });

describe("isAgedLost — auto-perte par âge (règle source LIVE)", () => {
  it("active + âge ≥ 366 j + IdC ≤ 90 % → périmée (perdue)", () => {
    expect(isAgedLost(opp({ ageDays: 366, probability: 0.9 }))).toBe(true);
    expect(isAgedLost(opp({ ageDays: 500, probability: 0.5 }))).toBe(true);
  });
  it("IdC > 90 % → PAS périmée même si vieille (certitude/gagnable)", () => {
    expect(isAgedLost(opp({ ageDays: 800, probability: 0.95 }))).toBe(false);
  });
  it("âge < 366 j → PAS périmée", () => {
    expect(isAgedLost(opp({ ageDays: 365, probability: 0.4 }))).toBe(false);
  });
  it("âge inconnu (null) → jamais périmée (fail-safe : pas d'âge, pas de verdict)", () => {
    expect(isAgedLost(opp({ ageDays: null }))).toBe(false);
    expect(isAgedLost(opp({ ageDays: undefined }))).toBe(false);
  });
  it("hors étape active (gagnée/perdue/suspendue) → hors périmètre", () => {
    expect(isAgedLost(opp({ stage: 6 }))).toBe(false);
    expect(isAgedLost(opp({ stage: 7 }))).toBe(false);
    expect(isAgedLost(opp({ stage: 8 }))).toBe(false);
  });
  it("source ≠ salesData (saisie manuelle) → jamais périmée par cette règle", () => {
    expect(isAgedLost(opp({ source: "saisie" }))).toBe(false);
  });
  it("seuils exposés (366 j / 90 %)", () => {
    expect(AGE_LOST_DAYS).toBe(366);
    expect(AGE_LOST_IDC).toBe(0.9);
  });
});
