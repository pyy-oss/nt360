import { describe, it, expect } from "vitest";
const { salesVelocity } = require("../domain/velocity");

describe("salesVelocity", () => {
  const opps = [
    { stage: 6, amount: 1000 },                        // gagné
    { stage: 6, amount: 3000 },                        // gagné
    { stage: 7, amount: 500 },                         // perdu
    { stage: 3, amount: 800, probability: 0.95 },      // ouvert → certitudes (poids 1) = 800
    { stage: 5, amount: 1200, probability: 0.7 },      // ouvert → forecast (poids 0,2) = 240
  ];
  it("taux de gain = gagnées / (gagnées + perdues)", () => {
    const v = salesVelocity(opps);
    expect(v.won).toBe(2);
    expect(v.lost).toBe(1);
    expect(v.winRate).toBeCloseTo(2 / 3);
  });
  it("deal moyen = moyenne des gagnées", () => {
    expect(salesVelocity(opps).avgDeal).toBe(2000); // (1000+3000)/2
  });
  it("pipeline pondéré ouvert = somme des pondérés TIÉRÉS (projectionWeight), pas le champ linéaire", () => {
    expect(salesVelocity(opps).openWeighted).toBe(1040); // 800 (certitudes ×1) + 240 (forecast ×0,2)
    expect(salesVelocity(opps).openCount).toBe(2);
  });
  it("exclut les opportunités périmées par âge (isAgedLost) du pipeline ouvert", () => {
    const aged = [{ stage: 3, amount: 1000, probability: 0.5, source: "salesData", ageDays: 400 }];
    const v = salesVelocity(aged);
    expect(v.openCount).toBe(0);
    expect(v.openWeighted).toBe(0);
  });
  it("indice de vélocité = openCount × winRate × avgDeal", () => {
    const v = salesVelocity(opps);
    expect(v.velocityIndex).toBe(Math.round(2 * (2 / 3) * 2000));
  });
  it("sans opps fermées : winRate 0 ; deal moyen = moyenne des ouvertes", () => {
    const v = salesVelocity([{ stage: 2, amount: 100 }, { stage: 4, amount: 300 }]);
    expect(v.winRate).toBe(0);
    expect(v.avgDeal).toBe(200);
    expect(v.velocityIndex).toBe(0);
  });
  it("liste vide → zéros", () => {
    expect(salesVelocity([])).toEqual({ openCount: 0, openWeighted: 0, winRate: 0, avgDeal: 0, won: 0, lost: 0, velocityIndex: 0 });
  });
  it("exclut du pondéré ouvert les opps DÉJÀ au carnet (bookedFps) — anti-double-compte, parité cockpit", () => {
    const withFp = [
      { stage: 3, amount: 800, probability: 0.95, fp: "FP/2026/1" }, // au carnet → exclue
      { stage: 5, amount: 1200, probability: 0.7, fp: "FP/2026/2" }, // hors carnet → comptée (240)
    ];
    const booked = new Set(["FP/2026/1"]); // fpKey canonique
    const v = salesVelocity(withFp, undefined, booked);
    expect(v.openCount).toBe(1);
    expect(v.openWeighted).toBe(240);
    // Sans bookedFps : les deux comptent (rétro-compat, aucun 3e argument requis).
    expect(salesVelocity(withFp).openCount).toBe(2);
  });
});
