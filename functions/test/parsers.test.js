import { describe, it, expect } from "vitest";
const XLSX = require("xlsx");
const { parsePnl } = require("../parsers/pnl");
const { parseFacturationDf } = require("../parsers/facturationDf");
const { parseSalesData, normalizeStage } = require("../parsers/salesData");
const { parseFiche } = require("../parsers/ficheAffaire");

// Construit un classeur à partir d'une feuille nommée + lignes d'objets.
function wbFromRows(sheetName, rows) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), sheetName);
  return wb;
}
function wbFromAoa(sheetName, aoa) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), sheetName);
  return wb;
}

describe("parsePnl → orders + suppliers (§17.2)", () => {
  const wb = wbFromRows("P&L", [
    {
      "Opp ID": "FP/2026/1", Customer: "ACME", BU: "ICT", "Year PO": 2026,
      CAS: 1000, "RAF TOTAL": 400, "MB TOTAL": 210, "MB Réel": 999, AM: "DATCHA",
      Frns1: 300, "Frns1 N": "HIPERDIST", Frns2: 50, "Frns2 N": "COM", Frns3: 0, "Frns3 N": "WESTCON",
    },
    { "Opp ID": "FP/2026/2", Customer: "BETA", BU: "xxx", "Year PO": 2025, CAS: 0 }, // quarantaine CAS<=0
    { "Opp ID": "NOFP", Customer: "GAMMA", CAS: 500 }, // quarantaine FP invalide
  ]);
  const { rows, report } = parsePnl(wb);

  it("garde seulement les lignes valides", () => {
    expect(rows).toHaveLength(1);
    expect(report.rowsIn).toBe(3);
    expect(report.rowsOk).toBe(1);
  });
  it("utilise MB TOTAL (pas MB Réel) et RAF≥0", () => {
    expect(rows[0].mb).toBe(210);
    expect(rows[0].raf).toBe(400);
    expect(rows[0].bu).toBe("ICT");
  });
  it("filtre le bruit fournisseurs (COM) et les montants nuls", () => {
    expect(rows[0].suppliers).toEqual([{ name: "HIPERDIST", amount: 300 }]);
  });
});

describe("parseFacturationDf → invoices (§17.3)", () => {
  it("dédup par Numéro et mappe Odoo", () => {
    const wb = wbFromRows("Facturation DF", [
      { "Numéro": "JV/2024/01/0002", "N° FP": "FP/2026/1", Client: "ACME", "Montant HT": 100, Date: "2024-01-15", BU: "ICT" },
      { "Numéro": "JV/2024/01/0002", "N° FP": "FP/2026/1", Client: "ACME", "Montant HT": 100, Date: "2024-01-15", BU: "ICT" },
      { "Numéro": "JV/2024/01/0003", "Référence": "FP/2026/1", "Nom d'affichage du partenaire": "ACME", "Total signé en devises": 250, "Date de facturation": "2024-02-01" },
      { Client: "SansNumero", "Montant HT": 99 }, // quarantaine
    ]);
    const { rows, report } = parseFacturationDf(wb);
    expect(rows).toHaveLength(2); // dédup + skip sans numéro
    expect(report.rowsSkipped).toBe(2);
    const byId = Object.fromEntries(rows.map((r) => [r._id, r]));
    expect(byId["JV_2024_01_0002"].amountHt).toBe(100);
    expect(byId["JV_2024_01_0003"].amountHt).toBe(250);
    expect(byId["JV_2024_01_0003"].client).toBe("ACME"); // mapping Odoo partenaire
    expect(byId["JV_2024_01_0002"].fp).toBe("FP/2026/1");
  });
  it("contrôle §18.3 : Σ factures d'un FP = son CAF", () => {
    const wb = wbFromRows("Facturation DF", [
      { "Numéro": "A1", "N° FP": "FP/2026/1", "Montant HT": 600 },
      { "Numéro": "A2", "N° FP": "FP/2026/1", "Montant HT": 400 },
    ]);
    const { rows } = parseFacturationDf(wb);
    expect(rows.reduce((s, r) => s + r.amountHt, 0)).toBe(1000);
  });
});

