import { describe, it, expect } from "vitest";
const { cashScenario } = require("../domain/cashScenario");

describe("cashScenario — scénarios best/base/worst & tension trésorerie", () => {
  const input = {
    asOf: "2026-07-05",
    months: [
      { month: "2026-07", ar: 1000, out: 400 },
      { month: "2026-08", ar: 500, out: 300 },
      { month: "2026-09", ar: 0, out: 800 },
    ],
    overdueAr: 300,   // créances échues à recouvrer
    overduePay: 600,  // payables échus à régler
  };
  const s = cashScenario(input);

  it("horizon & structure", () => {
    expect(s.horizon).toBe(3);
    expect(s.months).toHaveLength(3);
    expect(s.opening).toBe(0);
  });

  it("recouvrement total : best ≥ base ≥ worst (cumul encaissements sur l'horizon)", () => {
    const tot = (kind) => s.months.reduce((a, m) => a + m.enc[kind], 0);
    expect(tot("best")).toBeGreaterThanOrEqual(tot("base"));
    expect(tot("base")).toBeGreaterThanOrEqual(tot("worst"));
  });

  it("ordering : décaissement worst ≥ base ≥ best (worst paie tout tout de suite)", () => {
    // Mois 1 : worst paie 600 d'échus en plus, best les étale sur 3 mois (200).
    expect(s.months[0].dec.worst).toBe(400 + 600);
    expect(s.months[0].dec.best).toBe(400 + 200);
    expect(s.months[0].dec.base).toBe(400 + 200); // recoveryMonths=3 → 600/3=200
  });

  it("position cumulée : best ≥ base ≥ worst au fil des mois", () => {
    for (const m of s.months) {
      expect(m.cum.best).toBeGreaterThanOrEqual(m.cum.base);
      expect(m.cum.base).toBeGreaterThanOrEqual(m.cum.worst);
    }
  });

  it("encaissement best mois 1 = AR 100% + échus recouvrés en totalité", () => {
    expect(s.months[0].enc.best).toBe(1000 + 300);
  });

  it("tension détectée quand la position worst passe sous le plancher", () => {
    // worst mois1 : enc = 1000*0.85 + (300*0.8)/3 = 850 + 80 = 930 ; dec = 400 + 600 = 1000 → net -70.
    expect(s.months[0].net.worst).toBe(930 - 1000);
    expect(s.tension.firstMonth).toBe("2026-07");
    expect(s.tension.monthsCount).toBeGreaterThanOrEqual(1);
    expect(s.tension.trough.value).toBeLessThan(0);
  });

  it("solde d'ouverture décale la position", () => {
    const s2 = cashScenario(input, { opening: 100000 });
    expect(s2.months[0].cum.worst).toBe(100000 + s.months[0].net.worst);
  });

  it("aucune donnée → agrégat vide cohérent", () => {
    const e = cashScenario({ asOf: "2026-07-05", months: [], overdueAr: 0, overduePay: 0 });
    expect(e.horizon).toBe(0);
    expect(e.tension.monthsCount).toBe(0);
    expect(e.tension.trough).toEqual({ month: null, value: 0 });
  });
});
