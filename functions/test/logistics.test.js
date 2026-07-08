import { describe, it, expect } from "vitest";
const XLSX = require("xlsx");
const { parseLogistics } = require("../parsers/logistics");

function wbFrom(rows) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), "PO List");
  return wb;
}
const byBc = (rows, n) => rows.find((r) => r.bcNumber === n);

describe("parseLogistics — contre-valeur XOF robuste (cf. audit P0-B)", () => {
  const wb = wbFrom([
    ["PO N°", "Fournisseur", "Montant", "Devise", "Montant XOF"],
    ["BC-EUR", "CISCO", 1000, "EUR", ""],   // pas de XOF saisi → conversion parité fixe EUR
    ["BC-USD", "DELL", 500, "USD", ""],      // pas de taux paramétré → 0 EXPLICITEMENT « à saisir »
    ["BC-XOF", "HP", 700, "XOF", ""],        // alias « Devise » = XOF → montant repris
    ["BC-SAISI", "LENOVO", 900, "USD", 540000], // XOF saisi manuellement → prioritaire
  ]);
  const { rows } = parseLogistics(wb);

  it("EUR sans XOF saisi → converti par la parité fixe (jamais 0 silencieux)", () => {
    const b = byBc(rows, "BC-EUR");
    expect(b.amountXof).toBe(Math.round(1000 * 655.957));
    expect(b.fxSource).toBe("peg");
  });
  it("USD sans taux → amountXof OMIS (fxSource « a_saisir ») pour ne pas écraser une correction manuelle au ré-import", () => {
    const b = byBc(rows, "BC-USD");
    // Audit P0-2 : quand la valeur n'est pas dérivable, on N'ÉCRIT PAS amountXof → le merge préserve une
    // éventuelle correction manuelle (patchBcLine). Une ligne neuve reste à 0 (champ absent) → signalée en
    // qualité (test amountXof ≤ 0). fxSource reste « a_saisir » pour la traçabilité.
    expect(b).not.toHaveProperty("amountXof");
    expect(b).not.toHaveProperty("fxRate");
    expect(b.fxSource).toBe("a_saisir");
  });
  it("alias « Devise » = XOF → montant repris (bug d'alias corrigé)", () => {
    const b = byBc(rows, "BC-XOF");
    expect(b.currency).toBe("XOF");
    expect(b.amountXof).toBe(700);
    expect(b.fxSource).toBe("xof");
  });
  it("XOF saisi manuellement → prioritaire sur toute conversion", () => {
    const b = byBc(rows, "BC-SAISI");
    expect(b.amountXof).toBe(540000);
    expect(b.fxSource).toBe("manuel");
  });
});

describe("parseLogistics — identité BC STABLE sur correction du FP (cf. audit intégral I1)", () => {
  const line = (over) => ({ "PO N°": "BC N° 06457", Fournisseur: "KUKUZA", Description: "Routeur", Montant: 500000, Devise: "XOF", "Opp ID": "FP/2024/13", ...over });
  const idOf = (over) => parseLogistics(wbFrom([
    ["PO N°", "Fournisseur", "Description", "Montant", "Devise", "Opp ID"],
    Object.values(line(over)),
  ])).rows[0]._id;

  it("même PO, FP CORRIGÉ (13→14) → même id (mise à jour en place, plus d'orphelin double-compté)", () => {
    expect(idOf({ "Opp ID": "FP/2024/13" })).toBe(idOf({ "Opp ID": "FP/2024/14" }));
  });
  it("même PO, MONTANT corrigé → même id (idempotent)", () => {
    expect(idOf({ Montant: 500000 })).toBe(idOf({ Montant: 750000 }));
  });
  it("n° de PO DIFFÉRENT → id différent (deux BC distincts)", () => {
    expect(idOf({ "PO N°": "BC N° 06457" })).not.toBe(idOf({ "PO N°": "BC N° 06999" }));
  });
  it("sans n° de PO (identité faible) → le FP discrimine encore", () => {
    expect(idOf({ "PO N°": "", "Opp ID": "FP/2024/13" })).not.toBe(idOf({ "PO N°": "", "Opp ID": "FP/2024/14" }));
  });
});
