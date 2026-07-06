import { describe, it, expect } from "vitest";
const cf = require("../lib/clickupFields");

// Sous-ensemble représentatif des champs de l'espace « Gestion de Projets ».
const fieldDefs = [
  { id: "F_CAS", name: "CA Signé", type: "currency", type_config: { currency_type: "XOF" } },
  { id: "F_CAF", name: "CA Facturé", type: "currency", type_config: { currency_type: "XOF" } },
  { id: "F_OPP", name: "Opp ID", type: "short_text", type_config: {} },
  { id: "F_CLIENT", name: "Compte Client", type: "short_text", type_config: {} },
  { id: "F_AM", name: "AM", type: "short_text", type_config: {} },
  { id: "F_BU", name: "BU", type: "drop_down", type_config: { options: [{ id: "bu_ict", name: "ICT", orderindex: 0 }, { id: "bu_cloud", name: "CLOUD", orderindex: 2 }] } },
  { id: "F_PAYS", name: "Pays", type: "drop_down", type_config: { new_drop_down: true, options: [{ id: "p_bf", name: "BF", orderindex: 0 }, { id: "p_ci", name: "CI", orderindex: 1 }, { id: "p_gn", name: "GN", orderindex: 2 }] } },
  { id: "F_NATURE", name: "Nature", type: "drop_down", type_config: { options: [{ id: "n_liv", name: "Livraison + Services", orderindex: 2 }, { id: "n_maint", name: "Maintenance ", orderindex: 3 }] } },
  { id: "F_DELAI", name: "Délai Prévisonnel", type: "date", type_config: {} },
  { id: "F_BACKLOG", name: "Backlog", type: "formula", type_config: {} },
];

describe("buildFieldWrites — valeurs logiques → écritures ClickUp", () => {
  it("résout les listes déroulantes par libellé → UUID d'option", () => {
    const w = cf.buildFieldWrites(fieldDefs, { bu: "ICT", pays: "CI" });
    expect(w).toContainEqual({ id: "F_BU", value: "bu_ict" });
    expect(w).toContainEqual({ id: "F_PAYS", value: "p_ci" });
  });
  it("devise → nombre ; texte → chaîne ; date → ms", () => {
    const w = cf.buildFieldWrites(fieldDefs, { caSigne: 1000000, oppId: "FP/2026/1", delaiPrev: 1780200000000 });
    expect(w).toContainEqual({ id: "F_CAS", value: 1000000 });
    expect(w).toContainEqual({ id: "F_OPP", value: "FP/2026/1" });
    expect(w).toContainEqual({ id: "F_DELAI", value: 1780200000000 });
  });
  it("tolérance d'inclusion (« Maintenance » ↔ « Maintenance  »)", () => {
    const w = cf.buildFieldWrites(fieldDefs, { nature: "Maintenance" });
    expect(w).toContainEqual({ id: "F_NATURE", value: "n_maint" });
  });
  it("normalisation robuste : double espace et accents résolvent quand même l'option", () => {
    const defs = [
      { id: "F_DOM", name: "Domaine", type: "drop_down", type_config: { options: [{ id: "d_agile", name: "Agile Infrastructure & Cloud" }] } },
      { id: "F_SEC", name: "Secteur", type: "drop_down", type_config: { options: [{ id: "s_min", name: "Ministères" }] } },
    ];
    const w = cf.buildFieldWrites(defs, { domaine: "Agile Infrastructure  & Cloud", secteur: "ministeres" });
    expect(w).toContainEqual({ id: "F_DOM", value: "d_agile" });
    expect(w).toContainEqual({ id: "F_SEC", value: "s_min" });
  });
  it("option introuvable → champ ignoré (pas d'échec global)", () => {
    const w = cf.buildFieldWrites(fieldDefs, { bu: "INEXISTANT", caSigne: 5 });
    expect(w.find((x) => x.id === "F_BU")).toBeUndefined();
    expect(w).toContainEqual({ id: "F_CAS", value: 5 });
  });
  it("valeurs vides et champs absents/formule → ignorés", () => {
    const w = cf.buildFieldWrites(fieldDefs, { am: "", caSigne: null, oppId: undefined });
    expect(w).toEqual([]);
  });
});

