import { describe, it, expect } from "vitest";
const { buildClientNormPrompt, normalizeClientMergeSuggestions } = require("../domain/aiClientNorm");

describe("aiClientNorm — normalisation défensive des fusions IA", () => {
  const names = [
    { name: "WITTI FINANCE", count: 3 },
    { name: "WITTI FINANCES", count: 12 },
    { name: "NSIA ASSURANCE", count: 5 },
    { name: "NSIA ASSURANCES", count: 40 },
    { name: "ORANGE", count: 100 },
  ];

  it("garde les fusions dont le `from` est réel, rapproche vers la cible, trie par confiance", () => {
    const parsed = { merges: [
      { from: "WITTI FINANCE", to: "WITTI FINANCES", confidence: 0.95, reason: "pluriel" },
      { from: "NSIA ASSURANCE", to: "NSIA ASSURANCES", confidence: 0.8, reason: "pluriel" },
    ] };
    const out = normalizeClientMergeSuggestions(parsed, names);
    expect(out.map((s) => s.from)).toEqual(["WITTI FINANCE", "NSIA ASSURANCE"]); // confiance décroissante
    expect(out[0].existingTarget).toBe(true); // "WITTI FINANCES" est dans l'inventaire
  });

  it("rejette un `from` halluciné (absent de l'inventaire)", () => {
    const parsed = { merges: [{ from: "SOCIETE INCONNUE", to: "ORANGE", confidence: 0.99 }] };
    expect(normalizeClientMergeSuggestions(parsed, names)).toEqual([]);
  });

  it("écarte un no-op : from et to canoniquement identiques (déjà fusionnés par les règles)", () => {
    // "WITTI FINANCE SA" et "WITTI FINANCE" → même canonicalKey (SA retiré) → aucune fusion à proposer.
    const n2 = [{ name: "WITTI FINANCE SA", count: 1 }, { name: "WITTI FINANCE", count: 2 }];
    const parsed = { merges: [{ from: "WITTI FINANCE SA", to: "WITTI FINANCE", confidence: 0.9 }] };
    expect(normalizeClientMergeSuggestions(parsed, n2)).toEqual([]);
  });

  it("rejette une confiance illisible ; borne [0,1]", () => {
    const parsed = { merges: [
      { from: "WITTI FINANCE", to: "WITTI FINANCES", confidence: "n/a" },
      { from: "NSIA ASSURANCE", to: "NSIA ASSURANCES", confidence: 1.5 },
    ] };
    const out = normalizeClientMergeSuggestions(parsed, names);
    expect(out).toHaveLength(1);
    expect(out[0].from).toBe("NSIA ASSURANCE");
    expect(out[0].confidence).toBe(1);
  });

  it("marque `existingTarget=false` quand la cible est une graphie CORRIGÉE absente de l'inventaire", () => {
    const parsed = { merges: [{ from: "WITTI FINANCE", to: "WITTI FINANCES SARL", confidence: 0.7, reason: "forme corrigée" }] };
    const out = normalizeClientMergeSuggestions(parsed, names);
    // "WITTI FINANCES SARL" ≠ canonicalKey("WITTI FINANCE") (SARL retiré → "WITTI FINANCES" ≠ "WITTI FINANCE"),
    // donc la paire tient et la cible est marquée corrigée (absente de l'inventaire brut).
    expect(out).toHaveLength(1);
    expect(out[0].existingTarget).toBe(false);
  });

  it("dé-doublonne par `from` canonique (garde la plus confiante)", () => {
    const parsed = { merges: [
      { from: "WITTI FINANCE", to: "WITTI FINANCES", confidence: 0.6 },
      { from: "WITTI FINANCE", to: "WITTI FINANCES", confidence: 0.92 },
    ] };
    const out = normalizeClientMergeSuggestions(parsed, names);
    expect(out).toHaveLength(1);
    expect(out[0].confidence).toBe(0.92);
  });

  it("le prompt couvre les graphies et n'expose que le nécessaire", () => {
    const { system, user } = buildClientNormPrompt(names);
    expect(system).toMatch(/normaliser/i);
    expect(user).toContain("WITTI FINANCES");
    expect(user).toContain("ORANGE");
  });
});
