import { describe, it, expect } from "vitest";
const { pushOrderCore } = require("../lib/clickupPush");
const cf = require("../lib/clickupFields");

const fpKey = (s) => String(s || "").trim().toLowerCase();
const safeId = (s) => String(s || "").replace(/[^a-z0-9]/gi, "_");
const fieldDefs = [
  { id: "F_CAS", name: "CA Signé", type: "currency", type_config: {} },
  { id: "F_OPP", name: "Opp ID", type: "short_text", type_config: {} },
  { id: "F_CLIENT", name: "Compte Client", type: "short_text", type_config: {} },
];

function fakeClient(over = {}) {
  const calls = { create: [], update: [], setField: [], getTask: 0 };
  const clickup = {
    resolveAssignee: (_m, pm) => (pm === "Serge" ? 3 : null),
    getTask: async () => { calls.getTask++; return { assignees: [{ id: 1 }, { id: 3 }] }; },
    createTask: async (_t, listId, payload) => { calls.create.push({ listId, payload }); return { id: "newtask", url: "u" }; },
    updateTask: async (_t, taskId, payload, remove) => { calls.update.push({ taskId, payload, remove }); return {}; },
    setField: async (_t, _id, fieldId, value) => { calls.setField.push({ fieldId, value }); },
    ...over,
  };
  return { clickup, calls };
}

describe("pushOrderCore — orchestration create/update", () => {
  it("CRÉATION : statut forcé 0-affecte, champs posés, created=true", async () => {
    const { clickup, calls } = fakeClient();
    const r = await pushOrderCore({ token: "t", clickup, cf, safeId, fpKey, listId: "L1", members: [], fieldDefs,
      links: {}, order: { fp: "FP/1", client: "X", cas: 100, pm: "Serge" }, extra: {} });
    expect(r.created).toBe(true);
    expect(calls.create[0].payload.status).toBe("0-affecte");
    expect(calls.setField.map((s) => s.fieldId).sort()).toEqual(["F_CAS", "F_CLIENT", "F_OPP"]);
    expect(r.assigned).toBe(true);
  });

  it("MISE À JOUR : ne réinitialise PAS le statut ; retire l'ancien assigné", async () => {
    const { clickup, calls } = fakeClient();
    const links = { [safeId(fpKey("FP/1"))]: "task9" };
    const r = await pushOrderCore({ token: "t", clickup, cf, safeId, fpKey, listId: "L1", members: [], fieldDefs,
      links, order: { fp: "FP/1", client: "X", cas: 100, pm: "Serge" }, extra: {} });
    expect(r.created).toBe(false);
    expect(calls.create.length).toBe(0);
    expect(calls.update[0].payload.status).toBeUndefined(); // statut NON réinitialisé
    expect(calls.update[0].remove).toEqual([1]);            // assignés courants [1,3], nouveau=3 → retire 1
  });

  it("setField best-effort : un champ en échec ne casse pas le push", async () => {
    const { clickup } = fakeClient({ setField: async () => { throw new Error("boom"); } });
    const r = await pushOrderCore({ token: "t", clickup, cf, safeId, fpKey, listId: "L1", members: [], fieldDefs,
      links: {}, order: { fp: "FP/2", client: "Y", cas: 5, pm: "Serge" }, extra: {} });
    expect(r.created).toBe(true); // le push réussit malgré les échecs de champs
    expect(r.taskId).toBe("newtask");
  });
});
