import { describe, it, expect } from "vitest";
const { isMntEnabled } = require("../domain/mntFeature");

// C10 (côté serveur) — le module s'éteint SANS redéploiement via config/mntFeature.
describe("mntFeature — lecture du drapeau (ADR-009)", () => {
  it("drapeau ABSENT (doc manquant) ⇒ éteint", () => {
    expect(isMntEnabled(undefined)).toBe(false);
    expect(isMntEnabled(null)).toBe(false);
    expect(isMntEnabled({})).toBe(false);
  });
  it("enabled ≠ true (false / valeur trompeuse) ⇒ éteint (fail-closed)", () => {
    expect(isMntEnabled({ enabled: false })).toBe(false);
    expect(isMntEnabled({ enabled: "true" })).toBe(false); // pas le booléen strict
    expect(isMntEnabled({ enabled: 1 })).toBe(false);
  });
  it("enabled === true ⇒ allumé", () => {
    expect(isMntEnabled({ enabled: true })).toBe(true);
  });
});
