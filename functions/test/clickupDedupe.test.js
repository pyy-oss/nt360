import { describe, it, expect } from "vitest";
const { planDedupe } = require("../domain/clickupDedupe");

const T = (id, fp, ms) => ({ id, fp, dateCreatedMs: ms });

describe("planDedupe — nettoyage des tâches ClickUp dupliquées", () => {
  it("aucun doublon → rien à faire", () => {
    const r = planDedupe([T("a", "FP/2026/1", 100), T("b", "FP/2026/2", 100)], [], 0);
    expect(r.groups).toEqual([]);
    expect(r.duplicates).toBe(0);
    expect(r.deletable).toBe(0);
  });

  it("3 tâches même FP, aucune liée → garde la PLUS ANCIENNE, supprime les 2 autres", () => {
    const r = planDedupe([T("new1", "FP/2026/1", 300), T("old", "FP/2026/1", 100), T("new2", "FP/2026/1", 200)], [], 0);
    expect(r.duplicates).toBe(2);
    expect(r.groups).toHaveLength(1);
    expect(r.groups[0].keepId).toBe("old");
    expect(r.groups[0].deleteIds.sort()).toEqual(["new1", "new2"]);
  });

  it("conserve la tâche LIÉE (config/clickupLinks) même si plus récente", () => {
    const r = planDedupe([T("old", "FP/2026/1", 100), T("linked", "FP/2026/1", 300)], new Set(["linked"]), 0);
    expect(r.groups[0].keepId).toBe("linked");
    expect(r.groups[0].deleteIds).toEqual(["old"]);
  });

  it("fenêtre sinceMs : ne supprime QUE les doublons créés après le seuil", () => {
    // old (t=100) = gardé (plus ancien) ; dupOld (t=150 < seuil 200) préservé ; dupNew (t=300) supprimé.
    const r = planDedupe([T("old", "FP/2026/1", 100), T("dupOld", "FP/2026/1", 150), T("dupNew", "FP/2026/1", 300)], [], 200);
    expect(r.groups[0].keepId).toBe("old");
    expect(r.groups[0].deleteIds).toEqual(["dupNew"]); // dupOld hors fenêtre → préservé
    expect(r.deletable).toBe(1);
  });

  it("groupe dupliqué mais tout hors fenêtre → aucun groupe à traiter", () => {
    const r = planDedupe([T("a", "FP/2026/1", 100), T("b", "FP/2026/1", 150)], [], 500);
    expect(r.groups).toEqual([]);
    expect(r.duplicates).toBe(1); // compté comme doublon…
    expect(r.deletable).toBe(0);  // …mais rien de supprimable dans la fenêtre
  });

  it("tâches sans FP ignorées", () => {
    const r = planDedupe([T("a", "", 100), T("b", null, 200), T("c", "FP/2026/1", 100)], [], 0);
    expect(r.groups).toEqual([]);
  });
});
