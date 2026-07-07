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
  it("opportunité : mêmes attributs mais FP DIFFÉRENTS ⇒ clés différentes (pas de fusion destructive)", () => {
    const a = { fp: "FP/2026/100", client: "ORANGE CI", am: "DATCHA", bu: "CLOUD", amount: 12000000, stage: 4, closingDate: "2026-06-30" };
    const b = { fp: "FP/2026/200", client: "ORANGE CI", am: "DATCHA", bu: "CLOUD", amount: 12000000, stage: 4, closingDate: "2026-06-30" };
    expect(opportunityKey(a)).not.toBe(opportunityKey(b));
    // ...mais un même FP dédoublé reste un doublon.
    expect(opportunityKey(a)).toBe(opportunityKey({ ...a, client: "orange ci" }));
  });
  it("opportunité : même FP mais D Prev / montant / étape DIFFÉRENTS ⇒ MÊME clé (converge les orphelins)", () => {
    // cf. audit cycle de vie : un orphelin dont l'id a dérivé (D Prev/AM/montant changés) doit être
    // fusionnable par `dedupe` — la clé d'une opp AVEC FP ne dépend QUE du FP.
    const a = { fp: "FP/2026/7", client: "MTN", am: "AWA", amount: 1000, stage: 3, closingDate: "2026-06-30" };
    const b = { fp: "FP/2026/7", client: "MTN", am: "AWA DIOP", amount: 2000, stage: 5, closingDate: "2026-09-30" };
    expect(opportunityKey(a)).toBe(opportunityKey(b));
  });
  it("BC : même n° BC + FP + fournisseur + montant ⇒ même clé (fiche vs logistics)", () => {
    const a = { fp: "FP/2024/1", bcNumber: "BC N° 06457", supplier: "kukuza", description: "Routeur", amountXof: 500000, source: "fiche" };
    const b = { fp: "FP/2024/1", bcNumber: "BC N° 06457", supplier: "KUKUZA", description: "routeur", amountXof: 500000, source: "logistics" };
    expect(bcKey(a)).toBe(bcKey(b));
  });
  it("BC : même n° BC mais MONTANTS différents ⇒ clés différentes (2 lignes distinctes d'un même BC)", () => {
    const a = { fp: "FP/2024/1", bcNumber: "BC1", supplier: "S", description: "L", amountXof: 100000 };
    const b = { fp: "FP/2024/1", bcNumber: "BC1", supplier: "S", description: "L", amountXof: 250000 };
    expect(bcKey(a)).not.toBe(bcKey(b));
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
