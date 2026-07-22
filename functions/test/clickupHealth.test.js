import { describe, it, expect } from "vitest";
const { clickupHealth, taskNumField } = require("../domain/clickupHealth");

const fpKey = (s) => String(s || "").trim().toLowerCase();
const safeId = (s) => String(s || "").replace(/[^a-z0-9]/gi, "_");
const lkey = (fp) => safeId(fpKey(fp)); // clé des overlays = safeId(fpKey(fp)), comme en prod

const tasks = [
  { id: "t1", name: "MTN - A", custom_fields: [{ name: "Opp ID", value: "FP/1" }, { name: "CA Facturé", value: 500 }] }, // liée FP/1
  { id: "t2", name: "Orphan", custom_fields: [{ name: "Opp ID", value: "FP/999" }] },                                    // FP inconnu → orpheline
  { id: "t3", name: "SansFP", custom_fields: [{ name: "AM", value: "x" }] },                                             // pas d'Opp ID → orpheline
];

describe("taskNumField", () => {
  it("lit un champ numérique par nom (0 si absent)", () => {
    expect(taskNumField(tasks[0], "CA Facturé")).toBe(500);
    expect(taskNumField(tasks[1], "CA Facturé")).toBe(0);
  });
});

describe("clickupHealth — diagnostic de couverture", () => {
  const orders = [
    { fp: "FP/1", client: "MTN", facture: 500 }, // liée, CAF aligné
    { fp: "FP/2", client: "SGCI", facture: 0 },  // non liée, tâche existante ? non → pas rattachable
    { fp: "FP/3", client: "BACI", facture: 100 },// non liée mais tâche existe (Opp ID FP/3) → rattachable
  ];
  const tasks2 = [...tasks, { id: "t4", name: "BACI", custom_fields: [{ name: "Opp ID", value: "FP/3" }] }];
  const links = { [lkey("FP/1")]: "t1" };
  const syncMap = { [lkey("FP/1")]: { status: "3-en cours" } };

  it("éligibilité DC : sans prédicat, tout est éligible (rétro-compatible)", () => {
    const h = clickupHealth(orders, tasks2, links, syncMap, fpKey, safeId);
    expect(h.unlinkedNoDc).toBe(0);
    expect(h.unlinkedEligible).toBe(2);
  });
  it("éligibilité DC : une non-liée sans DC lié n'est pas créable (ADR-079)", () => {
    // FP/2 a un DC, FP/3 non → 1 éligible, 1 non éligible parmi les 2 non liées.
    const hasDc = (fp) => fp === fpKey("FP/2");
    const h = clickupHealth(orders, tasks2, links, syncMap, fpKey, safeId, hasDc);
    expect(h.unlinked).toBe(2);
    expect(h.unlinkedNoDc).toBe(1);   // FP/3
    expect(h.unlinkedEligible).toBe(1); // FP/2
    expect(h.unlinkedSample.find((u) => u.fp === "FP/2").hasDc).toBe(true);
    expect(h.unlinkedSample.find((u) => u.fp === "FP/3").hasDc).toBe(false);
  });

  it("couverture, non liées, rattachables, orphelines", () => {
    const h = clickupHealth(orders, tasks2, links, syncMap, fpKey, safeId);
    expect(h.commandesTotal).toBe(3);
    expect(h.linked).toBe(1);
    expect(h.unlinked).toBe(2);
    expect(h.unlinkedMatchable).toBe(1); // FP/3
    expect(h.synced).toBe(1);
    expect(h.coverage).toBe(33);
    expect(h.orphanTasks).toBe(2); // t2 (FP/999) + t3 (sans FP)
    expect(h.tasksWithFp).toBe(3); // t1, t2, t4
  });

  it("écart CAF détecté quand le CAF app diffère de la tâche", () => {
    const o2 = [{ fp: "FP/1", client: "MTN", facture: 800 }]; // app 800 vs tâche 500 → écart 300
    const h = clickupHealth(o2, tasks, { [lkey("FP/1")]: "t1" }, {}, fpKey, safeId);
    expect(h.cafGapCount).toBe(1);
    expect(h.cafGapTotal).toBe(300);
  });

  it("liens fantômes : lien vers une tâche absente du scan (supprimée/déplacée) → dérive signalée", () => {
    // Deux liens : FP/1 → t1 (présente), FP/9 → t99 (absente du scan) → 1 lien fantôme.
    const links2 = { [lkey("FP/1")]: "t1", [lkey("FP/9")]: "t99" };
    const h = clickupHealth([{ fp: "FP/1" }], tasks, links2, {}, fpKey, safeId);
    expect(h.phantomLinks).toBe(1);
    expect(h.phantomSample).toEqual([{ ref: lkey("FP/9"), taskId: "t99" }]);
  });

  it("aucun lien fantôme quand toutes les tâches liées existent", () => {
    const h = clickupHealth([{ fp: "FP/1" }], tasks, { [lkey("FP/1")]: "t1" }, {}, fpKey, safeId);
    expect(h.phantomLinks).toBe(0);
  });

  it("doublons rendus visibles : compte les tâches surnuméraires par FP", () => {
    // FP/1 porté par 3 tâches, FP/2 par 2 → 2 + 1 = 3 tâches surnuméraires, sur 2 FP en double.
    const dupTasks = [
      { id: "a1", custom_fields: [{ name: "Opp ID", value: "FP/1" }] },
      { id: "a2", custom_fields: [{ name: "Opp ID", value: "FP/1" }] },
      { id: "a3", custom_fields: [{ name: "Opp ID", value: "FP/1" }] },
      { id: "b1", custom_fields: [{ name: "Opp ID", value: "FP/2" }] },
      { id: "b2", custom_fields: [{ name: "Opp ID", value: "FP/2" }] },
      { id: "c1", custom_fields: [{ name: "Opp ID", value: "FP/3" }] }, // unique
    ];
    const h = clickupHealth([{ fp: "FP/1" }, { fp: "FP/2" }, { fp: "FP/3" }], dupTasks, {}, {}, fpKey, safeId);
    expect(h.duplicateTasks).toBe(3);
    expect(h.duplicateFps).toBe(2);
    expect(h.duplicateSample.map((d) => d.fp).sort()).toEqual(["fp/1", "fp/2"]);
  });
});
