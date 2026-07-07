import { describe, it, expect } from "vitest";
const { resolveAssignee, retryDelay, updateTask } = require("../lib/clickup");

describe("retryDelay — back-off des ré-essais", () => {
  it("priorité à Retry-After (secondes → ms, borné 120 s — cf. audit intégral C2)", () => {
    expect(retryDelay(0, "2")).toBe(2000);
    expect(retryDelay(5, "60")).toBe(60000);   // honoré tel quel (< cap)
    expect(retryDelay(5, "300")).toBe(120000); // borné à 120 s
  });
  it("exponentiel 500 ms × 2^tentative, borné à 8 s, sans Retry-After", () => {
    expect(retryDelay(0)).toBe(500);
    expect(retryDelay(1)).toBe(1000);
    expect(retryDelay(2)).toBe(2000);
    expect(retryDelay(10)).toBe(8000); // borné
  });
  it("Retry-After non numérique → repli exponentiel", () => {
    expect(retryDelay(1, "")).toBe(1000);
    expect(retryDelay(1, null)).toBe(1000);
  });
});

const members = [
  { id: 1, username: "KOUADIO KOFFI PHILIPPE LANDRY", email: "klandry@neuronestech.com" },
  { id: 2, username: "MIREILLE KOUADIO", email: "mkouadio@ops-neuronestech.com" },
  { id: 3, username: "Serge Djedje", email: "sdjedje@neuronestech.com" },
];

describe("resolveAssignee — PM (chaîne libre) → membre ClickUp", () => {
  it("email exact", () => expect(resolveAssignee(members, "klandry@neuronestech.com")).toBe(1));
  it("nom exact (insensible à la casse)", () => expect(resolveAssignee(members, "serge djedje")).toBe(3));
  it("inclusion", () => expect(resolveAssignee(members, "Mireille")).toBe(2));
  it("aucune correspondance → null", () => expect(resolveAssignee(members, "Inconnu X")).toBe(null));
  it("vide → null", () => expect(resolveAssignee(members, "")).toBe(null));
  it("inclusion AMBIGUË (2 candidats) → null, pas d'assignation au petit bonheur", () => {
    const two = [{ id: 11, username: "Marie Curie", email: "mc@x.com" }, { id: 22, username: "Marie Dupont", email: "md@x.com" }];
    expect(resolveAssignee(two, "Marie")).toBe(null); // « Marie » ⊂ deux usernames → refus
  });
  it("inclusion NON ambiguë (1 seul candidat) → résolu", () => {
    const one = [{ id: 11, username: "Marie Curie", email: "mc@x.com" }, { id: 22, username: "Paul", email: "p@x.com" }];
    expect(resolveAssignee(one, "Marie")).toBe(11);
  });
});

describe("updateTask — assignés au format {add, rem}", () => {
  it("transforme assignees[] en {add} et retire les anciens (rem)", async () => {
    const bodies = [];
    const orig = globalThis.fetch;
    globalThis.fetch = async (_url, opts) => { bodies.push(JSON.parse(opts.body)); return { ok: true, text: async () => "{}" }; };
    try {
      await updateTask("tok", "task1", { name: "X", assignees: [7] }, [3, 7, 9]); // 7 = nouveau (exclu de rem)
      expect(bodies[0].assignees).toEqual({ add: [7], rem: [3, 9] });
      expect(bodies[0].name).toBe("X");
      bodies.length = 0;
      await updateTask("tok", "task1", { name: "Y" }); // pas d'assigné → pas de patch assignees
      expect(bodies[0].assignees).toBeUndefined();
    } finally { globalThis.fetch = orig; }
  });
});
