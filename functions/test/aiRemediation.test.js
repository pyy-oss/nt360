import { describe, it, expect } from "vitest";
const { planLines, buildRemediationPrompt, normalizeSynthesis } = require("../domain/aiRemediation");

describe("aiRemediation — synthèse « par où commencer » (domain pur)", () => {
  const plan = {
    rows: [
      { type: "surfacturation", label: "Surfacturation", severity: "high", count: 3, impact: 5_000_000, estimated: false },
      { type: "opps_fantomes", label: "Opps fantômes", severity: "low", count: 12, impact: 0, estimated: true },
      { type: "vide", label: "Vide", severity: "medium", count: 0, impact: 100, estimated: false },
    ],
    totalImpact: 5_000_000, totalCount: 15,
  };

  it("planLines : écarte les lignes à 0 à traiter et borne/arrondit les nombres", () => {
    const lines = planLines(plan);
    expect(lines.map((l) => l.type)).toEqual(["surfacturation", "opps_fantomes"]); // "vide" (count 0) exclu
    expect(lines[0]).toMatchObject({ severity: "high", count: 3, impact: 5_000_000 });
  });

  it("buildRemediationPrompt : cite les types/chiffres fournis et impose le JSON de sortie", () => {
    const p = buildRemediationPrompt(plan);
    expect(p).toContain('type="surfacturation"');
    expect(p).toContain("impact cumulé ≈ 5000000 FCFA");
    expect(p).toContain('{"headline"'); // consigne de format
    expect(p).not.toContain('type="vide"'); // ligne à 0 non transmise
  });

  it("normalizeSynthesis : ne garde que les types du plan, déduplique et borne à 6 étapes", () => {
    const valid = new Set(["surfacturation", "opps_fantomes"]);
    const parsed = {
      headline: "Commencez par la surfacturation.",
      steps: [
        { type: "surfacturation", why: "impact FCFA le plus fort" },
        { type: "surfacturation", why: "doublon — écarté" },          // dédupliqué
        { type: "INVENTÉ", why: "type absent du plan — écarté" },      // type inconnu
        { type: "opps_fantomes", why: "volume, effort faible" },
        { type: "surfacturation", why: "" },                            // why vide — ignoré
      ],
    };
    const out = normalizeSynthesis(parsed, valid);
    expect(out.headline).toBe("Commencez par la surfacturation.");
    expect(out.steps.map((s) => s.type)).toEqual(["surfacturation", "opps_fantomes"]);
  });

  it("normalizeSynthesis : robuste à une réponse vide/malformée", () => {
    expect(normalizeSynthesis(null, new Set())).toEqual({ headline: "", steps: [] });
    expect(normalizeSynthesis({ steps: "pas un tableau" }, ["x"])).toEqual({ headline: "", steps: [] });
  });
});