describe("parseSalesData → opportunities (§17.5)", () => {
  it("normalise les étapes (accents/casse/variantes)", () => {
    expect(normalizeStage("4-Négociation")).toBe(4);
    expect(normalizeStage("negociation")).toBe(4);
    expect(normalizeStage("6 - Gagné")).toBe(6);
    expect(normalizeStage("Suspendu")).toBe(8);
    expect(normalizeStage("inconnu")).toBe(0);
  });
  it("proba = IdC sinon défaut ; pondéré = montant×proba", () => {
    const wb = wbFromRows("LIVE", [
      { Client: "ACME", "Montant (HT)": 1000, Statut: "4-Négociation", IdC: 0.5, "NEW AM": "DATCHA", "D Prev": "2026-03-01" },
      { Client: "BETA", "Montant (HT)": 2000, Statut: "2-Montage", "NEW AM": "KOUADIO" }, // proba défaut 0.25
      { Client: "", "Montant (HT)": 0, Statut: "1-Qualification" }, // quarantaine
    ]);
    const { rows, report } = parseSalesData(wb);
    expect(rows).toHaveLength(2);
    expect(report.rowsSkipped).toBe(1);
    const acme = rows.find((r) => r.client === "ACME");
    expect(acme.probability).toBe(0.5);
    expect(acme.weighted).toBe(500);
    const beta = rows.find((r) => r.client === "BETA");
    expect(beta.probability).toBe(0.25);
    expect(beta.weighted).toBe(500);
  });
  it("oppId stable par hash quand extId absent (idempotence)", () => {
    const mk = () => parseSalesData(wbFromRows("LIVE", [{ Client: "ACME", "Montant (HT)": 1000, Statut: "4-Négociation", "NEW AM": "DATCHA" }])).rows[0]._id;
    expect(mk()).toBe(mk());
  });
});

describe("parseFiche → projectSheets + bcLines (§18.4, contrôle PAM-BF)", () => {
  // Reconstruit la structure de la fiche affaire (labels + valeurs) — cellules §18.4.
  const aoa = [
    [], [], [],
    [null, null, null, null, null, "N° DE FP :", "FP/2026/13542"],   // ligne 4 (index 3)
    [null, null, null, null, null, "CLIENT :", "PAM - BF"],           // ligne 5
    [null, null, null, null, null, "AFFAIRE :", "Fourniture serveurs"],
    [null, null, null, null, null, "COMMERCIAL :", "DATCHA"],
    [], [],
    [null, null, "N°BC FRNS", "DESCRIPTION", "FOURNISSEUR", "TYPE", "DEVISE", "CHARGES EN DEVISE", "CHARGES EN XOF"], // en-tête (ligne 15/idx? place row idx 9)
    [null, "Commande Frns 1", "BC001", "Serveur", "AITEK", "Matériel", "XOF", 1007500, 1007500], // ligne données
    [null, "TOTAL Commandes Frns", null, null, null, null, null, null, 1007500], // stop
    [], [],
    [null, "PRIX DE REVIENT", null, null, null, null, null, null, 1007500],
    [null, "PRIX DE VENTE NEURONES", null, null, null, null, null, null, 1085668],
    [null, "MARGE BRUTE NEURONES", null, null, null, null, null, null, 78168],
    [null, "% DE MARGE BRUTE", null, null, null, null, null, null, 7.2],
  ];
  const wb = wbFromAoa("Fiche", aoa);
  const { sheet, bcLines } = parseFiche(wb);

  it("entête : FP, client, commercial", () => {
    expect(sheet.fp).toBe("FP/2026/13542");
    expect(sheet.client).toBe("PAM - BF");
    expect(sheet.commercial).toBe("DATCHA");
  });
  it("récap chiffré (revient/vente/marge/%MB)", () => {
    expect(sheet.costTotal).toBe(1007500);
    expect(sheet.saleTotal).toBe(1085668);
    expect(sheet.margin).toBe(78168);
    expect(sheet.marginPct).toBeCloseTo(0.072, 5); // 7,2% → /100
  });
  it("ligne BC AITEK 1 007 500 en XOF, statut initial a_emettre", () => {
    expect(bcLines).toHaveLength(1);
    expect(bcLines[0].supplier).toBe("AITEK");
    expect(bcLines[0].amountXof).toBe(1007500);
    expect(bcLines[0].status).toBe("a_emettre");
    expect(bcLines[0]._id).toBe("FP_2026_13542_0"); // FP sanitisé (pas de '/' dans l'ID)
  });
});
