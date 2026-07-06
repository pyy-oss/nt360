import { describe, it, expect } from "vitest";
const { diffCaf } = require("../lib/clickupCaf");

const links = { a: "task_a", b: "task_b", c: "task_c" };

describe("diffCaf — ne pousse que les CAF changés (sauf forcé)", () => {
  it("pousse uniquement les clés dont le CAF diffère du dernier envoi", () => {
    const last = { a: 100, b: 200, c: 300 };
    const caf = { a: 100, b: 250, c: 300 }; // seul b a changé
    const { toPush, nextMap, skipped } = diffCaf(links, last, caf, false);
    expect(toPush).toEqual([{ key: "b", taskId: "task_b", caf: 250 }]);
    expect(skipped).toBe(2);
    expect(nextMap).toEqual({ a: 100, c: 300 }); // inchangés pré-remplis ; b posé après succès
  });
  it("force=true pousse toutes les tâches liées", () => {
    const { toPush, skipped } = diffCaf(links, { a: 100 }, { a: 100, b: 5 }, true);
    expect(toPush.map((t) => t.key).sort()).toEqual(["a", "b", "c"]);
    expect(skipped).toBe(0);
  });
  it("CAF manquant → 0 (une commande sans facture n'est poussée que si 0 ≠ dernier)", () => {
    const { toPush } = diffCaf({ a: "task_a" }, { a: 40 }, {}, false);
    expect(toPush).toEqual([{ key: "a", taskId: "task_a", caf: 0 }]);
  });
  it("aucun lien → rien à pousser", () => {
    const { toPush, nextMap, skipped } = diffCaf({}, {}, {}, false);
    expect(toPush).toEqual([]); expect(nextMap).toEqual({}); expect(skipped).toBe(0);
  });
});
