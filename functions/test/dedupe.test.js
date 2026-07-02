import { describe, it, expect } from "vitest";
const { planDedupe, invoiceKey, opportunityKey, bcKey } = require("../domain/dedupe");

describe("dédoublonnage — clés métier", () => {
  it("facture : même Numéro (casse/espaces) ⇒ même clé", () => {
    expect(invoiceKey({ numero: "JVEXO/2026/0001" })).toBe(invoiceKey({ numero: " jvexo/2026/0001 " }));
  });
  it("opportunité : mêmes client/AM/BU/montant/étape/date ⇒ même clé", () => {
    const a = { client: "ACME", am: "Datcha", bu: "ICT", amount: 1000, stage: 3, closingDate: "2026-06-30" };
    const b = { client: "acme", am: "DATCHA", bu: "ict", amount: 1000.4, stage: 3, closingDate: "2026-06-30" };
    expect(opportunityKey(a)).toBe(opportunityKey(b));
  });
  it("BC : même n° BC + FP + fournisseur ⇒ même clé (fiche vs logistics)", () => {
    const a = { fp: "FP/2024/1", bcNumber: "BC N° 06457", supplier: "kukuza", description: "Routeur", source: "fiche" };
    const b = { fp: "FP/2024/1", bcNumber: "BC N° 06457", supplier: "KUKUZA", description: "routeur", source: "logistics" };
    expect(bcKey(a)).toBe(bcKey(b));
  });
});

describe("planDedupe — sélection du représentant", () => {
  it("supprime les doublons, garde 1 par groupe", () => {
    const docs = [
      { id: "a", numero: "N1", source: "facturationDf", updatedAt: "2026-01-02" },
      { id: "b", numero: "n1", source: "legacy", updatedAt: "2026-01-01" }, // doublon de a
      { id: "c", numero: "N2", source: "facturationDf" },
    ];
    const plan = planDedupe(docs, invoiceKey);
    expect(plan.total).toBe(3);
    expect(plan.duplicateGroups).toBe(1);
    expect(plan.duplicates).toBe(1);
    expect(plan.remove).toEqual(["b"]); // garde 'a' (source figée + plus récent), supprime 'b'
  });
  it("préfère la source figée à la saisie manuelle", () => {
    const docs = [
      { id: "man", client: "ACME", am: "X", bu: "ICT", amount: 5, stage: 1, closingDate: "2026-01-01", source: "saisie" },
      { id: "src", client: "ACME", am: "X", bu: "ICT", amount: 5, stage: 1, closingDate: "2026-01-01", source: "salesData" },
    ];
    const plan = planDedupe(docs, opportunityKey);
    expect(plan.remove).toEqual(["man"]); // garde la source salesData
  });
  it("aucun doublon ⇒ rien à supprimer", () => {
    const plan = planDedupe([{ id: "a", numero: "N1" }, { id: "b", numero: "N2" }], invoiceKey);
    expect(plan.duplicates).toBe(0);
    expect(plan.remove).toEqual([]);
  });
});
