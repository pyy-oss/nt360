import { describe, it, expect } from "vitest";
const { resolveAssignee, taskPayload } = require("../lib/clickup");

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
});

describe("taskPayload — commande → tâche", () => {
  it("nom = FP — client ; assigné inclus si résolu", () => {
    const p = taskPayload({ fp: "FP/2026/1", client: "MTN CI", designation: "Refonte", bu: "ICT", cas: 1000000, pm: "Serge" }, 3);
    expect(p.name).toBe("FP/2026/1 — MTN CI");
    expect(p.assignees).toEqual([3]);
    expect(p.description).toContain("Refonte");
    expect(p.description).toContain("XOF");
    expect(p.description.replace(/\s/g, "")).toContain("1000000XOF");
  });
  it("sans assigné → pas de champ assignees", () => {
    const p = taskPayload({ fp: "FP/2026/2", client: "X" }, null);
    expect(p.assignees).toBeUndefined();
  });
});
