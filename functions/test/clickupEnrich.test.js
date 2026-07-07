import { describe, it, expect } from "vitest";
const {
  MARKER, RISK_TAG, BC_CHECKLIST, buildSyncComment, needsRiskTag, findMarkedComment, latestHumanComment,
  buildMilestoneSubtasks, subtaskKey, planMilestoneSubtasks, buildBcChecklistItems, findBcChecklist,
} = require("../lib/clickupEnrich");

describe("latestHumanComment — note ops (≠ synthèse) remontée à l'app", () => {
  it("prend le commentaire HUMAIN le plus récent, ignore notre synthèse marquée", () => {
    const comments = [
      { comment_text: MARKER + " (synthèse)", user: { username: "bot" }, date: "300" },
      { comment_text: "Colis bloqué en douane", user: { username: "Awa" }, date: "250" },
      { comment_text: "ancienne note", user: { username: "Koffi" }, date: "100" },
    ];
    const r = latestHumanComment(comments, MARKER);
    expect(r.by).toBe("Awa");
    expect(r.text).toBe("Colis bloqué en douane");
    expect(r.at).toBe("250");
  });
  it("aucun commentaire humain → null ; tronque à 280 caractères", () => {
    expect(latestHumanComment([{ comment_text: MARKER + " x" }], MARKER)).toBe(null);
    const long = latestHumanComment([{ comment_text: "a".repeat(400), user: {}, date: "1" }], MARKER);
    expect(long.text.length).toBe(280);
    expect(long.by).toBe(null);
  });
});

describe("buildSyncComment — synthèse marquée idempotente (jalons/BC en pointeurs)", () => {
  it("commence par le marqueur et résume CA/RAF + %", () => {
    const t = buildSyncComment({ fp: "FP/1", cas: 1000000, facture: 250000, raf: 750000 });
    expect(t.startsWith(MARKER)).toBe(true);
    expect(t).toContain("25%");
    expect(t).toContain("750");
    expect(t).toContain("✅ Qualité : RAS");
  });
  it("pointe vers les sous-tâches (jalons) et la checklist (BC), sans les détailler", () => {
    const t = buildSyncComment({
      fp: "FP/2", cas: 100, facture: 0, raf: 100,
      milestones: [{ label: "Solde", amount: 60, dueDate: "2026-09-01" }, { label: "Acompte", amount: 40, dueDate: "2026-03-01" }],
      bcRefs: ["BC-1", "BC-2"], qualityFlags: ["FP manquant", "Montant nul"], overdue: true,
    });
    expect(t).toContain("Jalons de facturation : 2 (détaillés en sous-tâches)");
    expect(t).toContain("BC fournisseurs liés : 2");
    expect(t).toContain(BC_CHECKLIST);
    expect(t).not.toContain("BC-1"); // le détail des BC vit dans la checklist, pas le commentaire
    expect(t).toContain("⚠️ Qualité : FP manquant, Montant nul");
    expect(t).toContain("retard");
  });
  it("0 CA signé → 0% sans division par zéro", () => {
    expect(buildSyncComment({ fp: "FP/3", cas: 0, facture: 0, raf: 0 })).toContain("(0%)");
  });
});

describe("buildMilestoneSubtasks / planMilestoneSubtasks — jalons → sous-tâches idempotentes", () => {
  const ms = [{ label: "Acompte", amount: 40, dueDate: "2026-03-01" }, { amount: 60, dueDate: "2026-09-01" }, { label: "vide" }];
  it("construit des sous-tâches à clé stable `Jalon i`, ignore les jalons vides", () => {
    const subs = buildMilestoneSubtasks(ms);
    expect(subs.length).toBe(2); // le 3e (sans montant ni date) est ignoré
    expect(subs[0].key).toBe("Jalon 1");
    expect(subs[0].name).toContain("Acompte");
    expect(subs[0].dueMs).toBe(Date.parse("2026-03-01T00:00:00Z"));
    expect(subs[1].key).toBe("Jalon 2");
  });
  it("subtaskKey extrait la clé du nom", () => {
    expect(subtaskKey("Jalon 2 · Solde · 2026-09-01 — 60 XOF")).toBe("Jalon 2");
    expect(subtaskKey("Autre tâche")).toBe(null);
  });
  it("plan : crée les manquants, met à jour les divergents, ne touche pas les identiques", () => {
    const expected = buildMilestoneSubtasks(ms);
    const existing = [
      { id: "s1", name: expected[0].name, due_date: String(expected[0].dueMs) }, // identique → rien
      { id: "s2", name: "Jalon 2 · ancien nom", due_date: "123" },                 // divergent → update
    ];
    const plan = planMilestoneSubtasks(existing, expected);
    expect(plan.toCreate.length).toBe(0);
    expect(plan.toUpdate.length).toBe(1);
    expect(plan.toUpdate[0].id).toBe("s2");
  });
  it("plan : jalon manquant → toCreate ; « Jalon k » orphelin (échéancier rétréci) → toClose", () => {
    const expected = buildMilestoneSubtasks([ms[0]]); // un seul jalon attendu (Jalon 1)
    const plan = planMilestoneSubtasks([{ id: "s1", name: expected[0].name, due_date: String(expected[0].dueMs) }, { id: "x", name: "Jalon 9 · orphelin" }], expected);
    expect(plan.toCreate.length).toBe(0);
    expect(plan.toClose).toEqual([{ id: "x", key: "Jalon 9" }]); // le Jalon 9 périmé est purgé
  });
  it("plan : une sous-tâche HORS préfixe (suivi manuel) n'est jamais touchée", () => {
    const expected = buildMilestoneSubtasks([ms[0]]);
    const plan = planMilestoneSubtasks([{ id: "m", name: "Note manuelle du PM" }], expected);
    expect(plan.toClose).toEqual([]); // pas notre préfixe → intacte
    expect(plan.toCreate.length).toBe(1);
  });
});

describe("buildBcChecklistItems / findBcChecklist — BC → checklist", () => {
  it("dédup + nettoie les N° BC", () => {
    expect(buildBcChecklistItems(["BC-1", " BC-1 ", "BC-2", ""])).toEqual(["BC-1", "BC-2"]);
  });
  it("retrouve NOTRE checklist par nom", () => {
    const cls = [{ id: "c1", name: "Autre" }, { id: "c2", name: BC_CHECKLIST }];
    expect(findBcChecklist(cls, BC_CHECKLIST).id).toBe("c2");
    expect(findBcChecklist([], BC_CHECKLIST)).toBe(null);
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
  it("retrouve NOTRE commentaire le plus récent (listComments renvoie du plus récent au plus ancien)", () => {
    const comments = [
      { id: "c1", comment_text: "note humaine" },
      { id: "c2", comment_text: MARKER + " (récent)\n• …" }, // plus récent des marqués → gagne
      { id: "c3", comment_text: "autre" },
      { id: "c4", comment_text: MARKER + " (ancien doublon)" },
    ];
    expect(findMarkedComment(comments, MARKER).id).toBe("c2"); // premier marqué = le plus récent
  });
  it("aucun commentaire marqué → null", () => {
    expect(findMarkedComment([{ id: "c1", comment_text: "rien" }], MARKER)).toBe(null);
    expect(findMarkedComment([], MARKER)).toBe(null);
  });
});

describe("constantes", () => {
  it("expose le tag de risque", () => { expect(typeof RISK_TAG).toBe("string"); expect(RISK_TAG.length).toBeGreaterThan(0); });
});
