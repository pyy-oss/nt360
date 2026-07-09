import { describe, it, expect } from "vitest";
const { salesVelocity } = require("../domain/velocity");

describe("salesVelocity", () => {
  const opps = [
    { stage: 6, amount: 1000 },              // gagné
    { stage: 6, amount: 3000 },              // gagné
    { stage: 7, amount: 500 },               // perdu
    { stage: 3, amount: 800, weighted: 400 },// ouvert
    { stage: 5, amount: 1200, weighted: 900 },// ouvert
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
  it("pipeline pondéré ouvert = somme des pondérés ouverts", () => {
    expect(salesVelocity(opps).openWeighted).toBe(1300); // 400 + 900
    expect(salesVelocity(opps).openCount).toBe(2);
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
});
