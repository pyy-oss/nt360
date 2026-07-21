import { describe, it, expect } from "vitest";
const { dedupeLiveOpps, maskSaisieCovered, isLiveSource } = require("../domain/liveOpps");
const { bcCompareKey } = require("../lib/ids");

// Source unique de la dédup LIVE (aggregate + correctionQueue) — audit 40 axes, axe 27 : la
// ré-implémentation locale du Centre de correction ignorait Odoo et la dédup intra-live.
describe("liveOpps — dédup intra-live (salesData + odoo, le plus récent par FP)", () => {
  it("deux docs LIVE de même FP → seul le plus récent (updatedAt) survit, toutes sources confondues", () => {
    const a = { id: "x", source: "salesData", fp: "FP/2026/1", updatedAt: 100 };
    const b = { id: "o", source: "odoo", fp: "FP/2026/1", updatedAt: 200 };
    const { oppsDedup } = dedupeLiveOpps([a, b]);
    expect(oppsDedup).toEqual([b]); // Odoo plus récent → représentant du FP
  });
  it("à égalité de date, le DERNIER lu l'emporte (>= — comportement historique du recompute)", () => {
    const a = { id: "a", source: "odoo", fp: "FP/2026/2", updatedAt: 100 };
    const b = { id: "b", source: "salesData", fp: "FP/2026/2", updatedAt: 100 };
    expect(dedupeLiveOpps([a, b]).oppsDedup).toEqual([b]);
  });
  it("updatedAt Timestamp Firestore (toMillis) accepté comme un nombre", () => {
    const ts = (ms) => ({ toMillis: () => ms });
    const a = { id: "a", source: "salesData", fp: "FP/2026/3", updatedAt: ts(50) };
    const b = { id: "b", source: "odoo", fp: "FP/2026/3", updatedAt: 100 };
    expect(dedupeLiveOpps([a, b]).oppsDedup).toEqual([b]);
  });
  it("live SANS FP → pas de clé, pas de dédup ; non-live jamais touché", () => {
    const rows = [
      { id: "1", source: "salesData" }, { id: "2", source: "odoo" },
      { id: "3", source: "saisie", fp: "FP/2026/4" },
    ];
    expect(dedupeLiveOpps(rows).oppsDedup).toEqual(rows);
  });
  it("les graphies d'un même FP convergent (fpKey : zéros de tête, casse)", () => {
    const a = { id: "a", source: "salesData", fp: "FP/2026/013", updatedAt: 1 };
    const b = { id: "b", source: "odoo", fp: "fp/2026/13", updatedAt: 2 };
    expect(dedupeLiveOpps([a, b]).oppsDedup).toEqual([b]);
  });
});

describe("liveOpps — masquage des « saisie » couvertes par un FP live", () => {
  it("une saisie doublonnant une opp ODOO est écartée (l'ancien Centre de correction ne voyait que salesData)", () => {
    const odoo = { id: "o", source: "odoo", fp: "FP/2026/5", updatedAt: 1 };
    const saisie = { id: "s", source: "saisie", fp: "FP/2026/5" };
    const { oppsDedup, liveFps } = dedupeLiveOpps([odoo, saisie]);
    expect(maskSaisieCovered(oppsDedup, liveFps)).toEqual([odoo]);
  });
  it("une saisie sans jumeau live est conservée", () => {
    const s = { id: "s", source: "saisie", fp: "FP/2026/6" };
    const { oppsDedup, liveFps } = dedupeLiveOpps([s]);
    expect(maskSaisieCovered(oppsDedup, liveFps)).toEqual([s]);
  });
  it("liveFps inclut un FP live même si l'opp est stale (stabilité du masquage, cf. recompute)", () => {
    const live = { id: "l", source: "salesData", fp: "FP/2026/7", stale: true, updatedAt: 1 };
    const saisie = { id: "s", source: "saisie", fp: "FP/2026/7" };
    const { liveFps } = dedupeLiveOpps([live, saisie]);
    expect(liveFps.has("FP/2026/7")).toBe(true); // le split stale est fait PAR L'APPELANT, après
  });
  it("isLiveSource : salesData et odoo seulement", () => {
    expect(isLiveSource({ source: "salesData" })).toBe(true);
    expect(isLiveSource({ source: "odoo" })).toBe(true);
    expect(isLiveSource({ source: "saisie" })).toBe(false);
  });
});

describe("bcCompareKey — clé de comparaison inter-graphies d'un N° BC (éviction anti double-compte SOA)", () => {
  it("« BC-001 » ≡ « BC 001 » ≡ « bc001 » (la clé safeId, elle, ne pliait pas le tiret)", () => {
    expect(bcCompareKey("BC-001")).toBe(bcCompareKey("BC 001"));
    expect(bcCompareKey("bc001")).toBe(bcCompareKey("BC-001"));
  });
  it("forme structurée : « BC-2026-001 » ≡ « BC/2026/1 » ≡ « BC 2026 01 » (zéros de tête normalisés)", () => {
    expect(bcCompareKey("BC-2026-001")).toBe(bcCompareKey("BC/2026/1"));
    expect(bcCompareKey("BC 2026 01")).toBe(bcCompareKey("BC/2026/1"));
  });
  it("deux BC réellement différents ne collisionnent pas ; vide → \"\"", () => {
    expect(bcCompareKey("BC/2026/1")).not.toBe(bcCompareKey("BC/2026/2"));
    expect(bcCompareKey("")).toBe("");
    expect(bcCompareKey(null)).toBe("");
  });
});
