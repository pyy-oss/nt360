import { describe, it, expect } from "vitest";
const { ownerChain, descendants } = require("../domain/hierarchy");

// Hiérarchie de test : direction(dir) ← commercial_dir(cdir) ← commercial A(a), commercial B(b).
const USERS = {
  dir: { managerUid: null },
  cdir: { managerUid: "dir" },
  a: { managerUid: "cdir" },
  b: { managerUid: "cdir" },
  orphan: {},
};

describe("ownerChain — visibleTo = propriétaire + ligne hiérarchique ascendante", () => {
  it("remonte toute la chaîne (self → manager → … → direction)", () => {
    expect(ownerChain(USERS, "a")).toEqual(["a", "cdir", "dir"]);
    expect(ownerChain(USERS, "cdir")).toEqual(["cdir", "dir"]);
    expect(ownerChain(USERS, "dir")).toEqual(["dir"]);
  });
  it("propriétaire sans manager → chaîne = [self]", () => {
    expect(ownerChain(USERS, "orphan")).toEqual(["orphan"]);
  });
  it("propriétaire absent/vide → [] (enregistrement sans propriétaire)", () => {
    expect(ownerChain(USERS, "")).toEqual([]);
    expect(ownerChain(USERS, null)).toEqual([]);
  });
  it("uid inconnu de la map → [self] (pas de crash, pas de manager)", () => {
    expect(ownerChain(USERS, "ghost")).toEqual(["ghost"]);
  });
  it("garde-fou anti-cycle (A→B→A) : chaîne finie, chaque uid une seule fois", () => {
    const cyc = { x: { managerUid: "y" }, y: { managerUid: "x" } };
    expect(ownerChain(cyc, "x")).toEqual(["x", "y"]);
  });
  it("plafond de profondeur respecté", () => {
    const deep = {};
    for (let i = 0; i < 30; i++) deep["u" + i] = { managerUid: "u" + (i + 1) };
    expect(ownerChain(deep, "u0", 5)).toHaveLength(5);
  });
});

describe("descendants — sous-arbre d'un uid (pour ré-indexer visibleTo)", () => {
  it("inclut self + tous les subordonnés transitifs", () => {
    expect(descendants(USERS, "dir").sort()).toEqual(["a", "b", "cdir", "dir"]);
    expect(descendants(USERS, "cdir").sort()).toEqual(["a", "b", "cdir"]);
    expect(descendants(USERS, "a")).toEqual(["a"]);
  });
  it("racine vide → []", () => {
    expect(descendants(USERS, "")).toEqual([]);
  });
  it("anti-cycle : ensemble fini", () => {
    const cyc = { x: { managerUid: "y" }, y: { managerUid: "x" } };
    expect(descendants(cyc, "x").sort()).toEqual(["x", "y"]);
  });
});
