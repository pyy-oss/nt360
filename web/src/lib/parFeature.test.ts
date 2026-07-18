import { describe, it, expect } from "vitest";
import { isParEnabled } from "./parFeature";

// MIROIR de functions/domain/parFeature.js : le drapeau config/parFeature { enabled: true } commande
// l'existence de toute surface par_*. Absent ⇒ éteint (l'ERP reste celui d'avant). ADR-P01.
// (Le filtrage de l'onglet via moduleFlagOn arrive avec l'onglet lui-même, Lot 6.)
describe("parFeature — drapeau front (miroir back)", () => {
  it("isParEnabled : absent / non-true ⇒ éteint ; true ⇒ allumé", () => {
    expect(isParEnabled(undefined)).toBe(false);
    expect(isParEnabled(null)).toBe(false);
    expect(isParEnabled({})).toBe(false);
    expect(isParEnabled({ enabled: false })).toBe(false);
    expect(isParEnabled({ enabled: true })).toBe(true);
  });
});
