import { describe, it, expect } from "vitest";
const bc = require("../lib/clickupBc");
const { clickupBcSignals } = require("../domain/clickupBc");
const { safeId } = require("../lib/sheets");

// Définitions réelles (sous-ensemble) de la liste « Commandes Fournisseurs ».
const bcFieldDefs = [
  { id: "F_FRN", name: "Fournisseur", type: "short_text", type_config: {} },
  { id: "F_NUM", name: "Numéro de Commande", type: "short_text", type_config: {} },
  { id: "F_MNT", name: "Montant Total de la Commande", type: "currency", type_config: { currency_type: "USD" } },
  { id: "F_CUR", name: "Currency", type: "drop_down", type_config: { options: [{ id: "c_eur", name: "EUR" }, { id: "c_usd", name: "USD" }, { id: "c_fcfa", name: "FCFA" }] } },
  { id: "F_ETA", name: "Livraison Estimée (ETA)", type: "date", type_config: {} },
  { id: "F_CLI", name: "Client", type: "short_text", type_config: {} },
  { id: "F_OPP", name: "Opp ID", type: "short_text", type_config: {} },
  { id: "F_PAYS", name: "Pays", type: "drop_down", type_config: { new_drop_down: true, options: [{ id: "p_bf", name: "BF" }, { id: "p_ci", name: "CI" }, { id: "p_gn", name: "GN" }] } },
];

describe("groupBcByNumber — agrégation par N° BC", () => {
  it("somme les lignes de même N° BC en un seul groupe (une tâche)", () => {
    const groups = bc.groupBcByNumber([
      { id: "a", bcNumber: "BC-1", supplier: "CISCO", customer: "MTN", fp: "FP/2026/1", country: "CI", currency: "USD", amount: 100, amountXof: 60000 },
      { id: "b", bcNumber: "BC-1", supplier: "CISCO", amount: 50, amountXof: 30000 },
      { id: "c", bcNumber: "BC-2", supplier: "DELL", amount: 10, amountXof: 6000 },
    ], safeId);
    expect(groups.length).toBe(2);
    const g1 = groups.find((g) => g.bcNumber === "BC-1");
    expect(g1.amount).toBe(150);
    expect(g1.amountXof).toBe(90000);
    expect(g1.key).toBe(safeId("BC-1"));
    expect(g1.ids).toEqual(["a", "b"]);
    expect(g1.supplier).toBe("CISCO");
    expect(g1.fp).toBe("FP/2026/1");
  });
  it("ignore les lignes sans N° BC (pas de clé stable)", () => {
    const groups = bc.groupBcByNumber([{ id: "x", bcNumber: "", supplier: "X", amount: 5 }, { id: "y", bcNumber: "  ", amount: 3 }], safeId);
    expect(groups).toEqual([]);
  });
  it("ETA = réel sinon contractuel, prise sur la 1re ligne qui en porte une", () => {
    const groups = bc.groupBcByNumber([
      { id: "a", bcNumber: "BC-3", etaContrat: "2026-03-01" },
      { id: "b", bcNumber: "BC-3", etaReel: "2026-04-15" },
    ], safeId);
    expect(groups[0].eta).toBe("2026-03-01");
  });
});

