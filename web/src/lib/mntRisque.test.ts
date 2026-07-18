import { describe, it, expect } from "vitest";
import { niveauTone, NIVEAU_LABEL, SIGNAL_LABEL, signalText } from "./mntRisque";

describe("mntRisque (front) — libellés & tons", () => {
  it("niveauTone mappe la palette de risque (ADR-008)", () => {
    expect(niveauTone("vert")).toBe("emerald");
    expect(niveauTone("ambre")).toBe("gold");
    expect(niveauTone("rouge")).toBe("clay");
    expect(niveauTone("critique")).toBe("plum");
    expect(niveauTone(undefined)).toBe("neutral");
  });
  it("libellés FR complets", () => {
    expect(NIVEAU_LABEL.critique).toBe("Critique");
    expect(SIGNAL_LABEL.sla_rompu).toBe("SLA rompu");
    expect(SIGNAL_LABEL.sous_facturation).toBe("Sous-facturation");
  });
  it("signalText enrichit avec la valeur du signal", () => {
    expect(signalText({ type: "sla_rompu", count: 3 })).toBe("SLA rompu (3)");
    expect(signalText({ type: "echeance_proche", jours: 12 })).toBe("Échéance proche (12 j)");
    expect(signalText({ type: "echeance_proche", jours: -2 })).toBe("Échéance proche (dépassée)");
    expect(signalText({ type: "quota_depasse", depassement: 2 })).toBe("Quota dépassé (+2)");
  });
  it("marge_faible distingue négative et faible via la sévérité (DO Lot 5)", () => {
    expect(signalText({ type: "marge_faible", severite: "negative" })).toBe("Marge négative");
    expect(signalText({ type: "marge_faible", severite: "faible" })).toBe("Marge faible");
  });
});
