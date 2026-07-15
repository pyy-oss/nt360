import { describe, it, expect } from "vitest";
import { isMntEnabled, moduleFlagOn } from "./mntFeature";

// C10 (côté front) — MIROIR de functions/domain/mntFeature.js : à drapeau éteint, l'onglet du module
// n'apparaît pas (App filtre via moduleFlagOn), donc l'ERP est strictement celui d'avant.
describe("mntFeature — drapeau front (miroir back)", () => {
  it("isMntEnabled : absent / non-true ⇒ éteint ; true ⇒ allumé", () => {
    expect(isMntEnabled(undefined)).toBe(false);
    expect(isMntEnabled(null)).toBe(false);
    expect(isMntEnabled({})).toBe(false);
    expect(isMntEnabled({ enabled: false })).toBe(false);
    expect(isMntEnabled({ enabled: true })).toBe(true);
  });

  it("moduleFlagOn : un module SANS flag est toujours visible (comportement historique inchangé)", () => {
    expect(moduleFlagOn(undefined, undefined)).toBe(true);
    expect(moduleFlagOn(undefined, { enabled: false })).toBe(true);
  });

  it("moduleFlagOn : le module 'mntFeature' est masqué tant que le drapeau est éteint", () => {
    expect(moduleFlagOn("mntFeature", undefined)).toBe(false); // doc absent ⇒ masqué
    expect(moduleFlagOn("mntFeature", { enabled: false })).toBe(false);
    expect(moduleFlagOn("mntFeature", { enabled: true })).toBe(true); // allumé ⇒ visible (si droit)
  });
});
