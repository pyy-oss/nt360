import { describe, it, expect } from "vitest";
const { am360 } = require("../domain/am360");

describe("am360 — pilotage par commercial (sans marge)", () => {
  const orders = [
    { fp: "FP/2026/1", am: "DATCHA", cas: 1000, raf: 400, mb: 200, yearPo: 2026 },
    { fp: "FP/2026/2", am: "DATCHA", cas: 500, raf: 0, mb: 100, yearPo: 2026 },
    { fp: "FP/2025/3", am: "KOUADIO", cas: 800, raf: 300, mb: 160, yearPo: 2025 },
  ];
  const invoices = [
    { fp: "FP/2026/1", amountHt: 600 }, // → DATCHA
    { fp: "FP/2025/3", amountHt: 500 }, // → KOUADIO
    { fp: "FP/9999/9", amountHt: 999 }, // orpheline (aucun AM) → ignorée
  ];
  const opps = [
    { am: "DATCHA", stage: 3, probability: 0.95, amount: 1000, weighted: 950 }, // actif éligible
    { am: "DATCHA", stage: 6, probability: 1, weighted: 0 },      // gagné
    { am: "KOUADIO", stage: 7, probability: 0, weighted: 0 },     // perdu
  ];
  const objectives = [
    { scope: "commercial", scopeValue: "DATCHA", fiscalYear: 2026, targetCas: 3000 },
    { scope: "global", scopeValue: "all", fiscalYear: 2026, targetCas: 9999 },
  ];
  const { rows, fy } = am360(orders, invoices, opps, objectives, 2026);
  const byAm = Object.fromEntries(rows.map((r) => [r.am, r]));

  it("CAS et backlog par AM", () => {
    expect(byAm.DATCHA.cas).toBe(1500); // 1000 + 500
    expect(byAm.DATCHA.backlog).toBe(400); // raf 400 + 0
    expect(byAm.KOUADIO.cas).toBe(800);
  });
  it("facturé relié via FP→AM (orphelines exclues)", () => {
    expect(byAm.DATCHA.facture).toBe(600);
    expect(byAm.KOUADIO.facture).toBe(500);
  });
  it("pipeline pondéré (éligibles IdC≥90 %) à 100% du montant + conversion", () => {
    expect(byAm.DATCHA.pipelinePondere).toBe(1000);
    expect(byAm.DATCHA.activeCount).toBe(1);
    expect(byAm.DATCHA.won).toBe(1);
    expect(byAm.DATCHA.conv).toBe(1); // 1 gagné, 0 perdu
    expect(byAm.KOUADIO.conv).toBe(0); // 0 gagné, 1 perdu
  });
  it("R/O = CAS de l'exercice / objectif CAS (commercial, même FY)", () => {
    expect(byAm.DATCHA.casFy).toBe(1500); // yearPo 2026
    expect(byAm.DATCHA.targetCas).toBe(3000);
    expect(byAm.DATCHA.roCas).toBeCloseTo(0.5, 6);
    expect(byAm.KOUADIO.roCas).toBeNull(); // pas d'objectif AM
    // Couverture = pipeline pondéré / (objectif − réalisé) = 1000 / (3000 − 1500) = 0,667×.
    expect(byAm.DATCHA.couverture).toBeCloseTo(1000 / 1500, 6);
    expect(byAm.KOUADIO.couverture).toBeNull(); // pas d'objectif → rien à couvrir
  });
  it("SANS marge : aucun champ mb/pmb exposé", () => {
    expect(byAm.DATCHA.mb).toBeUndefined();
    expect(byAm.DATCHA.pmb).toBeUndefined();
  });
  it("trié par CAS décroissant, fy renvoyé", () => {
    expect(rows[0].am).toBe("DATCHA");
    expect(fy).toBe(2026);
  });
  it("CAF rattachée par FP CANONIQUE : facture au format différent (zéros/espaces) attribuée au bon AM (audit fiabilité)", () => {
    // Commande FP/2026/7 (AM DATCHA) ; facture au MÊME FP canonique mais formaté autrement → doit être
    // attribuée à DATCHA (avant correctif : amOfFp indexé brut ⇒ lookup raté ⇒ CAF sous-comptée).
    const o = [{ fp: "FP/2026/7", am: "DATCHA", cas: 1000, yearPo: 2026 }];
    const inv = [{ fp: "FP/2026/007", amountHt: 400 }, { fp: "FP 2026 7", amountHt: 100 }];
    const r = am360(o, inv, [], [], 2026).rows;
    const d = r.find((x) => x.am === "DATCHA");
    expect(d.facture).toBe(500); // 400 + 100 rattachés malgré le formatage
  });
  it("pondéré NET du carnet : une opp active dont le FP est déjà commande est exclue (parité pipeline/atterrissage)", () => {
    // La commande FP/2026/1 (DATCHA) « booke » l'opp active portant ce FP → déjà au CAS, hors pondéré.
    const o = [{ fp: "FP/2026/1", am: "DATCHA", cas: 1000, yearPo: 2026 }];
    const op = [{ am: "DATCHA", stage: 3, probability: 0.95, amount: 1000, fp: "FP/2026/0001" }];
    const d = am360(o, [], op, [], 2026).rows.find((x) => x.am === "DATCHA");
    expect(d.pipelinePondere).toBe(0); // opp au carnet retirée du pondéré
    expect(d.activeCount).toBe(1);     // funnel actif BRUT inchangé
  });

  it("exclut les opps DORMANTES du pondéré par AM (parité Cockpit « Tout »)", () => {
    const op = [
      { am: "DATCHA", stage: 3, probability: 0.95, amount: 1000, closingDate: "2026-06-01" }, // exercice
      { am: "DATCHA", stage: 3, probability: 0.95, amount: 8000, closingDate: "2024-06-01" }, // DORMANTE
    ];
    // Défaut (exclusion active) : la dormante 2024 ne compte pas.
    expect(am360([], [], op, [], 2026).rows.find((x) => x.am === "DATCHA").pipelinePondere).toBe(1000);
    // Drapeau désactivé : les deux comptent (poids Certitudes = 1).
    expect(am360([], [], op, [], 2026, undefined, false).rows.find((x) => x.am === "DATCHA").pipelinePondere).toBe(9000);
    // activeCount (funnel brut) inchangé dans les deux cas.
    expect(am360([], [], op, [], 2026).rows.find((x) => x.am === "DATCHA").activeCount).toBe(2);
  });
});

