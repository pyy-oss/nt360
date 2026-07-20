import { describe, it, expect } from "vitest";
const { recurringTotals, annualiseMontant } = require("../domain/mntRecurring");

// Fixture PARTAGÉE avec le test front (web/src/lib/mntDashboard.test.ts) : les MÊMES contrats doivent
// donner les MÊMES totalMrr/totalArr/contratsActifs des deux côtés (invariant « même métrique = même
// nombre », CLAUDE.md). Toute divergence casse l'un des deux tests → parité verrouillée.
export const RECURRING_FIXTURE = [
  { statut: "actif", echeanceType: "mensuel", montantEngage: 100_000 },      // ARR = 100k × 12 = 1,2M
  { statut: "actif", echeanceType: "trimestriel", montantEngage: 300_000 }, // ARR = 300k × 4 = 1,2M
  { statut: "actif", echeanceType: "annuel", montantEngage: 2_400_000 },    // ARR = 2,4M × 1 = 2,4M
  { statut: "brouillon", echeanceType: "mensuel", montantEngage: 999_000 }, // EXCLU (pas engagé)
  { statut: "echu", echeanceType: "annuel", montantEngage: 999_000 },       // EXCLU (ne court plus)
  { statut: "resilie", echeanceType: "mensuel", montantEngage: 999_000 },   // EXCLU
];
export const RECURRING_EXPECTED = { contratsActifs: 3, totalArr: 4_800_000, totalMrr: 400_000 };

describe("mntRecurring — MRR/ARR des contrats actifs", () => {
  it("annualiseMontant : mensuel ×12, trimestriel ×4, annuel ×1", () => {
    expect(annualiseMontant(100_000, "mensuel")).toBe(1_200_000);
    expect(annualiseMontant(300_000, "trimestriel")).toBe(1_200_000);
    expect(annualiseMontant(2_400_000, "annuel")).toBe(2_400_000);
    expect(annualiseMontant(50_000, undefined)).toBe(600_000); // périodicité absente → ×12 par défaut
  });
  it("recurringTotals : assiette ACTIFS uniquement, MRR = ARR/12 (parité front)", () => {
    expect(recurringTotals(RECURRING_FIXTURE)).toEqual(RECURRING_EXPECTED);
  });
  it("montantEngage nul → 0 ; entrée vide → totaux nuls", () => {
    expect(recurringTotals([{ statut: "actif", echeanceType: "mensuel", montantEngage: 0 }])).toEqual({ contratsActifs: 1, totalArr: 0, totalMrr: 0 });
    expect(recurringTotals([])).toEqual({ contratsActifs: 0, totalArr: 0, totalMrr: 0 });
    expect(recurringTotals(undefined)).toEqual({ contratsActifs: 0, totalArr: 0, totalMrr: 0 });
  });
});
