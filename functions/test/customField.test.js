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
    const d = normalizeDefs([{ label: "X", type: "wysiwyg" }])[0]; // type non supporté → repli text
    expect(d.type).toBe("text");
    expect(d.active).toBe(true);
  });
  it("accepte les types date et checkbox (R9)", () => {
    const defs = normalizeDefs([{ label: "Échéance", type: "date" }, { label: "Prioritaire", type: "checkbox" }]);
    expect(defs.map((d) => d.type)).toEqual(["date", "checkbox"]);
  });
});

describe("sanitizeCustom — coercition + filtrage contre les définitions actives", () => {
  const defs = [
    { key: "concurrent", type: "text", active: true },
    { key: "score", type: "number", active: true },
    { key: "canal", type: "select", options: ["Direct", "Partenaire"], active: true },
    { key: "echeance", type: "date", active: true },
    { key: "prioritaire", type: "checkbox", active: true },
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
  it("date : ISO valide conservée, sinon null (R9)", () => {
    expect(sanitizeCustom(defs, { echeance: "2026-07-09" }).echeance).toBe("2026-07-09");
    expect(sanitizeCustom(defs, { echeance: "09/07/2026" }).echeance).toBeNull();
    expect(sanitizeCustom(defs, { echeance: "" }).echeance).toBeNull();
  });
  it("checkbox : booléen strict (R9)", () => {
    expect(sanitizeCustom(defs, { prioritaire: true }).prioritaire).toBe(true);
    expect(sanitizeCustom(defs, { prioritaire: "true" }).prioritaire).toBe(true);
    expect(sanitizeCustom(defs, { prioritaire: "1" }).prioritaire).toBe(true);
    expect(sanitizeCustom(defs, { prioritaire: false }).prioritaire).toBe(false);
    expect(sanitizeCustom(defs, { prioritaire: "non" }).prioritaire).toBe(false);
  });
});
