import { describe, it, expect } from "vitest";
const { slugKey, normalizeDefs, sanitizeCustom } = require("../domain/customField");

describe("slugKey", () => {
  it("minuscule alphanumérique + underscore", () => {
    expect(slugKey("Secteur d'activité !")).toBe("secteur_d_activit");
    expect(slugKey("  Score ABC  ")).toBe("score_abc");
  });
});

describe("normalizeDefs", () => {
  it("déduplique par clé, borne, défaut type text", () => {
    const defs = normalizeDefs([
      { label: "Concurrent", type: "text" },
      { label: "Concurrent", type: "number" }, // doublon de clé → ignoré
      { label: "Canal", type: "select", options: ["Direct", "Partenaire", ""] },
    ]);
    expect(defs.map((d) => d.key)).toEqual(["concurrent", "canal"]);
    expect(defs[1].options).toEqual(["Direct", "Partenaire"]);
  });
  it("type inconnu → text ; active par défaut true", () => {
    const d = normalizeDefs([{ label: "X", type: "date" }])[0];
    expect(d.type).toBe("text");
    expect(d.active).toBe(true);
  });
});

describe("sanitizeCustom — coercition + filtrage contre les définitions actives", () => {
  const defs = [
    { key: "concurrent", type: "text", active: true },
    { key: "score", type: "number", active: true },
    { key: "canal", type: "select", options: ["Direct", "Partenaire"], active: true },
    { key: "vieux", type: "text", active: false },
  ];
  it("ignore les clés inconnues ou inactives", () => {
    const r = sanitizeCustom(defs, { concurrent: "Acme", inconnu: "x", vieux: "y" });
    expect(r).toEqual({ concurrent: "Acme" });
  });
  it("coerce nombre (invalide → null)", () => {
    expect(sanitizeCustom(defs, { score: "42" }).score).toBe(42);
    expect(sanitizeCustom(defs, { score: "abc" }).score).toBeNull();
    expect(sanitizeCustom(defs, { score: "" }).score).toBeNull();
  });
  it("select : valeur hors options → null", () => {
    expect(sanitizeCustom(defs, { canal: "Direct" }).canal).toBe("Direct");
    expect(sanitizeCustom(defs, { canal: "Autre" }).canal).toBeNull();
  });
  it("borne le texte à 500", () => {
    expect(sanitizeCustom(defs, { concurrent: "a".repeat(999) }).concurrent).toHaveLength(500);
  });
});
