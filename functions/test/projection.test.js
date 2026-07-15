import { describe, it, expect } from "vitest";
const { normalizeTiers, projectionWeight, tierBreakdown, p01 } = require("../domain/projection");

const OPPS = [
  { probability: 0.95, amount: 1000 }, // Certitudes ≥90 → 100 %
  { probability: 0.80, amount: 2000 }, // Forecast 70-90 → 20 %
  { probability: 0.60, amount: 1000 }, // Pipe 50-70 → 5 %
  { probability: 0.40, amount: 5000 }, // < 50 → 0
];

describe("projection — moteur à 3 niveaux configurables", () => {
  it("défauts : Certitudes 100 % · Forecast 20 % · Pipe 5 % (tous actifs)", () => {
    const t = normalizeTiers();
    expect(projectionWeight(OPPS[0], t)).toBe(1000);
    expect(projectionWeight(OPPS[1], t)).toBe(400);
    expect(projectionWeight(OPPS[2], t)).toBe(50);
    expect(projectionWeight(OPPS[3], t)).toBe(0);
  });
  it("désactiver un niveau → sa contribution tombe à 0 (les patates/carottes ne se mélangent pas)", () => {
    const t = normalizeTiers({ forecast: { active: false }, pipe: { active: false } });
    expect(projectionWeight(OPPS[0], t)).toBe(1000); // Certitudes reste
    expect(projectionWeight(OPPS[1], t)).toBe(0);    // Forecast off
    expect(projectionWeight(OPPS[2], t)).toBe(0);    // Pipe off
  });
  it("poids configurable (borné [0,1]) ; valeur invalide → défaut", () => {
    expect(projectionWeight(OPPS[1], normalizeTiers({ forecast: { weight: 0.5 } }))).toBe(1000); // 0,5 × 2000
    expect(projectionWeight(OPPS[2], normalizeTiers({ pipe: { weight: 2 } }))).toBe(50);         // 2 hors [0,1] → défaut 0,05
    expect(projectionWeight(OPPS[2], normalizeTiers({ pipe: { weight: -1 } }))).toBe(50);        // négatif → défaut
  });
  it("tierBreakdown : cohortes disjointes, pondéré = 0 si niveau inactif, Σ actifs = pondéré total", () => {
    const t = normalizeTiers({ pipe: { active: false } });
    const b = tierBreakdown(OPPS, t);
    const by = Object.fromEntries(b.map((x) => [x.key, x]));
    expect(by.certitudes).toMatchObject({ brut: 1000, pond: 1000, count: 1 });
    expect(by.forecast).toMatchObject({ brut: 2000, pond: 400, count: 1 });
    expect(by.pipe).toMatchObject({ brut: 1000, pond: 0, count: 1 }); // compté en brut, pondéré 0 (inactif)
    const total = b.reduce((s, x) => s + x.pond, 0);
    expect(total).toBe(1400); // 1000 + 400 + 0
  });
});

describe("projection — IdC en POURCENTAGE (0-100) via p01, mixte 0-1 toléré", () => {
  it("p01 : > 1 ⇒ ÷100 ; ≤ 1 ⇒ identité (données 0-1 historiques)", () => {
    expect(p01(90)).toBeCloseTo(0.9);
    expect(p01(60)).toBeCloseTo(0.6);
    expect(p01(0.9)).toBe(0.9);
    expect(p01(0)).toBe(0);
    expect(p01(100)).toBe(1);
  });
  it("les IdC en % tombent dans le BON palier (fin du ladder qui s'effondrait sur « Certitudes »)", () => {
    const t = normalizeTiers();
    expect(projectionWeight({ probability: 90, amount: 1000 }, t)).toBe(1000); // 90 % → Certitudes ×1
    expect(projectionWeight({ probability: 80, amount: 2000 }, t)).toBe(400);  // 80 % → Forecast ×0,2
    expect(projectionWeight({ probability: 60, amount: 1000 }, t)).toBe(50);   // 60 % → Pipe ×0,05
    expect(projectionWeight({ probability: 40, amount: 5000 }, t)).toBe(0);    // 40 % → sous le plancher
  });
  it("tierBreakdown : population en % se RÉPARTIT (ne s'agglutine plus en Certitudes)", () => {
    const b = tierBreakdown([
      { probability: 90, amount: 1000 }, { probability: 80, amount: 2000 }, { probability: 60, amount: 1000 },
    ], normalizeTiers());
    const by = Object.fromEntries(b.map((x) => [x.key, x]));
    expect(by.certitudes.count).toBe(1);
    expect(by.forecast.count).toBe(1);
    expect(by.pipe.count).toBe(1);
  });
  it("mixte 0-1 et 0-100 : mêmes paliers (parité pendant la transition, sans migration)", () => {
    const t = normalizeTiers();
    expect(projectionWeight({ probability: 90, amount: 1000 }, t)).toBe(projectionWeight({ probability: 0.9, amount: 1000 }, t));
    expect(projectionWeight({ probability: 60, amount: 1000 }, t)).toBe(projectionWeight({ probability: 0.6, amount: 1000 }, t));
  });
});