describe("bcLogical — valeurs logiques (clé = nom de champ ClickUp)", () => {
  it("mappe fournisseur/numéro/montant/client/opp/pays/currency/eta", () => {
    const g = { bcNumber: "BC-1", supplier: "CISCO", customer: "MTN", fp: "FP/2026/1", country: "Côte d'Ivoire", currency: "USD", amount: 150, amountXof: 90000, eta: "2026-05-01" };
    const l = bc.bcLogical(g);
    expect(l["Fournisseur"]).toBe("CISCO");
    expect(l["Numéro de Commande"]).toBe("BC-1");
    expect(l["Montant Total de la Commande"]).toBe(150);
    expect(l["Client"]).toBe("MTN");
    expect(l["Opp ID"]).toBe("FP/2026/1");
    expect(l["Pays"]).toBe("CI"); // « Côte d'Ivoire » → code CI
    expect(l["Currency"]).toBe("USD");
    expect(l["Livraison Estimée (ETA)"]).toBe(Date.parse("2026-05-01T00:00:00Z"));
  });
  it("XOF → libellé FCFA ; montant XOF de repli si pas de montant devise", () => {
    const l = bc.bcLogical({ bcNumber: "BC-9", currency: "xof", amount: 0, amountXof: 42000 });
    expect(l["Currency"]).toBe("FCFA");
    expect(l["Montant Total de la Commande"]).toBe(42000);
  });
  it("omet les valeurs vides", () => {
    const l = bc.bcLogical({ bcNumber: "BC-0" });
    expect(l["Fournisseur"]).toBeUndefined();
    expect(l["Numéro de Commande"]).toBe("BC-0");
  });
});

describe("buildBcFieldWrites — logique → écritures ClickUp", () => {
  it("résout devise (drop_down), pays, montant, dates, textes", () => {
    const g = { bcNumber: "BC-1", supplier: "CISCO", customer: "MTN", fp: "FP/2026/1", country: "CI", currency: "USD", amount: 150, eta: "2026-05-01" };
    const w = bc.buildBcFieldWrites(bcFieldDefs, bc.bcLogical(g));
    expect(w).toContainEqual({ id: "F_FRN", value: "CISCO" });
    expect(w).toContainEqual({ id: "F_NUM", value: "BC-1" });
    expect(w).toContainEqual({ id: "F_MNT", value: 150 });
    expect(w).toContainEqual({ id: "F_CUR", value: "c_usd" });
    expect(w).toContainEqual({ id: "F_PAYS", value: "p_ci" });
    expect(w).toContainEqual({ id: "F_OPP", value: "FP/2026/1" });
    expect(w).toContainEqual({ id: "F_ETA", value: Date.parse("2026-05-01T00:00:00Z") });
  });
});

describe("bcCorePayload — cœur de la tâche BC", () => {
  it("nom = fournisseur — N° BC ; statut posé seulement si fourni", () => {
    const p = bc.bcCorePayload({ bcNumber: "BC-1", supplier: "CISCO", customer: "MTN", fp: "FP/2026/1" }, { status: "placee distributeur" });
    expect(p.name).toBe("CISCO — BC-1");
    expect(p.status).toBe("placee distributeur");
    expect(p.description).toContain("BC-1");
    expect(p.description).toContain("MTN");
  });
  it("sans extra → pas de statut (posé à la création par l'appelant)", () => {
    const p = bc.bcCorePayload({ bcNumber: "BC-2", supplier: "DELL" }, {});
    expect(p.name).toBe("DELL — BC-2");
    expect(p.status).toBeUndefined();
  });
});

describe("bcKey — clé casse-insensible (anti-doublon)", () => {
  it("normalise la casse : « BC/2026/1 » et « bc/2026/1 » → même clé", () => {
    expect(bc.bcKey("bc/2026/1", safeId)).toBe(bc.bcKey("BC/2026/1", safeId));
    expect(bc.bcKey(" Bc/2026/1 ", safeId)).toBe(bc.bcKey("BC/2026/1", safeId));
  });
  it("groupBcByNumber agrège deux casses différentes en UN seul groupe", () => {
    const g = bc.groupBcByNumber([{ id: "a", bcNumber: "BC-7", amount: 10 }, { id: "b", bcNumber: "bc-7", amount: 5 }], safeId);
    expect(g.length).toBe(1);
    expect(g[0].amount).toBe(15);
  });
});

