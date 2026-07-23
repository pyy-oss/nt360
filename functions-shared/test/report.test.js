import { describe, it, expect } from "vitest";
const { validateReportDef, applyReport, GROUP_FIELDS } = require("../domain/report");

const OPPS = [
  { bu: "ICT", am: "Alice", client: "ORANGE", stage: 3, amount: 100, probability: 0.5, weighted: 50, forecastCategory: "commit" },
  { bu: "ICT", am: "Bob", client: "MTN", stage: 5, amount: 200, probability: 0.9, weighted: 180 },
  { bu: "CLOUD", am: "Alice", client: "CIE", stage: 6, amount: 300, probability: 1, weighted: 300 },
  { bu: "", am: "Bob", client: "SONATEL", stage: 2, amount: 50, probability: 0.2, weighted: 10 },
];

describe("validateReportDef", () => {
  it("rejette un regroupement invalide, défaut mesure = count", () => {
    expect(validateReportDef({ groupBy: "xxx" }).ok).toBe(false);
    const v = validateReportDef({ groupBy: "bu" });
    expect(v.ok).toBe(true);
    expect(v.value.measure).toBe("count");
  });
  it("normalise les filtres (BU en majuscules, montant min, openOnly)", () => {
    const v = validateReportDef({ groupBy: "am", measure: "amount", filters: { bu: "ict", minAmount: "80", openOnly: true } });
    expect(v.value.filters.bu).toBe("ICT");
    expect(v.value.filters.minAmount).toBe(80);
    expect(v.value.filters.openOnly).toBe(true);
  });
  it("expose les champs de regroupement", () => {
    expect(GROUP_FIELDS).toContain("forecastCategory");
  });
});

describe("applyReport", () => {
  it("groupe par BU, mesure count, avec libellé (non renseigné)", () => {
    const r = applyReport({ groupBy: "bu", measure: "count" }, OPPS);
    const byKey = Object.fromEntries(r.rows.map((x) => [x.key, x.count]));
    expect(byKey.ICT).toBe(2);
    expect(byKey.CLOUD).toBe(1);
    expect(byKey["(non renseigné)"]).toBe(1);
    expect(r.totals.count).toBe(4);
  });
  it("groupe par AM, mesure Σ montant, trié décroissant", () => {
    const r = applyReport({ groupBy: "am", measure: "amount" }, OPPS);
    // Alice = 100 + 300 = 400, Bob = 200 + 50 = 250 → Alice en tête.
    expect(r.rows[0].key).toBe("Alice");
    expect(r.rows[0].amount).toBe(400);
  });
  it("filtre openOnly exclut les fermées (stage 6/7)", () => {
    const r = applyReport({ groupBy: "am", measure: "count", filters: { openOnly: true } }, OPPS);
    expect(r.totals.count).toBe(3); // exclut la gagnée (stage 6)
  });
  it("filtre minAmount + bu", () => {
    const r = applyReport({ groupBy: "client", measure: "amount", filters: { bu: "ICT", minAmount: 150 } }, OPPS);
    expect(r.totals.count).toBe(1);
    expect(r.rows[0].key).toBe("MTN");
  });
  it("mesure weighted = pondéré TIÉRÉ (projectionWeight), pas le champ linéaire persisté", () => {
    const r = applyReport({ groupBy: "bu", measure: "weighted" }, OPPS);
    const ict = r.rows.find((x) => x.key === "ICT");
    // ORANGE (proba 0,5 → palier Pipe ×0,05 = 5) + MTN (proba 0,9 → Certitudes ×1 = 200) = 205.
    expect(ict.weighted).toBe(205);
  });
});
