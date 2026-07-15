import { describe, it, expect } from "vitest";
import { canonicalKey, buildClientResolver } from "./clientName";

// MIROIR de functions/domain/clientName.js — mêmes cas que clientName.test.js côté serveur, pour
// garantir qu'une graphie donne la MÊME clé canonique des deux côtés (sinon le filtre front diverge).
describe("canonicalKey (miroir serveur) — normalisation des noms clients", () => {
  it("MAJUSCULES + accents retirés", () => {
    expect(canonicalKey("Société Générale")).toBe("SOCIETE GENERALE");
  });
  it("suffixe pays (Côte d'Ivoire / CI) retiré", () => {
    expect(canonicalKey("Orange Côte d'Ivoire")).toBe("ORANGE");
    expect(canonicalKey("Orange CI")).toBe("ORANGE");
  });
  it("formes juridiques (SA/SARL…) retirées", () => {
    expect(canonicalKey("Nestlé SA")).toBe("NESTLE");
    expect(canonicalKey("Datcha SARL")).toBe("DATCHA");
  });
  it("ponctuation → espace, espaces normalisés", () => {
    expect(canonicalKey("  ACME,  Inc.  ")).toBe("ACME");
  });
  it("nom uniquement forme juridique/pays → repli sur le brut (jamais vide)", () => {
    expect(canonicalKey("SA")).toBe("SA");
  });
  it("nom vide → chaîne vide", () => {
    expect(canonicalKey("")).toBe("");
    expect(canonicalKey(null)).toBe("");
  });
});

describe("buildClientResolver — règles + alias (un niveau)", () => {
  const resolve = buildClientResolver([{ from: "SGBCI", to: "Société Générale" }]);
  it("règles déterministes rapprochent accents / pays / juridique", () => {
    expect(resolve("Société Générale CI")).toBe("SOCIETE GENERALE");
    expect(resolve("SOCIETE GENERALE")).toBe("SOCIETE GENERALE");
  });
  it("alias mappe une variante non rattrapée par les règles vers la cible canonique", () => {
    expect(resolve("SGBCI")).toBe("SOCIETE GENERALE");
    expect(resolve("sgbci")).toBe("SOCIETE GENERALE"); // insensible à la casse
  });
  it("client hors alias → sa propre clé canonique", () => {
    expect(resolve("Orange CI")).toBe("ORANGE");
  });
});
