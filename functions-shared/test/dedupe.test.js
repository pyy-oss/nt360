import { describe, it, expect } from "vitest";
const { planDedupe, invoiceKey, opportunityKey, bcKey, freshMs } = require("../domain/dedupe");
// Simule un Timestamp Firestore (objet à .toMillis()) — c'est ce que la PROD stocke dans updatedAt.
const ts = (ms) => ({ toMillis: () => ms });

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
  it("FRAÎCHEUR sur Timestamp Firestore (prod) : garde la CORRECTION récente, supprime le doc PÉRIMÉ (audit A1)", () => {
    // updatedAt = objet Timestamp (.toMillis) comme en prod. Avant correctif : Date.parse(Timestamp)=NaN→0
    // → fraîcheur morte → départage par complétude → la correction (1 champ vidé) était SUPPRIMÉE.
    const docs = [
      { id: "old", numero: "N1", source: "salesData", updatedAt: ts(1000), client: "ACME", am: "X" }, // complet, ancien
      { id: "new", numero: "n1", source: "salesData", updatedAt: ts(9000), client: "ACME", am: "" },   // corrigé (am vidé), récent
    ];
    const plan = planDedupe(docs, invoiceKey);
    expect(plan.remove).toEqual(["old"]); // on GARDE la version récente « new », pas la périmée « old »
  });
  it("SOURCE strictement prioritaire sur la fraîcheur : garde le P&L figé même moins récent (audit A2)", () => {
    // Somme pondérée : un salesData très récent pouvait dépasser le rang du pnl → perte de la source d'autorité.
    const docs = [
      { id: "pnl", numero: "N1", source: "pnl", updatedAt: ts(1000) },        // autorité, ancien
      { id: "sales", numero: "n1", source: "salesData", updatedAt: ts(9e12) }, // très récent, source inférieure
    ];
    const plan = planDedupe(docs, invoiceKey);
    expect(plan.remove).toEqual(["sales"]); // la source figée (pnl) l'emporte malgré la fraîcheur
  });
  it("clé par FP CANONIQUE : deux opps au FP formaté différemment sont fusionnées (audit B1)", () => {
    expect(opportunityKey({ fp: "FP/2026/7" })).toBe(opportunityKey({ fp: "FP/2026/007" }));
    const plan = planDedupe([
      { id: "a", fp: "FP/2026/7", source: "salesData", updatedAt: ts(1) },
      { id: "b", fp: "FP/2026/007", source: "salesData", updatedAt: ts(2) },
    ], opportunityKey);
    expect(plan.duplicateGroups).toBe(1);
    expect(plan.remove).toEqual(["a"]);
  });
  it("aperçu (sample) : chaque groupe expose le représentant gardé + les doublons écartés", () => {
    const docs = [
      { id: "a", numero: "N1", source: "pnl", updatedAt: ts(2) },
      { id: "b", numero: "N1", source: "legacy", updatedAt: ts(1) },
    ];
    const plan = planDedupe(docs, invoiceKey);
    expect(plan.sample).toHaveLength(1);
    expect(plan.sample[0].keep.id).toBe("a");
    expect(plan.sample[0].remove.map((r) => r.id)).toEqual(["b"]);
  });
  it("freshMs robuste : Timestamp, ISO string, nombre, ou vide", () => {
    expect(freshMs(ts(1234))).toBe(1234);
    expect(freshMs("2026-01-02")).toBe(Date.parse("2026-01-02"));
    expect(freshMs(5000)).toBe(5000);
    expect(freshMs(undefined)).toBe(0);
  });
});
