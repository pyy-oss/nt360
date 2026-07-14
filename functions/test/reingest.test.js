import { describe, it, expect } from "vitest";
const { zipSync } = require("fflate");
const { bufFromRows } = require("./_wb");
const { parseBuffer, isSourceObject, reingestBucket, IngestError } = require("../lib/reingest");

const xlsxBuf = (sheetName, rows) => bufFromRows(sheetName, rows); // tampon .xlsx réel (exceljs)

describe("parseBuffer — XLSX / ZIP partagé (importDelta + reingest)", () => {
  it("XLSX P&L → écritures orders/{fp} + kinds", async () => {
    const buf = await xlsxBuf("P&L", [{ "Opp ID": "FP/2026/1", CAS: 100, "RAF TOTAL": 10, Customer: "ACME" }]);
    const r = await parseBuffer(buf, "pnl.xlsx");
    expect(r.kinds).toEqual(["pnl"]);
    expect(r.writes.some((w) => w.path === "orders/FP_2026_1")).toBe(true);
    expect(r.rowsOk).toBeGreaterThan(0);
  });

  it("« Description du Projet » alimente la désignation (le fix ré-appliqué à la ré-ingestion)", async () => {
    const buf = await xlsxBuf("P&L", [{ "Opp ID": "FP/2026/2", CAS: 100, "RAF TOTAL": 0, Customer: "ACME", "Description du Projet": "Refonte réseau" }]);
    const r = await parseBuffer(buf, "pnl.xlsx");
    const order = r.writes.find((w) => w.path === "orders/FP_2026_2");
    expect(order.data.designation).toBe("Refonte réseau");
  });

  it("ZIP de classeurs → agrège toutes les fiches", async () => {
    const a = await xlsxBuf("P&L", [{ "Opp ID": "FP/2026/1", CAS: 100, "RAF TOTAL": 0, Customer: "A" }]);
    const b = await xlsxBuf("P&L", [{ "Opp ID": "FP/2026/2", CAS: 200, "RAF TOTAL": 0, Customer: "B" }]);
    const zip = Buffer.from(zipSync({ "a.xlsx": new Uint8Array(a), "b.xlsx": new Uint8Array(b) }));
    const r = await parseBuffer(zip, "lot.zip");
    expect(r.kinds).toEqual(["pnl"]);
    expect(r.writes.filter((w) => w.path.startsWith("orders/")).length).toBe(2);
    expect(r.files.length).toBe(2);
  });

  it("ZIP illisible → IngestError", async () => {
    await expect(parseBuffer(Buffer.from("pas un zip du tout"), "x.zip")).rejects.toThrow(IngestError);
  });

  it("classeur sans source reconnue → kinds vide (pas d'exception)", async () => {
    const buf = await xlsxBuf("Divers", [{ Foo: 1, Bar: 2 }]);
    const r = await parseBuffer(buf, "divers.xlsx");
    expect(r.kinds).toEqual([]);
    expect(r.files[0].error).toBe("aucune source reconnue");
  });
});

describe("isSourceObject — filtre des objets du bucket", () => {
  it("accepte .xlsx / .xls / .zip à la racine", () => {
    expect(isSourceObject("export-pnl.xlsx")).toBe(true);
    expect(isSourceObject("data/lot.zip")).toBe(true);
    expect(isSourceObject("vieux.xls")).toBe(true);
  });
  it("rejette dossiers, temporaires, non-source et sous-dossiers de service", () => {
    expect(isSourceObject("dossier/")).toBe(false);
    expect(isSourceObject("~$brouillon.xlsx")).toBe(false);
    expect(isSourceObject("bc/BC123.pdf")).toBe(false);
    expect(isSourceObject("backups/2026/dump.xlsx")).toBe(false);
    expect(isSourceObject("exports/rapport.xlsx")).toBe(false);
    expect(isSourceObject("note.txt")).toBe(false);
  });
});

describe("reingestBucket — orchestration (bucket simulé)", () => {
  // Firestore minimal simulé : capture les set() et sert des lectures vides à `recomputeAll`
  // (collections sans docs, config docs → {}). Suffit à faire tourner le recompute sur base vide.
  function fakeDb() {
    const sets = [];
    const emptySnap = { docs: [], size: 0, empty: true, forEach: () => {} };
    const docSnap = { exists: false, data: () => ({}), get: () => undefined };
    const docRef = (path) => ({ path, get: async () => docSnap, set: async () => {} });
    const col = () => ({ where: () => col(), select: () => col(), orderBy: () => col(), limit: () => col(), doc: docRef, get: async () => emptySnap });
    return {
      sets,
      batch: () => { const ops = []; return { set: (ref, data) => ops.push({ ref, data }), delete: () => {}, commit: async () => { sets.push(...ops); } }; },
      doc: docRef,
      collection: col,
    };
  }
  function fakeStorage(objects) {
    return { bucket: () => ({ getFiles: async () => [objects.map(([name, buf]) => ({ name, download: async () => [buf] }))] }) };
  }

  it("ne re-parse que les sources, applique les écritures, remonte le rapport", async () => {
    const good = await xlsxBuf("P&L", [{ "Opp ID": "FP/2026/9", CAS: 50, "RAF TOTAL": 0, Customer: "Z" }]);
    const storage = fakeStorage([
      ["pnl.xlsx", good],
      ["backups/old.xlsx", good], // ignoré par le filtre de préfixe
      ["readme.txt", Buffer.from("x")], // ignoré (non-source)
    ]);
    const db = fakeDb();
    const r = await reingestBucket({ db, storage, bucketName: "nt360" });
    expect(r.objectsScanned).toBe(1); // seul pnl.xlsx passe le filtre
    expect(r.objectsIngested).toBe(1);
    expect(r.kinds).toEqual(["pnl"]);
    expect(db.sets.some((s) => s.ref.path === "orders/FP_2026_9")).toBe(true);
  });
});
