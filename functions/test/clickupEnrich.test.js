import { describe, it, expect } from "vitest";
const { MARKER, RISK_TAG, buildSyncComment, needsRiskTag, findMarkedComment } = require("../lib/clickupEnrich");

describe("buildSyncComment — synthèse marquée idempotente", () => {
  it("commence par le marqueur et résume CA/RAF + %", () => {
    const t = buildSyncComment({ fp: "FP/1", cas: 1000000, facture: 250000, raf: 750000 });
    expect(t.startsWith(MARKER)).toBe(true);
    expect(t).toContain("25%");
    expect(t).toContain("750");
    expect(t).toContain("✅ Qualité : RAS");
  });
  it("liste jalons (prochain par date) + BC + anomalies qualité + retard", () => {
    const t = buildSyncComment({
      fp: "FP/2", cas: 100, facture: 0, raf: 100,
      milestones: [{ label: "Solde", amount: 60, dueDate: "2026-09-01" }, { label: "Acompte", amount: 40, dueDate: "2026-03-01" }],
      bcRefs: ["BC-1", "BC-2"], qualityFlags: ["FP manquant", "Montant nul"], overdue: true,
    });
    expect(t).toContain("Jalons de facturation : 2");
    expect(t).toContain("prochain 2026-03-01"); // le plus tôt gagne
    expect(t).toContain("BC fournisseurs liés : 2 (BC-1, BC-2)");
    expect(t).toContain("⚠️ Qualité : FP manquant, Montant nul");
    expect(t).toContain("retard");
  });
  it("0 CA signé → 0% sans division par zéro", () => {
    expect(buildSyncComment({ fp: "FP/3", cas: 0, facture: 0, raf: 0 })).toContain("(0%)");
  });
});

describe("needsRiskTag", () => {
  it("vrai si anomalies qualité OU retard, faux sinon", () => {
    expect(needsRiskTag({ qualityFlags: ["x"] })).toBe(true);
    expect(needsRiskTag({ overdue: true })).toBe(true);
    expect(needsRiskTag({ qualityFlags: [], overdue: false })).toBe(false);
    expect(needsRiskTag({})).toBe(false);
  });
});

describe("findMarkedComment — upsert idempotent", () => {
  it("retrouve NOTRE commentaire (le plus récent) parmi d'autres", () => {
    const comments = [
      { id: "c1", comment_text: "note humaine" },
      { id: "c2", comment_text: MARKER + " (mise à jour automatique)\n• …" },
      { id: "c3", comment_text: "autre" },
      { id: "c4", comment_text: MARKER + " v2" },
    ];
    expect(findMarkedComment(comments, MARKER).id).toBe("c4"); // le dernier marqué gagne
  });
  it("aucun commentaire marqué → null", () => {
    expect(findMarkedComment([{ id: "c1", comment_text: "rien" }], MARKER)).toBe(null);
    expect(findMarkedComment([], MARKER)).toBe(null);
  });
});

describe("constantes", () => {
  it("expose le tag de risque", () => { expect(typeof RISK_TAG).toBe("string"); expect(RISK_TAG.length).toBeGreaterThan(0); });
});
