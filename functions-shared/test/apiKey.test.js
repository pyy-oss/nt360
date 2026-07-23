import { describe, it, expect } from "vitest";
const { hashApiKey, parseBearer, matchRoute, API_RESOURCES } = require("../domain/apiKey");

describe("hashApiKey — SHA-256 déterministe (la clé brute n'est jamais stockée)", () => {
  it("même entrée → même hash, 64 hex", () => {
    const h = hashApiKey("nt360_abc");
    expect(h).toBe(hashApiKey("nt360_abc"));
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });
  it("entrées différentes → hash différents", () => {
    expect(hashApiKey("a")).not.toBe(hashApiKey("b"));
  });
});

describe("parseBearer", () => {
  it("extrait le jeton, insensible à la casse", () => {
    expect(parseBearer("Bearer xyz")).toBe("xyz");
    expect(parseBearer("bearer  token123 ")).toBe("token123");
  });
  it("null si absent/malformé", () => {
    expect(parseBearer("")).toBeNull();
    expect(parseBearer("Basic abc")).toBeNull();
    expect(parseBearer(undefined)).toBeNull();
  });
});

describe("matchRoute", () => {
  it("GET liste et détail", () => {
    expect(matchRoute("GET", "/v1/opportunities")).toEqual({ action: "list", resource: "opportunities", id: null });
    expect(matchRoute("GET", "/v1/accounts/ORANGE")).toEqual({ action: "get", resource: "accounts", id: "ORANGE" });
  });
  it("POST création réservé aux opportunités", () => {
    expect(matchRoute("POST", "/v1/opportunities")).toEqual({ action: "create", resource: "opportunities", id: null });
    expect(matchRoute("POST", "/v1/accounts")).toBeNull();
    expect(matchRoute("POST", "/v1/opportunities/x")).toBeNull(); // pas de POST sur un id
  });
  it("chemins non gérés → null", () => {
    expect(matchRoute("GET", "/v2/opportunities")).toBeNull();
    expect(matchRoute("GET", "/v1/invoices")).toBeNull();
    expect(matchRoute("DELETE", "/v1/opportunities/x")).toBeNull();
    expect(matchRoute("GET", "/v1/opportunities/x/y")).toBeNull(); // trop de segments
  });
  it("décode l'id encodé", () => {
    expect(matchRoute("GET", "/v1/opportunities/saisie%5Fx").id).toBe("saisie_x");
  });
  it("expose les ressources", () => {
    expect(API_RESOURCES).toEqual(["opportunities", "accounts"]);
  });
});
