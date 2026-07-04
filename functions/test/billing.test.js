import { describe, it, expect } from "vitest";
const { billingTrend } = require("../domain/billing");

describe("billingTrend — tendance de facturation jusqu'au 31/12", () => {
  const INV = [
    { date: "2026-01-15", amountHt: 100 },
    { date: "2026-02-10", amountHt: 200 },
    { date: "2026-07-01", amountHt: 50 },  // mois courant
    { date: "2025-12-01", amountHt: 999 }, // hors exercice → ignoré
  ];
  const MS = [
    { date: "2026-02-01", amount: 180 },   // mois échu (comparaison plan/réalisé)
    { date: "2026-09-01", amount: 300 },   // à venir → planifié
    { date: "2026-11-01", amount: 400 },   // à venir → planifié
    { date: "2027-01-01", amount: 500 },   // N+1 → hors exercice, ignoré ici
  ];
  const t = billingTrend(INV, MS, 2026, "2026-07-15");

  it("12 mois de l'exercice, réalisé et planifié ventilés", () => {
    expect(t.months).toHaveLength(12);
    const by = Object.fromEntries(t.months.map((m) => [m.month, m]));
    expect(by["2026-01"].realise).toBe(100);
    expect(by["2026-02"]).toMatchObject({ realise: 200, planifie: 180 });
    expect(by["2026-09"].planifie).toBe(300);
  });
  it("trajectoire : réalisé pour les mois échus, planifié pour les mois à venir", () => {
    const by = Object.fromEntries(t.months.map((m) => [m.month, m]));
    expect(by["2026-02"].retenu).toBe(200); // échu → réalisé (pas 180 planifié)
    expect(by["2026-09"].retenu).toBe(300); // à venir → planifié
  });
  it("réalisé à date + planifié restant = projeté au 31/12", () => {
    expect(t.realiseYtd).toBe(350);       // 100 + 200 + 50 (mois ≤ 2026-07)
    expect(t.planifieRestant).toBe(700);  // 300 (sept) + 400 (nov)
    expect(t.projeteDec).toBe(1050);      // 350 + 700
  });
});
