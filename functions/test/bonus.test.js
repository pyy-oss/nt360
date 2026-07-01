import { describe, it, expect } from "vitest";
const { atterrissage } = require("../domain/atterrissage");
const { alerts } = require("../domain/alerts");

const ORDERS = [
  { fp: "FP/2026/1", client: "ACME", bu: "ICT", yearPo: 2026, cas: 1000, raf: 400, mb: 210 },
  { fp: "FP/2022/9", client: "ACME", bu: "ICT", yearPo: 2022, cas: 800, raf: 300, mb: -50 }, // marge nég + dormant
  { fp: "FP/2026/3", client: "BETA", bu: "CLOUD", yearPo: 2026, cas: 200, raf: 0, mb: 40 },
];
const INVOICES = [
  { fp: "FP/2026/1", date: "2026-01-01", amountHt: 600 },
  { fp: "FP/2025/1", date: "2025-01-01", amountHt: 400 },
];
const OPPS = [
  { stage: 4, probability: 0.95, weighted: 500, closingDate: "2026-05-01" }, // éligible ≥90% + FY
  { stage: 4, probability: 0.95, weighted: 300, closingDate: "2025-05-01" }, // hors FY
  { stage: 4, probability: 0.4, weighted: 800, closingDate: "2026-06-01" }, // FY mais IdC<90% → exclu
];
const OBJ = [{ fiscalYear: 2026, scope: "global", targetCas: 2000 }];

describe("atterrissage (§7)", () => {
  const a = atterrissage(ORDERS, INVOICES, OPPS, OBJ, 2026);
  it("réalisé CAS FY + pipeline pondéré closing FY → projeté", () => {
    expect(a.realiseCas).toBe(1200); // 1000 + 200 (yearPo 2026)
    expect(a.pipelinePondere).toBe(500); // seule l'opp closing 2026
    expect(a.projete).toBe(1700);
  });
  it("écart vs objectif + N vs N-1", () => {
    expect(a.objectif).toBe(2000);
    expect(a.ecart).toBe(-300);
    expect(a.factureN).toBe(600);
    expect(a.factureN1).toBe(400);
    expect(a.croissanceFacture).toBeCloseTo(0.5, 6);
  });
});

describe("alerts", () => {
  const sup = { bySupplier: [{ name: "HDF", state: "saturation" }, { name: "EXN", state: "tension" }] };
  const INV = [
    { fp: "FP/2026/1", amountHt: 600, linked: true },
    { fp: "FP/2026/3", amountHt: 300, linked: true }, // Σ=300 > cas 200 → surfacturation
    { fp: "FP/9999/9", amountHt: 50, linked: false }, // orpheline
  ];
  const items = alerts(ORDERS, INV, sup, [{ status: "emis" }, { status: "solde" }], 2026);
  const byType = Object.fromEntries(items.map((i) => [i.type, i]));
  it("marge négative + backlog dormant détectés", () => {
    expect(byType.marge_negative.count).toBe(1);
    expect(byType.backlog_dormant.count).toBe(1); // FP/2022/9 (≤2024) raf>0
  });
  it("saturation + tension fournisseurs", () => {
    expect(byType.ligne_saturee.count).toBe(1);
    expect(byType.ligne_tension.count).toBe(1);
  });
  it("concentration client (ACME > 30% du CAS)", () => {
    expect(byType.concentration_client).toBeTruthy();
  });
  it("BC non soldés", () => {
    expect(byType.bc_en_attente.count).toBe(1);
  });
  it("alertes financières : orphelines, surfacturation, RAF incohérent", () => {
    expect(byType.factures_non_rattachees.count).toBe(1); // FP/9999/9
    expect(byType.surfacturation.count).toBe(1); // FP/2026/3 (300 > 200)
    expect(byType.raf_incoherent.count).toBeGreaterThanOrEqual(1); // FP/2022/9 (attendu 800 vs raf 300)
  });
});
