import { describe, it, expect } from "vitest";
import { filterMatch } from "./filters";
import { buildClientResolver } from "./clientName";

describe("filterMatch — prédicat de filtre transverse", () => {
  it("critère vide n'exclut jamais", () => {
    expect(filterMatch({ bu: "", am: "", client: "", pm: "" }, { bu: "ICT" })).toBe(true);
  });
  it("insensible à la casse / espaces", () => {
    expect(filterMatch({ bu: " ict ", am: "", client: "", pm: "" }, { bu: "ICT" })).toBe(true);
  });
  it("exclut si la dimension diffère", () => {
    expect(filterMatch({ bu: "ICT", am: "", client: "", pm: "" }, { bu: "CLOUD" })).toBe(false);
  });
  it("dims restreint les dimensions testées", () => {
    expect(filterMatch({ bu: "", am: "X", client: "", pm: "" }, { am: "Y" }, ["bu"])).toBe(true); // AM non testé
    expect(filterMatch({ bu: "", am: "X", client: "", pm: "" }, { am: "Y" }, ["am"])).toBe(false);
  });
  it("combinaison multi-critères (ET)", () => {
    expect(filterMatch({ bu: "ICT", am: "DATCHA", client: "", pm: "" }, { bu: "ICT", am: "DATCHA" })).toBe(true);
    expect(filterMatch({ bu: "ICT", am: "DATCHA", client: "", pm: "" }, { bu: "ICT", am: "KOUADIO" })).toBe(false);
  });
  it("client : sans résolveur, comparaison BRUTE (une graphie non canonique ne matche pas l'option canonique)", () => {
    // Régression documentée : l'option vient de clients_all (canonique) ; la ligne est brute.
    const f = { bu: "", am: "", client: "SOCIETE GENERALE", pm: "" };
    expect(filterMatch(f, { client: "Société Générale CI" })).toBe(false);
  });
  it("client : AVEC résolveur (miroir serveur), une graphie brute matche sa cible canonique", () => {
    const ck = buildClientResolver([{ from: "SGBCI", to: "Société Générale" }]);
    const f = { bu: "", am: "", client: "SOCIETE GENERALE", pm: "" };
    // Règles déterministes : accents + suffixe pays « CI » retirés → même clé.
    expect(filterMatch(f, { client: "Société Générale Côte d'Ivoire" }, undefined, ck)).toBe(true);
    // Alias : « SGBCI » pointe vers la cible.
    expect(filterMatch(f, { client: "SGBCI" }, undefined, ck)).toBe(true);
    // Client différent : toujours exclu.
    expect(filterMatch(f, { client: "Orange CI" }, undefined, ck)).toBe(false);
  });
});
