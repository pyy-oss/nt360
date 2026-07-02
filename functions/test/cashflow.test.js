import { describe, it, expect } from "vitest";
const { cashflow, monthList } = require("../domain/cashflow");

describe("cashflow — échéancier des encaissements", () => {
  const INV = [
    { amountHt: 1000, date: "2026-06-01", dueDate: "2026-07-15", paid: false }, // mois courant (échéance)
    { amountHt: 500, date: "2026-06-20", dueDate: "2026-08-10", paid: false },   // mois +1
    { amountHt: 400, date: "2026-09-05", paid: false },                          // pas d'échéance → repli sur la date (mois +2)
    { amountHt: 150, paid: false },                                              // ni échéance ni date → mois courant
    { amountHt: 300, date: "2026-05-01", dueDate: "2026-05-31", paid: false },   // échue → en retard
    { amountHt: 200, date: "2026-06-01", dueDate: "2027-06-01", paid: false },   // au-delà de l'horizon
    { amountHt: 700, date: "2026-06-01", dueDate: "2026-07-01", paid: true },    // encaissée → exclue
  ];
  const ORDERS = [{ raf: 600 }, { raf: 0 }, { raf: 1200 }]; // Σ RAF = 1800
  const cf = cashflow(INV, ORDERS, "2026-07-01", { horizon: 6 });

  it("horizon = 6 mois glissants à partir du mois courant", () => {
    expect(cf.months).toHaveLength(6);
    expect(cf.months[0].month).toBe("2026-07");
    expect(cf.months[1].month).toBe("2026-08");
    expect(cf.months[5].month).toBe("2026-12");
  });
  it("AR au mois d'échéance ; repli sur la date ; ni l'un ni l'autre → mois courant", () => {
    expect(cf.months[0].ar).toBe(1150); // 1000 (éch. 07-15) + 150 (aucune date → mois courant)
    expect(cf.months[1].ar).toBe(500);  // éch. 08-10
    expect(cf.months[2].ar).toBe(400);  // pas d'échéance → date 09-05
  });
  it("créance échue isolée en « en retard » (hors échéancier futur)", () => {
    expect(cf.overdue).toBe(300);
    expect(cf.overdueCount).toBe(1);
    expect(cf.months.reduce((s, m) => s + m.ar, 0)).toBe(2050); // 1150 + 500 + 400
  });
  it("créance au-delà de l'horizon comptée à part (beyond)", () => {
    expect(cf.beyond).toBe(200); // éch. 2027-06
  });
  it("exclut les factures encaissées", () => {
    expect(cf.totalAR).toBe(2550); // 1000+500+400+150+300+200 (paid exclue)
    expect(cf.openCount).toBe(6);
  });
  it("backlog RAF étalé également sur l'horizon (indicatif)", () => {
    expect(cf.totalRaf).toBe(1800);
    expect(cf.months[0].backlog).toBe(300); // 1800 / 6
  });
  it("AR cumulé croissant", () => {
    expect(cf.months[0].cumulAr).toBe(1150);
    expect(cf.months[2].cumulAr).toBe(2050);
    expect(cf.months[5].cumulAr).toBe(2050);
  });
  it("monthList gère le passage d'année", () => {
    expect(monthList("2026-11-15", 4)).toEqual(["2026-11", "2026-12", "2027-01", "2027-02"]);
  });
  it("« en retard » au JOUR : une échéance passée DANS le mois courant est échue (pas ce mois)", () => {
    const cf2 = cashflow([
      { amountHt: 500, date: "2026-07-01", dueDate: "2026-07-05", paid: false }, // échue avant le 10
      { amountHt: 300, date: "2026-07-01", dueDate: "2026-07-20", paid: false }, // à venir ce mois
    ], [], "2026-07-10", { horizon: 3 });
    expect(cf2.overdue).toBe(500);        // 07-05 < 07-10 → en retard (jour), pas « ce mois »
    expect(cf2.months[0].ar).toBe(300);   // seule la 07-20 reste attendue ce mois
  });
});
