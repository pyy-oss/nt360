import { describe, it, expect } from "vitest";
const { isParEnabled } = require("../domain/parFeature");

// Drapeau du module Partenariats (par_) — miroir de web/src/lib/parFeature.ts. À drapeau éteint, aucune
// surface par_* n'existe : l'ERP est strictement celui d'avant (ADR-P01).
describe("parFeature — drapeau (pur)", () => {
  it("absent / non-true ⇒ éteint ; enabled:true ⇒ allumé", () => {
    expect(isParEnabled(undefined)).toBe(false);
    expect(isParEnabled(null)).toBe(false);
    expect(isParEnabled({})).toBe(false);
    expect(isParEnabled({ enabled: false })).toBe(false);
    expect(isParEnabled({ enabled: "true" })).toBe(false); // strict === true, pas de coercition
    expect(isParEnabled({ enabled: true })).toBe(true);
  });
});
