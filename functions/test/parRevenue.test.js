import { describe, it, expect } from "vitest";
const { resolvePartner, revenueByPartner, revenueProgress, blendRevenue, allocationsFor, bcYear, normalizeSupplier } = require("../domain/parRevenue");

// Audit adverse #4 : la clé fournisseur doit être ROBUSTE à l'espacement variable selon la source du BC.
describe("normalizeSupplier — clé robuste (compacte espaces + MAJUSCULES)", () => {
  it("compacte les espaces internes, coupe les bords, met en majuscules", () => {
    expect(normalizeSupplier("  Dell   Technologies ")).toBe("DELL TECHNOLOGIES");
    expect(normalizeSupplier("dell technologies")).toBe("DELL TECHNOLOGIES");
  });
  it("un même fournisseur à espacement variable (Odoo vs ClickUp) résout au MÊME partenaire", () => {
    const map = { "DELL TECHNOLOGIES": "dell" }; // clé compactée (comme setParPartnerMap la stocke)
    expect(resolvePartner("DELL  TECHNOLOGIES", map)).toBe("dell"); // double espace (ClickUp) → matche quand même
    const { partners, unmapped } = revenueByPartner([
      { supplier: "DELL TECHNOLOGIES", amountXof: 100 }, // Odoo (compacté)
      { supplier: "DELL  TECHNOLOGIES", amountXof: 50 }, // ClickUp (double espace)
    ], map);
    expect(partners).toHaveLength(1); // un seul partenaire, pas de scission
    expect(partners[0].revenueXof).toBe(150);
    expect(unmapped).toHaveLength(0);
  });
});

// CA partenaire dérivé des BC fournisseurs (ADR-P02). Aucune saisie : somme des BC par constructeur.
describe("parRevenue — CA dérivé des BC", () => {
  const map = { "DELL TECHNOLOGIES": "dell", "DELL": "dell", "CISCO SYSTEMS": "cisco" };

  it("resolvePartner : normalise (majuscules/espaces) et mappe ; null si inconnu", () => {
    expect(resolvePartner(" dell technologies ", map)).toBe("dell");
    expect(resolvePartner("Cisco Systems", map)).toBe("cisco");
    expect(resolvePartner("Fortinet", map)).toBe(null);
  });

  it("agrège le CA par partenaire et arrondit en XOF entier", () => {
    const bc = [
      { supplier: "Dell Technologies", amountXof: 720000.4 },
      { supplier: "DELL", amountXof: 300000 },
      { supplier: "Cisco Systems", amountXof: 1100000 },
    ];
    const { partners } = revenueByPartner(bc, map);
    expect(partners[0]).toEqual({ partnerId: "cisco", revenueXof: 1100000, bcCount: 1 });
    const dell = partners.find((p) => p.partnerId === "dell");
    expect(dell).toEqual({ partnerId: "dell", revenueXof: 1020000, bcCount: 2 }); // 720000.4 + 300000 → arrondi
  });

  it("remonte les fournisseurs NON mappés à part (jamais ignorés silencieusement)", () => {
    const bc = [
      { supplier: "Fortinet", amountXof: 500000 },
      { supplier: "Dell", amountXof: 100000 },
    ];
    const { partners, unmapped } = revenueByPartner(bc, map);
    expect(partners).toHaveLength(1);
    expect(unmapped).toEqual([{ supplier: "FORTINET", revenueXof: 500000, bcCount: 1 }]);
  });

  it("ignore les BC à montant nul/négatif (déjà signalés par la qualité fournisseurs)", () => {
    const bc = [{ supplier: "Dell", amountXof: 0 }, { supplier: "Dell", amountXof: -5 }, { supplier: "Dell", amountXof: 200000 }];
    const { partners } = revenueByPartner(bc, map);
    expect(partners).toEqual([{ partnerId: "dell", revenueXof: 200000, bcCount: 1 }]);
  });

  it("revenueProgress : borné à 100, null sans objectif", () => {
    expect(revenueProgress(500000, 1000000)).toBe(50);
    expect(revenueProgress(1500000, 1000000)).toBe(100);
    expect(revenueProgress(500000, null)).toBe(null);
    expect(revenueProgress(500000, 0)).toBe(null);
  });
});

// Mapping fournisseur MULTI-CONSTRUCTEUR (ADR-P14) : un distributeur porte plusieurs marques ; on répartit
// le montant BC par poids (somme = 1) — jamais de double-compte entre constructeurs.
describe("allocationsFor — répartition d'un fournisseur", () => {
  it("string legacy → un seul constructeur à 100 %", () => {
    expect(allocationsFor("dell")).toEqual([{ partnerId: "dell", weight: 1 }]);
    expect(allocationsFor("  ")).toEqual([]);
    expect(allocationsFor(null)).toEqual([]);
  });
  it("objet { partnerId: poids } → normalisé à somme 1, poids invalides écartés", () => {
    const a = allocationsFor({ cisco: 3, fortinet: 1, bad: 0, nope: -2 });
    expect(a).toEqual([{ partnerId: "cisco", weight: 0.75 }, { partnerId: "fortinet", weight: 0.25 }]);
  });
});

