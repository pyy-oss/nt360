import { describe, it, expect } from "vitest";
const { resolveLevel, canRead, canWrite, validateMatrix } = require("../domain/authz");

const M = {
  commercial: { overview: "read", pipeline: "write", rentabilite: "none" },
  achats: { bc: "write", overview: "read" },
};

describe("authz — résolution du niveau depuis la matrice opposable", () => {
  it("direction = write partout (superviseur), quel que soit le module", () => {
    expect(resolveLevel(M, "direction", "rentabilite")).toBe("write");
    expect(canWrite(M, "direction", "habilitations")).toBe(true);
  });
  it("valeur de la matrice sinon, `none` par défaut", () => {
    expect(resolveLevel(M, "commercial", "pipeline")).toBe("write");
    expect(resolveLevel(M, "commercial", "overview")).toBe("read");
    expect(resolveLevel(M, "commercial", "rentabilite")).toBe("none");
    expect(resolveLevel(M, "commercial", "inconnu")).toBe("none"); // module absent → none
    expect(resolveLevel(M, "achats", "pipeline")).toBe("none");    // module non listé pour ce rôle
  });
  it("rôle absent / nul → none", () => {
    expect(resolveLevel(M, null, "overview")).toBe("none");
    expect(resolveLevel(M, "inexistant", "overview")).toBe("none");
    expect(resolveLevel(null, "commercial", "overview")).toBe("none");
  });
  it("canRead = read|write ; canWrite = write strict", () => {
    expect(canRead(M, "commercial", "overview")).toBe(true);
    expect(canWrite(M, "commercial", "overview")).toBe(false);
    expect(canRead(M, "commercial", "rentabilite")).toBe(false);
  });
  it("valeur corrompue dans la matrice → none (défensif)", () => {
    expect(resolveLevel({ commercial: { overview: "admin" } }, "commercial", "overview")).toBe("none");
  });
});

describe("authz — validation de matrice (anti-DoS RBAC)", () => {
  it("accepte une matrice bien formée", () => {
    expect(validateMatrix(M).ok).toBe(true);
  });
  it("accepte les rôles personas (finance/directeur_contrats/data_steward) — audit P2-5", () => {
    expect(validateMatrix({ finance: { facturation: "write", rentabilite: "write" } }).ok).toBe(true);
    expect(validateMatrix({ directeur_contrats: { maintenance: "write" } }).ok).toBe(true);
    expect(validateMatrix({ data_steward: { import: "write" } }).ok).toBe(true);
    // Sûr par défaut : un rôle sans ligne de matrice résout à « none » partout.
    expect(resolveLevel({}, "finance", "facturation")).toBe("none");
    expect(resolveLevel({ finance: { facturation: "write" } }, "finance", "facturation")).toBe("write");
    expect(resolveLevel({ finance: { facturation: "write" } }, "finance", "rentabilite")).toBe("none");
  });
  it("rejette rôle inconnu / niveau invalide / structure invalide / vide", () => {
    expect(validateMatrix({ intrus: { overview: "read" } }).ok).toBe(false);
    expect(validateMatrix({ commercial: { overview: "admin" } }).ok).toBe(false);
    expect(validateMatrix({ commercial: "read" }).ok).toBe(false);
    expect(validateMatrix({}).ok).toBe(false);
    expect(validateMatrix(null).ok).toBe(false);
    expect(validateMatrix([]).ok).toBe(false);
  });
});
