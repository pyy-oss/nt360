import { describe, it, expect } from "vitest";
const { buildSupplierResolver, groupSupplierNames } = require("../domain/supplierName");

describe("supplierName — résolveur minimal (cleanName + alias manuels)", () => {
  it("sans alias : resolve === cleanName (identité, non-régression SOA)", () => {
    const r = buildSupplierResolver([]);
    expect(r("Dell  Technologies")).toBe("DELL TECHNOLOGIES"); // espaces compactés + MAJ (cleanName)
    expect(r("  samsung ")).toBe("SAMSUNG");
    expect(r("")).toBe("");
  });

  it("alias : une variante pointe vers la clé cible (cleanName des deux côtés)", () => {
    const r = buildSupplierResolver([{ from: "Samsung Electronics", to: "SAMSUNG" }]);
    expect(r("samsung electronics")).toBe("SAMSUNG"); // variante → cible
    expect(r("SAMSUNG")).toBe("SAMSUNG");             // cible inchangée
    expect(r("Dell")).toBe("DELL");                   // hors alias → cleanName
  });

  it("alias ignoré si from/to identiques après cleanName ou vides", () => {
    const r = buildSupplierResolver([{ from: "DELL", to: "dell" }, { from: "", to: "X" }, { from: "Y", to: "" }]);
    expect(r("DELL")).toBe("DELL"); // from==to après cleanName → pas de mapping
    expect(r("Y")).toBe("Y");
  });

  it("résolution à UN niveau (pas de chaînage)", () => {
    // A→B et B→C : A ne doit PAS suivre jusqu'à C (pointer directement A→C).
    const r = buildSupplierResolver([{ from: "A", to: "B" }, { from: "B", to: "C" }]);
    expect(r("A")).toBe("B");
    expect(r("B")).toBe("C");
  });
});

describe("groupSupplierNames — inventaire à normaliser", () => {
  it("regroupe par clé canonique effective, compte les variantes et le total", () => {
    const names = [
      { name: "SAMSUNG", count: 3 },
      { name: "Samsung Electronics", count: 2 },
      { name: "DELL", count: 5 },
    ];
    const groups = groupSupplierNames(names, [{ from: "Samsung Electronics", to: "SAMSUNG" }]);
    // trié par total desc : SAMSUNG (3+2=5) puis DELL (5) — égalité, ordre stable sur l'insertion
    const samsung = groups.find((g) => g.canon === "SAMSUNG");
    expect(samsung.total).toBe(5);
    expect(samsung.distinct).toBe(2);
    expect(samsung.hasVariants).toBe(true);
    expect(samsung.variants[0].name).toBe("SAMSUNG"); // plus gros count d'abord
    expect(samsung.variants.find((v) => v.name === "Samsung Electronics").aliased).toBe(true);
    const dell = groups.find((g) => g.canon === "DELL");
    expect(dell.hasVariants).toBe(false);
  });

  it("deux graphies au même cleanName se regroupent SANS alias (espaces/casse)", () => {
    const groups = groupSupplierNames([{ name: "dell  technologies", count: 1 }, { name: "DELL TECHNOLOGIES", count: 4 }], []);
    expect(groups.length).toBe(1);
    expect(groups[0].canon).toBe("DELL TECHNOLOGIES");
    expect(groups[0].total).toBe(5);
  });

  it("ignore les noms vides", () => {
    const groups = groupSupplierNames([{ name: "  ", count: 9 }, { name: "DELL", count: 1 }], []);
    expect(groups.length).toBe(1);
    expect(groups[0].canon).toBe("DELL");
  });
});
