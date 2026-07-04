import { describe, it, expect } from "vitest";
import { resolveLevel } from "./perm";

describe("resolveLevel — niveau d'accès (RBAC front)", () => {
  const m = { commercial: { pipeline: "write", rentabilite: "none" }, lecture: { overview: "read" } } as any;
  it("rôle absent → none", () => expect(resolveLevel(null, m, "pipeline")).toBe("none"));
  it("direction → write partout (même matrice nulle)", () => {
    expect(resolveLevel("direction", null, "toto")).toBe("write");
    expect(resolveLevel("direction", m, "rentabilite")).toBe("write");
  });
  it("matrice : valeur du module", () => {
    expect(resolveLevel("commercial", m, "pipeline")).toBe("write");
    expect(resolveLevel("commercial", m, "rentabilite")).toBe("none");
  });
  it("module non listé → none", () => expect(resolveLevel("lecture", m, "fournisseurs")).toBe("none"));
  it("non-direction sans matrice → none", () => expect(resolveLevel("commercial", null, "pipeline")).toBe("none"));
});
