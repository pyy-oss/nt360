import { describe, it, expect } from "vitest";
import { STATUT_LABEL, COUVERTURE_LABEL, statutTone, label } from "./mntContrat";

describe("mntContrat (front) — libellés & tons", () => {
  it("libellés FR des statuts / couvertures", () => {
    expect(STATUT_LABEL.actif).toBe("Actif");
    expect(STATUT_LABEL.resilie).toBe("Résilié");
    expect(COUVERTURE_LABEL.ouvre_lun_ven).toBe("Jours ouvrés (Lun–Ven)");
  });
  it("ton de badge par statut (palette existante)", () => {
    expect(statutTone("actif")).toBe("emerald");
    expect(statutTone("resilie")).toBe("clay");
    expect(statutTone("inconnu")).toBe("neutral");
    expect(statutTone(undefined)).toBe("neutral");
  });
  it("label() : valeur absente ⇒ « — » ; code inconnu ⇒ code brut", () => {
    expect(label(STATUT_LABEL, undefined)).toBe("—");
    expect(label(STATUT_LABEL, "actif")).toBe("Actif");
    expect(label(STATUT_LABEL, "zzz")).toBe("zzz");
  });
});
