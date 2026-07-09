import { describe, it, expect } from "vitest";
import { calibrate, rateToImpact } from "../domain/scoreCalib.js";
import { scoreOpportunity } from "../domain/scoring.js";

const closedMix = (won, lost, cat) =>
  [...Array(won)].map(() => ({ won: true, forecastCategory: cat }))
    .concat([...Array(lost)].map(() => ({ won: false, forecastCategory: cat })));

describe("calibrate — ancrage empirique du scoring (R6)", () => {
  it("renvoie null sous l'échantillon minimal", () => {
    expect(calibrate(closedMix(3, 2, "commit"))).toBeNull();
    expect(calibrate([])).toBeNull();
    expect(calibrate(null)).toBeNull();
  });

  it("calcule le taux de gain global (base) sur un échantillon suffisant", () => {
    const c = calibrate(closedMix(15, 15, "pipeline")); // 30 fermées, 50% gagnées
    expect(c).not.toBeNull();
    expect(c.n).toBe(30);
    expect(c.base).toBeCloseTo(0.5, 5);
  });

  it("calcule un taux de gain PAR catégorie quand elle est assez peuplée", () => {
    const rows = closedMix(9, 1, "commit").concat(closedMix(2, 8, "pipeline")); // commit 90%, pipeline 20%
    const c = calibrate(rows);
    expect(c.byCategory.commit).toBeCloseTo(0.9, 5);
    expect(c.byCategory.pipeline).toBeCloseTo(0.2, 5);
  });

  it("ignore une catégorie sous-échantillonnée (< MIN_CAT_SAMPLE)", () => {
    const rows = closedMix(15, 15, "pipeline").concat(closedMix(2, 1, "commit")); // commit n=3 < 8
    const c = calibrate(rows);
    expect(c.byCategory.pipeline).toBeDefined();
    expect(c.byCategory.commit).toBeUndefined();
  });

  it("rateToImpact borne et centre autour de la référence", () => {
    expect(rateToImpact(0.5, 0.5)).toBe(0);
    expect(rateToImpact(1, 0.5)).toBe(45);   // borné à +45
    expect(rateToImpact(0, 0.5)).toBe(-45);  // borné à -45
    expect(rateToImpact(0.7, 0.5)).toBe(20);
  });
});

describe("scoreOpportunity — chemin calibré vs heuristique", () => {
  const opp = { stage: 3, probability: 0.5, forecastCategory: "commit", nextStep: "relancer" };
  it("sans calib : base neutre 50 (heuristique, rétrocompatible)", () => {
    const r = scoreOpportunity(opp, "2026-07-09");
    // base 50 + étape(0) + commit(15) + prochaine action(10) = 75
    expect(r.score).toBe(75);
    expect(r.band).toBe("hot");
  });

  it("avec calib : la base suit le taux de gain historique global", () => {
    const calib = { n: 40, base: 0.3, byCategory: {} }; // marché difficile : 30% de gain
    const r = scoreOpportunity(opp, "2026-07-09", calib);
    // base 30 + étape(0) + commit(15 heuristique, byCategory vide) + action(10) = 55
    expect(r.score).toBe(55);
  });

  it("avec calib.byCategory : le poids de la catégorie devient empirique", () => {
    const calib = { n: 40, base: 0.5, byCategory: { commit: 0.85 } }; // commit gagne 85% → +35 pts
    const r = scoreOpportunity(opp, "2026-07-09", calib);
    // base 50 + étape(0) + commit(rateToImpact(0.85,0.5)=35) + action(10) = 95
    expect(r.score).toBe(95);
    expect(r.factors.find((f) => f.label === "Prévision : Commit").impact).toBe(35);
  });
});
