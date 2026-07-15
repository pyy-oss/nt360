import { describe, it, expect } from "vitest";
import { computeMntDashboard, ECHEANCE_PROCHE_JOURS } from "./mntDashboard";

const asOf = "2026-07-15";

describe("computeMntDashboard", () => {
  it("ne compte le montant engagé QUE sur les contrats actifs", () => {
    const d = computeMntDashboard(
      [
        { statut: "actif", montantEngage: 1_000_000 },
        { statut: "actif", montantEngage: 500_000 },
        { statut: "brouillon", montantEngage: 9_000_000 }, // exclu
        { statut: "resilie", montantEngage: 9_000_000 },   // exclu
      ],
      [],
      asOf,
    );
    expect(d.contratsTotal).toBe(4);
    expect(d.contratsActifs).toBe(2);
    expect(d.montantEngageActifs).toBe(1_500_000);
    expect(d.parStatut).toEqual({ actif: 2, brouillon: 1, resilie: 1 });
  });

  it("repère les échéances proches (0..60 j) des contrats actifs, triées, exclut passées et lointaines", () => {
    const d = computeMntDashboard(
      [
        { id: "a", client: "X", statut: "actif", dateFin: "2026-08-01" }, // +17 j → proche
        { id: "b", client: "Y", statut: "actif", dateFin: "2026-07-20" }, // +5 j → proche
        { id: "c", client: "Z", statut: "actif", dateFin: "2026-07-10" }, // passée → exclue
        { id: "d", client: "W", statut: "actif", dateFin: "2027-01-01" }, // lointaine → exclue
        { id: "e", client: "V", statut: "suspendu", dateFin: "2026-07-16" }, // non actif → exclu
      ],
      [],
      asOf,
    );
    expect(d.echeancesProches.map((e) => e.id)).toEqual(["b", "a"]);
    expect(d.echeancesProches[0].jours).toBe(5);
    expect(ECHEANCE_PROCHE_JOURS).toBe(60);
  });

  it("ne compte comme ouverts que les tickets ouvert|en_cours et les ventile par priorité", () => {
    const d = computeMntDashboard(
      [],
      [
        { statut: "ouvert", priorite: "haute" },
        { statut: "en_cours", priorite: "haute" },
        { statut: "ouvert", priorite: "basse" },
        { statut: "resolu", priorite: "critique" }, // clos-like → exclu
        { statut: "clos", priorite: "critique" },   // exclu
      ],
      asOf,
    );
    expect(d.ticketsTotal).toBe(5);
    expect(d.ticketsOuverts).toBe(3);
    expect(d.parPriorite).toEqual({ haute: 2, basse: 1 });
  });
});