describe("buildCorePayload — cœur de la tâche", () => {
  it("nom = client - désignation ; statut initial ; assigné ; dates ; priorité", () => {
    const p = cf.buildCorePayload(
      { fp: "FP/2026/1", client: "MTN CI", affaire: "Refonte réseau", bu: "ICT", cas: 1000000, pm: "Serge" },
      { status: "0-affecte", dateCommande: 1741752000000, dateContractuelle: 1782792000000, priority: "Haute", commentaire: "urgent" }, 3,
    );
    expect(p.name).toBe("MTN CI - Refonte réseau");
    expect(p.status).toBe("0-affecte");
    expect(p.assignees).toEqual([3]);
    expect(p.start_date).toBe(1741752000000);
    expect(p.due_date).toBe(1782792000000);
    expect(p.priority).toBe(2);
    expect(p.description).toContain("urgent");
  });
  it("sans assigné/dates → champs omis ; repli du nom sur le FP", () => {
    const p = cf.buildCorePayload({ fp: "FP/2026/2" }, {}, null);
    expect(p.name).toBe("FP/2026/2");
    expect(p.assignees).toBeUndefined();
    expect(p.start_date).toBeUndefined();
    expect(p.due_date).toBeUndefined();
    expect(p.priority).toBeUndefined();
  });
});

describe("buildLogical — n'inclut que les clés fournies", () => {
  it("commande + extra, ignore les vides", () => {
    const l = cf.buildLogical({ fp: "FP/1", client: "X", cas: 10, facture: 4, bu: "ICT", am: "" }, { pays: "CI", nature: "" });
    expect(l).toEqual({ oppId: "FP/1", compteClient: "X", caSigne: 10, caFacture: 4, bu: "ICT", pays: "CI" });
  });
  it("filtre `only` (synchro CAF du Lot B)", () => {
    const l = cf.buildLogical({ fp: "FP/1", client: "X", facture: 4, cas: 9 }, {}, ["caFacture"]);
    expect(l).toEqual({ caFacture: 4 });
  });
});

describe("readTaskSync — sens inverse ClickUp → app", () => {
  const task = {
    status: { status: "3-en cours - deploiement" },
    start_date: "1741752000000", due_date: "1782792000000",
    assignees: [{ id: 3, username: "Serge Djedje" }],
    custom_fields: [{ id: "F_DELAI", name: "Délai Prévisonnel", type: "date", value: "1780200000000" }],
  };
  it("extrait statut + 3 dates + PM assigné", () => {
    const s = cf.readTaskSync(task);
    expect(s.status).toBe("3-en cours - deploiement");
    expect(s.dateCommande).toBe(1741752000000);
    expect(s.dateContractuelle).toBe(1782792000000);
    expect(s.dateFinPrev).toBe(1780200000000);
    expect(s.pm).toBe("Serge Djedje");
  });
  it("tolère status chaîne, dates et assigné absents → null", () => {
    const s = cf.readTaskSync({ status: "0-affecte", custom_fields: [] });
    expect(s.status).toBe("0-affecte");
    expect(s.dateCommande).toBe(null);
    expect(s.dateContractuelle).toBe(null);
    expect(s.dateFinPrev).toBe(null);
    expect(s.pm).toBe(null);
  });
  it("tâche vide → tout null", () => {
    expect(cf.readTaskSync({})).toEqual({ status: null, dateCommande: null, dateContractuelle: null, dateFinPrev: null, pm: null });
  });
});

describe("taskFp / buildTaskFpIndex — réconciliation anti-doublons", () => {
  const tasks = [
    { id: "t1", custom_fields: [{ name: "Opp ID", value: "FP/2024/9447" }] },
    { id: "t2", custom_fields: [{ name: "AM", value: "x" }] },              // pas d'Opp ID → ignorée
    { id: "t3", custom_fields: [{ name: "Opp ID", value: "  fp/2024/9447 " }] }, // doublon (1er gagne)
    { id: "t4", custom_fields: [{ name: "Opp ID", value: "FP/2026/1" }] },
  ];
  it("taskFp lit le champ Opp ID", () => {
    expect(cf.taskFp(tasks[0])).toBe("FP/2024/9447");
    expect(cf.taskFp(tasks[1])).toBe(null);
  });
  it("index FP normalisé → taskId (première tâche gagne)", () => {
    const norm = (s) => String(s || "").trim().toLowerCase();
    const idx = cf.buildTaskFpIndex(tasks, norm);
    expect(idx["fp/2024/9447"]).toBe("t1"); // t3 (même FP normalisé) n'écrase pas t1
    expect(idx["fp/2026/1"]).toBe("t4");
    expect(Object.keys(idx).length).toBe(2);
  });
});

describe("toPriority", () => {
  it("libellés FR/EN → 1..4", () => {
    expect(cf.toPriority("Urgente")).toBe(1);
    expect(cf.toPriority("haute")).toBe(2);
    expect(cf.toPriority("Normale")).toBe(3);
    expect(cf.toPriority("basse")).toBe(4);
    expect(cf.toPriority(2)).toBe(2);
    expect(cf.toPriority("")).toBe(null);
  });
});
