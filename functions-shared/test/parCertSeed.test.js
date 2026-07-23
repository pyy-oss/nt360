// Amorçage certifs par ingénieur : le planificateur PUR résout les noms contre l'annuaire, marque les
// consultants à créer, complète le catalogue, et sépare détenues (certs) / à obtenir (assignations).
import { describe, it, expect } from "vitest";
const { planCertImport, normName, obtainedFromExpiry } = require("../domain/parCertSeed");

describe("normName — rapprochement annuaire", () => {
  it("replie casse, accents et espaces, sans réordonner", () => {
    expect(normName("Stevensky  Aboua")).toBe("stevensky aboua");
    expect(normName("Mel N'DIAMOI")).toBe(normName("mel n'diamoi"));
    expect(normName("Agadji DJIBRINE")).toBe("agadji djibrine");
  });
  // Audit adverse #3 : la ponctuation ne doit plus créer de fiches fantômes.
  it("plie l'apostrophe (lie) et le tiret (sépare) — anti-doublon annuaire", () => {
    expect(normName("Mel N'DIAMOI")).toBe("mel ndiamoi");      // apostrophe supprimée → matche « Mel Ndiamoi »
    expect(normName("O'Brien")).toBe("obrien");
    expect(normName("Jean-Marc Kouassi")).toBe("jean marc kouassi"); // tiret → espace → matche « Jean Marc Kouassi »
    expect(normName("Awa  Koné")).toBe("awa kone");
  });
  it("ne réordonne PAS (choix délibéré : éviter les faux positifs prénom/nom)", () => {
    expect(normName("KOUADIO Richard")).not.toBe(normName("Richard KOUADIO"));
  });
});

describe("obtainedFromExpiry — rétro-calcul date d'obtention", () => {
  it("échéance − validité (mois)", () => {
    expect(obtainedFromExpiry("2027-05-31", 36)).toBe("2024-05-31");
    expect(obtainedFromExpiry("2026-09-30", 24)).toBe("2024-09-30");
  });
  it("échéance absente/invalide → null (repli géré par l'appelant)", () => {
    expect(obtainedFromExpiry("", 24)).toBeNull();
    expect(obtainedFromExpiry(null, 24)).toBeNull();
  });
});

describe("planCertImport", () => {
  const partners = [{ id: "fortinet" }, { id: "paloalto" }, { id: "huawei" }, { id: "hpe-aruba" }, { id: "kaspersky" }, { id: "f5" }, { id: "checkpoint" }, { id: "cisco" }];
  const today = "2026-07-19";

  it("résout un consultant existant et marque les manquants à créer", () => {
    const consultants = [{ id: "c-stev", name: "Stevensky Aboua" }]; // seul existant
    const plan = planCertImport(consultants, partners, today);
    // Stevensky existe → pas dans needConsultants ; les autres nommés y sont.
    const needNorms = plan.needConsultants.map((n) => n.norm);
    expect(needNorms).not.toContain("stevensky aboua");
    expect(needNorms).toContain("mel ndiamoi"); // apostrophe pliée (audit adverse #3)
    expect(needNorms).toContain("agadji djibrine");
  });

  it("complète le catalogue de chaque partenaire (compétences + certifs)", () => {
    const plan = planCertImport([], partners, today);
    expect(plan.partnerPatches.fortinet.addCerts.some((c) => c.id === "nse-certification")).toBe(true);
    const aruba = plan.partnerPatches["hpe-aruba"];
    expect(aruba).toBeTruthy();
    expect(aruba.addComps.some((c) => c.id === "application-delivery")).toBe(true);
  });

  it("détenue → cert (date d'obtention rétro-calculée) ; à obtenir → assignation (date cible = échéance)", () => {
    const plan = planCertImport([], partners, today);
    const held = plan.certs.find((c) => c.partnerId === "hpe-aruba" && c.catalogId === "aruba-certified-switching-associate-acsa");
    expect(held).toBeTruthy();
    expect(held.obtainedDate).toBe("2024-05-31"); // 2027-05-31 − 36 mois
    const assign = plan.assignments.find((a) => a.partnerId === "paloalto" && a.catalogId === "software-firewall-product-specialization");
    expect(assign).toBeTruthy();
    expect(assign.targetDate).toBe("2026-07-25");
    expect(assign.status).toBe("planifie");
  });

  it("idempotence : si TOUS les noms existent déjà à l'annuaire, aucun consultant à créer (ré-import sûr)", () => {
    const { ROWS } = require("../domain/parCertSeed");
    const allNames = new Set();
    for (const r of ROWS) for (const e of r.eng) allNames.add(e);
    const consultants = [...allNames].map((name, i) => ({ id: `c${i}`, name }));
    const plan = planCertImport(consultants, partners, today);
    expect(plan.needConsultants).toHaveLength(0);
  });

  it("toutes les dates du plan sont d'années plausibles (rétro-calcul sain)", () => {
    const plan = planCertImport([], partners, today);
    const yr = (d) => Number(String(d).slice(0, 4));
    for (const c of plan.certs) expect(yr(c.obtainedDate)).toBeGreaterThanOrEqual(2015);
    for (const a of plan.assignments) expect(yr(a.targetDate)).toBeGreaterThanOrEqual(2015);
  });

  it("partenaire absent du référentiel → ligne écartée et rapportée", () => {
    const plan = planCertImport([], [{ id: "fortinet" }], today); // seul fortinet présent
    expect(plan.skipped.some((s) => s.reason.includes("partenaire absent"))).toBe(true);
    // Aucun cert/assignation pour un partenaire absent.
    expect(plan.certs.every((c) => c.partnerId === "fortinet")).toBe(true);
    expect(plan.assignments.every((a) => a.partnerId === "fortinet")).toBe(true);
  });
});
