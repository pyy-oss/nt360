import { describe, it, expect } from "vitest";
import { businessMsBetween, addBusinessMs, slaState, echeancier, monthsBetween } from "./mntSla";

const H = 3600000;
const wed10 = Date.UTC(2026, 2, 4, 10);

// Miroir FRONT du moteur SLA — mêmes attentes que functions/test/mntSla.test.js (parité).
describe("mntSla (front, miroir) — horloge jours ouvrés + état SLA", () => {
  it("heures ouvrées + saut de week-end", () => {
    expect(businessMsBetween(wed10, wed10 + 3 * H)).toBe(3 * H);
    expect(businessMsBetween(wed10, Date.UTC(2026, 2, 9, 10)) / H).toBe(72);
    expect(addBusinessMs(Date.UTC(2026, 2, 6, 10), 8 * H)).toBe(Date.UTC(2026, 2, 6, 18));
  });
  it("état SLA : respecté / rompu / en cours", () => {
    expect(slaState({ seuilHeures: 8 }, wed10, wed10 + 4 * H, wed10 + 4 * H).state).toBe("respecte");
    expect(slaState({ seuilHeures: 8 }, wed10, null, wed10 + 100 * H).state).toBe("rompu");
    expect(slaState({ seuilHeures: 8 }, wed10, null, wed10 + 2 * H).state).toBe("en_cours");
  });
});

describe("mntSla (front, miroir) — échéancier", () => {
  it("engagé = échéances dues × montant ; écart = engagé − facturé", () => {
    expect(monthsBetween("2026-01-01", "2026-03-15")).toBe(2);
    const e = echeancier({ echeanceType: "mensuel", montantEngage: 1000000, dateDebut: "2026-01-01" }, 2500000, "2026-03-15");
    expect(e.periodsDue).toBe(3);
    expect(e.engage).toBe(3000000);
    expect(e.ecart).toBe(500000);
  });
});
