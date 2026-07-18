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

  it("le coût inclut le P&L de l'affaire (carnet, par FP) EN PLUS des interventions (ADR-033)", () => {
    // C2 (revenu 500 000) sans intervention : sans P&L → coût 0 → marge 100 % (l'anomalie signalée en prod).
    // Avec le coût carnet de FP/2026/2 = 400 000, la marge redevient réaliste.
    const pnlCostByFp = { "FP/2026/2": 400_000, "FP/2026/1": 300_000 };
    const rows = computeContratPnl(contrats, interventions, cjmById, asOf, true, pnlCostByFp);
    const c2 = rows.find((r) => r.id === "C2");
    expect(c2.coutInterventions).toBe(0);
    expect(c2.coutPnl).toBe(400_000);
    expect(c2.cout).toBe(400_000);
    expect(c2.marge).toBe(100_000);      // 500 000 − 400 000, plus 100 %
    expect(c2.margePct).toBe(0.2);
    const c1 = rows.find((r) => r.id === "C1");
    expect(c1.coutInterventions).toBe(250_000); // 2,5 j × CJM
    expect(c1.coutPnl).toBe(300_000);           // coût carnet FP/2026/1
    expect(c1.cout).toBe(550_000);
    // Rapprochement par fpKey : un FP zero-paddé/à casse différente joint la même affaire.
    const r2 = computeContratPnl([{ id: "C1", fp: "fp/2026/001", client: "ACME", statut: "actif", echeanceType: "annuel", montantEngage: 1_000_000, dateDebut: "2026-01-01", dateFin: "2027-01-01" }], [], {}, asOf, true, { "FP/2026/1": 300_000 });
    expect(r2[0].coutPnl).toBe(300_000);
  });

  it("le coût P&L reste masqué SANS droit rentabilité", () => {
    const rows = computeContratPnl(contrats, interventions, cjmById, asOf, false, { "FP/2026/1": 300_000 });
    const c1 = rows.find((r) => r.id === "C1");
    expect(c1.coutInterventions).toBeNull();
    expect(c1.coutPnl).toBeNull();
    expect(c1.cout).toBeNull();
  });

  it("signale missingCjm : jours d'intervention sans CJM connu (marge non fiable, audit m6)", () => {
    // K2 n'est pas dans cjmById → ses jours comptent en coût 0 mais sont drapeautés.
    const iv = [{ contratId: "C1", consultantId: "K1", heures: 8 }, { contratId: "C1", consultantId: "K2", heures: 16 }];
    const rows = computeContratPnl(contrats, iv, { K1: 100_000 }, asOf, true);
    const c1 = rows.find((r) => r.id === "C1");
    expect(c1.missingCjm).toBe(2);  // 16 h / 8 → 2 j sans CJM
    expect(c1.cout).toBe(100_000);  // seul K1 (1 j × 100 000) est chiffré
    // Sans droit coût : missingCjm masqué comme le reste.
    expect(computeContratPnl(contrats, iv, { K1: 100_000 }, asOf, false).find((r) => r.id === "C1").missingCjm).toBeNull();
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
  it("EXCLUT les statuts non vivants (brouillon/échu/résilié) même avec un revenu > 0 — parité risque (audit M2)", () => {
    // Même montant/dates que C1 (revenu engagé 1 000 000) mais statuts terminaux/spéculatifs : ne doivent PAS
    // gonfler la rentabilité (assiette = celle du moteur de risque, actif/suspendu). ADR-021.
    const pop = [
      { id: "B", statut: "brouillon", echeanceType: "annuel", montantEngage: 1_000_000, dateDebut: "2026-01-01", dateFin: "2027-01-01" },
      { id: "R", statut: "resilie", echeanceType: "annuel", montantEngage: 1_000_000, dateDebut: "2026-01-01", dateFin: "2027-01-01" },
      { id: "E", statut: "echu", echeanceType: "annuel", montantEngage: 1_000_000, dateDebut: "2026-01-01", dateFin: "2027-01-01" },
      { id: "S", statut: "suspendu", echeanceType: "annuel", montantEngage: 1_000_000, dateDebut: "2026-01-01", dateFin: "2027-01-01" },
    ];
    const rows = computeContratPnl(pop, [], {}, asOf, true);
    expect(rows.map((r) => r.id)).toEqual(["S"]); // seul le suspendu (vivant) subsiste
  });
});
