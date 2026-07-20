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

  it("millésime de création ABERRANT (1900) → ignoré (pas de tranche « ancienne » à tort) [audit]", () => {
    const active = [
      { oppId: "ok", amount: 10, stage: 2, dateCreation: "2026-07-01" }, // 17 j
      { oppId: "aberrant", amount: 999, stage: 3, dateCreation: "1900-01-01" }, // millésime hors [2015..]
    ];
    const r = agingAnalysis(active, TODAY);
    expect(r.withDate).toBe(1);              // seule l'opp au millésime plausible est datée
    expect(r.buckets.dPlus.count).toBe(0);   // 1900 ne gonfle PAS la tranche la plus ancienne
    expect(r.total).toBe(2);
  });
});

const { closingAnalysis, scopePrivateSummary } = require("../domain/pipeline");
const pwOne = (o) => o.amount || 0; // pondération neutre pour le test

describe("scopePrivateSummary — confidentialité record-level (audit P1-a)", () => {
  const base = () => ({
    tot: { weighted: 100 }, byStage: { 3: { count: 1 } }, byAM: { X: 50 },
    topOpps: [{ oppId: "a", client: "ACME", am: "X" }],
    byAmConv: [{ am: "X", won: 1, lost: 0 }],
    closing: { staleCount: 2, staleTop: [{ oppId: "b", client: "BETA", am: "Y" }] },
  });
  it("OWD public → summary INCHANGÉ (no-op, référence identique)", () => {
    const s = base();
    expect(scopePrivateSummary(s, false)).toBe(s);
  });
  it("OWD private → détail NOMINATIF vidé, AGRÉGATS conservés, original non muté", () => {
    const src = base();
    const s = scopePrivateSummary(src, true);
    expect(s.topOpps).toEqual([]);                 // deals nommés retirés
    expect(s.byAmConv).toEqual([]);                // conversion par commercial retirée
    expect(s.closing.staleTop).toEqual([]);        // retards nommés retirés
    expect(s.closing.staleCount).toBe(2);          // agrégat conservé
    expect(s.tot.weighted).toBe(100);              // agrégats conservés (vue équipe)
    expect(s.byAM).toEqual({ X: 50 });             // distribution agrégée conservée
    expect(s.scopedPrivate).toBe(true);
    expect(src.topOpps).toHaveLength(1);           // l'objet source n'est PAS muté (réutilisé par l'Actualité)
  });
});

describe("closingAnalysis — millésime de closing borné (audit)", () => {
  it("closing ABERRANT (« 20226-… » trie AVANT today en chaîne) → seau « sans », PAS « retard »", () => {
    const active = [
      { oppId: "aberrant", amount: 100, closingDate: "20226-01-01" }, // année à 5 chiffres
      { oppId: "vraiRetard", amount: 50, closingDate: "2026-01-01" },  // vraie D Prev passée
    ];
    const r = closingAnalysis(active, "2026-07-18", pwOne);
    expect(r.buckets.sans.count).toBe(1);    // l'aberrant tombe en « à requalifier/dater »
    expect(r.buckets.retard.count).toBe(1);  // seul le vrai retard est « en retard »
    expect(r.staleCount).toBe(1);            // et un seul entre dans le top des retards
  });
});
