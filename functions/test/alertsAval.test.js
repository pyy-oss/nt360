// Alertes de COHÉRENCE AVAL (facture) — Exécution Lot B. Deux contrôles temporels/chronologiques qui
// vivent dans le Centre d'alertes (comme opp_dormante / facture_pre_po), pas dans la Qualité d'ingestion.
import { describe, it, expect } from "vitest";
const { alerts } = require("../domain/alerts");

const countOf = (arr, type) => { const x = arr.find((a) => a.type === type); return x ? x.count : 0; };
const sup = { rows: [] };

describe("livraison_en_retard — retard de livraison (ClickUp) remonté au Centre d'alertes (DO Lot 3)", () => {
  it("émet une alerte high depuis la liste des affaires en retard de livraison", () => {
    const deliv = [{ fp: "FP/2026/1", client: "ACME" }, { fp: "FP/2026/2", client: "BETA" }];
    const al = alerts([], [], sup, [], 2026, "2026-07-17", [], null, deliv);
    const a = al.find((x) => x.type === "livraison_en_retard");
    expect(a).toBeTruthy();
    expect(a.severity).toBe("high");
    expect(a.count).toBe(2);
    expect(a.refs).toEqual(["FP/2026/1", "FP/2026/2"]);
  });
  it("aucune alerte quand la liste est vide ou absente (rétrocompatible)", () => {
    expect(alerts([], [], sup, [], 2026, "2026-07-17", [], null).find((x) => x.type === "livraison_en_retard")).toBeFalsy();
    expect(alerts([], [], sup, [], 2026, "2026-07-17", [], null, []).find((x) => x.type === "livraison_en_retard")).toBeFalsy();
  });
});

describe("commande_non_facturee — commande signée sans facture depuis > N jours", () => {
  const orders = [
    { fp: "FP/2025/1", cas: 1000, facture: 0, dateCommande: "2025-01-10" }, // signée il y a > 90 j, 0 facturé → alerte
    { fp: "FP/2025/2", cas: 1000, facture: 400, dateCommande: "2025-01-10" }, // partiellement facturée → non
    { fp: "FP/2025/3", cas: 1000, facture: 0, dateCommande: "2026-06-20" }, // récente (< 90 j) → non
    { fp: "FP/2025/4", cas: 0, facture: 0, dateCommande: "2025-01-10" },    // CAS 0 → non (rien à facturer)
    { fp: "FP/2025/5", cas: 1000, facture: 0 },                             // pas de dateCommande → non (âge inconnu)
  ];
  it("compte les commandes signées, non facturées et âgées", () => {
    const al = alerts(orders, [], sup, [], 2026, "2026-07-17", [], null);
    expect(countOf(al, "commande_non_facturee")).toBe(1); // FP/2025/1 seulement
    const a = al.find((x) => x.type === "commande_non_facturee");
    expect(a.refs).toContain("FP/2025/1");
  });
  it("sans asOf, aucune alerte temporelle (âge non mesurable)", () => {
    const al = alerts(orders, [], sup, [], 2026, undefined, [], null);
    expect(countOf(al, "commande_non_facturee")).toBe(0);
  });
  it("le seuil est configurable (nonFactureJours)", () => {
    // À 400 jours, la commande de janvier 2025 (≈ 550 j) reste au-dessus ; à 999 j elle passe sous le seuil.
    expect(countOf(alerts(orders, [], sup, [], 2026, "2026-07-17", [], { nonFactureJours: 999 }), "commande_non_facturee")).toBe(0);
  });
});

describe("facture_avant_commande — facture datée avant la date de commande (preCmd)", () => {
  it("compte les factures marquées preCmd par enrichLinks", () => {
    const invoices = [
      { numero: "F1", fp: "FP/2026/1", amountHt: 100, preCmd: true },
      { numero: "F2", fp: "FP/2026/1", amountHt: 100, preCmd: false },
      { numero: "F3", fp: "FP/2026/2", amountHt: 100 }, // pas de flag → non
    ];
    const al = alerts([], invoices, sup, [], 2026, "2026-07-17", [], null);
    expect(countOf(al, "facture_avant_commande")).toBe(1);
    expect(al.find((x) => x.type === "facture_avant_commande").refs).toContain("F1");
  });
});
