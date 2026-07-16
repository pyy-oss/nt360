import { describe, it, expect } from "vitest";
const { computeContratPnl } = require("../domain/mntContratPnl");

describe("computeContratPnl — rentabilité par contrat", () => {
  const asOf = "2026-07-15";
  // Contrat annuel démarré au 2026-01-01, montant 1 000 000 par échéance → 1 échéance due (annuel) = 1 000 000.
  const contrats = [
    { id: "C1", fp: "FP/2026/1", client: "ACME", statut: "actif", echeanceType: "annuel", montantEngage: 1_000_000, dateDebut: "2026-01-01", dateFin: "2027-01-01" },
    { id: "C2", fp: "FP/2026/2", client: "BETA", statut: "actif", echeanceType: "annuel", montantEngage: 500_000, dateDebut: "2026-01-01", dateFin: "2027-01-01" },
  ];
  // 20 h consultant K1 (CJM 100 000/j, 8 h/j → 2,5 j → 250 000) sur C1 ; C2 sans intervention.
  const interventions = [{ contratId: "C1", consultantId: "K1", heures: 20 }];
  const cjmById = { K1: 100_000 };

  it("marge = revenu engagé − coût (jours CRA × CJM), avec droit rentabilité", () => {
    const rows = computeContratPnl(contrats, interventions, cjmById, asOf, true);
    const c1 = rows.find((r) => r.id === "C1");
    expect(c1.revenue).toBe(1_000_000);
    expect(c1.jours).toBe(2.5);          // 20 h / 8 h → 2,5 j
    expect(c1.cout).toBe(250_000);       // 2,5 × 100 000
    expect(c1.marge).toBe(750_000);
    expect(c1.margePct).toBe(0.75);
  });

  it("masque coût/marge SANS droit rentabilité (revenu + jours restent)", () => {
    const rows = computeContratPnl(contrats, interventions, cjmById, asOf, false);
    const c1 = rows.find((r) => r.id === "C1");
    expect(c1.revenue).toBe(1_000_000);
    expect(c1.jours).toBe(2.5);
    expect(c1.cout).toBeNull();
    expect(c1.marge).toBeNull();
    expect(c1.margePct).toBeNull();
  });

  it("trie par pire marge d'abord quand le coût est visible", () => {
    // C2 : revenu 500 000, aucun coût → marge 500 000 ; C1 marge 750 000 → C2 devrait suivre C1 (750k < ... non)
    const rows = computeContratPnl(contrats, interventions, cjmById, asOf, true);
    expect(rows[0].id).toBe("C2"); // marge 500 000 < 750 000 → pire d'abord
  });

  it("exclut un contrat sans revenu ni activité", () => {
    const c3 = [{ id: "C3", statut: "brouillon", echeanceType: "annuel", montantEngage: 0, dateDebut: "2030-01-01" }];
    expect(computeContratPnl(c3, [], {}, asOf, true)).toEqual([]);
  });
});
