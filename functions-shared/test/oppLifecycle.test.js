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

// TAUX DE TRANSFORMATION (win rate) — règle métier UNIQUE (audit commercial DC/DG) : perdu = étape 7 OU 9
// (annulé) OU auto-périmé par âge. Sans ces deux ajouts, annulés + périmées échappaient au dénominateur
// → taux optimiste (hors bande ESN ~15-25 %).
const { isWonOpp, isLostOpp } = require("../domain/oppLifecycle");
describe("isWonOpp / isLostOpp — dénominateur honnête du win rate", () => {
  it("gagné = étape 6 uniquement", () => {
    expect(isWonOpp({ stage: 6 })).toBe(true);
    for (const s of [1, 2, 3, 4, 5, 7, 8, 9]) expect(isWonOpp({ stage: s })).toBe(false);
  });
  it("perdu = étape 7 (Perdu) OU 9 (Annulé)", () => {
    expect(isLostOpp({ stage: 7 })).toBe(true);
    expect(isLostOpp({ stage: 9 })).toBe(true);
    expect(isLostOpp({ stage: 6 })).toBe(false); // gagné n'est pas perdu
    expect(isLostOpp({ stage: 8 })).toBe(false); // suspendu : ni gagné ni perdu
  });
  it("perdu inclut les AUTO-PÉRIMÉES par âge (stage 1-5 mais isAgedLost)", () => {
    expect(isLostOpp({ source: "salesData", stage: 3, ageDays: 500, probability: 0.5 })).toBe(true);
    expect(isLostOpp({ source: "salesData", stage: 3, ageDays: 30, probability: 0.5 })).toBe(false); // active récente
  });
  it("le win rate chute quand annulés + périmées entrent au dénominateur (exemple audit)", () => {
    const opps = [
      ...Array.from({ length: 6 }, () => ({ stage: 6 })),
      ...Array.from({ length: 4 }, () => ({ stage: 7 })),
      ...Array.from({ length: 8 }, () => ({ stage: 9 })),
      ...Array.from({ length: 5 }, () => ({ source: "salesData", stage: 3, ageDays: 500, probability: 0.5 })),
    ];
    const won = opps.filter(isWonOpp).length;
    const lost = opps.filter(isLostOpp).length;
    expect(won).toBe(6);
    expect(lost).toBe(17); // 4 + 8 + 5
    expect(won / (won + lost)).toBeCloseTo(6 / 23, 5); // ~26 % (dans la bande) vs 60 % à l'ancien calcul
  });
});
