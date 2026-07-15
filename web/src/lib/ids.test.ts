import { describe, it, expect } from "vitest";
import { fpKey, isAgedLost, plausibleYear } from "./ids";

// Parité avec le serveur (functions/lib/ids.js fpKey, functions/domain/oppLifecycle.js isAgedLost).
// Ces helpers existent pour que le frontal canonise les N° FP EXACTEMENT comme mergeCommandes, sinon
// les rapprochements front (opps ↔ commandes, factures ↔ commandes) divergent des comptes serveur.
describe("fpKey (miroir serveur)", () => {
  it("canonise les zéros de tête de la séquence", () => {
    expect(fpKey("FP/2024/013")).toBe("FP/2024/13");
    expect(fpKey("FP/2024/13")).toBe("FP/2024/13");
  });
  it("tolère la casse et les séparateurs espaces (sans slash)", () => {
    expect(fpKey("fp/2024/013")).toBe("FP/2024/13");
    expect(fpKey("FP 2024 13")).toBe("FP/2024/13");
  });
  it("rejette les placeholders à séquence nulle et les formats invalides", () => {
    expect(fpKey("FP/2024/0000")).toBeNull();
    expect(fpKey("")).toBeNull();
    expect(fpKey("ABC")).toBeNull();
    expect(fpKey(null)).toBeNull();
  });
  it("ne tronque pas une année à 5 chiffres (pas de collision)", () => {
    expect(fpKey("FP/20244/13")).toBeNull();
  });
});

describe("isAgedLost (miroir serveur)", () => {
  const base = { source: "salesData", stage: 3, ageDays: 400, probability: 0.5 };
  it("vrai : salesData active ≥366 j et IdC ≤90 %", () => {
    expect(isAgedLost(base)).toBe(true);
  });
  it("faux : IdC > 90 %", () => {
    expect(isAgedLost({ ...base, probability: 0.95 })).toBe(false);
  });
  it("faux : âge < 366 j", () => {
    expect(isAgedLost({ ...base, ageDays: 100 })).toBe(false);
  });
  it("faux : source ≠ salesData ou hors stage actif", () => {
    expect(isAgedLost({ ...base, source: "saisie" })).toBe(false);
    expect(isAgedLost({ ...base, stage: 6 })).toBe(false);
  });
});

describe("plausibleYear (miroir serveur)", () => {
  it("accepte une année dans [2015, année+3]", () => {
    const now = new Date().getFullYear();
    expect(plausibleYear(2026)).toBe(2026);
    expect(plausibleYear(String(now + 3))).toBe(now + 3);
  });
  it("rejette sentinelles et millésimes aberrants → 0", () => {
    expect(plausibleYear(1900)).toBe(0);
    expect(plausibleYear(0)).toBe(0);
    expect(plausibleYear(20226)).toBe(0);
    expect(plausibleYear(new Date().getFullYear() + 4)).toBe(0);
    expect(plausibleYear("")).toBe(0);
    expect(plausibleYear(null)).toBe(0);
  });
});
