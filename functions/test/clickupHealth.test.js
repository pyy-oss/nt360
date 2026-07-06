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
});
