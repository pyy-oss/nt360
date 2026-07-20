import { describe, it, expect } from "vitest";
import { businessMsBetween, addBusinessMs, slaState, echeancier, monthsBetween, addMonthsIso, echeancierPlan } from "./mntSla";

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
  it("couverture h24 : horloge calendaire 24/7 (miroir back, audit BUG2)", () => {
    const sat00 = Date.UTC(2026, 2, 7, 0); // samedi
    expect(slaState({ seuilHeures: 8, couverture: "h24" }, sat00, null, sat00 + 12 * H).state).toBe("rompu");
    expect(slaState({ seuilHeures: 8, couverture: "ouvre_lun_ven" }, sat00, null, sat00 + 12 * H).state).toBe("en_cours");
  });
  it("calendrier (ADR-P23) : férié sauté, fenêtre B2B, parité neutre — miroir back", () => {
    const cal = { holidays: ["2026-03-05"] }; // jeudi férié
    expect(addBusinessMs(wed10, 20 * H, cal)).toBe(Date.UTC(2026, 2, 6, 6)); // jeu sauté → ven 06:00
    expect(businessMsBetween(wed10, Date.UTC(2026, 2, 6, 10), cal) / H).toBe(24); // mer(14)+ven(10)
    // Fenêtre B2B 8–18 : ouvre_b2b, ouvert mer 09:00, +12h → jeu 11:00 (échéance).
    expect(slaState({ seuilHeures: 12, couverture: "ouvre_b2b" }, Date.UTC(2026, 2, 4, 9), null, Date.UTC(2026, 2, 5, 13)).dueMs).toBe(Date.UTC(2026, 2, 5, 11));
    // Calendrier neutre : stricte parité avec l'horloge historique.
    expect(businessMsBetween(wed10, Date.UTC(2026, 2, 9, 10), {})).toBe(businessMsBetween(wed10, Date.UTC(2026, 2, 9, 10)));
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
  it("contrat non démarré (asOf < dateDebut) → 0 échéance (miroir back, audit BUG3)", () => {
    const e = echeancier({ echeanceType: "mensuel", montantEngage: 1000000, dateDebut: "2026-09-01" }, 0, "2026-07-15");
    expect(e.periodsDue).toBe(0);
    expect(e.engage).toBe(0);
    expect(e.ecart).toBe(0);
  });
  it("annuel 12 mois pile → 1 échéance, pas 2 (dateFin exclusive, bug doublage — miroir back)", () => {
    const a = echeancier({ echeanceType: "annuel", montantEngage: 12000000, dateDebut: "2026-01-01", dateFin: "2027-01-01" }, 0, "2027-06-01");
    expect(a.periodsDue).toBe(1);
    expect(a.engage).toBe(12000000);
  });
  it("début fin de mois (31/01) : échéances rabattues comptées, pas de sous-décompte (miroir back, audit M1)", () => {
    const m = echeancier({ echeanceType: "mensuel", montantEngage: 1000000, dateDebut: "2026-01-31" }, 0, "2026-02-28");
    expect(m.periodsDue).toBe(2); // 31/01 + 28/02 (AVANT le fix : 1)
    expect(m.engage).toBe(2000000);
  });
});

describe("mntSla (front, miroir) — échéancier DÉTAILLÉ", () => {
  it("addMonthsIso : miroir back (clamp fin de mois)", () => {
    expect(addMonthsIso("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonthsIso("2026-11-30", 3)).toBe("2027-02-28");
    expect(addMonthsIso("2026/01/01", 1)).toBeNull();
  });
  it("liste datée : facturé / dû / à venir (miroir back)", () => {
    const c = { echeanceType: "mensuel", montantEngage: 1000000, dateDebut: "2026-01-01", dateFin: "2026-06-30" };
    const p = echeancierPlan(c, 2500000, "2026-03-15");
    expect(p.periods.length).toBe(6);
    expect(p.periods.map((x) => x.statut)).toEqual(["facture", "facture", "du", "a_venir", "a_venir", "a_venir"]);
    const agg = echeancier(c, 2500000, "2026-03-15");
    expect({ periodsDue: p.periodsDue, engage: p.engage, facture: p.facture, ecart: p.ecart }).toEqual(agg);
  });
  it("sans date de fin : ne liste que les dues", () => {
    const p = echeancierPlan({ echeanceType: "mensuel", montantEngage: 500000, dateDebut: "2026-01-01" }, 0, "2026-03-15");
    expect(p.periods.length).toBe(3);
    expect(p.periods.every((x) => x.statut === "du")).toBe(true);
  });
  it("annuel 12 mois pile : 1 seule ligne datée (pas de ligne fantôme sur dateFin — miroir back)", () => {
    const c = { echeanceType: "annuel", montantEngage: 12000000, dateDebut: "2026-01-01", dateFin: "2027-01-01" };
    const p = echeancierPlan(c, 0, "2027-06-01");
    expect(p.periods.length).toBe(1);
    expect(p.periods.map((x) => x.dateEcheance)).toEqual(["2026-01-01"]);
    expect(p.engage).toBe(12000000);
  });
});
