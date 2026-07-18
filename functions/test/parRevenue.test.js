import { describe, it, expect } from "vitest";
const { resolvePartner, revenueByPartner, revenueProgress } = require("../domain/parRevenue");

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
