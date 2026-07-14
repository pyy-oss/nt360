import { describe, it, expect } from "vitest";
const { planFromInvoices } = require("../domain/genFromInvoice");

describe("genFromInvoice — générer commande+opp depuis factures non rattachées", () => {
  it("regroupe par FP canonique, CAS = Σ HT, client/année majoritaires, D Prev = date la plus récente", () => {
    const invoices = [
      { id: "a", fp: "FP/2026/7", client: "ACME", amountHt: 600, date: "2026-01-10", numero: "F1" },
      { id: "b", fp: "FP/2026/007", client: "ACME", amountHt: 400, date: "2026-03-05", numero: "F2" }, // même FP (zéros)
      { id: "c", fp: "FP/2026/9", client: "BETA", amountHt: 500, date: "2026-02-01", numero: "F3" },
    ];
    const { plan } = planFromInvoices(invoices, new Set());
    expect(plan.length).toBe(2);
    const acme = plan.find((p) => p.fp === "FP/2026/7");
    expect(acme.cas).toBe(1000);           // 600 + 400 sur le FP canonique
    expect(acme.invoiceCount).toBe(2);
    expect(acme.client).toBe("ACME");
    expect(acme.yearPo).toBe(2026);
    expect(acme.closingDate).toBe("2026-03-05"); // la plus récente
    expect(acme.numeros).toEqual(["F1", "F2"]);
    expect(plan[0].fp).toBe("FP/2026/7"); // trié CAS décroissant (1000 > 500)
  });
  it("IGNORE les factures sans FP canonique (rien à créer) et compte skippedNoFp", () => {
    const invoices = [
      { id: "x", fp: "", amountHt: 100 },
      { id: "y", fp: "SANS-FP", amountHt: 200 },
      { id: "z", fp: "FP/2026/1", client: "ACME", amountHt: 300, date: "2026-01-01" },
    ];
    const { plan, skippedNoFp } = planFromInvoices(invoices, new Set());
    expect(skippedNoFp).toBe(2);
    expect(plan.length).toBe(1);
    expect(plan[0].fp).toBe("FP/2026/1");
  });
  it("SKIP les FP déjà au carnet (pas de doublon) — robuste au formatage", () => {
    const invoices = [
      { id: "a", fp: "FP/2026/0005", client: "ACME", amountHt: 800, date: "2026-01-01" }, // commande existe (FP/2026/5)
      { id: "b", fp: "FP/2026/6", client: "BETA", amountHt: 200, date: "2026-01-01" },     // absente → générée
    ];
    const { plan, skippedExisting } = planFromInvoices(invoices, new Set(["FP/2026/5"]));
    expect(skippedExisting).toBe(1);
    expect(plan.length).toBe(1);
    expect(plan[0].fp).toBe("FP/2026/6");
  });
  it("écarte les FP à CAS nul (facture d'annulation/avoir) — pas de commande vide", () => {
    const invoices = [
      { id: "a", fp: "FP/2026/1", amountHt: 500, date: "2026-01-01" },
      { id: "b", fp: "FP/2026/1", amountHt: -500, date: "2026-02-01" }, // annule → Σ = 0
      { id: "c", fp: "FP/2026/2", amountHt: 300, date: "2026-01-01" },
    ];
    const { plan } = planFromInvoices(invoices, new Set());
    expect(plan.map((p) => p.fp)).toEqual(["FP/2026/2"]); // FP/2026/1 (CAS 0) écarté
  });
  it("montant ROBUSTE au nom de colonne (montant/montantHt) + BU majoritaire de la facture", () => {
    const invoices = [
      { id: "a", fp: "FP/2026/3", client: "GAMMA", bu: "ICT", montant: 700, date: "2026-01-01", numero: "F1" }, // « montant » (pas amountHt)
      { id: "b", fp: "FP/2026/3", client: "GAMMA", bu: "ICT", montantHt: 300, date: "2026-02-01", numero: "F2" }, // « montantHt »
    ];
    const { plan } = planFromInvoices(invoices, new Set());
    expect(plan.length).toBe(1);
    expect(plan[0].cas).toBe(1000);   // 700 + 300 malgré des noms de colonne différents
    expect(plan[0].bu).toBe("ICT");   // BU dérivée des factures (plus de « AUTRE » figé)
  });
  it("BU absente sur les factures → plan.bu vide (l'appelant posera « AUTRE »)", () => {
    const { plan } = planFromInvoices([{ id: "a", fp: "FP/2026/4", amountHt: 500, date: "2026-01-01" }], new Set());
    expect(plan[0].bu).toBe("");
  });
  it("année de PO robuste : repli sur l'année du N° FP quand les factures n'ont pas de date", () => {
    const { plan } = planFromInvoices([{ id: "a", fp: "FP/2023/12", client: "ACME", amountHt: 900 }], new Set()); // pas de date
    expect(plan[0].yearPo).toBe(2023); // dérivée du N° FP → rattachement comptable correct (pas 0)
  });
  it("INVARIANT : N factures d'un MÊME FP → UNE seule commande/opp, CAS = Σ exacte des factures", () => {
    const invoices = [
      { id: "1", fp: "FP/2021/4687", client: "CORIS", amountHt: 1500000, date: "2021-03-10", numero: "F1" },
      { id: "2", fp: "FP/2021/04687", client: "CORIS", amountHt: 500000, date: "2021-05-02", numero: "F2" }, // même FP (zéro de tête)
      { id: "3", fp: "FP/2021/4687", client: "CORIS", amountHt: 250000, date: "2021-06-01", numero: "F3" },
      { id: "4", fp: "FP/2021/5005", client: "ONECI", amountHt: 900000, date: "2021-04-01", numero: "F4" },
    ];
    const { plan } = planFromInvoices(invoices, new Set());
    expect(plan.length).toBe(2); // 3 factures d'un FP + 1 d'un autre → 2 commandes, pas 4
    const g = plan.find((p) => p.fp === "FP/2021/4687");
    expect(g.invoiceCount).toBe(3);
    expect(g.cas).toBe(2250000); // 1 500 000 + 500 000 + 250 000 (le zéro de tête est fusionné)
    // Le callable dérive des IDs DÉTERMINISTES du FP (safeId(fp) / saisie_geninv_…) → 1 doc order + 1 doc
    // opp par FP, idempotent en ré-exécution : jamais de doublon de commande/opportunité pour un même FP.
  });
  it("entrées vides → plan vide, compteurs cohérents", () => {
    const r = planFromInvoices([], new Set());
    expect(r.plan).toEqual([]);
    expect(r.skippedNoFp).toBe(0);
    expect(r.skippedExisting).toBe(0);
  });
});
