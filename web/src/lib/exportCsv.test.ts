import { describe, it, expect } from "vitest";
import { nodeToText, csvCell, cellValue, buildCsv } from "./exportCsv";

describe("nodeToText — extraction du texte visible d'un ReactNode", () => {
  it("chaîne / nombre / null", () => {
    expect(nodeToText("MTN CI")).toBe("MTN CI");
    expect(nodeToText(42)).toBe("42");
    expect(nodeToText(null)).toBe("");
    expect(nodeToText(false)).toBe("");
  });
  it("élément avec enfants imbriqués", () => {
    const el = { props: { children: ["1,2 ", { props: { children: "M" } }] } };
    expect(nodeToText(el)).toBe("1,2 M");
  });
});

describe("csvCell — échappement (séparateur ;)", () => {
  it("entoure et double les guillemets si séparateur/guillemet/newline", () => {
    expect(csvCell("simple")).toBe("simple");
    expect(csvCell("a;b")).toBe('"a;b"');
    expect(csvCell('dit "oui"')).toBe('"dit ""oui"""');
    expect(csvCell("ligne1\nligne2")).toBe('"ligne1\nligne2"');
    expect(csvCell(null)).toBe("");
  });
});

describe("cellValue — priorité à la valeur de tri brute", () => {
  const col = { header: "CAS", render: (r: any) => ({ props: { children: r.label } }), sort: (r: any) => r.cas };
  it("nombre de tri → brut (pour Excel)", () => {
    expect(cellValue(col, { cas: 1000000, label: "1 M" })).toBe(1000000);
  });
  it("sans valeur de tri exploitable → texte rendu", () => {
    const c2 = { header: "X", render: (r: any) => ({ props: { children: r.v } }) };
    expect(cellValue(c2, { v: "abc" })).toBe("abc");
  });
});

describe("buildCsv", () => {
  const cols = [
    { header: "FP", render: (r: any) => r.fp, sort: (r: any) => r.fp },
    { header: "CAS", render: () => "x", sort: (r: any) => r.cas },
  ];
  it("entête + lignes séparées par ;", () => {
    const csv = buildCsv(cols, [{ fp: "FP/1", cas: 500 }, { fp: "FP;2", cas: 0 }]);
    expect(csv).toBe('FP;CAS\nFP/1;500\n"FP;2";0');
  });
  it("aucune ligne → entête seule", () => {
    expect(buildCsv(cols, [])).toBe("FP;CAS");
  });
});