describe("mapBcStatus / readBcSync — sens inverse ClickUp → app", () => {
  it("statut d'avancement → livre / annule / en_cours (matching par inclusion)", () => {
    expect(bc.mapBcStatus("livre")).toBe("livre");
    expect(bc.mapBcStatus("Livrée")).toBe("livre");      // libellé réel varié
    expect(bc.mapBcStatus("Réceptionné")).toBe("livre");
    expect(bc.mapBcStatus("annulee")).toBe("annule");
    expect(bc.mapBcStatus("Annulé")).toBe("annule");     // masculin
    expect(bc.mapBcStatus("livraison annulée")).toBe("annule"); // « annul » prime sur « livr »
    expect(bc.mapBcStatus("en transit")).toBe("en_cours");
    expect(bc.mapBcStatus("")).toBe(null);
  });
  it("readBcSync extrait statut brut + mappé + ETA", () => {
    const task = { status: { status: "en transit" }, custom_fields: [{ name: "Livraison Estimée (ETA)", value: "1780200000000" }] };
    const s = bc.readBcSync(task);
    expect(s.statusRaw).toBe("en transit");
    expect(s.status).toBe("en_cours");
    expect(s.eta).toBe(1780200000000);
  });
  it("tâche vide → statut/eta null", () => {
    expect(bc.readBcSync({})).toEqual({ statusRaw: null, status: null, eta: null });
  });
});

describe("taskBcNumber / buildBcIndex — réconciliation anti-doublons", () => {
  const tasks = [
    { id: "t1", custom_fields: [{ name: "Numéro de Commande", value: "BC-1" }] },
    { id: "t2", custom_fields: [{ name: "Fournisseur", value: "X" }] },        // pas de N° → ignorée
    { id: "t3", custom_fields: [{ name: "Numéro de Commande", value: "BC-1" }] }, // doublon (1re gagne)
    { id: "t4", custom_fields: [{ name: "Numéro de Commande", value: "BC-2" }] },
  ];
  it("lit le champ Numéro de Commande", () => {
    expect(bc.taskBcNumber(tasks[0])).toBe("BC-1");
    expect(bc.taskBcNumber(tasks[1])).toBe(null);
  });
  it("index N° BC → taskId (première gagne)", () => {
    const idx = bc.buildBcIndex(tasks, safeId);
    expect(idx[safeId("BC-1")]).toBe("t1");
    expect(idx[safeId("BC-2")]).toBe("t4");
    expect(Object.keys(idx).length).toBe(2);
  });
});

describe("clickupBcSignals — retards & couverture (overlay fusionné)", () => {
  const asOf = Date.parse("2026-06-01T00:00:00Z");
  it("compte les BC liés, en retard (ETA dépassée, non terminal), par statut", () => {
    const bcLines = [
      { bcNumber: "BC-1", supplier: "CISCO", clickupBcTaskId: "t1", clickupBcStatus: "en_cours", clickupBcStatusRaw: "en transit", clickupBcEta: Date.parse("2026-05-01T00:00:00Z") }, // en retard
      { bcNumber: "BC-1", supplier: "CISCO", clickupBcTaskId: "t1" }, // même BC (une seule tâche)
      { bcNumber: "BC-2", supplier: "DELL", clickupBcTaskId: "t2", clickupBcStatus: "livre", clickupBcStatusRaw: "livre", clickupBcEta: Date.parse("2026-01-01T00:00:00Z") }, // livré → jamais en retard
      { bcNumber: "BC-3", supplier: "HP", clickupBcTaskId: "t3", clickupBcStatus: "en_cours", clickupBcStatusRaw: "en production", clickupBcEta: Date.parse("2026-12-01T00:00:00Z") }, // futur
      { bcNumber: "BC-4", supplier: "LENOVO" }, // non lié
    ];
    const s = clickupBcSignals(bcLines, asOf);
    expect(s.totalBc).toBe(4);
    expect(s.linkedCount).toBe(3);
    expect(s.overdueCount).toBe(1);
    expect(s.overdueRefs).toEqual(["BC-1"]);
    expect(s.byStatus["en transit"]).toBe(1);
    expect(s.byStatus["livre"]).toBe(1);
  });
});
