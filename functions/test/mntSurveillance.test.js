import { describe, it, expect } from "vitest";
const { mntSurveillance, eventFromSignal, SEVERITY_RANK, normalizeWatch, watchMatchesEvent, WATCH_CAP } = require("../domain/mntSurveillance");

// Item de risque type (forme produite par domain/mntRisque.js).
const item = (over) => ({ id: "C1", fp: "FP/2026/7", client: "ACME", am: "Awa", bu: "ICT", niveau: "rouge", signals: [], ...over });

describe("mntSurveillance — projection du moteur de risque en flux d'événements (ADR-026)", () => {
  it("aplatit chaque signal en un événement portant le contrat + une sévérité", () => {
    const r = mntSurveillance({ items: [item({ signals: [{ type: "sla_rompu", count: 2 }] })], asOf: "2026-07-17" });
    expect(r.total).toBe(1);
    const e = r.events[0];
    expect(e).toMatchObject({ contratId: "C1", fp: "FP/2026/7", client: "ACME", am: "Awa", type: "sla_rompu", severity: "high", count: 2 });
    expect(e.id).toBe("C1:sla_rompu"); // id stable pour diffing front
    expect(e.message).toContain("2 tickets");
  });

  it("gradue la sévérité de l'échéance : dépassée=high, ≤30j=medium, plus lointaine=low", () => {
    expect(eventFromSignal(item(), { type: "echeance_proche", jours: -5 }).severity).toBe("high");
    expect(eventFromSignal(item(), { type: "echeance_proche", jours: 20 }).severity).toBe("medium");
    expect(eventFromSignal(item(), { type: "echeance_proche", jours: 50 }).severity).toBe("low");
    expect(eventFromSignal(item(), { type: "echeance_proche", jours: -5 }).message).toContain("échu depuis 5 j");
  });

  it("gradue la sous-facturation : > 25 % de l'engagé = high, sinon medium", () => {
    expect(eventFromSignal(item(), { type: "sous_facturation", ecart: 100, pct: 0.3 }).severity).toBe("high");
    expect(eventFromSignal(item(), { type: "sous_facturation", ecart: 100, pct: 0.1 }).severity).toBe("medium");
  });
  it("ABRÈGE le montant FCFA du message comme l'ERP (k/M/Md, jamais l'entier brut)", () => {
    expect(eventFromSignal(item(), { type: "sous_facturation", ecart: 12000000, pct: 0.3 }).message).toContain("12.0 M FCFA");
    expect(eventFromSignal(item(), { type: "sous_facturation", ecart: 2500000000, pct: 0.5 }).message).toContain("2.50 Md FCFA");
    expect(eventFromSignal(item(), { type: "sous_facturation", ecart: 12000000, pct: 0.3 }).message).not.toContain("12000000");
  });

  it("quota dépassé → événement medium avec dépassement et quota", () => {
    const e = eventFromSignal(item(), { type: "quota_depasse", depassement: 3, quota: 5 });
    expect(e).toMatchObject({ type: "quota_depasse", severity: "medium", depassement: 3, quota: 5 });
  });

  it("trie le flux du plus grave au moins grave, échéance la plus proche d'abord à sévérité égale", () => {
    const r = mntSurveillance({
      items: [
        item({ id: "A", client: "A", signals: [{ type: "echeance_proche", jours: 50 }] }),           // low
        item({ id: "B", client: "B", signals: [{ type: "sla_rompu", count: 1 }] }),                    // high
        item({ id: "C", client: "C", signals: [{ type: "echeance_proche", jours: -2 }] }),             // high, plus urgent
      ],
    });
    expect(r.events.map((e) => e.contratId)).toEqual(["C", "B", "A"]);
    expect(r.counts).toEqual({ high: 2, medium: 0, low: 1 });
    expect(SEVERITY_RANK.high).toBeLessThan(SEVERITY_RANK.low);
  });

  it("un contrat sans signal ne produit aucun événement ; entrée vide → flux vide", () => {
    expect(mntSurveillance({ items: [item({ signals: [] })] }).total).toBe(0);
    expect(mntSurveillance({}).events).toEqual([]);
    expect(mntSurveillance().total).toBe(0);
  });

  it("un contrat à plusieurs signaux produit plusieurs événements", () => {
    const r = mntSurveillance({ items: [item({ signals: [{ type: "sla_rompu", count: 1 }, { type: "quota_depasse", depassement: 1, quota: 2 }] })] });
    expect(r.total).toBe(2);
    expect(r.events.map((e) => e.type).sort()).toEqual(["quota_depasse", "sla_rompu"]);
  });
});

describe("mntSurveillance — abonnements par utilisateur (ADR-026)", () => {
  it("normalise : coerce global, trim + dédoublonne les listes, ignore les vides", () => {
    const w = normalizeWatch({ global: 1, contrats: [" C1 ", "C1", "C2", ""], clients: ["ACME", "ACME"], ams: [] });
    expect(w).toEqual({ global: true, contrats: ["C1", "C2"], clients: ["ACME"], ams: [] });
  });
  it("entrée absente/malformée → abonnement vide (fail-safe)", () => {
    expect(normalizeWatch()).toEqual({ global: false, contrats: [], clients: [], ams: [] });
    expect(normalizeWatch({ contrats: "pasuntableau" }).contrats).toEqual([]);
  });
  it("borne chaque liste (garde-fou anti-doc géant)", () => {
    const big = Array.from({ length: WATCH_CAP + 50 }, (_, i) => `C${i}`);
    expect(normalizeWatch({ contrats: big }).contrats.length).toBe(WATCH_CAP);
  });
  it("watchMatchesEvent : global couvre tout ; sinon match par contrat / client / AM", () => {
    const ev = { contratId: "C1", client: "ACME", am: "Awa" };
    expect(watchMatchesEvent({ global: true }, ev)).toBe(true);
    expect(watchMatchesEvent({ contrats: ["C1"] }, ev)).toBe(true);
    expect(watchMatchesEvent({ clients: ["ACME"] }, ev)).toBe(true);
    expect(watchMatchesEvent({ ams: ["Awa"] }, ev)).toBe(true);
    expect(watchMatchesEvent({ contrats: ["C9"], clients: ["AUTRE"], ams: ["Zoe"] }, ev)).toBe(false);
    expect(watchMatchesEvent({}, ev)).toBe(false);
  });
});
