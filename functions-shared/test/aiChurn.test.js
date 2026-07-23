import { describe, it, expect } from "vitest";
const { buildChurnPrompt, normalizeChurnAnalysis } = require("../domain/aiChurn");

describe("aiChurn — normalisation défensive de l'analyse de rétention", () => {
  const contrats = [
    { fp: "FP/2026/1", client: "ACME", niveau: "rouge", signals: ["sla_rompu"], joursEcheance: 20, ticketsOuverts: 4, slaBreaches: 2 },
    { fp: "FP/2026/2", client: "BETA", niveau: "ambre", signals: ["sous_facturation"], joursEcheance: 80, ticketsOuverts: 1, slaBreaches: 0 },
  ];

  it("garde les analyses au fp réel, trie par risque (élevé d'abord)", () => {
    const parsed = { analyses: [
      { fp: "FP/2026/2", churnRisk: "moyen", drivers: ["sous-facturation"], recommendation: "revue de service" },
      { fp: "FP/2026/1", churnRisk: "eleve", drivers: ["SLA rompus", "échéance proche"], recommendation: "plan de remédiation" },
    ] };
    const out = normalizeChurnAnalysis(parsed, contrats);
    expect(out.map((a) => a.fp)).toEqual(["FP/2026/1", "FP/2026/2"]); // élevé avant moyen
    expect(out[0].client).toBe("ACME");
    expect(out[0].drivers).toEqual(["SLA rompus", "échéance proche"]);
  });

  it("rejette un fp halluciné et un churnRisk hors énumération", () => {
    const parsed = { analyses: [
      { fp: "FP/9999/9", churnRisk: "eleve" },              // halluciné
      { fp: "FP/2026/1", churnRisk: "catastrophique" },     // hors énum
    ] };
    expect(normalizeChurnAnalysis(parsed, contrats)).toEqual([]);
  });

  it("borne drivers (≤ 5) et tronque la recommandation", () => {
    const parsed = { analyses: [{ fp: "FP/2026/1", churnRisk: "faible", drivers: Array(10).fill("x"), recommendation: "y".repeat(500) }] };
    const out = normalizeChurnAnalysis(parsed, contrats);
    expect(out[0].drivers.length).toBe(5);
    expect(out[0].recommendation.length).toBe(300);
  });

  it("dé-doublonne par fp canonique", () => {
    const parsed = { analyses: [
      { fp: "FP/2026/0001", churnRisk: "moyen" },
      { fp: "FP/2026/1", churnRisk: "eleve" },
    ] };
    expect(normalizeChurnAnalysis(parsed, contrats)).toHaveLength(1);
  });

  it("le prompt couvre chaque fp", () => {
    const { system, user } = buildChurnPrompt(contrats);
    expect(system).toMatch(/renouvellement|churn/i);
    expect(user).toContain("FP/2026/1");
    expect(user).toContain("FP/2026/2");
  });
});
