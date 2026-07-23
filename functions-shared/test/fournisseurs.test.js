import { describe, it, expect } from "vitest";
const { suppliers } = require("../domain/fournisseurs");

// Récupère l'agrégat d'un fournisseur par nom (normalisé majuscules dans le domaine).
const sup = (res, name) => res.bySupplier.find((s) => s.name === name.toUpperCase());

// ADR-P20 : un même fournisseur importé « à un espace/casse près » selon la source du BC ne doit plus se
// scinder en deux dans le SOA (clé canonique cleanName). Fusion des lignes + appariement du plafond.
describe("suppliers — clé fournisseur canonique (ADR-P20)", () => {
  it("fusionne un fournisseur mal espacé (ClickUp) avec sa forme propre (Odoo), plafond apparié", () => {
    const r = suppliers([], [
      { bcNumber: "BC1", supplier: "DELL TECHNOLOGIES", amountXof: 60_000, status: "facture" }, // Odoo (compacté)
      { bcNumber: "BC2", supplier: "dell  technologies", amountXof: 40_000, status: "facture" }, // ClickUp (double espace + casse)
    ], [{ id: "DELL TECHNOLOGIES", authorized: 200_000, openingBalance: 0 }]);
    const rows = r.bySupplier.filter((s) => s.name === "DELL TECHNOLOGIES");
    expect(rows).toHaveLength(1);                 // un SEUL fournisseur, pas deux
    expect(rows[0].facture).toBe(100_000);        // 60k + 40k agrégés
    expect(rows[0].hasCredit).toBe(true);         // plafond « DELL TECHNOLOGIES » bien apparié
    expect(rows[0].authorized).toBe(200_000);
  });
});

// ADR-P21 — « Vérité du coût » : sous drapeau, le SOLDE du compte fournisseur dérive des FACTURES FOURNISSEUR
// RÉELLES (pièce comptable), et le statut « facturé » d'un BC posé à la main ne meut plus le solde.
describe("suppliers — vérité du coût (facture fournisseur, ADR-P21)", () => {
  it("drapeau OFF (défaut) : le solde vient du statut BC « facture » (comportement historique inchangé)", () => {
    const r = suppliers([], [{ bcNumber: "BC1", supplier: "DELL", amountXof: 50_000, status: "facture" }], [{ id: "DELL", authorized: 100_000, openingBalance: 0 }]);
    expect(sup(r, "DELL").facture).toBe(50_000); // statut BC → solde (inchangé)
  });
  it("drapeau ON : le solde = Σ FACTURES fournisseur ; le statut BC « facture » ne compte plus (fin du pilotage manuel)", () => {
    const bc = [{ bcNumber: "BC1", supplier: "DELL", amountXof: 999_000, status: "facture" }]; // ne DOIT pas gonfler le solde
    const inv = [{ supplier: "DELL", amountXof: 30_000 }, { supplier: "dell  ", amountXof: 20_000 }]; // casse/espaces → même clé canonique
    const r = suppliers([], bc, [{ id: "DELL", authorized: 100_000, openingBalance: 0 }], inv, { soaFromInvoices: true });
    expect(sup(r, "DELL").facture).toBe(50_000);   // 30k + 20k (factures réelles) ; le BC « facture » 999k est SUPERSEDÉ
    expect(sup(r, "DELL").solde).toBe(50_000);     // ouverture 0 + factures 50k
  });
});

describe("suppliers — BC en devise non convertie (SOA indéterminé)", () => {
  it("BC réel (N° BC) à montant XOF nul → fournisseur `unvalued` + état « indetermine » (pas « ok » à tort)", () => {
    const orders = [];
    const bcLines = [{ bcNumber: "BC-USD-1", supplier: "DELL", amountXof: 0, status: "emis" }]; // devise non convertie
    const credit = [{ id: "DELL", authorized: 100_000, openingBalance: 0 }];
    const r = suppliers(orders, bcLines, credit);
    const c = sup(r, "DELL");
    expect(c.unvalued).toBe(true);
    expect(c.state).toBe("indetermine"); // le disponible « ok » ne doit pas rassurer à tort
    expect(r.indeterminate).toContain("DELL");
  });
  it("BC valorisé → PAS de flag ; état normal", () => {
    const r = suppliers([], [{ bcNumber: "BC1", supplier: "DELL", amountXof: 50_000, status: "emis" }], [{ id: "DELL", authorized: 100_000, openingBalance: 0 }]);
    const c = sup(r, "DELL");
    expect(c.unvalued).toBe(false);
    expect(c.state).toBe("ok");
  });
  it("saturation réelle prime sur « indetermine » (état pire conservé)", () => {
    const r = suppliers([], [
      { bcNumber: "BC1", supplier: "DELL", amountXof: 120_000, status: "facture" }, // dépasse déjà le plafond
      { bcNumber: "BC2", supplier: "DELL", amountXof: 0, status: "emis" },           // + un non converti
    ], [{ id: "DELL", authorized: 100_000, openingBalance: 0 }]);
    expect(sup(r, "DELL").state).toBe("saturation");
  });
});

