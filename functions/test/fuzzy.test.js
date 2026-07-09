import { describe, it, expect } from "vitest";
const { levenshtein, similarity, findFuzzyDuplicates } = require("../domain/fuzzy");

describe("levenshtein", () => {
  it("distance d'édition", () => {
    expect(levenshtein("chat", "chat")).toBe(0);
    expect(levenshtein("chat", "chats")).toBe(1);
    expect(levenshtein("orange", "orenge")).toBe(1);
    expect(levenshtein("", "abc")).toBe(3);
  });
});

describe("similarity ∈ [0,1]", () => {
  it("1 pour identique, proche pour typo", () => {
    expect(similarity("ORANGE", "ORANGE")).toBe(1);
    expect(similarity("ORANGE CI", "ORANGE CY")).toBeGreaterThan(0.85);
    expect(similarity("ORANGE", "MTN")).toBeLessThan(0.4);
  });
  it("deux vides → 1", () => {
    expect(similarity("", "")).toBe(1);
  });
});

describe("findFuzzyDuplicates", () => {
  it("repère les quasi-doublons (typo / casse / espaces), pas les identiques", () => {
    const pairs = findFuzzyDuplicates(["Orange CI", "Orange CY", "orange ci", "MTN", "Moov"]);
    // « Orange CI » vs « Orange CY » = typo ; « orange ci » identique à « Orange CI » (casse) → écarté (score 1).
    const keys = pairs.map((p) => [p.a.toUpperCase(), p.b.toUpperCase()].sort().join("|"));
    expect(keys).toContain(["ORANGE CI", "ORANGE CY"].sort().join("|"));
    expect(pairs.every((p) => p.score < 1)).toBe(true);
    // MTN / Moov trop éloignés → absents.
    expect(keys.some((k) => k.includes("MTN") && k.includes("MOOV"))).toBe(false);
  });
  it("trie par score décroissant et borne le résultat", () => {
    const pairs = findFuzzyDuplicates(["ABCDE", "ABCDF", "ABCDX", "ZZZZZ"]);
    for (let i = 1; i < pairs.length; i++) expect(pairs[i - 1].score).toBeGreaterThanOrEqual(pairs[i].score);
  });
  it("liste vide → []", () => {
    expect(findFuzzyDuplicates([])).toEqual([]);
  });
});
