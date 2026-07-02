import { describe, it, expect } from "vitest";
import { fmt, pct, buColors } from "./tokens";

// Socle F0 : garde-fous formatage FCFA (garde anti-NaN/zéro, §18.7).
describe("fmt — formatage FCFA", () => {
  it("échelles Md / M / k", () => {
    expect(fmt(31_700_000_000)).toBe("31.70 Md");
    expect(fmt(447_975_335)).toBe("448.0 M");
    expect(fmt(1_007_500)).toBe("1.0 M");
    expect(fmt(1_500)).toBe("2 k");
  });
  it("distingue vrai zéro et absence de donnée", () => {
    expect(fmt(0)).toBe("0");      // vrai zéro
    expect(fmt(null)).toBe("—");   // donnée absente
    expect(fmt(undefined)).toBe("—");
    expect(fmt(NaN)).toBe("—");    // donnée invalide
  });
});

describe("pct", () => {
  it("formate un ratio", () => {
    expect(pct(0.21)).toBe("21.0%");
    expect(pct(0.072)).toBe("7.2%");
  });
});

describe("buColors", () => {
  it("associe chaque BU à une couleur", () => {
    expect(buColors.ICT).toBeTruthy();
    expect(buColors.CLOUD).toBeTruthy();
    expect(buColors.FORMATION).toBeTruthy();
  });
});
