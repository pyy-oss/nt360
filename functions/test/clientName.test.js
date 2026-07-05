import { describe, it, expect } from "vitest";
const { canonicalKey, buildClientResolver } = require("../domain/clientName");

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
});
