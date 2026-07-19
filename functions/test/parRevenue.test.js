import { describe, it, expect } from "vitest";
const { resolvePartner, revenueByPartner, revenueProgress, blendRevenue } = require("../domain/parRevenue");

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
