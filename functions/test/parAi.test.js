import { describe, it, expect } from "vitest";
const { actionPlanSnapshot, qbrSnapshot, normalizeActionPlan, normalizeQbr, buildActionPlanPrompt, buildQbrPrompt, fiscalMonthsLabel, gapLabel, mapSuggestSnapshot, buildMapSuggestPrompt, normalizeMapSuggest } = require("../domain/parAi");

describe("parAi — snapshots + validation des sorties IA", () => {
  const ca = { byPartner: [{ partnerId: "fortinet", name: "Fortinet", revenueXof: 1200000, bcXof: 800000, declaredXof: 400000, source: "bc" }] };
  const quotas = { partners: [{ partnerId: "fortinet", name: "Fortinet", status: "at_risk", coverage: [{ target: "fortinet-nse7", holders: 1, minCount: 2, ok: false }], gaps: [{ target: "fortinet-nse7", holders: 1, minCount: 2 }] }] };
  const relances = { items: [{ partnerId: "fortinet", consultantName: "Awa", cert: "NSE7", bucket: "retard" }] };

  it("actionPlanSnapshot : dérive statut + CA FCFA ventilé (BC/déclaré) + quotas chiffrés + retards", () => {
    const s = actionPlanSnapshot({ dateIso: "2026-07-18", ca, quotas, relances });
    expect(s.partners[0]).toMatchObject({ nom: "Fortinet", statut_conformite: "at_risk", ca_ytd_fcfa: 1200000, ca_dont_bc_fcfa: 800000, ca_dont_declare_fcfa: 400000 });
    expect(s.partners[0].quotas_manquants[0]).toMatch(/fortinet-nse7 : 1\/2 certifié\(s\) — manque 1/); // écart chiffré
    expect(s.assignations_en_retard[0]).toMatch(/Awa/);
  });

  it("qbrSnapshot : CA ventilé + exercice fiscal + couverture + certifs actives (statut re-dérivé en amont ⇒ expirées exclues)", () => {
    // Le handler re-dérive le statut (computeCertStatus) AVANT d'appeler qbrSnapshot ; qbrSnapshot ne garde
    // que les `active`. Une certif expirée (statut re-dérivé) ne doit donc jamais figurer dans la liste QBR.
    const certifs = [
      { partnerId: "fortinet", status: "active", certName: "NSE 4" },
      { partnerId: "fortinet", status: "expired", certName: "NSE 7 (périmée)" },
    ];
    const s = qbrSnapshot({ partnerId: "fortinet", partner: { name: "Fortinet", fiscalStartMonth: 8 }, periode: "T3 2026", ca, quotas, certifs, relances });
    expect(s).toMatchObject({ partenaire: "Fortinet", statut_conformite: "at_risk", ca_realise_ytd_fcfa: 1200000, ca_dont_bc_fcfa: 800000, ca_dont_declare_fcfa: 400000 });
    expect(s.exercice_fiscal).toBe("août → juillet"); // Cisco-like : exercice décalé
    expect(s.quotas[0]).toMatch(/fortinet-nse7 : 1\/2 certifié\(s\) — manque 1/); // écart chiffré, pas de ✓
    expect(s.certifications_actives).toContain("NSE 4");
    expect(s.certifications_actives).not.toContain("NSE 7 (périmée)");
  });

  it("masquage CA (ADR-P07) : ca={} ⇒ montants 0 (dont ventilation) dans les deux snapshots", () => {
    // Sans le droit `rentabilite`, le handler passe ca:{} — le CA confidentiel ne doit apparaître nulle part.
    const plan = actionPlanSnapshot({ dateIso: "2026-07-18", ca: {}, quotas, relances });
    expect(plan.partners[0]).toMatchObject({ ca_ytd_fcfa: 0, ca_dont_bc_fcfa: 0, ca_dont_declare_fcfa: 0 });
    const qbr = qbrSnapshot({ partnerId: "fortinet", partner: { name: "Fortinet" }, periode: "T3 2026", ca: {}, quotas, certifs: [], relances });
    expect(qbr).toMatchObject({ ca_realise_ytd_fcfa: 0, ca_dont_bc_fcfa: 0, ca_dont_declare_fcfa: 0 });
    expect(qbr.exercice_fiscal).toBe("calendaire (janvier → décembre)"); // exercice non confidentiel, présent
  });

  it("fiscalMonthsLabel : mois de début → « <mois> → <mois−1> » ; hors bornes → calendaire", () => {
    expect(fiscalMonthsLabel(8)).toBe("août → juillet");
    expect(fiscalMonthsLabel(1)).toBe("janvier → décembre");
    expect(fiscalMonthsLabel(0)).toBe("calendaire (janvier → décembre)");
    expect(fiscalMonthsLabel(undefined)).toBe("calendaire (janvier → décembre)");
    expect(fiscalMonthsLabel(13)).toBe("calendaire (janvier → décembre)");
  });

  it("gapLabel : chiffre le déficit ; couvert → suffixe ok (pas de « manque »)", () => {
    expect(gapLabel("nse7", 1, 3)).toBe("nse7 : 1/3 certifié(s) — manque 2");
    expect(gapLabel("nse7", 3, 3, " ✓")).toBe("nse7 : 3/3 certifié(s) ✓");
  });

  it("buildQbrPrompt : guide l'IA sur la ventilation BC/déclaré + l'exercice fiscal", () => {
    const { user } = buildQbrPrompt({ partenaire: "Fortinet", periode: "T3", exercice_fiscal: "août → juillet" });
    expect(user).toMatch(/ca_dont_bc_fcfa/);
    expect(user).toMatch(/exercice_fiscal/);
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

  describe("mapping assisté (IA) — proposition fournisseur → constructeur", () => {
    const unmapped = [{ supplier: "TECH DISTRIBUTION SA", revenueXof: 5000000, bcCount: 3 }, { supplier: "", revenueXof: 1, bcCount: 1 }];
    const partners = [{ id: "cisco", name: "Cisco", programName: "Cisco Partner" }, { id: "fortinet", name: "Fortinet" }];

    it("mapSuggestSnapshot : liste fournisseurs (SANS montant CA) + constructeurs connus", () => {
      const s = mapSuggestSnapshot({ unmapped, partners });
      expect(s.fournisseurs_non_rattaches).toEqual([{ nom: "TECH DISTRIBUTION SA", nb_bc: 3 }]); // vide écarté
      expect(JSON.stringify(s)).not.toMatch(/5000000/); // aucun montant CA transmis au modèle (ADR-P07)
      expect(s.partenaires_connus[0]).toMatchObject({ id: "cisco", marque: "Cisco Partner" });
    });

    it("buildMapSuggestPrompt : exige des id connus + JSON strict + poids sommant à 1", () => {
      const { system, user } = buildMapSuggestPrompt(mapSuggestSnapshot({ unmapped, partners }));
      expect(system).toMatch(/JSON valide/);
      expect(user).toMatch(/sommer à 1|sommer a 1/i);
      expect(user).toMatch(/EXACTEMENT/);
    });

    it("normalizeMapSuggest : n'admet QUE des id connus, normalise les poids à somme 1", () => {
      const raw = [
        { fournisseur: "TECH DISTRIBUTION SA", repartition: [{ id: "cisco", poids: 3 }, { id: "fortinet", poids: 1 }], justification: "distributeur multi-marques" },
        { fournisseur: "AUTRE", repartition: [{ id: "inconnu", poids: 1 }] }, // id hors liste → écarté
      ];
      const out = normalizeMapSuggest(raw, ["cisco", "fortinet"]);
      expect(out).toHaveLength(1);
      expect(out[0].supplier).toBe("TECH DISTRIBUTION SA");
      const w = out[0].allocations.reduce((s, a) => s + a.weight, 0);
      expect(Math.round(w * 100) / 100).toBe(1); // poids re-normalisés (3+1 → 0.75 / 0.25)
      expect(out[0].allocations.find((a) => a.partnerId === "cisco").weight).toBe(0.75);
    });

    it("normalizeMapSuggest : un seul constructeur → poids 1 ; sortie invalide → []", () => {
      const out = normalizeMapSuggest([{ fournisseur: "X", repartition: [{ id: "cisco", poids: 42 }] }], ["cisco"]);
      expect(out[0].allocations).toEqual([{ partnerId: "cisco", weight: 1 }]);
      expect(normalizeMapSuggest("pas du json", ["cisco"])).toEqual([]);
      expect(normalizeMapSuggest(null, ["cisco"])).toEqual([]);
    });
  });
});
