import { describe, it, expect } from "vitest";
const { buildNews } = require("../domain/news");

const base = { fy: 2026, asOf: "2026-07-15" };
const ids = (r) => r.bulletins.map((b) => b.id);

describe("news — moteur d'actualité (bulletins + recommandations)", () => {
  it("aucun signal → fil vide, pas de recommandation", () => {
    const r = buildNews({ ...base, att: {}, pipeline: {}, backlog: {}, receivables: {}, suppliers: {}, billingTrend: {}, dataQuality: {} });
    expect(r.bulletins).toEqual([]);
    expect(r.recommendations).toEqual([]);
  });

  it("atterrissage CAS/CAF sous objectif → bulletins high + recommandations", () => {
    const r = buildNews({ ...base,
      att: { objectif: 1000, realiseCas: 400, projete: 700, ecart: -300, objectifCaf: 1000, cafProjete: 600, ecartCaf: -400 },
      pipeline: { tot: { weighted: 100 } } });
    expect(ids(r)).toContain("cas_sous_objectif");
    expect(ids(r)).toContain("caf_sous_objectif");
    expect(r.recommendations.length).toBeGreaterThan(0);
    expect(r.recommendations[0].priority).toBe(1);
  });

  it("couverture pipeline insuffisante (< 1×) détectée", () => {
    const r = buildNews({ ...base, att: { objectif: 1000, realiseCas: 400 }, pipeline: { tot: { weighted: 300 } } });
    // écart 600, pondéré 300 → couverture 0.5× < 1
    expect(ids(r)).toContain("pipeline_couverture");
  });

  it("closing en retard + concentration AM", () => {
    const r = buildNews({ ...base, att: {},
      pipeline: { closing: { staleCount: 4, staleBrut: 500, avgOverdueDays: 40 }, byAM: { Alice: 800, Bob: 100 } } });
    expect(ids(r)).toContain("closing_retard");
    expect(ids(r)).toContain("pipeline_concentration"); // Alice 800/900 = 89% > 50%
    const conc = r.bulletins.find((b) => b.id === "pipeline_concentration");
    expect(conc.refs).toContain("Alice");
  });

  it("facturation en retard sur le plan (jalons échus non facturés)", () => {
    const r = buildNews({ ...base,
      billingTrend: { realiseYtd: 100, projeteDec: 500, months: [
        { month: "2026-01", planifie: 200 }, { month: "2026-03", planifie: 200 }, { month: "2026-09", planifie: 300 },
      ] } });
    // plan échu (≤ 2026-07) = 400 ; réalisé 100 < 400×0.85 → retard
    expect(ids(r)).toContain("facturation_retard_plan");
  });

  it("créances échues + DSO élevé + fournisseur saturé + BC en retard", () => {
    const r = buildNews({ ...base,
      receivables: { totalAR: 1000, overdue: 400, overdueCount: 5, dso: 120 },
      // `saturated` = liste COMPLÈTE des noms (pas bySupplier, tronqué top-50).
      suppliers: { saturated: ["ACME"], bySupplier: [{ name: "ACME", state: "saturation" }] },
      bcLines: [{ etaContrat: "2026-01-01", status: "emis" }, { etaContrat: "2030-01-01", status: "emis" }, { source: "fiche", etaContrat: "2026-01-01", status: "emis" }] });
    expect(ids(r)).toContain("creances_echues");
    expect(ids(r)).toContain("dso_eleve");
    expect(ids(r)).toContain("fournisseur_sature");
    const bc = r.bulletins.find((b) => b.id === "bc_en_retard");
    expect(bc.title).toContain("1 "); // une seule ligne en retard (la « fiche » est exclue, la 2030 pas échue)
  });

  it("objectif annuel non défini → bulletin info actionnable", () => {
    const r = buildNews({ ...base, att: { objectif: 0, projete: 500 } });
    expect(ids(r)).toContain("objectif_absent");
    const b = r.bulletins.find((x) => x.id === "objectif_absent");
    expect(b.module).toBe("objectifs");
  });

  it("opportunités gagnées à réconcilier (sans FP / sans P&L) → bulletin high", () => {
    const r = buildNews({ ...base, dataQuality: { issues: [
      { type: "opps_gagnees_sans_fp", count: 2, refs: ["ACME", "MTN"] },
      { type: "opps_gagnees_sans_pnl", count: 3, refs: ["FP/2026/1"] },
    ] } });
    const b = r.bulletins.find((x) => x.id === "opps_a_reconcilier");
    expect(b).toBeTruthy();
    expect(b.severity).toBe("high");
    expect(b.title).toContain("5"); // 2 + 3
    expect(b.module).toBe("opplist"); // sans FP présent → on route vers le Pipeline
    expect(b.refs).toContain("FP/2026/1");
  });

  it("concentration : le faux seau « AUTRE » (opps/commandes sans AM/client) est ignoré", () => {
    // AUTRE domine mais n'est pas un vrai AM/client → pas d'alerte de concentration attribuée à AUTRE.
    const r = buildNews({ ...base,
      pipeline: { byAM: { AUTRE: 900, Alice: 100 } },
      backlog: { total: 1000, totalDerive: 0, byClient: { AUTRE: 900, ORANGE: 100 } } });
    const am = r.bulletins.find((b) => b.id === "pipeline_concentration");
    const cl = r.bulletins.find((b) => b.id === "backlog_concentration_client");
    // Alice = 100/1000 = 10 % < 50 % ; ORANGE = 100/1000 = 10 % < 40 % → aucune alerte, et surtout jamais « AUTRE ».
    expect(am).toBeUndefined();
    expect(cl).toBeUndefined();
  });

  it("concentration client + backlog dormant détectés", () => {
    const r = buildNews({ ...base, backlog: {
      total: 1000, totalDerive: 0,
      byClient: { ORANGE: 700, MTN: 300 },              // ORANGE 70 % > 40 %
      byVintage: { "2026": 600, "2023": 400 },          // 2023 ≤ 2026−2 → 400/1000 = 40 % > 15 %
    } });
    const conc = r.bulletins.find((b) => b.id === "backlog_concentration_client");
    expect(conc).toBeTruthy();
    expect(conc.refs).toContain("ORANGE");
    expect(ids(r)).toContain("backlog_dormant");
  });

  it("tri par sévérité : high avant medium avant info", () => {
    const r = buildNews({ ...base,
      att: { objectif: 1000, realiseCas: 100, projete: 300, ecart: -700 }, // high
      pipeline: { tot: { brut: 1000, weighted: 50 }, susp: { brut: 500 } }, // info (suspendu)
      backlog: { total: 1000, totalDerive: 800 } }); // medium
    const sev = r.bulletins.map((b) => b.severity);
    const firstMedium = sev.indexOf("medium"), firstInfo = sev.indexOf("info");
    expect(sev[0]).toBe("high");
    if (firstMedium >= 0 && firstInfo >= 0) expect(firstMedium).toBeLessThan(firstInfo);
  });
});
