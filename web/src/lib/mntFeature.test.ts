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
    expect(moduleFlagOn(undefined, { mntFeature: false })).toBe(true);
  });

  it("moduleFlagOn : le module 'mntFeature' est masqué tant que le drapeau est éteint", () => {
    expect(moduleFlagOn("mntFeature", undefined)).toBe(false); // table absente ⇒ masqué
    expect(moduleFlagOn("mntFeature", {})).toBe(false); // flag absent de la table ⇒ masqué
    expect(moduleFlagOn("mntFeature", { mntFeature: false })).toBe(false);
    expect(moduleFlagOn("mntFeature", { mntFeature: true })).toBe(true); // allumé ⇒ visible (si droit)
  });

  it("moduleFlagOn : générique — chaque drapeau résolu indépendamment via la table", () => {
    expect(moduleFlagOn("parFeature", { mntFeature: true })).toBe(false);
    expect(moduleFlagOn("parFeature", { mntFeature: true, parFeature: true })).toBe(true);
  });
});