describe("suppliers — netting BC ↔ achat commande (anti double-compte)", () => {
  it("BC du même FP+fournisseur : l'achat commande est netté (pas de double engagement)", () => {
    const orders = [{ fp: "FP/2026/1", raf: 10, suppliers: [{ name: "CISCO", amount: 40000 }] }];
    const bcLines = [{ fp: "FP/2026/1", supplier: "CISCO", amountXof: 40000, status: "emis" }];
    const r = suppliers(orders, bcLines, []);
    const c = sup(r, "CISCO");
    expect(c.engagement).toBe(40000); // BC engagé, achat commande entièrement couvert → open 0
  });
  it("BC SANS FP du même fournisseur : nette quand même l'achat (repli fournisseur) — cf. audit P0-B", () => {
    const orders = [{ fp: "FP/2026/1", raf: 10, suppliers: [{ name: "CISCO", amount: 40000 }] }];
    const bcLines = [{ fp: "", supplier: "CISCO", amountXof: 40000, status: "emis" }]; // BC saisi sans N° FP
    const r = suppliers(orders, bcLines, []);
    const c = sup(r, "CISCO");
    // AVANT le correctif : engagement = 40000 (BC) + 40000 (open non netté) = 80000 (double compte).
    expect(c.engagement).toBe(40000);
  });
  it("BC sans FP inférieur à l'achat : le reliquat reste en prévisionnel (open)", () => {
    const orders = [{ fp: "FP/2026/2", raf: 5, suppliers: [{ name: "DELL", amount: 100000 }] }];
    const bcLines = [{ fp: "", supplier: "DELL", amountXof: 30000, status: "emis" }];
    const r = suppliers(orders, bcLines, []);
    const c = sup(r, "DELL");
    expect(c.engagement).toBe(100000); // 30000 (BC) + 70000 (reliquat open)
  });
});

// ADR-068 — BC « annulé » : hors engagement ET hors netting SOA. L'achat planifié de la commande
// RETOMBE en prévisionnel (open) « en attendant le BC de remplacement » ; la charge planifiée reste
// au P&L (costTotal/fiche — objets distincts, non touchés ici).
describe("suppliers — BC annulé hors engagement et hors netting (ADR-068)", () => {
  const order = { fp: "FP/2026/1", raf: 100, suppliers: [{ name: "ACME", amount: 100_000 }] };
  it("BC émis : achat netté (open 0), engagement 100k — référence avant annulation", () => {
    const r = suppliers([order], [{ bcNumber: "BC1", supplier: "ACME", fp: "FP/2026/1", amountXof: 100_000, status: "emis" }], []);
    const a = r.bySupplier.find((s) => s.name === "ACME");
    expect(a.engagement).toBe(100_000); // BC engagé
    expect(a.open).toBe(0);             // achat couvert par le BC (netting)
  });
  it("MÊME BC annulé : plus d'engagement, l'achat retombe en prévisionnel (open)", () => {
    const r = suppliers([order], [{ bcNumber: "BC1", supplier: "ACME", fp: "FP/2026/1", amountXof: 100_000, status: "annule" }], []);
    const a = r.bySupplier.find((s) => s.name === "ACME");
    expect(a.open).toBe(100_000);       // besoin d'achat de nouveau ouvert (BC de remplacement attendu)
    expect(a.engagement).toBe(100_000); // = open seul (engagementBc 0)
    expect(a.facture).toBe(0);          // jamais dans le solde
  });
});
