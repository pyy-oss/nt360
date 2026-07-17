import { describe, it, expect } from "vitest";
const { dedupOppsByFp } = require("../domain/oppPipeline");

const ts = (ms) => ({ toMillis: () => ms });

describe("dedupOppsByFp — dédup famille pipeline (parité aggregate.js)", () => {
  it("intra-source salesData : garde le PLUS RÉCENT par FP", () => {
    const opps = [
      { id: "a", source: "salesData", fp: "FP/2026/1", updatedAt: ts(100) },
      { id: "b", source: "salesData", fp: "FP/2026/1", updatedAt: ts(200) }, // plus récent → gagne
      { id: "c", source: "salesData", fp: "FP/2026/2", updatedAt: ts(50) },
    ];
    expect(dedupOppsByFp(opps).map((o) => o.id).sort()).toEqual(["b", "c"]);
  });

  it("inter-source : une 'saisie' dont le FP est couvert par une 'salesData' est écartée", () => {
    const opps = [
      { id: "s", source: "salesData", fp: "FP/2026/1", updatedAt: ts(10) },
      { id: "m", source: "saisie", fp: "FP/2026/1", updatedAt: ts(999) }, // même FP → écartée malgré updatedAt
    ];
    expect(dedupOppsByFp(opps).map((o) => o.id)).toEqual(["s"]);
  });

  it("une 'saisie' à FP non couvert par salesData est conservée", () => {
    const opps = [
      { id: "s", source: "salesData", fp: "FP/2026/1" },
      { id: "m", source: "saisie", fp: "FP/2026/9" },
    ];
    expect(dedupOppsByFp(opps).map((o) => o.id).sort()).toEqual(["m", "s"]);
  });

  it("FP absent/non canonique : rien à rapprocher, tout est conservé", () => {
    const opps = [
      { id: "a", source: "saisie", fp: null },
      { id: "b", source: "saisie", fp: "" },
      { id: "c", source: "salesData", fp: "FP/0000/0" }, // placeholder rejeté par fpKey
    ];
    expect(dedupOppsByFp(opps).map((o) => o.id).sort()).toEqual(["a", "b", "c"]);
  });

  it("rapproche via fpKey (zéros de tête / casse normalisés), pas par FP brut", () => {
    const opps = [
      { id: "s", source: "salesData", fp: "fp/2026/007", updatedAt: ts(1) },
      { id: "m", source: "saisie", fp: "FP/2026/7" }, // même clé canonique → écartée
    ];
    expect(dedupOppsByFp(opps).map((o) => o.id)).toEqual(["s"]);
  });

  it("liste vide/nulle → []", () => {
    expect(dedupOppsByFp([])).toEqual([]);
    expect(dedupOppsByFp(null)).toEqual([]);
  });
});
