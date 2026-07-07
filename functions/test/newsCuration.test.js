import { describe, it, expect } from "vitest";
const { buildSignals, humanizeId, SIGNAL_CATALOG, CURATION_THRESHOLD } = require("../domain/newsCuration");
const { parseJson } = require("../lib/anthropic");

describe("newsCuration — dé-identification par CONSTRUCTION (aucune fuite vers l'API)", () => {
  it("un bulletin porteur de noms/montants ne laisse filtrer QUE {key, domain, severity, label}", () => {
    const sensitive = {
      id: "pipeline_concentration", domain: "pipeline", severity: "medium",
      title: "Pipeline concentré sur JEAN DUPONT",
      detail: "JEAN DUPONT porte 1.2 Md (60 %) du pipeline pondéré — SOCIÉTÉ ACME.",
      refs: ["JEAN DUPONT", "SOCIÉTÉ ACME", "FP/2026/00042"],
      module: "am360",
    };
    const signals = buildSignals([sensitive]);
    const sig = signals.find((s) => s.key === "pipeline_concentration");
    // Le signal ne contient QUE les 4 champs non-sensibles.
    expect(Object.keys(sig).sort()).toEqual(["domain", "key", "label", "severity"]);
    // Le libellé vient du CATALOGUE statique, jamais du texte réel du bulletin.
    expect(sig.label).toBe(SIGNAL_CATALOG.pipeline_concentration);
    expect(sig.domain).toBe("pipeline");
    expect(sig.severity).toBe("medium");
    // Aucune donnée sensible (nom / montant / FP / module) dans TOUTE la charge envoyée.
    const payload = JSON.stringify(signals);
    for (const leak of ["JEAN DUPONT", "SOCIÉTÉ ACME", "ACME", "FP/2026/00042", "1.2 Md", "60 %", "am360"]) {
      expect(payload).not.toContain(leak);
    }
  });
});

describe("newsCuration — buildSignals (catalogue + bulletins actifs)", () => {
  it("sans bulletin actif, renvoie tout le catalogue (domaine/sévérité vides)", () => {
    const signals = buildSignals([]);
    expect(signals.length).toBe(Object.keys(SIGNAL_CATALOG).length);
    expect(signals.every((s) => s.key && s.label && s.domain === "" && s.severity === "")).toBe(true);
  });
  it("enrichit le domaine/la sévérité depuis un bulletin actif connu", () => {
    const sig = buildSignals([{ id: "creances_echues", domain: "facturation", severity: "high" }])
      .find((s) => s.key === "creances_echues");
    expect(sig.domain).toBe("facturation");
    expect(sig.severity).toBe("high");
    expect(sig.label).toBe(SIGNAL_CATALOG.creances_echues);
  });
  it("un id NON catalogué (nouveau déclencheur) est inclus avec un libellé humanisé neutre", () => {
    const signals = buildSignals([{ id: "nouveau_signal_test", domain: "pipeline", severity: "info" }]);
    const sig = signals.find((s) => s.key === "nouveau_signal_test");
    expect(sig).toBeTruthy();
    expect(sig.label).toBe("Nouveau signal test");
    expect(signals.length).toBe(Object.keys(SIGNAL_CATALOG).length + 1);
  });
  it("dédoublonne un id présent plusieurs fois", () => {
    const signals = buildSignals([{ id: "dso_eleve", domain: "facturation", severity: "medium" }, { id: "dso_eleve", domain: "facturation", severity: "medium" }]);
    expect(signals.filter((s) => s.key === "dso_eleve")).toHaveLength(1);
  });
  it("le seuil de rétention par défaut est exposé", () => {
    expect(CURATION_THRESHOLD).toBe(50);
  });
});

describe("newsCuration — humanizeId", () => {
  it("transforme un slug en libellé lisible", () => {
    expect(humanizeId("backlog_concentration_client")).toBe("Backlog concentration client");
    expect(humanizeId("")).toBe("");
  });
});

describe("anthropic — parseJson (tolère enrobage / prose)", () => {
  it("parse un JSON simple", () => {
    expect(parseJson('{"scores":[{"key":"a","relevance":80}]}').scores[0].key).toBe("a");
  });
  it("parse un JSON enrobé de ```json", () => {
    expect(parseJson('```json\n{"scores":[]}\n```').scores).toEqual([]);
  });
  it("extrait le 1er objet JSON noyé dans de la prose", () => {
    expect(parseJson('Voici : {"scores":[{"key":"b","relevance":10}]} merci').scores[0].key).toBe("b");
  });
  it("renvoie {} sur une entrée illisible", () => {
    expect(parseJson("pas du json")).toEqual({});
  });
});
