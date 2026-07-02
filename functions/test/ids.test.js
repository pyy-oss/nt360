import { describe, it, expect } from "vitest";
const { fpKey, num, cleanBu, noAcc, cleanName } = require("../lib/ids");

// Socle F0 : garde-fous des helpers déterministes (BUILD_KIT §18.1).
describe("fpKey — normalisation clé d'or N° FP", () => {
  it("normalise majuscules et extrait la clé d'un libellé", () => {
    expect(fpKey("fp/2026/13542")).toBe("FP/2026/13542");
    expect(fpKey("  FP/2026/13542  ")).toBe("FP/2026/13542");
    expect(fpKey("Réf FP/2026/13542 — client")).toBe("FP/2026/13542");
  });
  it("renvoie null si aucun motif FP", () => {
    expect(fpKey("")).toBeNull();
    expect(fpKey("N/A")).toBeNull();
  });
  it("rejette les FP placeholder à séquence nulle (.../0000)", () => {
    expect(fpKey("FP/2024/0000")).toBeNull();
    expect(fpKey("FP/2026/00")).toBeNull();
    expect(fpKey("FP/2026/013")).toBe("FP/2026/013"); // zéros non significatifs conservés
  });
});

describe("cleanName — fusion des doublons logiques", () => {
  it("trim, espaces, majuscules", () => {
    expect(cleanName("  Orange   ci ")).toBe("ORANGE CI");
    expect(cleanName("orange ci")).toBe("ORANGE CI");
    expect(cleanName(null)).toBe("");
  });
});

describe("num — parsing tolérant", () => {
  it("gère espaces et virgule décimale", () => {
    expect(num("1 007 500")).toBe(1007500);
    expect(num("7,2")).toBe(7.2);
    expect(num("1 085 668 FCFA")).toBe(1085668);
  });
  it("renvoie 0 pour valeurs non numériques", () => {
    expect(num(null)).toBe(0);
    expect(num("abc")).toBe(0);
  });
  it("milliers avec point, décimale virgule (fr-FR)", () => {
    expect(num("1.234.567")).toBe(1234567); // point = millier
    expect(num("1.234.567,89")).toBeCloseTo(1234567.89, 2);
    expect(num("435,04")).toBeCloseTo(435.04, 2);
  });
  it("format en-US (virgule millier, point décimal)", () => {
    expect(num("1,234,567.89")).toBeCloseTo(1234567.89, 2);
    expect(num("744.96")).toBeCloseTo(744.96, 2);
  });
  it("négatifs : parenthèses comptables et signe en queue", () => {
    expect(num("(1 000)")).toBe(-1000);
    expect(num("1 000-")).toBe(-1000);
    expect(num("-2 500,50")).toBeCloseTo(-2500.5, 2);
  });
  it("entiers XOF sans décimale", () => {
    expect(num("20000000")).toBe(20000000);
    expect(num("1,234")).toBe(1234); // virgule = millier (3 chiffres) → entier
  });
});

describe("cleanBu / noAcc", () => {
  it("normalise la BU", () => {
    expect(cleanBu("ict")).toBe("ICT");
    expect(cleanBu("xxx")).toBe("AUTRE");
  });
  it("retire les accents", () => {
    expect(noAcc("Négociation")).toBe("negociation");
    expect(noAcc("N° DE FP")).toBe("n° de fp");
  });
});