describe("revenueByPartner — répartition multi-constructeur", () => {
  it("un BC d'un distributeur est réparti par poids (somme des parts = montant)", () => {
    const bc = [{ supplier: "HDF SAS", amountXof: 1000000 }];
    const map = { "HDF SAS": { cisco: 3, fortinet: 1 } }; // 75 % / 25 %
    const { partners } = revenueByPartner(bc, map);
    const byId = Object.fromEntries(partners.map((p) => [p.partnerId, p.revenueXof]));
    expect(byId.cisco).toBe(750000);
    expect(byId.fortinet).toBe(250000);
    expect(byId.cisco + byId.fortinet).toBe(1000000); // aucun double-compte
  });
  it("mapping simple (string) inchangé — 100 % au constructeur", () => {
    const { partners } = revenueByPartner([{ supplier: "Dell", amountXof: 500000 }], { DELL: "dell" });
    expect(partners).toEqual([{ partnerId: "dell", revenueXof: 500000, bcCount: 1 }]);
  });
});

// CA MIXTE : BC dérivé + déclaratif (ADR-P10). Règle anti-double-compte : BC prime, déclaratif en repli.
describe("blendRevenue — mélange BC + déclaratif", () => {
  it("BC prime dès qu'il existe (déclaratif ignoré, jamais additif)", () => {
    const bc = [{ partnerId: "dell", revenueXof: 900000, bcCount: 3 }];
    const out = blendRevenue(bc, { dell: 500000 });
    const dell = out.find((g) => g.partnerId === "dell");
    expect(dell.revenueXof).toBe(900000); // BC, pas 1 400 000
    expect(dell.source).toBe("bc");
    expect(dell.declaredXof).toBe(500000); // conservé pour l'affichage
  });

  it("déclaratif en repli quand aucun BC n'est rattaché", () => {
    const out = blendRevenue([], { fortinet: 250000 });
    const f = out.find((g) => g.partnerId === "fortinet");
    expect(f.revenueXof).toBe(250000);
    expect(f.source).toBe("declare");
    expect(f.bcXof).toBe(0);
  });

  it("union des partenaires BC-mappés et déclaratifs ; ceux à 0 des deux côtés sont écartés", () => {
    const bc = [{ partnerId: "cisco", revenueXof: 100000, bcCount: 1 }];
    const out = blendRevenue(bc, { fortinet: 40000, vide: 0 });
    const ids = out.map((g) => g.partnerId).sort();
    expect(ids).toEqual(["cisco", "fortinet"]);
    expect(out[0].partnerId).toBe("cisco"); // trié desc
  });
});

// Millésime d'exercice (ADR-P16) — le CA « YTD » ne doit plus sommer tous les BC de l'histoire.
describe("bcYear + revenueByPartner scopé à l'exercice", () => {
  const YEAR = new Date().getFullYear();
  it("bcYear : lit AAAA du n° BC/AAAA/N ; repli sur le millésime d'affaire FP/AAAA/N ; 0 sinon", () => {
    expect(bcYear({ bcNumber: `BC/${YEAR}/42` })).toBe(YEAR);
    expect(bcYear({ bcNumber: "BC/2019/7" })).toBe(2019);
    expect(bcYear({ bcNumber: "sans-annee", fp: "FP/2020/3" })).toBe(2020); // repli FP
    expect(bcYear({ bcNumber: "BC/1900/1" })).toBe(0); // millésime aberrant → plausibleYear écarte
    expect(bcYear({ bcNumber: "", fp: "" })).toBe(0);   // non daté
  });

  it("year : écarte les BC d'un AUTRE millésime (remontés dans offExerciseXof), garde l'exercice + les non datés", () => {
    const map = { "HDF": "cisco" };
    const bc = [
      { supplier: "HDF", amountXof: 1000, bcNumber: `BC/${YEAR}/1` },      // exercice courant → compté
      { supplier: "HDF", amountXof: 500, bcNumber: "BC/2019/9" },          // vieux millésime → écarté
      { supplier: "HDF", amountXof: 300, bcNumber: "sans-numero", fp: "" }, // non daté → conservé (pas de sous-compte)
    ];
    const out = revenueByPartner(bc, map, { year: YEAR });
    const cisco = out.partners.find((p) => p.partnerId === "cisco");
    expect(cisco.revenueXof).toBe(1300);      // 1000 (exercice) + 300 (non daté), PAS le 500 de 2019
    expect(out.offExerciseXof).toBe(500);     // le vieux millésime, remonté et non ignoré
    expect(out.offExerciseCount).toBe(1);
  });

  it("sans year : cumul all-time (rétro-compat) — offExerciseXof = 0", () => {
    const bc = [{ supplier: "HDF", amountXof: 500, bcNumber: "BC/2019/9" }];
    const out = revenueByPartner(bc, { "HDF": "cisco" });
    expect(out.partners[0].revenueXof).toBe(500);
    expect(out.offExerciseXof).toBe(0);
  });
});
