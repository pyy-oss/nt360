import { describe, it, expect } from "vitest";
const { canonicalKey, buildClientResolver, groupClientNames } = require("../domain/clientName");

describe("clientName — normalisation des noms de clients", () => {
  it("règles : casse, accents, ponctuation, suffixe pays → même clé", () => {
    const k = canonicalKey("ORANGE CI");
    expect(k).toBe("ORANGE");
    for (const v of ["Orange Côte d'Ivoire", "ORANGE-CI", "orange", "  Orange   CI  ", "ORANGE, CI"]) {
      expect(canonicalKey(v)).toBe(k);
    }
  });

  it("forme juridique retirée mais « SOCIETE » conservé (fait partie du nom)", () => {
    expect(canonicalKey("Société Générale SA")).toBe("SOCIETE GENERALE");
    expect(canonicalKey("SOCIETE GENERALE COTE D IVOIRE")).toBe("SOCIETE GENERALE");
    // On ne réduit jamais à vide : un nom purement juridique/pays garde le brut.
    expect(canonicalKey("SARL")).toBe("SARL");
  });

  it("nom vide / non normalisable", () => {
    expect(canonicalKey("")).toBe("");
    expect(canonicalKey(null)).toBe("");
    expect(canonicalKey("   ")).toBe("");
  });

  it("résolveur d'alias : fusionne deux graphies distinctes vers la même cible", () => {
    const resolve = buildClientResolver([{ from: "SGBCI", to: "Société Générale" }]);
    expect(resolve("SGBCI")).toBe("SOCIETE GENERALE");
    expect(resolve("Societe Generale CI")).toBe("SOCIETE GENERALE"); // via les règles
    expect(resolve("ORANGE CI")).toBe("ORANGE"); // hors alias → clé de règle
  });

  it("résolveur : paires invalides ignorées, pas de chaînage, pas d'auto-mapping", () => {
    const resolve = buildClientResolver([
      { from: "", to: "X" }, { from: "Y" }, null,
      { from: "MTN CI", to: "MTN CI" }, // from==to après clé → ignoré
    ]);
    expect(resolve("MTN CI")).toBe("MTN"); // clé de règle, pas d'alias appliqué
    expect(resolve("Client Inconnu")).toBe("CLIENT INCONNU");
  });

  describe("groupClientNames — atelier de normalisation", () => {
    it("regroupe les graphies par cible canonique, compte, trie par volume", () => {
      const names = [
        { name: "Orange CI", count: 10 }, { name: "ORANGE", count: 5 }, // → ORANGE (règles)
        { name: "MTN Côte d'Ivoire", count: 3 },                        // → MTN (seul)
        { name: "SGBCI", count: 8 },                                    // → SOCIETE GENERALE via alias
        { name: "Société Générale", count: 2 },
      ];
      const g = groupClientNames(names, [{ from: "SGBCI", to: "Société Générale" }]);
      const orange = g.find((x) => x.canon === "ORANGE");
      expect(orange.total).toBe(15);
      expect(orange.hasVariants).toBe(true);       // 2 graphies collapsent déjà (règles)
      expect(orange.variants.map((v) => v.name)).toEqual(["Orange CI", "ORANGE"]); // tri par count
      const sg = g.find((x) => x.canon === "SOCIETE GENERALE");
      expect(sg.total).toBe(10);
      expect(sg.variants.find((v) => v.name === "SGBCI").aliased).toBe(true); // graphie aliasée signalée
      expect(g[0].canon).toBe("ORANGE"); // tri global par volume total (15 > 10 > 3)
    });
    it("ignore les noms vides", () => {
      expect(groupClientNames([{ name: "  ", count: 5 }, { name: "", count: 1 }], [])).toEqual([]);
    });
  });
});
