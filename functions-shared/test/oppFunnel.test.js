import { describe, it, expect } from "vitest";
const { oppFunnel, stageConversion, stageDwell } = require("../domain/oppFunnel");

const DAY = 86400000;

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
    // Win-rate EN VALEUR : 1500 gagnés / 1800 tranchés = 0,833 — plus haut que le win-rate en nombre
    // (0,667) car les deals gagnés pèsent plus lourd que le petit deal perdu.
    expect(r.wonAmount).toBe(1500);
    expect(r.lostAmount).toBe(300);
    expect(r.winRateValue).toBeCloseTo(1500 / 1800, 5);
  });

  it("le win-rate EN VALEUR diverge du win-rate EN NOMBRE quand un gros deal est perdu", () => {
    // 2 petits gagnés (100 chacun) mais 1 gros perdu (10 000) : en nombre 2/3 ≈ 0,67 (sain),
    // en valeur seulement 200/10 200 ≈ 0,02 (alarmant). C'est tout l'intérêt de la vue valeur.
    const r = oppFunnel([
      { from: 5, to: 6, amount: 100 },
      { from: 5, to: 6, amount: 100 },
      { from: 5, to: 7, amount: 10_000 },
    ]);
    expect(r.winRate).toBeCloseTo(2 / 3, 5);
    expect(r.winRateValue).toBeCloseTo(200 / 10_200, 5);
    // Assiette vide (aucun gagné ni perdu) → 0, jamais NaN.
    const empty = oppFunnel([{ from: 1, to: 2, amount: 500 }]);
    expect(empty.winRateValue).toBe(0);
    expect(empty.wonAmount).toBe(0);
    expect(empty.lostAmount).toBe(0);
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

describe("stageDwell — temps moyen par étape (séjours clos)", () => {
  it("reconstitue la durée entre deux transitions consécutives d'une même opp", () => {
    // Opp A : entre en étape 2 à t0, passe en 3 à t0+10j, puis en 6 (gagné) à t0+10j+4j.
    // Séjours clos : étape 2 = 10 j, étape 3 = 4 j. (Le séjour en 6 n'a pas de sortie → non compté.)
    const t0 = 1000 * DAY;
    const r = stageDwell([
      { oppId: "A", from: 1, to: 2, atMs: t0 },
      { oppId: "A", from: 2, to: 3, atMs: t0 + 10 * DAY },
      { oppId: "A", from: 3, to: 6, atMs: t0 + 14 * DAY },
    ]);
    const s2 = r.find((x) => x.stage === 2);
    const s3 = r.find((x) => x.stage === 3);
    expect(s2).toMatchObject({ stage: 2, count: 1, avgDays: 10 });
    expect(s3).toMatchObject({ stage: 3, count: 1, avgDays: 4 });
    expect(r.find((x) => x.stage === 6)).toBeUndefined(); // étape terminale, séjour non clos
  });

  it("moyenne sur plusieurs opps et ignore les étapes hors funnel actif", () => {
    const t0 = 500 * DAY;
    const r = stageDwell([
      { oppId: "A", from: 1, to: 2, atMs: t0 },
      { oppId: "A", from: 2, to: 3, atMs: t0 + 20 * DAY }, // étape 2 : 20 j
      { oppId: "B", from: 1, to: 2, atMs: t0 },
      { oppId: "B", from: 2, to: 3, atMs: t0 + 10 * DAY }, // étape 2 : 10 j
    ]);
    const s2 = r.find((x) => x.stage === 2);
    expect(s2).toMatchObject({ stage: 2, count: 2, avgDays: 15 }); // (20+10)/2
  });

  it("ignore les événements sans oppId et les séjours de durée nulle (mêmes horodatages)", () => {
    const t0 = 100 * DAY;
    const r = stageDwell([
      { from: 1, to: 2, atMs: t0 }, // sans oppId → ignoré
      { oppId: "C", from: 2, to: 3, atMs: t0 }, // deux transitions au même instant (import en masse)
      { oppId: "C", from: 3, to: 4, atMs: t0 }, // → dt = 0, séjour non mesurable, ignoré
    ]);
    expect(r).toHaveLength(0);
  });
});
