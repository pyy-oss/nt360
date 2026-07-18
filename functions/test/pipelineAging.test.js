import { describe, it, expect } from "vitest";
// ÂGE & CYCLE des opportunités actives (Lot cockpit C2) — fondé sur la SEULE date de création réelle
// (`dateCreation`, Odoo create_date). Prouve : (1) les opps SANS date (Excel) sont ignorées mais comptées
// dans `total` (couverture honnête) ; (2) les tranches d'âge et l'âge moyen ne portent que sur les datées ;
// (3) le cycle prévisionnel = création → clôture prévue ; (4) le top est trié par âge décroissant.
const { agingAnalysis } = require("../domain/pipeline");

const TODAY = "2026-07-18";

describe("agingAnalysis — âge des opps actives (périmètre daté)", () => {
  it("ignore les opps sans dateCreation mais les compte dans total (couverture)", () => {
    const active = [
      { oppId: "a", amount: 100, stage: 2, dateCreation: "2026-07-01" }, // 17 j → d30
      { oppId: "b", amount: 200, stage: 3 }, // pas de date (Excel) → ignorée pour l'âge
    ];
    const r = agingAnalysis(active, TODAY);
    expect(r.total).toBe(2);
    expect(r.withDate).toBe(1);
    expect(r.buckets.d30.count).toBe(1);
    expect(r.buckets.d30.brut).toBe(100);
    expect(r.avgAge).toBe(17);
  });

  it("ventile par tranche d'âge et calcule l'âge moyen sur les seules datées", () => {
    const active = [
      { oppId: "a", amount: 10, stage: 1, dateCreation: "2026-07-10" }, // 8 j → d30
      { oppId: "b", amount: 20, stage: 2, dateCreation: "2026-05-01" }, // 78 j → d90
      { oppId: "c", amount: 30, stage: 3, dateCreation: "2026-03-01" }, // 139 j → d180
      { oppId: "d", amount: 40, stage: 4, dateCreation: "2025-06-01" }, // >180 j → dPlus
    ];
    const r = agingAnalysis(active, TODAY);
    expect(r.withDate).toBe(4);
    expect(r.buckets.d30.count).toBe(1);
    expect(r.buckets.d90.count).toBe(1);
    expect(r.buckets.d180.count).toBe(1);
    expect(r.buckets.dPlus.count).toBe(1);
    // top trié par âge décroissant : la plus vieille (d) d'abord
    expect(r.top[0].oppId).toBe("d");
    expect(r.top[3].oppId).toBe("a");
  });

  it("cycle prévisionnel = création → clôture prévue, seulement quand les deux dates existent", () => {
    const active = [
      { oppId: "a", amount: 10, stage: 2, dateCreation: "2026-01-01", closingDate: "2026-04-01" }, // 90 j
      { oppId: "b", amount: 20, stage: 2, dateCreation: "2026-01-01" }, // pas de closing → hors cycle
    ];
    const r = agingAnalysis(active, TODAY);
    expect(r.avgProjectedCycle).toBe(90);
  });

  it("date de création incohérente (postérieure à asOf) → âge négatif ignoré", () => {
    const active = [{ oppId: "a", amount: 10, stage: 2, dateCreation: "2027-01-01" }];
    const r = agingAnalysis(active, TODAY);
    expect(r.withDate).toBe(0);
    expect(r.avgAge).toBe(0);
  });
});
