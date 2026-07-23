import { describe, it, expect } from "vitest";
const { accountId } = require("../domain/accounts");

describe("accountId — id de compte déterministe, jointure avec le client canonique", () => {
  it("dérive un slug du nom canonique (espaces → _)", () => {
    expect(accountId("Sanlam Allianz")).toBe("SANLAM_ALLIANZ");
    expect(accountId("ORANGE")).toBe("ORANGE");
  });
  it("idempotent sur un nom déjà canonique + insensible aux formes juridiques/pays/accents", () => {
    expect(accountId(accountId("Orange Côte d'Ivoire SA"))).toBe(accountId("Orange Côte d'Ivoire SA"));
    // « SA » (forme juridique) et « Côte d'Ivoire » (pays) retirés par canonicalKey.
    expect(accountId("Orange Côte d'Ivoire SA")).toBe("ORANGE");
  });
  it("deux noms distincts ne collisionnent pas (slug conserve les mots)", () => {
    expect(accountId("AB C")).not.toBe(accountId("ABC"));
  });
  it("nom vide → id vide (pas de compte fantôme)", () => {
    expect(accountId("")).toBe("");
    expect(accountId(null)).toBe("");
  });
});
