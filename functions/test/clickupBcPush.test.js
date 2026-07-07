import { describe, it, expect } from "vitest";
const { pushBcCore } = require("../lib/clickupBcPush");
const bc = require("../lib/clickupBc");
const { safeId } = require("../lib/sheets");

const bcFieldDefs = [
  { id: "F_FRN", name: "Fournisseur", type: "short_text", type_config: {} },
  { id: "F_NUM", name: "Numéro de Commande", type: "short_text", type_config: {} },
  { id: "F_MNT", name: "Montant Total de la Commande", type: "currency", type_config: {} },
  { id: "F_OPP", name: "Opp ID", type: "short_text", type_config: {} },
];

function fakeClient(over = {}) {
  const calls = { create: [], update: [], setField: [] };
  const clickup = {
    createTask: async (_t, listId, payload) => { calls.create.push({ listId, payload }); return { id: "newbc", url: "u" }; },
    updateTask: async (_t, taskId, payload) => { calls.update.push({ taskId, payload }); return {}; },
    setField: async (_t, _id, fieldId, value) => { calls.setField.push({ fieldId, value }); },
    ...over,
  };
  return { clickup, calls };
}

const group = (over = {}) => bc.groupBcByNumber([{ id: "a", bcNumber: "BC-1", supplier: "CISCO", fp: "FP/2026/1", amount: 100, ...over }], safeId)[0];

describe("pushBcCore — orchestration create/update BC", () => {
  it("CRÉATION : statut placee distributeur, champs DANS le payload de création, created=true (C3)", async () => {
    const { clickup, calls } = fakeClient();
    const r = await pushBcCore({ token: "t", clickup, listId: "L", fieldDefs: bcFieldDefs, links: {}, group: group(), extra: {} });
    expect(r.created).toBe(true);
    expect(calls.create[0].payload.status).toBe("placee distributeur");
    // C3 : champs posés atomiquement à la création (pas via setField) → tâche née identifiable.
    expect((calls.create[0].payload.custom_fields || []).map((c) => c.id).sort()).toEqual(["F_FRN", "F_MNT", "F_NUM", "F_OPP"]);
    expect(calls.setField.length).toBe(0);
    expect(r.taskId).toBe("newbc");
  });

  it("MISE À JOUR : ne pose pas de statut initial ; champs via setField sur la tâche liée", async () => {
    const { clickup, calls } = fakeClient();
    const g = group();
    const r = await pushBcCore({ token: "t", clickup, listId: "L", fieldDefs: bcFieldDefs, links: { [g.key]: "task9" }, group: g, extra: {} });
    expect(r.created).toBe(false);
    expect(calls.create.length).toBe(0);
    expect(calls.update[0].taskId).toBe("task9");
    expect(calls.update[0].payload.status).toBeUndefined(); // avancement achat piloté dans ClickUp
    expect(calls.setField.map((s) => s.fieldId).sort()).toEqual(["F_FRN", "F_MNT", "F_NUM", "F_OPP"]);
  });

  it("MISE À JOUR — setField best-effort : un champ en échec ne casse pas le push (lien déjà présent)", async () => {
    const { clickup } = fakeClient({ setField: async () => { throw new Error("boom"); } });
    const g = group();
    const r = await pushBcCore({ token: "t", clickup, listId: "L", fieldDefs: bcFieldDefs, links: { [g.key]: "task2" }, group: g, extra: {} });
    expect(r.created).toBe(false);
    expect(r.taskId).toBe("task2");
  });

  it("statut initial validé : absent de la liste → omis, création quand même", async () => {
    const { clickup, calls } = fakeClient();
    const r = await pushBcCore({ token: "t", clickup, listId: "L", fieldDefs: bcFieldDefs, statuses: [{ status: "autre" }], links: {}, group: group(), extra: {} });
    expect(r.created).toBe(true);
    expect(calls.create[0].payload.status).toBeUndefined();
  });
  it("statut initial validé : présent → posé", async () => {
    const { clickup, calls } = fakeClient();
    await pushBcCore({ token: "t", clickup, listId: "L", fieldDefs: bcFieldDefs, statuses: [{ status: "placee distributeur" }], links: {}, group: group(), extra: {} });
    expect(calls.create[0].payload.status).toBe("placee distributeur");
  });
});
