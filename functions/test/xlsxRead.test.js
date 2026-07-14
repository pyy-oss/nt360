// Valide le pont exceljs (lib/xlsxRead) via un aller-retour BINAIRE réel : on écrit un .xlsx avec
// exceljs (aoaToXlsxBase64), on le relit (readWorkbook), puis on extrait avec sheetToJson. Couvre les
// options réellement utilisées par les parseurs + les cas délicats (dates, cellules fusionnées, vides).
import { describe, it, expect } from "vitest";
const ExcelJS = require("exceljs");
const { readWorkbook, sheetToJson, aoaToXlsxBase64 } = require("../lib/xlsxRead");

const roundtrip = async (aoa, sheetName = "F1") => {
  const b64 = await aoaToXlsxBase64(aoa, sheetName);
  return readWorkbook(Buffer.from(b64, "base64"));
};

describe("xlsxRead — aller-retour exceljs (lecture binaire)", () => {
  it("expose SheetNames + Sheets", async () => {
    const wb = await roundtrip([["A", "B"], [1, 2]], "Data");
    expect(wb.SheetNames).toEqual(["Data"]);
    expect(wb.Sheets.Data._aoa.length).toBe(2);
  });

  it("sheetToJson header:1 → AOA", async () => {
    const wb = await roundtrip([["A", "B"], [1, 2], [3, 4]]);
    const aoa = sheetToJson(wb.Sheets.F1, { header: 1 });
    expect(aoa[0]).toEqual(["A", "B"]);
    expect(aoa[1]).toEqual([1, 2]);
  });

  it("sheetToJson mode objets → clés d'en-tête", async () => {
    const wb = await roundtrip([["Opp ID", "CAS"], ["FP/2026/1", 100]]);
    const rows = sheetToJson(wb.Sheets.F1);
    expect(rows).toEqual([{ "Opp ID": "FP/2026/1", CAS: 100 }]);
  });

  it("defval:null comble les cellules vides ; sans defval la clé est omise", async () => {
    const wb = await roundtrip([["A", "B"], [1, null]]);
    expect(sheetToJson(wb.Sheets.F1, { defval: null })).toEqual([{ A: 1, B: null }]);
    expect(sheetToJson(wb.Sheets.F1)).toEqual([{ A: 1 }]);
  });

  it("saute les lignes entièrement vides (parité xlsx)", async () => {
    const wb = await roundtrip([["A"], [1], [null], [2]]);
    expect(sheetToJson(wb.Sheets.F1)).toEqual([{ A: 1 }, { A: 2 }]);
  });

  it("en-têtes dupliqués → suffixe _N", async () => {
    const wb = await roundtrip([["X", "X"], [1, 2]]);
    expect(sheetToJson(wb.Sheets.F1)).toEqual([{ X: 1, X_1: 2 }]);
  });

  it("colonne à en-tête vide → clé __EMPTY (parité xlsx, données conservées)", async () => {
    // xlsx nomme les colonnes sans en-tête __EMPTY/__EMPTY_1… et conserve leurs valeurs. Les DROP
    // faisait collisionner la signature de dédup de facturationDf (sous-comptage CAF) → on rétablit la parité.
    const wb = await roundtrip([["A", null, "B", null], [1, 9, 2, 8]]);
    expect(sheetToJson(wb.Sheets.F1)).toEqual([{ A: 1, __EMPTY: 9, B: 2, __EMPTY_1: 8 }]);
  });

  it("dates → objets Date (cellDates)", async () => {
    const d = new Date(Date.UTC(2026, 5, 30));
    const b64 = await aoaToXlsxBase64([["D"], [d]], "F1");
    const wb = await readWorkbook(Buffer.from(b64, "base64"));
    const v = wb.Sheets.F1._aoa[1][0];
    expect(v instanceof Date).toBe(true);
    expect(v.getUTCFullYear()).toBe(2026);
  });

  it("cellule fusionnée : seule la maîtresse porte la valeur", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("F1");
    ws.getCell("A1").value = "FUSION";
    ws.mergeCells("A1:B1");
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    const rd = await readWorkbook(buf);
    const row0 = rd.Sheets.F1._aoa[0];
    expect(row0[0]).toBe("FUSION");
    expect(row0[1]).toBe(null); // la cellule fusionnée non-maîtresse est vide
  });

  it("richText et hyperlink → texte plat", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("F1");
    ws.getCell("A1").value = { richText: [{ text: "Re" }, { text: "fonte" }] };
    ws.getCell("B1").value = { text: "Lien", hyperlink: "https://x" };
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    const rd = await readWorkbook(buf);
    expect(rd.Sheets.F1._aoa[0][0]).toBe("Refonte");
    expect(rd.Sheets.F1._aoa[0][1]).toBe("Lien");
  });

  it("hyperlink à libellé richText → texte plat (pas d'objet qui fuit)", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("F1");
    // exceljs peut produire { text: { richText:[…] }, hyperlink } : normCell doit re-normaliser récursivement.
    ws.getCell("A1").value = { text: { richText: [{ text: "Fac" }, { text: "ture" }] }, hyperlink: "https://x" };
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    const rd = await readWorkbook(buf);
    expect(rd.Sheets.F1._aoa[0][0]).toBe("Facture");
  });

  it("CSV (buffer sans signature ZIP) → lu comme classeur (support conservé)", async () => {
    const csv = "A,B\n1,2\n3,4\n";
    const rd = await readWorkbook(Buffer.from(csv, "utf8"));
    expect(rd.SheetNames.length).toBe(1);
    expect(sheetToJson(rd.Sheets[rd.SheetNames[0]])).toEqual([{ A: 1, B: 2 }, { A: 3, B: 4 }]);
  });

  it(".xls hérité (OLE) → erreur claire plutôt qu'échec cryptique", async () => {
    const ole = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
    await expect(readWorkbook(ole)).rejects.toThrow(/\.xls/);
  });
});
