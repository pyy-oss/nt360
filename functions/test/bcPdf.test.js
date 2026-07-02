import { describe, it, expect } from "vitest";
const { parseBcText, normCur, guessType } = require("../parsers/bcPdf");

// Texte représentatif d'un BC Odoo (tel qu'extrait par pdfjs), en une ligne d'items.
const SAMPLE = `NEURONES TECHNOLOGIES Immeuble Neurones Cocody Angré 8ème Tranche 26 BP 855 Abidjan 26 - Côte d'Ivoire Abidjan Tél..: (+225)22429090/2722429092 Fax..: (225)22429009 Adresse de livraison : NEURONES TECHNOLOGIES Immeuble Neurones Cocody Angré Abidjan 26 BP 855 Abidjan 26 - Côte d'Ivoire Côte d'Ivoire (+225)22429090/2722429092 EXCLUSIVE NETWORKS NORTH WEST AFRICA TOUR CFC First, lot 57, 12 étage, Casa-Anfa Hay Hassani 20250 CASABLANCA Maroc VAT: 003176064000092 Bon de Commande N° BC/2026/07924 Référence Fournisseur FORTINET / NEURONES CI / SEMPA (entreprise) / SW26 Référence Dossier DC/2026/0210 Date Bon commande : 02/07/2026 08:35:03 Référence Description Taxes Date prévue Quantité Prix Unitaire Net à payer FC-10-0060F-809-02-12 FortiGate-60F 1 Year Enterprise Protection (IPS) Exonéré de TVA 02/07/2026 1,000 435,04 435,04 € Total hors-taxe 744,96 € Taxes 0,00 € Total 744,96 €`;

describe("parseBcText — extraction d'un BC PDF (best-effort)", () => {
  const f = parseBcText(SAMPLE);
  it("numéro de BC", () => expect(f.bcNumber).toBe("BC/2026/07924"));
  it("fournisseur (société vendeuse, pas l'acheteur NEURONES)", () => expect(f.supplier).toBe("EXCLUSIVE NETWORKS NORTH WEST AFRICA"));
  it("date du BC (ISO)", () => expect(f.dateIn).toBe("2026-07-02"));
  it("montant + devise", () => {
    expect(f.currency).toBe("EUR");
    expect(f.amount).toBeCloseTo(744.96, 2);
    expect(f.amountXof).toBe(0); // devise ≠ XOF → montant XOF laissé à convertir
  });
  it("références fournisseur / dossier", () => {
    expect(f.refFournisseur).toContain("FORTINET");
    expect(f.refDossier).toBe("DC/2026/0210");
  });
  it("type déduit (licence via '1 Year')", () => expect(f.expenseType).toBe("Licence"));
  it("texte vide → objet sûr sans crash", () => {
    const e = parseBcText("");
    expect(e.bcNumber).toBe("");
    expect(e.amount).toBe(0);
  });
});

describe("helpers bcPdf", () => {
  it("normCur", () => {
    expect(normCur("€")).toBe("EUR");
    expect(normCur("FCFA")).toBe("XOF");
    expect(normCur("$")).toBe("USD");
  });
  it("guessType", () => {
    expect(guessType("FortiGate 1 Year Protection")).toBe("Licence");
    expect(guessType("Câble HDMI")).toBe("Hardware");
    expect(guessType("Prestation de déploiement")).toBe("Service Pro");
  });
});
