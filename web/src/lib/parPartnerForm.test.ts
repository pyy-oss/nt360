import { describe, it, expect } from "vitest";
import { buildPartnerPayload, partnerToForm, parSlug, bpAchievement, fiscalMonthsLabel, EMPTY_BP, type PartnerFormState } from "./parPartnerForm";

// Formulaire de référentiel partenaire (par_) — prouve : (1) l'id dérive du nom en slug ; (2) les exigences
// et le catalogue référencent bien le slug de leur cible via la clé locale ; (3) l'aller-retour
// partenaire → formulaire → payload préserve l'intégrité (édition).

describe("buildPartnerPayload — construction du payload upsertParPartner", () => {
  const base: PartnerFormState = {
    name: "Fortinet", programName: "Engage",
    status: "", renewalDate: "", validationStatus: "", bp: { ...EMPTY_BP },
    caDeclaredXof: "", fiscalStartMonth: "",
    tiers: [{ k: "t1", name: "Gold", rank: "2" }],
    comps: [{ k: "c1", name: "Sécurité réseau" }],
    certs: [{ k: "e1", name: "NSE 7", code: "NSE7", compK: "c1", level: "expert", validityMonths: "24" }],
    reqs: [{ k: "r1", tierK: "t1", targetK: "comp:c1", minCount: "1" }],
  };

  it("dérive l'id du nom et relie les références par clé locale", () => {
    const r = buildPartnerPayload(base);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.id).toBe("fortinet");
    expect(r.value.programName).toBe("Engage");
    expect(r.value.tiers).toEqual([{ id: "gold", name: "Gold", rank: 2 }]);
    // slug SANS repli d'accent (parité backend) : « Sécurité réseau » → « s-curit-r-seau ».
    expect(r.value.competencies).toEqual([{ id: "s-curit-r-seau", name: "Sécurité réseau" }]);
    expect((r.value.certificationCatalog as any[])[0]).toMatchObject({ id: "nse7", competencyId: "s-curit-r-seau", level: "expert", validityMonths: 24 });
    // l'exigence pointe bien le slug de la compétence liée par la clé locale c1
    expect(r.value.requirements).toEqual([{ tierId: "gold", certIdOrCompetencyId: "s-curit-r-seau", minCount: 1 }]);
  });

  it("une exigence peut viser une certification (targetK cert:)", () => {
    const f = { ...base, reqs: [{ k: "r1", tierK: "t1", targetK: "cert:e1", minCount: "3" }] };
    const r = buildPartnerPayload(f);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.requirements).toEqual([{ tierId: "gold", certIdOrCompetencyId: "nse7", minCount: 3 }]);
  });

  it("ignore les lignes à libellé vide et refuse un nom vide", () => {
    expect(buildPartnerPayload({ ...base, name: "  " }).ok).toBe(false);
    const f = { ...base, tiers: [...base.tiers, { k: "t2", name: "  ", rank: "1" }] };
    const r = buildPartnerPayload(f);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.tiers).toHaveLength(1); // la ligne vide est écartée
  });

  it("validityMonths vide → chaîne vide (le backend appliquera le repli 24 mois)", () => {
    const f = { ...base, certs: [{ ...base.certs[0], validityMonths: "" }] };
    const r = buildPartnerPayload(f);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect((r.value.certificationCatalog as any[])[0].validityMonths).toBe("");
  });

  it("aller-retour partenaire stocké → formulaire → payload : intégrité préservée", () => {
    const stored = {
      id: "cisco", name: "Cisco", programName: "Partner",
      tiers: [{ id: "gold", name: "Gold", rank: 2 }],
      competencies: [{ id: "collaboration", name: "Collaboration" }],
      certificationCatalog: [{ id: "ccnp", competencyId: "collaboration", code: "CCNP", name: "CCNP Collab", level: "professional", validityMonths: 36 }],
      requirements: [{ tierId: "gold", certIdOrCompetencyId: "ccnp", minCount: 2 }],
    };
    const form = partnerToForm(stored);
    expect(form.reqs[0].targetK).toBe("cert:ccnp"); // cible = certif (présente au catalogue)
    const r = buildPartnerPayload(form);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.id).toBe("cisco");
    expect(r.value.requirements).toEqual([{ tierId: "gold", certIdOrCompetencyId: "ccnp", minCount: 2 }]);
  });

  it("plan d'affaires + statut : transmis au payload et aller-retour préservé", () => {
    const f: PartnerFormState = {
      ...base, status: "Platinum", renewalDate: "2026-01-31", validationStatus: "valide",
      bp: { ...EMPTY_BP, pipelineBp: "300000", pipelineYtd: "3000000", growthBp: "25", growthYtd: "20" },
    };
    const r = buildPartnerPayload(f);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.status).toBe("Platinum");
    expect(r.value.renewalDate).toBe("2026-01-31");
    expect(r.value.validationStatus).toBe("valide");
    expect(r.value.businessPlan).toEqual({ pipelineBp: 300000, pipelineYtd: 3000000, growthBp: 25, growthYtd: 20 });
    // Aller-retour stocké → formulaire : les champs BP reviennent en chaînes.
    const back = partnerToForm({ id: "x", name: "X", ...(r.value as any) });
    expect(back.status).toBe("Platinum");
    expect(back.bp.pipelineYtd).toBe("3000000");
  });

  it("CA déclaré + exercice fiscal : transmis (entier/1-12) et aller-retour préservé", () => {
    const f: PartnerFormState = { ...base, caDeclaredXof: "1500000.6", fiscalStartMonth: "8" };
    const r = buildPartnerPayload(f);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.caDeclaredXof).toBe(1500001); // XOF entier
    expect(r.value.fiscalStartMonth).toBe(8);
    const back = partnerToForm({ id: "x", name: "X", ...(r.value as any) });
    expect(back.caDeclaredXof).toBe("1500001");
    expect(back.fiscalStartMonth).toBe("8");
  });

  it("mois de début invalide ou CA négatif → champ non transmis", () => {
    const r = buildPartnerPayload({ ...base, caDeclaredXof: "-5", fiscalStartMonth: "13" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.caDeclaredXof).toBeUndefined();
    expect(r.value.fiscalStartMonth).toBeUndefined();
  });
});

describe("fiscalMonthsLabel", () => {
  it("mois de début → « début → fin » (fin = mois−1)", () => {
    expect(fiscalMonthsLabel(8)).toBe("août → juillet");
    expect(fiscalMonthsLabel(1)).toBe("janvier → décembre");
    expect(fiscalMonthsLabel("")).toBe("");
    expect(fiscalMonthsLabel(13)).toBe("");
  });
});

describe("bpAchievement — miroir du calcul backend", () => {
  it("ratio par axe + % global = moyenne des axes évaluables", () => {
    const a = bpAchievement({ pipelineBp: 300000, pipelineYtd: 3000000, growthBp: 25, growthYtd: 20 });
    expect(a.pipeline).toBeCloseTo(10, 6);
    expect(a.growth).toBeCloseTo(0.8, 6);
    expect(a.global).toBeCloseTo((10 + 0.8) / 2, 6);
    expect(bpAchievement({ pipelineBp: 0, pipelineYtd: 5 }).pipeline).toBe(null); // objectif nul → null
    expect(bpAchievement(null).global).toBe(null);
  });
});

describe("parSlug", () => {
  it("normalise en slug stable", () => {
    expect(parSlug("Sécurité Réseau!")).toBe("s-curit-r-seau");
    expect(parSlug("  Gold  ")).toBe("gold");
    expect(parSlug("")).toBe("");
  });
});
