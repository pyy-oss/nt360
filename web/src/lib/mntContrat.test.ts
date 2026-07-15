import { describe, it, expect } from "vitest";
import { STATUT_LABEL, COUVERTURE_LABEL, statutTone, label, PRIORITE_LABEL, prioriteTone, ticketStatutTone } from "./mntContrat";

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
  it("tickets : libellés + tons de priorité sur la palette de risque (ADR-008/014)", () => {
    expect(PRIORITE_LABEL.critique).toBe("Critique");
    expect(prioriteTone("basse")).toBe("emerald");
    expect(prioriteTone("critique")).toBe("plum");
    expect(ticketStatutTone("resolu")).toBe("emerald");
    expect(ticketStatutTone("clos")).toBe("neutral");
  });
});
