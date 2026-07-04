import { describe, it, expect } from "vitest";
import { computeFilteredOverview } from "./overviewCalc";

// match() identique à useFilters().match : égalité insensible à la casse sur les dims fournies.
const up = (s?: string) => (s || "").trim().toUpperCase();
const mkMatch = (f: { bu?: string; am?: string; client?: string }) =>
  (row: { bu?: string; am?: string; client?: string }, dims: readonly ("bu" | "am" | "client")[] = ["bu", "am", "client"]) => {
    if (dims.includes("bu") && f.bu && up(row.bu) !== up(f.bu)) return false;
    if (dims.includes("am") && f.am && up(row.am) !== up(f.am)) return false;
    if (dims.includes("client") && f.client && up(row.client) !== up(f.client)) return false;
    return true;
  };

describe("computeFilteredOverview — recalcul par périmètre (miroir de overview())", () => {
  const orders = [
    { fp: "FP/2026/1", bu: "ICT", am: "X", client: "ACME", cas: 1000, raf: 400, mb: 200, yearPo: 2026 },
    { fp: "FP/2026/2", bu: "CLOUD", am: "Y", client: "BETA", cas: 500, raf: 100, mb: 50, yearPo: 2026 },
    { fp: "FP/2025/3", bu: "ICT", am: "X", client: "ACME", cas: 800, raf: 800, mb: 160, yearPo: 2025 }, // hors cohorte 2026
  ];
  const invoices = [
    { fp: "FP/2026/1", bu: "ICT", client: "ACME", amountHt: 600, date: "2026-03-01" }, // périmètre ICT/X/ACME
    { fp: "FP/2026/2", bu: "CLOUD", client: "BETA", amountHt: 300, date: "2026-04-01" },
    { fp: "FP/2025/3", bu: "ICT", client: "ACME", amountHt: 700, date: "2025-05-01" }, // hors 2026
  ];
  const opps = [
    { bu: "ICT", am: "X", client: "ACME", amount: 400, stage: 3, probability: 0.95, closingDate: "2026-06-01" }, // certitude ICT
    { bu: "ICT", am: "X", client: "ACME", amount: 200, stage: 2, probability: 0.75, closingDate: "2026-07-01" }, // bande 70-90
    { bu: "CLOUD", am: "Y", client: "BETA", amount: 999, stage: 5, probability: 0.95, closingDate: "2026-06-01" }, // hors ICT
  ];

  it("filtre BU=ICT, période 2026 : CAS/CAF/backlog/certitudes/ratios par périmètre", () => {
    const r = computeFilteredOverview(orders as any, invoices as any, opps as any, "2026", mkMatch({ bu: "ICT" }));
    expect(r.commandes).toBe(1000);   // FP/2026/1 (cohorte 2026, ICT) — FP/2025/3 hors cohorte
    expect(r.facture).toBe(600);      // facture ICT datée 2026 (FP/2026/1) — 2025 exclue
    // backlog GLISSANT = RAF de TOUTES les commandes ICT ouvertes (2026 + 2025) : 400 + 800
    expect(r.backlog).toBe(1200);
    expect(r.backlogCount).toBe(2);
    expect(r.mb).toBe(200);
    expect(r.certitudes).toBe(400);   // opp ICT ≥90 %
    // conversion = commandes / (commandes + certitude + 0.2·[70-90] + 0.1·[50-70] + perdu)
    expect(r.ratios.tauxConversionVente).toBeCloseTo(1000 / (1000 + 400 + 0.2 * 200), 6);
    expect(r.ratios.tauxFacturation).toBeCloseTo(600 / (600 + 1200), 6);
    expect(r.ratios.pmb).toBeCloseTo(0.2, 6);
  });

  it("période « all » : ignore la cohorte d'année (toutes commandes du périmètre)", () => {
    const r = computeFilteredOverview(orders as any, invoices as any, opps as any, "all", mkMatch({ client: "ACME" }));
    expect(r.commandes).toBe(1800);   // FP/2026/1 + FP/2025/3
    expect(r.facture).toBe(1300);     // 600 + 700 (toutes dates)
  });

  it("dédup saisie/salesData : une opp saisie couverte par salesData (même FP) n'est comptée qu'une fois", () => {
    const opps2 = [
      { fp: "FP/2026/1", bu: "ICT", am: "X", client: "A", amount: 100, stage: 3, probability: 0.95, closingDate: "2026-05-01", source: "salesData" },
      { fp: "FP/2026/1", bu: "ICT", am: "X", client: "A", amount: 100, stage: 3, probability: 0.95, closingDate: "2026-05-01", source: "saisie" }, // doublon même FP
    ];
    const r = computeFilteredOverview([] as any, [] as any, opps2 as any, "2026", mkMatch({ bu: "ICT" }));
    expect(r.certitudes).toBe(100); // 100, pas 200 (doublon écarté)
  });

  it("perspective Facturé : marge reconnue = taux × min(facturé, CAS) (plafond surfacturation)", () => {
    const ord = [{ fp: "FP/1", bu: "ICT", am: "X", client: "A", cas: 1000, raf: 0, mb: 200, yearPo: 2026 }]; // taux 20 %
    const inv = [{ fp: "FP/1", bu: "ICT", client: "A", amountHt: 1500, date: "2026-03-01" }]; // surfacturé
    const r = computeFilteredOverview(ord as any, inv as any, [] as any, "2026", mkMatch({ bu: "ICT" }));
    expect(r.facture).toBe(1500);          // assiette facturé = facturé réel
    expect(r.factureMb).toBe(200);         // 0,20 × min(1500, 1000) = 200 (pas 300)
    expect(r.facturePmb).toBeCloseTo(200 / 1500, 6);
  });
  it("conversion vente : bandes 70-90 / 50-70 pondérées + perdu au dénominateur", () => {
    const ord = [{ fp: "FP/1", bu: "ICT", am: "X", client: "A", cas: 2000, raf: 0, mb: 0, yearPo: 2026 }];
    const opps2 = [
      { bu: "ICT", am: "X", client: "A", amount: 1000, stage: 2, probability: 0.80, closingDate: "2026-05-01" }, // 70-90 → ×0.2
      { bu: "ICT", am: "X", client: "A", amount: 1000, stage: 2, probability: 0.60, closingDate: "2026-05-01" }, // 50-70 → ×0.05 (Pipe)
      { bu: "ICT", am: "X", client: "A", amount: 500, stage: 7, closingDate: "2026-05-01" }, // perdu
    ];
    const r = computeFilteredOverview(ord as any, [] as any, opps2 as any, "2026", mkMatch({ bu: "ICT" }));
    expect(r.certitudes).toBe(0); // aucune ≥ 90 %
    // convDenom = 2000 (cmd) + 0.2·1000 (Forecast) + 0.05·1000 (Pipe) + 500 (perdu) = 2750
    expect(r.ratios.tauxConversionVente).toBeCloseTo(2000 / 2750, 6);
  });

  it("facture ORPHELINE attribuée au périmètre via son propre BU (pas de commande)", () => {
    const ord = [{ fp: "FP/1", bu: "ICT", am: "X", client: "ACME", cas: 100, raf: 0, mb: 10, yearPo: 2026 }];
    const inv = [{ fp: "FP/9", bu: "ICT", client: "OTHER", amountHt: 500, date: "2026-01-01" }]; // orpheline, BU ICT
    const r = computeFilteredOverview(ord as any, inv as any, [], "2026", mkMatch({ bu: "ICT" }));
    expect(r.facture).toBe(500); // rattachée à ICT par le BU de la facture, faute de commande
  });
});
