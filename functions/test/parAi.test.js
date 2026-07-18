import { describe, it, expect } from "vitest";
const { actionPlanSnapshot, qbrSnapshot, normalizeActionPlan, normalizeQbr, buildActionPlanPrompt } = require("../domain/parAi");

describe("parAi — snapshots + validation des sorties IA", () => {
  const ca = { byPartner: [{ partnerId: "fortinet", name: "Fortinet", revenueXof: 1200000 }] };
  const quotas = { partners: [{ partnerId: "fortinet", name: "Fortinet", status: "at_risk", coverage: [{ target: "fortinet-nse7", holders: 1, minCount: 2, ok: false }], gaps: [{ target: "fortinet-nse7", holders: 1, minCount: 2 }] }] };
  const relances = { items: [{ partnerId: "fortinet", consultantName: "Awa", cert: "NSE7", bucket: "retard" }] };

  it("actionPlanSnapshot : dérive statut + CA FCFA + quotas manquants + retards", () => {
    const s = actionPlanSnapshot({ dateIso: "2026-07-18", ca, quotas, relances });
    expect(s.partners[0]).toMatchObject({ nom: "Fortinet", statut_conformite: "at_risk", ca_ytd_fcfa: 1200000 });
    expect(s.partners[0].quotas_manquants[0]).toMatch(/fortinet-nse7 : 1\/2/);
    expect(s.assignations_en_retard[0]).toMatch(/Awa/);
  });

  it("qbrSnapshot : CA FCFA + couverture + certifs actives (statut re-dérivé en amont ⇒ expirées exclues)", () => {
    // Le handler re-dérive le statut (computeCertStatus) AVANT d'appeler qbrSnapshot ; qbrSnapshot ne garde
    // que les `active`. Une certif expirée (statut re-dérivé) ne doit donc jamais figurer dans la liste QBR.
    const certifs = [
      { partnerId: "fortinet", status: "active", certName: "NSE 4" },
      { partnerId: "fortinet", status: "expired", certName: "NSE 7 (périmée)" },
    ];
    const s = qbrSnapshot({ partnerId: "fortinet", partner: { name: "Fortinet" }, periode: "T3 2026", ca, quotas, certifs, relances });
    expect(s).toMatchObject({ partenaire: "Fortinet", statut_conformite: "at_risk", ca_realise_ytd_fcfa: 1200000 });
    expect(s.certifications_actives).toContain("NSE 4");
    expect(s.certifications_actives).not.toContain("NSE 7 (périmée)");
  });

  it("masquage CA (ADR-P07) : ca={} ⇒ montant 0 dans les deux snapshots (contrat du handler sans droit rentabilite)", () => {
    // Sans le droit `rentabilite`, le handler passe ca:{} — le CA confidentiel ne doit apparaître nulle part.
    const plan = actionPlanSnapshot({ dateIso: "2026-07-18", ca: {}, quotas, relances });
    expect(plan.partners[0].ca_ytd_fcfa).toBe(0);
    const qbr = qbrSnapshot({ partnerId: "fortinet", partner: { name: "Fortinet" }, periode: "T3 2026", ca: {}, quotas, certifs: [], relances });
    expect(qbr.ca_realise_ytd_fcfa).toBe(0);
  });

  it("normalizeActionPlan : ne garde que les items bien formés, priorité normalisée, trié, max 6", () => {
    const raw = [
      { priorite: "basse", titre: "C", actions: ["x"] },
      { priorite: "haute", titre: "A", constat: "gap", actions: ["y", "z"], impact: "ok" },
      { titre: "" }, // rejeté (pas de titre)
      { priorite: "zzz", titre: "B" }, // priorité inconnue → moyenne
    ];
    const out = normalizeActionPlan(raw);
    expect(out.map((i) => i.titre)).toEqual(["A", "B", "C"]); // trié haute<moyenne<basse
    expect(out[1].priorite).toBe("moyenne");
  });

  it("normalizeActionPlan : tolère un objet {plan:[...]} et une sortie invalide", () => {
    expect(normalizeActionPlan({ plan: [{ priorite: "haute", titre: "T" }] })).toHaveLength(1);
    expect(normalizeActionPlan("pas du json")).toEqual([]);
    expect(normalizeActionPlan(null)).toEqual([]);
  });

  it("normalizeQbr : structure garantie même sur sortie partielle", () => {
    const q = normalizeQbr({ synthese_executive: "S", points_forts: ["pf1"] }, { partenaire: "Fortinet", periode: "T3" });
    expect(q.titre).toMatch(/QBR Fortinet/);
    expect(q.points_forts).toEqual(["pf1"]);
    expect(Array.isArray(q.demandes_constructeur)).toBe(true);
  });

  it("buildActionPlanPrompt : mentionne FCFA et exige du JSON strict", () => {
    const { system, user } = buildActionPlanPrompt({ partners: [] });
    expect(system).toMatch(/FCFA/);
    expect(user).toMatch(/JSON valide/);
  });
});
