// Opportunités DORMANTES (année de closing < exercice courant) : prédicat, analyse (volume/valeur/âge)
// et exclusion de la prévision cumulée. Cf. domain/oppLifecycle.js + domain/pipeline.js.
import { describe, it, expect } from "vitest";
const { isDormantClosing } = require("../domain/oppLifecycle");
const { dormantSummary, pipeline } = require("../domain/pipeline");

const FY = 2026;

describe("isDormantClosing", () => {
  it("vraie pour une opp ouverte de closing d'un millésime révolu", () => {
    expect(isDormantClosing({ stage: 3, closingDate: "2024-05-01" }, FY)).toBe(true);
    expect(isDormantClosing({ stage: 1, closingDate: "2025-12-31" }, FY)).toBe(true);
  });
  it("fausse pour l'exercice courant ou futur", () => {
    expect(isDormantClosing({ stage: 3, closingDate: "2026-01-01" }, FY)).toBe(false);
    expect(isDormantClosing({ stage: 3, closingDate: "2027-01-01" }, FY)).toBe(false);
  });
  it("fausse hors étape active (gagnée/perdue) même si millésime révolu", () => {
    expect(isDormantClosing({ stage: 6, closingDate: "2023-01-01" }, FY)).toBe(false);
    expect(isDormantClosing({ stage: 7, closingDate: "2023-01-01" }, FY)).toBe(false);
  });
  it("fail-safe : closingDate aberrant (borné par plausibleYear) ⇒ non dormant", () => {
    expect(isDormantClosing({ stage: 3, closingDate: "1900-01-01" }, FY)).toBe(false);
    expect(isDormantClosing({ stage: 3, closingDate: "" }, FY)).toBe(false);
  });
  it("fail-safe : exercice inconnu ⇒ non dormant (pas de verdict)", () => {
    expect(isDormantClosing({ stage: 3, closingDate: "2024-01-01" }, 0)).toBe(false);
  });
});

describe("dormantSummary", () => {
  it("volume, valeur brute et ancienneté min/max/moyen (jours depuis la D Prev)", () => {
    const asOf = "2026-07-15";
    const opps = [
      { stage: 3, closingDate: "2025-07-15", amount: 1000 }, // 365 j
      { stage: 2, closingDate: "2024-07-15", amount: 3000 }, // 730 j
      { stage: 4, closingDate: "2026-03-01", amount: 9000 }, // exercice courant → non dormant
      { stage: 6, closingDate: "2023-01-01", amount: 5000 }, // gagnée → non dormant
    ];
    const d = dormantSummary(opps, FY, asOf);
    expect(d.count).toBe(2);
    expect(d.brut).toBe(4000);
    expect(d.ageMin).toBe(365);
    expect(d.ageMax).toBe(730);
    expect(d.ageAvg).toBe(Math.round((365 + 730) / 2));
  });
  it("ensemble vide ⇒ zéros", () => {
    expect(dormantSummary([], FY, "2026-07-15")).toEqual({ count: 0, brut: 0, ageMin: 0, ageMax: 0, ageAvg: 0 });
  });
});

describe("exclusion des dormantes du pondéré (parité assiette)", () => {
  // Le pondéré est calculé par pipeline() sur l'assiette fournie. L'exclusion est un filtre de POPULATION
  // fait en amont (aggregate) ; on vérifie ici que retirer les dormantes change bien le pondéré projeté.
  const asOf = "2026-07-15";
  const opps = [
    { fp: "FP/2026/1", stage: 5, closingDate: "2026-06-01", amount: 1000, probability: 95 }, // exercice, certain
    { fp: "FP/2024/9", stage: 5, closingDate: "2024-06-01", amount: 8000, probability: 95 }, // DORMANTE, certaine
  ];
  it("le pondéré chute quand on exclut les dormantes", () => {
    const withDormant = pipeline(opps, asOf, undefined, []).tot.weighted;
    const withoutDormant = pipeline(opps.filter((o) => !isDormantClosing(o, FY)), asOf, undefined, []).tot.weighted;
    expect(withDormant).toBe(9000);       // 1000 + 8000 (poids Certitudes = 1)
    expect(withoutDormant).toBe(1000);    // dormante retirée
  });
});
