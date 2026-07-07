import { describe, it, expect } from "vitest";
const XLSX = require("xlsx");
const { parseSalesData } = require("../parsers/salesData");

function wb(rows) {
  const b = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(b, XLSX.utils.json_to_sheet(rows), "LIVE");
  return b;
}
const deal = (over) => ({ Client: "MTN CI", Statut: "3-Proposition", IdC: 0.6, "N° FP": "FP/2026/5", "D Prev": "2026-06-30", AM: "Awa", Montant: 100, ...over });

describe("parseSalesData — identité d'opportunité STABLE (cf. audit P0-E : pipeline fantôme)", () => {
  it("même deal, montant CHANGÉ → même oppId (pas d'orphelin qui double-compte)", () => {
    const a = parseSalesData(wb([deal({ Montant: 100 })])).rows[0];
    const b = parseSalesData(wb([deal({ Montant: 150 })])).rows[0];
    expect(a._id).toBe(b._id);
  });
  it("même deal, ÉTAPE changée (3→4) → même oppId", () => {
    const a = parseSalesData(wb([deal({ Statut: "3-Proposition" })])).rows[0];
    const b = parseSalesData(wb([deal({ Statut: "4-Négociation" })])).rows[0];
    expect(a._id).toBe(b._id);
  });
  it("même FP, client corrigé → même oppId (le FP est la clé d'identité)", () => {
    // Deux lignes de MÊME FP = même affaire : le client (corrigeable) n'entre pas dans l'id.
    const a = parseSalesData(wb([deal({ Client: "MTN CI" })])).rows[0];
    const b = parseSalesData(wb([deal({ Client: "ORANGE CI" })])).rows[0];
    expect(a._id).toBe(b._id);
  });
  it("Opp ID externe → prioritaire et stable quel que soit le montant", () => {
    const a = parseSalesData(wb([deal({ "Opp ID": "EXT-9", Montant: 100 })])).rows[0];
    const b = parseSalesData(wb([deal({ "Opp ID": "EXT-9", Montant: 999 })])).rows[0];
    expect(a._id).toBe(b._id);
  });
  // cf. audit cycle de vie : l'id d'une opp AVEC FP ne dépend QUE du FP (D Prev / AM sont mutables).
  it("même FP, D Prev CHANGÉE → même oppId (plus d'orphelin sur glissement d'échéance)", () => {
    const a = parseSalesData(wb([deal({ "D Prev": "2026-06-30" })])).rows[0];
    const b = parseSalesData(wb([deal({ "D Prev": "2026-09-30" })])).rows[0];
    expect(a._id).toBe(b._id);
  });
  it("même FP, AM corrigé → même oppId", () => {
    const a = parseSalesData(wb([deal({ AM: "Awa" })])).rows[0];
    const b = parseSalesData(wb([deal({ AM: "Awa Diop" })])).rows[0];
    expect(a._id).toBe(b._id);
  });
  it("FP différent → oppId différent (deux affaires distinctes)", () => {
    const a = parseSalesData(wb([deal({ "N° FP": "FP/2026/5" })])).rows[0];
    const b = parseSalesData(wb([deal({ "N° FP": "FP/2026/6" })])).rows[0];
    expect(a._id).not.toBe(b._id);
  });
});
