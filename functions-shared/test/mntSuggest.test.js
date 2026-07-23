import { describe, it, expect } from "vitest";
const { buildMntSuggestPrompt, normalizeMntSuggestions } = require("../domain/mntSuggest");

describe("mntSuggest — normalisation défensive des propositions IA", () => {
  const candidates = [
    { fp: "FP/2026/1", client: "ACME", bu: "ICT", am: "DATCHA", affaire: "Support applicatif annuel", cas: 5000 },
    { fp: "FP/2026/2", client: "BETA", bu: "CLOUD", am: "KOUADIO", affaire: "Migration one-shot", cas: 8000 },
    { fp: "FP/2026/3", client: "GAMMA", bu: "ICT", am: "DATCHA", affaire: "Infogérance", cas: 3000 },
  ];

  it("ne garde que isMaintenance=true, rapproché à un candidat réel, trié par confiance", () => {
    const parsed = { suggestions: [
      { fp: "FP/2026/2", isMaintenance: false, confidence: 0.9 },       // projet → écarté
      { fp: "FP/2026/1", isMaintenance: true, confidence: 0.7, reason: "récurrent" },
      { fp: "FP/2026/3", isMaintenance: true, confidence: 0.95, reason: "infogérance" },
    ] };
    const out = normalizeMntSuggestions(parsed, candidates);
    expect(out.map((s) => s.fp)).toEqual(["FP/2026/3", "FP/2026/1"]); // confiance décroissante
    expect(out[0].client).toBe("GAMMA");
  });

  it("rejette un fp halluciné (absent du lot)", () => {
    const parsed = { suggestions: [{ fp: "FP/9999/9", isMaintenance: true, confidence: 0.99 }] };
    expect(normalizeMntSuggestions(parsed, candidates)).toEqual([]);
  });

  it("rejette une confiance illisible (jamais fabriquée) et borne [0,1]", () => {
    const parsed = { suggestions: [
      { fp: "FP/2026/1", isMaintenance: true, confidence: "n/a" },   // illisible → tombe
      { fp: "FP/2026/3", isMaintenance: true, confidence: 1.8 },     // borné à 1
    ] };
    const out = normalizeMntSuggestions(parsed, candidates);
    expect(out).toHaveLength(1);
    expect(out[0].fp).toBe("FP/2026/3");
    expect(out[0].confidence).toBe(1);
  });

  it("valide l'échéance contre l'énumération ERP (invalide → null)", () => {
    const parsed = { suggestions: [
      { fp: "FP/2026/1", isMaintenance: true, confidence: 0.6, echeance: "annuel" },
      { fp: "FP/2026/3", isMaintenance: true, confidence: 0.5, echeance: "hebdomadaire" }, // hors énum → null
    ] };
    const out = normalizeMntSuggestions(parsed, candidates);
    const byFp = Object.fromEntries(out.map((s) => [s.fp, s]));
    expect(byFp["FP/2026/1"].echeance).toBe("annuel");
    expect(byFp["FP/2026/3"].echeance).toBeNull();
  });

  it("dé-doublonne par FP CANONIQUE (fp reformaté rapproché ; on garde le plus confiant)", () => {
    const parsed = { suggestions: [
      { fp: "FP/2026/0001", isMaintenance: true, confidence: 0.4 }, // même affaire, format différent
      { fp: "FP/2026/1", isMaintenance: true, confidence: 0.8 },
    ] };
    const out = normalizeMntSuggestions(parsed, candidates);
    expect(out).toHaveLength(1);
    expect(out[0].confidence).toBe(0.8); // on garde la proposition la plus confiante des deux
  });

  it("le prompt couvre chaque candidat et n'expose que la liste blanche de champs", () => {
    const { system, user } = buildMntSuggestPrompt(candidates);
    expect(system).toMatch(/maintenance/i);
    expect(user).toContain("FP/2026/1");
    expect(user).toContain("FP/2026/3");
    expect(user).not.toMatch(/mot de passe|secret/i);
  });
});
