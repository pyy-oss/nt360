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
  it("USD sans taux → 0 mais fxSource « a_saisir » (visible en qualité, pas silencieux)", () => {
    const b = byBc(rows, "BC-USD");
    expect(b.amountXof).toBe(0);
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
