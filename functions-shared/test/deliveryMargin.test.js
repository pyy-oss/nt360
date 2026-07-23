import { describe, it, expect } from "vitest";
const { deliveryMargin } = require("../domain/deliveryMargin");

describe("deliveryMargin — marge de livraison par affaire (marge carnet − labor constaté)", () => {
  const carnet = [
    { fp: "FP/2026/1", client: "ACME", bu: "ICT", am: "KOUAME", cas: 10_000_000, facture: 6_000_000 },
    { fp: "FP/2026/2", client: "BETA", bu: "CLOUD", am: "DIALLO", cas: 5_000_000, facture: 0 },
  ];
  const margin = [
    { fp: "FP/2026/1", mb: 3_000_000, costTotal: 7_000_000 }, // 30 % de marge « papier »
    { fp: "FP/2026/2", mb: 2_000_000, costTotal: 3_000_000 },
  ];
  // FP/2026/1 : 20 j imputés à 100 000 → 2 000 000 de labor ; FP/2026/2 : rien.
  const labor = [{ fp: "FP/2026/1", laborDays: 20, laborCost: 2_000_000 }];

  it("marge de livraison = marge carnet − coût labor imputé, triée par la plus basse", () => {
    const rows = deliveryMargin(carnet, margin, labor, true);
    const a = rows.find((r) => r.fp === "FP/2026/1");
    expect(a.vente).toBe(10_000_000);
    expect(a.margeCarnet).toBe(3_000_000);
    expect(a.coutLabor).toBe(2_000_000);
    expect(a.joursLabor).toBe(20);
    expect(a.margeLivraison).toBe(1_000_000);          // 3M − 2M : la main-d'œuvre a mangé 2/3 de la marge
    expect(a.margeLivraisonPct).toBe(0.1);             // 1M / 10M
    const b = rows.find((r) => r.fp === "FP/2026/2");
    expect(b.coutLabor).toBe(0);                        // pas de temps imputé
    expect(b.margeLivraison).toBe(2_000_000);          // = marge carnet
    // Tri : la plus basse marge de livraison d'abord (FP/1 = 1M < FP/2 = 2M).
    expect(rows.map((r) => r.fp)).toEqual(["FP/2026/1", "FP/2026/2"]);
  });

  it("retranche AUSSI la charge d'astreinte validée (par FP) de la marge de livraison (ADR-035)", () => {
    // FP/2026/1 : marge carnet 3M − labor 2M − astreinte 500k = 500k.
    const rows = deliveryMargin(carnet, margin, labor, true, { "FP/2026/1": 500_000 });
    const a = rows.find((r) => r.fp === "FP/2026/1");
    expect(a.coutAstreintes).toBe(500_000);
    expect(a.margeLivraison).toBe(500_000);            // 3M − 2M − 500k
    expect(a.margeLivraisonPct).toBe(0.05);            // 500k / 10M
    // Sans droit rentabilité, la charge est masquée.
    const masked = deliveryMargin(carnet, margin, labor, false, { "FP/2026/1": 500_000 });
    expect(masked.find((r) => r.fp === "FP/2026/1").coutAstreintes).toBeNull();
  });

  it("rapproche par fpKey (zéros de tête / casse) — un labor FP/2026/001 joint FP/2026/1", () => {
    const rows = deliveryMargin(carnet, margin, [{ fp: "fp/2026/001", laborDays: 5, laborCost: 500_000 }], true);
    expect(rows.find((r) => r.fp === "FP/2026/1").coutLabor).toBe(500_000);
  });

  it("masque coûts/marges SANS droit rentabilité (vente + jours restent)", () => {
    const rows = deliveryMargin(carnet, margin, labor, false);
    const a = rows.find((r) => r.fp === "FP/2026/1");
    expect(a.vente).toBe(10_000_000);
    expect(a.joursLabor).toBe(20);
    expect(a.margeCarnet).toBeNull();
    expect(a.coutLabor).toBeNull();
    expect(a.margeLivraison).toBeNull();
    expect(a.margeLivraisonPct).toBeNull();
  });

  it("ignore une marge / un labor sur une affaire absente du carnet ; exclut une affaire à 0 montant", () => {
    const rows = deliveryMargin(
      [{ fp: "FP/2026/9", cas: 0, facture: 0 }],           // montant nul → exclue
      [{ fp: "FP/2026/8", mb: 1, costTotal: 1 }],          // hors carnet → ignorée
      [{ fp: "FP/2026/7", laborDays: 1, laborCost: 1 }],   // hors carnet → ignoré
      true,
    );
    expect(rows).toEqual([]);
  });
});
