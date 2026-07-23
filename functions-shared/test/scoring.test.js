import { describe, it, expect } from "vitest";
const { scoreOpportunity, isOpen } = require("../domain/scoring");

const TODAY = "2026-07-09";

describe("scoreOpportunity — score explicable 0..100 + bande", () => {
  it("opp avancée, confiante, engagée Commit, action définie → hot", () => {
    const r = scoreOpportunity({ stage: 5, probability: 0.8, forecastCategory: "commit", nextStep: "Signer", dr: true, mbPrev: 25 }, TODAY);
    expect(r.band).toBe("hot");
    expect(r.score).toBeGreaterThanOrEqual(70);
    // Le facteur le plus fort est restitué en tête.
    expect(r.factors[0]).toHaveProperty("label");
    expect(r.factors[0]).toHaveProperty("impact");
  });
  it("opp jeune, dormante, sans action → cold", () => {
    const r = scoreOpportunity({ stage: 1, probability: 0.2, stale: true, nextStep: "" }, TODAY);
    expect(r.band).toBe("cold");
    expect(r.score).toBeLessThan(45);
    expect(r.factors.some((f) => f.label.includes("dormante") && f.impact < 0)).toBe(true);
  });
  it("action en retard pénalise", () => {
    const withLate = scoreOpportunity({ stage: 3, probability: 0.5, nextStep: "Relancer", nextStepDate: "2026-07-01" }, TODAY);
    const onTime = scoreOpportunity({ stage: 3, probability: 0.5, nextStep: "Relancer", nextStepDate: "2026-07-20" }, TODAY);
    expect(withLate.score).toBeLessThan(onTime.score);
    expect(withLate.factors.some((f) => f.label.includes("retard"))).toBe(true);
  });
  it("score borné 0..100", () => {
    const hi = scoreOpportunity({ stage: 5, probability: 1, forecastCategory: "commit", nextStep: "x", dr: true, mbPrev: 40 }, TODAY);
    const lo = scoreOpportunity({ stage: 1, probability: 0, forecastCategory: "omitted", stale: true }, TODAY);
    expect(hi.score).toBeLessThanOrEqual(100);
    expect(lo.score).toBeGreaterThanOrEqual(0);
  });
  it("opps fermées : score dégénéré sans facteurs", () => {
    expect(scoreOpportunity({ stage: 6 }, TODAY)).toEqual({ score: 100, band: "won", factors: [] });
    expect(scoreOpportunity({ stage: 7 }, TODAY)).toEqual({ score: 0, band: "lost", factors: [] });
  });
  it("déterministe : mêmes entrées → même score", () => {
    const o = { stage: 4, probability: 0.6, nextStep: "a" };
    expect(scoreOpportunity(o, TODAY).score).toBe(scoreOpportunity(o, TODAY).score);
  });
});

describe("isOpen", () => {
  it("étapes 1..5 ouvertes, 6/7 fermées", () => {
    expect(isOpen({ stage: 1 })).toBe(true);
    expect(isOpen({ stage: 5 })).toBe(true);
    expect(isOpen({ stage: 6 })).toBe(false);
    expect(isOpen({ stage: 7 })).toBe(false);
  });
});
