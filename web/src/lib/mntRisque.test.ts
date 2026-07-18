import { describe, it, expect } from "vitest";
import { niveauTone, NIVEAU_LABEL, SIGNAL_LABEL, signalText, revenueRecognition } from "./mntRisque";
import type { RisqueItem } from "./mntRisque";

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

describe("revenueRecognition — reconnu vs facturé (DO Lot 4)", () => {
  const mk = (engage: number, facture: number): RisqueItem => ({
    id: "c", fp: "FP/2026/1", client: "A", am: "", bu: "", statut: "actif",
    score: 0, niveau: "vert", signals: [], slaRompus: 0, joursAvantFin: null, quotaDepasse: 0,
    sousFacturation: { engage, facture, ecart: engage - facture },
  });
  it("agrège reconnu/facturé et sépare à-facturer (couru) et facturé d'avance (constaté d'avance)", () => {
    const r = revenueRecognition([
      mk(1_000_000, 600_000), // reconnu > facturé → 400k à facturer
      mk(500_000, 500_000),   // équilibré → rien
      mk(300_000, 800_000),   // facturé > reconnu → 500k facturé d'avance
    ]);
    expect(r.reconnu).toBe(1_800_000);
    expect(r.facture).toBe(1_900_000);
    expect(r.aFacturer).toBe(400_000);       // Σ max(0, reconnu − facturé) — NON nettoyé du facturé d'avance
    expect(r.factureAvance).toBe(500_000);   // Σ max(0, facturé − reconnu)
    expect(r.contrats).toBe(2);              // 2 contrats avec écart (l'équilibré exclu)
  });
  it("liste vide → tout à zéro", () => {
    expect(revenueRecognition([])).toEqual({ reconnu: 0, facture: 0, aFacturer: 0, factureAvance: 0, contrats: 0 });
  });
});
