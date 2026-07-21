import { describe, it, expect } from "vitest";
const { wbFromRows, wbFromAoa, wbMulti } = require("./_wb");
const { detectKind, detectKinds, buildWrites, fiscalYearFromOrders } = require("../lib/ingest");

const wb = wbFromRows;
const wbAoa = wbFromAoa;

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
  it("« Prix de revient » SEUL (colonne P&L) ne reclasse PAS en fiche → P&L préservé", () => {
    const kinds = detectKinds(wb("P&L", [{ "Opp ID": "FP/2026/1", CAS: 100, "RAF TOTAL": 10, "Prix de revient": 80 }]));
    expect(kinds).toContain("pnl");
    expect(kinds).not.toContain("fiche");
  });
  it("classé « fiche » à tort (revient+vente) mais 0 fiche parsable → REPLI sur P&L (pas de perte)", () => {
    // Un P&L contenant à la fois « Prix de revient » ET « Prix de vente » est détecté « fiche » (couple),
    // mais parseFicheAll n'y trouve aucune fiche cellulaire → repli sur la détection non-fiche → P&L
    // conservé (avant : classeur entier jeté « fiche · 0 l. »).
    const { kinds, writes } = buildWrites(wb("P&L", [{ "Opp ID": "FP/2026/1", CAS: 100, "RAF TOTAL": 10, "Prix de revient": 80, "Prix de vente": 100 }]));
    expect(kinds).toContain("pnl");
    expect(kinds).not.toContain("fiche");
    expect(writes.some((w) => w.path === "orders/FP_2026_1")).toBe(true);
  });
  it("faux positif LIVE évité : « Valid Client » ne matche pas « id c »", () => {
    const kinds = detectKinds(wb("P&L", [{ "Opp ID": "FP/2026/1", CAS: 100, "RAF TOTAL": 10, "Valid Client": "ACME" }]));
    expect(kinds).toEqual(["pnl"]); // pas de salesData parasite
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
    // id de ligne BC = clé métier hachée (plus positionnel `_0`) — cf. audit intégral I3.
    expect(writes.map((w) => w.path.replace(/_h[a-z0-9]+$/, "_h#"))).toEqual(
      ["projectSheets/FP_2026_9", "projectSheetsMargin/FP_2026_9", "bcLines/FP_2026_9_h#"]);
    // marge isolée dans projectSheetsMargin ; le doc de base ne porte plus coût/vente/marge
    const base = writes.find((w) => w.path === "projectSheets/FP_2026_9").data;
    expect(base.saleTotal).toBeUndefined();
    expect(writes.find((w) => w.path === "projectSheetsMargin/FP_2026_9").data).toHaveProperty("costTotal");
  });
  it("classeur multi-fiches (une fiche par onglet) → toutes les fiches écrites", () => {
    const fiche = (fp, frn) => [
      [null, null, null, null, null, "N° DE FP :", fp],
      [null, null, "N°BC FRNS", "DESCRIPTION", "FOURNISSEUR", "TYPE", "DEVISE", "CHARGES EN DEVISE", "CHARGES EN XOF"],
      [null, "Commande Frns 1", "BC1", "x", frn, "Matériel", "XOF", 500, 500],
      [null, "TOTAL Commandes Frns", null, null, null, null, null, null, 500],
    ];
    const b = wbMulti([
      { name: "Fiche A", aoa: fiche("FP/2026/9", "AITEK") },
      { name: "Fiche B", aoa: fiche("FP/2026/10", "WESTCON") },
    ]);
    const { kinds, writes, report } = buildWrites(b);
    expect(kinds).toEqual(["fiche"]);
    expect(report.byKind.fiche.fiches).toBe(2);
    expect(writes.map((w) => w.path.replace(/_h[a-z0-9]+$/, "_h#"))).toEqual([
      "projectSheets/FP_2026_9", "projectSheetsMargin/FP_2026_9", "bcLines/FP_2026_9_h#",
      "projectSheets/FP_2026_10", "projectSheetsMargin/FP_2026_10", "bcLines/FP_2026_10_h#",
    ]);
  });
  it("classeur multi-feuilles (P&L + LIVE + Facturation DF) → toutes les sources", () => {
    const b = wbMulti([
      { name: "P&L", rows: [{ "Opp ID": "FP/2026/1", CAS: 100, "RAF TOTAL": 10, Customer: "ACME" }] },
      { name: "LIVE", rows: [{ Client: "ACME", "Montant (HT)": 1000, Statut: "4-Négociation", "NEW AM": "DATCHA", IdC: 0.6 }] },
      { name: "Facturation DF", rows: [{ "Numéro": "A1", "N° FP": "FP/2026/1", "Montant HT": 600 }] },
    ]);
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
  it("même règle de millésime que le carnet : yearPo aberrant ignoré, année du FP en repli", () => {
    // 20226 (faute de frappe Excel) ne doit PAS devenir currentFy ; 1900 → repli sur l'année du FP.
    expect(fiscalYearFromOrders([{ yearPo: 20226, fp: "FP/2024/1" }, { yearPo: 2025, fp: "FP/2025/2" }])).toBe(2025);
    expect(fiscalYearFromOrders([{ yearPo: 1900, fp: "FP/2026/3" }, { yearPo: 2025, fp: "FP/2025/4" }])).toBe(2026);
    // yearPo plausible PRIME sur l'année du FP (commande d'une année sur un FP antérieur).
    expect(fiscalYearFromOrders([{ yearPo: 2026, fp: "FP/2024/5" }])).toBe(2026);
  });
});
