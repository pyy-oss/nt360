import { describe, it, expect } from "vitest";
const { evaluateAutomations, matches, AUTOMATION_TYPES } = require("../domain/automation");

const OPPS = [
  { id: "o1", client: "ORANGE", stage: 3, nextStep: "", ownerUid: "alice" },      // sans prochaine action
  { id: "o2", client: "MTN", stage: 3, nextStep: "Relancer lundi", ownerUid: "bob" }, // a une action → exclue
  { id: "o3", client: "SONATEL", stage: 6, nextStep: "", ownerUid: "a" },          // gagnée → hors 1..5
  { id: "o4", client: "CIE", stage: 2, nextStep: "", stale: true },                // dormante
];

describe("matches — prédicats d'éligibilité", () => {
  it("opp_no_nextstep : ouverte (1..5) sans prochaine action et non dormante", () => {
    expect(matches("opp_no_nextstep", OPPS[0])).toBe(true);
    expect(matches("opp_no_nextstep", OPPS[1])).toBe(false); // a une action
    expect(matches("opp_no_nextstep", OPPS[2])).toBe(false); // stage 6
    expect(matches("opp_no_nextstep", OPPS[3])).toBe(false); // dormante
  });
  it("opp_stale : uniquement les dormantes", () => {
    expect(matches("opp_stale", OPPS[3])).toBe(true);
    expect(matches("opp_stale", OPPS[0])).toBe(false);
  });
});

describe("evaluateAutomations — génération idempotente de tâches", () => {
  const rules = [{ type: "opp_no_nextstep", enabled: true, dueInDays: 5 }, { type: "opp_stale", enabled: true }];
  it("génère une tâche par opportunité éligible et par règle active", () => {
    const out = evaluateAutomations(rules, OPPS, new Set());
    const keys = out.map((t) => t.autoKey).sort();
    expect(keys).toEqual(["opp_no_nextstep:o1", "opp_stale:o4"]);
    expect(out.find((t) => t.autoKey === "opp_no_nextstep:o1").ownerUid).toBe("alice");
    expect(out.find((t) => t.autoKey === "opp_no_nextstep:o1").dueInDays).toBe(5);
  });
  it("n'inclut PAS les clés déjà existantes (idempotence)", () => {
    const out = evaluateAutomations(rules, OPPS, new Set(["opp_no_nextstep:o1"]));
    expect(out.map((t) => t.autoKey)).toEqual(["opp_stale:o4"]);
  });
  it("ignore les règles désactivées ou de type inconnu", () => {
    expect(evaluateAutomations([{ type: "opp_no_nextstep", enabled: false }], OPPS, new Set())).toHaveLength(0);
    expect(evaluateAutomations([{ type: "inconnu", enabled: true }], OPPS, new Set())).toHaveLength(0);
  });
  it("dueInDays par défaut = 7 si absent/invalide", () => {
    const out = evaluateAutomations([{ type: "opp_stale", enabled: true }], OPPS, new Set());
    expect(out[0].dueInDays).toBe(7);
  });
  it("expose les 2 types déclaratifs", () => {
    expect(Object.keys(AUTOMATION_TYPES)).toEqual(["opp_no_nextstep", "opp_stale"]);
  });
});