describe("am360 — tendance mensuelle par commercial (CAS booké + facturé)", () => {
  it("agrège le CAS par mois de commande et le facturé par mois de facture, rattaché à l'AM", () => {
    const orders = [
      { fp: "FP/2026/1", am: "DATCHA", cas: 1000, yearPo: 2026, dateCommande: "2026-02-15" },
      { fp: "FP/2026/2", am: "DATCHA", cas: 300, yearPo: 2026, dateCommande: "2026-03-01" },
    ];
    const invoices = [
      { fp: "FP/2026/1", amountHt: 600, date: "2026-04-10" }, // rattaché à DATCHA via FP→AM
    ];
    const d = am360(orders, invoices, [], [], 2026).rows.find((r) => r.am === "DATCHA");
    expect(d.trend).toEqual([
      { month: "2026-02", cas: 1000, facture: 0 },
      { month: "2026-03", cas: 300, facture: 0 },
      { month: "2026-04", cas: 0, facture: 600 },
    ]);
  });
  it("sans dateCommande ni date de facture → tendance vide", () => {
    const d = am360([{ fp: "FP/2026/1", am: "X", cas: 100, yearPo: 2026 }], [], [], [], 2026).rows.find((r) => r.am === "X");
    expect(d.trend).toEqual([]);
  });
});
