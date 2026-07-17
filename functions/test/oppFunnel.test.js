import { describe, it, expect } from "vitest";
const { oppFunnel, stageConversion } = require("../domain/oppFunnel");

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

describe("stageConversion — progression par étape (où meurent les deals)", () => {
  it("mesure sorties/avancés/perdus/reculs par étape active de départ", () => {
    const hist = [
      { from: 4, to: 5 },  // avancé
      { from: 4, to: 6 },  // avancé (gagné)
      { from: 4, to: 7 },  // perdu
      { from: 4, to: 3 },  // recul
      { from: 2, to: 3 },  // avancé
      { from: 6, to: 7 },  // départ NON actif (6) → ignoré
      { from: 0, to: 2 },  // départ 0 → ignoré (création, pas une sortie d'étape)
    ];
    const s4 = stageConversion(hist).find((s) => s.stage === 4);
    expect(s4.out).toBe(4);
    expect(s4.advanced).toBe(2);
    expect(s4.won).toBe(1);
    expect(s4.lost).toBe(1);
    expect(s4.regressed).toBe(1);
    expect(s4.advanceRate).toBeCloseTo(0.5, 6);
    expect(s4.lossRate).toBeCloseTo(0.25, 6);
    const s2 = stageConversion(hist).find((s) => s.stage === 2);
    expect(s2.out).toBe(1);
    expect(s2.advanceRate).toBe(1);
    // Seules les étapes actives 1-5 rencontrées apparaissent, triées.
    expect(stageConversion(hist).map((s) => s.stage)).toEqual([2, 4]);
    expect(stageConversion([])).toEqual([]);
  });

  it("ne compte PAS une suspension (8) / annulation (9) comme une avancée", () => {
    const s3 = stageConversion([
      { from: 3, to: 8 }, // suspendu → sortie, mais pas une progression
      { from: 3, to: 9 }, // annulé → idem
      { from: 3, to: 4 }, // vraie avancée
    ]).find((s) => s.stage === 3);
    expect(s3.out).toBe(3);       // les 3 quittent bien l'étape 3
    expect(s3.advanced).toBe(1);  // seule 3→4 progresse
    expect(s3.lost).toBe(0);      // 8/9 ne sont pas des « Perdu » (=7)
    expect(s3.regressed).toBe(0);
    expect(s3.advanceRate).toBeCloseTo(1 / 3, 6);
  });
});
