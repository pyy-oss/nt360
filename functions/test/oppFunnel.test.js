import { describe, it, expect } from "vitest";
const { oppFunnel } = require("../domain/oppFunnel");

describe("oppFunnel — funnel de conversion depuis l'historique des transitions", () => {
  it("agrège les transitions (from→to) avec count + montant", () => {
    const r = oppFunnel([
      { from: 1, to: 2, amount: 100 },
      { from: 1, to: 2, amount: 50 },
      { from: 2, to: 3, amount: 200 },
    ]);
    expect(r.total).toBe(3);
    const t12 = r.transitions.find((t) => t.from === 1 && t.to === 2);
    expect(t12.count).toBe(2);
    expect(t12.amount).toBe(150);
    expect(r.advanced).toBe(3); // toutes progressent dans le funnel actif
  });

  it("won / lost / winRate depuis les passages en 6 / 7", () => {
    const r = oppFunnel([
      { from: 5, to: 6, amount: 1000 }, // gagné
      { from: 4, to: 6, amount: 500 },  // gagné
      { from: 3, to: 7, amount: 300 },  // perdu
    ]);
    expect(r.won).toBe(2);
    expect(r.lost).toBe(1);
    expect(r.winRate).toBeCloseTo(2 / 3, 5);
  });

  it("compte les reculs (regressed) dans le funnel actif", () => {
    const r = oppFunnel([{ from: 4, to: 2 }, { from: 3, to: 1 }, { from: 2, to: 3 }]);
    expect(r.regressed).toBe(2);
    expect(r.advanced).toBe(1);
  });

  it("ignore les transitions sans étape cible et gère l'entrée vide", () => {
    expect(oppFunnel([]).total).toBe(0);
    expect(oppFunnel([{ from: 1 }, { to: 0 }, null]).total).toBe(0);
    expect(oppFunnel(undefined).transitions).toEqual([]);
  });
});
