import { describe, it, expect } from "vitest";
const XLSX = require("xlsx");
const { detectKind, buildWrites, fiscalYearFromOrders } = require("../lib/ingest");

function wb(sheetName, rows) {
  const b = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(b, XLSX.utils.json_to_sheet(rows), sheetName);
  return b;
}
function wbAoa(sheetName, aoa) {
  const b = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(b, XLSX.utils.aoa_to_sheet(aoa), sheetName);
  return b;
}

describe("detectKind — signatures de colonnes/cellules (§9)", () => {
  it("P&L", () => {
    expect(detectKind(wb("P&L", [{ "Opp ID": "FP/2026/1", CAS: 1, "RAF TOTAL": 0 }]))).toBe("pnl");
  });
  it("Sales_DATA (LIVE)", () => {
    expect(detectKind(wb("LIVE", [{ Client: "A", Statut: "1-Qualification", IdC: 0.2 }]))).toBe("salesData");
  });
  it("Facturation DF", () => {
    expect(detectKind(wb("Facturation DF", [{ "Numéro": "A1", "N° FP": "FP/2026/1", "Montant HT": 1 }]))).toBe("facturationDf");
  });
  it("fiche affaire (label cellulaire)", () => {
    expect(detectKind(wbAoa("Fiche", [[null, null, null, null, null, "N° DE FP :", "FP/2026/1"]]))).toBe("fiche");
  });
});

describe("buildWrites — écritures déterministes + idempotence", () => {
  it("P&L → orders/{fp}", () => {
    const { kinds, writes } = buildWrites(wb("P&L", [{ "Opp ID": "FP/2026/1", CAS: 100, "RAF TOTAL": 10, Customer: "ACME" }]));
    expect(kinds).toEqual(["pnl"]);
    expect(writes[0].path).toBe("orders/FP_2026_1"); // FP sanitisé
    expect(writes[0].data.cas).toBe(100);
    expect(writes[0].data.fp).toBe("FP/2026/1"); // champ fp d'origine conservé
  });
  it("ré-exécution → mêmes chemins (upsert, aucun doublon)", () => {
    const mk = () => buildWrites(wb("LIVE", [{ Client: "ACME", "Montant (HT)": 1000, Statut: "4-Négociation", "NEW AM": "DATCHA" }])).writes.map((w) => w.path);
    expect(mk()).toEqual(mk());
  });
  it("fiche → projectSheets + bcLines", () => {
    const aoa = [
      [null, null, null, null, null, "N° DE FP :", "FP/2026/9"],
      [null, null, "N°BC FRNS", "DESCRIPTION", "FOURNISSEUR", "TYPE", "DEVISE", "CHARGES EN DEVISE", "CHARGES EN XOF"],
      [null, "Commande Frns 1", "BC1", "x", "AITEK", "Matériel", "XOF", 500, 500],
      [null, "TOTAL Commandes Frns", null, null, null, null, null, null, 500],
    ];
    const { kinds, writes } = buildWrites(wbAoa("Fiche", aoa));
    expect(kinds).toEqual(["fiche"]);
    expect(writes.map((w) => w.path)).toEqual(["projectSheets/FP_2026_9", "bcLines/FP_2026_9_0"]);
  });
  it("classeur multi-feuilles (P&L + LIVE + Facturation DF) → toutes les sources", () => {
    const b = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(b, XLSX.utils.json_to_sheet([{ "Opp ID": "FP/2026/1", CAS: 100, "RAF TOTAL": 10, Customer: "ACME" }]), "P&L");
    XLSX.utils.book_append_sheet(b, XLSX.utils.json_to_sheet([{ Client: "ACME", "Montant (HT)": 1000, Statut: "4-Négociation", "NEW AM": "DATCHA", IdC: 0.6 }]), "LIVE");
    XLSX.utils.book_append_sheet(b, XLSX.utils.json_to_sheet([{ "Numéro": "A1", "N° FP": "FP/2026/1", "Montant HT": 600 }]), "Facturation DF");
    const { kinds, writes } = buildWrites(b);
    expect(kinds.sort()).toEqual(["facturationDf", "pnl", "salesData"]);
    expect(writes.some((w) => w.path.startsWith("orders/"))).toBe(true);
    expect(writes.some((w) => w.path.startsWith("opportunities/"))).toBe(true);
    expect(writes.some((w) => w.path.startsWith("invoices/"))).toBe(true);
  });
});

describe("fiscalYearFromOrders — ancrage FY (§7)", () => {
  it("max(yearPo)", () => {
    expect(fiscalYearFromOrders([{ yearPo: 2024 }, { yearPo: 2026 }, { yearPo: 2025 }])).toBe(2026);
  });
});
