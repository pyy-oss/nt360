import { describe, it, expect } from "vitest";
const { businessMsBetween, addBusinessMs, slaState } = require("../domain/mntSla");
const { echeancier, monthsBetween } = require("../domain/mntEcheancier");

const H = 3600000;
// Repères UTC : 2026-03-04 est un MERCREDI ; 2026-03-06 vendredi ; 2026-03-07 samedi ; 2026-03-09 lundi.
const wed10 = Date.UTC(2026, 2, 4, 10); // mer 10:00
const fri10 = Date.UTC(2026, 2, 6, 10); // ven 10:00

describe("mntSla — horloge jours ouvrés pleins (ADR-002)", () => {
  it("compte les heures en semaine, saute le week-end", () => {
    expect(businessMsBetween(wed10, wed10 + 3 * H)).toBe(3 * H); // même jour ouvré
    // mer 10:00 → lun 10:00 = mer(14) + jeu(24) + ven(24) + [sam/dim ignorés] + lun(10) = 72 h
    const mon10 = Date.UTC(2026, 2, 9, 10);
    expect(businessMsBetween(wed10, mon10) / H).toBe(72);
  });
  it("addBusinessMs saute le week-end pour poser l'échéance", () => {
    // ven 10:00 + 8 h ouvrées : ven 10→24 = 14 h dispo → il reste, on saute sam/dim → lun. 8<14 donc ven 18:00.
    expect(addBusinessMs(fri10, 8 * H)).toBe(Date.UTC(2026, 2, 6, 18));
    // ven 20:00 + 8 h : ven 20→24 = 4 h, reste 4 h → lun 00:00 + 4 h = lun 04:00.
    expect(addBusinessMs(Date.UTC(2026, 2, 6, 20), 8 * H)).toBe(Date.UTC(2026, 2, 9, 4));
  });
});

describe("mntSla — état SLA d'un engagement", () => {
  const eng = { seuilHeures: 8 };
  it("atteint avant l'échéance → respecté ; après → rompu", () => {
    expect(slaState(eng, wed10, wed10 + 4 * H, wed10 + 4 * H).state).toBe("respecte");
    expect(slaState(eng, wed10, wed10 + 30 * H, wed10 + 30 * H).state).toBe("rompu"); // 30h calendaires = >8h ouvrées
  });
  it("non atteint : en cours si dans les temps, rompu si échéance dépassée", () => {
    expect(slaState(eng, wed10, null, wed10 + 2 * H).state).toBe("en_cours");
    expect(slaState(eng, wed10, null, wed10 + 100 * H).state).toBe("rompu");
  });
});

describe("mntEcheancier — engagé vs facturé", () => {
  const c = { echeanceType: "mensuel", montantEngage: 1000000, dateDebut: "2026-01-01" };
  it("échéances dues = mois écoulés + 1 (1ʳᵉ à dateDebut) ; engagé = dues × montant", () => {
    expect(monthsBetween("2026-01-01", "2026-03-15")).toBe(2);
    const e = echeancier(c, 2500000, "2026-03-15"); // 3 échéances dues × 1M = 3M engagé ; 2,5M facturé
    expect(e.periodsDue).toBe(3);
    expect(e.engage).toBe(3000000);
    expect(e.ecart).toBe(500000); // sous-facturation de 0,5M
  });
  it("trimestriel : 1 échéance par trimestre ; borné par la date de fin", () => {
    const t = echeancier({ echeanceType: "trimestriel", montantEngage: 3000000, dateDebut: "2026-01-01", dateFin: "2026-06-30" }, 0, "2027-01-01");
    expect(t.periodsDue).toBe(2); // 2 trimestres sur un contrat de 6 mois
    expect(t.engage).toBe(6000000);
  });
});
