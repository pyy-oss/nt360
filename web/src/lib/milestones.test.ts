import { describe, it, expect } from "vitest";
import { defaultMilestones, reportedFromMilestones } from "./milestones";

// MIROIR EXACT du repli serveur (functions/domain/milestones.js) — mêmes entrées, mêmes jalons (audit
// backlog H1) : « Répartir par défaut » doit proposer EXACTEMENT ce que billingTrend appliquerait sans
// jalons saisis, sinon valider le défaut CHANGE la prévision.
describe("defaultMilestones (miroir client = repli serveur)", () => {
  it("courbe pondérée croissante du MOIS COURANT (inclus) au 31/12, Σ = montant, reliquat sur décembre", () => {
    const d = defaultMilestones(300, "2026-07-15", 2026);
    // Mois 7..12, poids 1..6 (Σ 21) : 14, 28, 42, 57, 71, reliquat 88 — parité serveur ligne à ligne.
    expect(d.map((m) => m.date)).toEqual(["2026-07-28", "2026-08-28", "2026-09-28", "2026-10-28", "2026-11-28", "2026-12-28"]);
    expect(d.map((m) => m.amount)).toEqual([14, 28, 42, 57, 71, 88]);
    expect(d.reduce((s, m) => s + m.amount, 0)).toBe(300);
  });
  it("closeMs (date de clôture ClickUp) dans l'exercice et non passée → jalon UNIQUE sur ce mois", () => {
    const d = defaultMilestones(500, "2026-07-15", 2026, { closeMs: Date.UTC(2026, 9, 10) });
    expect(d).toEqual([{ date: "2026-10-28", amount: 500 }]);
  });
  it("closeMs passée (avant le mois courant) → repli courbe (parité serveur : la clôture passée n'ancre rien)", () => {
    const d = defaultMilestones(300, "2026-07-15", 2026, { closeMs: Date.UTC(2026, 2, 10) });
    expect(d[0].date).toBe("2026-07-28");
    expect(d.length).toBe(6);
  });
  it("asOf avant l'exercice → démarre en janvier ; après → tout au 31/12 ; montant nul → aucun jalon", () => {
    expect(defaultMilestones(120, "2025-11-01", 2026)[0].date).toBe("2026-01-28");
    expect(defaultMilestones(120, "2027-02-01", 2026)).toEqual([{ date: "2026-12-28", amount: 120 }]);
    expect(defaultMilestones(0, "2026-07-15", 2026)).toEqual([]);
  });
});

// Report N+1 extrait de CarryoverCard (audit backlog, axe 9) — parité serveur reportedFromMilestones.
describe("reportedFromMilestones (miroir client, extrait de CarryoverCard)", () => {
  it("Σ des jalons datés APRÈS le cutoff, bornée au RAF projetable", () => {
    const ms = [{ date: "2026-11-28", amount: 40 }, { date: "2027-02-28", amount: 60 }, { date: "2027-05-28", amount: 30 }];
    expect(reportedFromMilestones(ms, "2026-12-31", 1000)).toBe(90);
    expect(reportedFromMilestones(ms, "2026-12-31", 50)).toBe(50); // borné au projetable
  });
  it("jalon à date aberrante (millésime implausible) écarté — comme normalizeMilestones serveur", () => {
    expect(reportedFromMilestones([{ date: "20226-01-28", amount: 999 }, { date: "2027-01-28", amount: 10 }], "2026-12-31", 1000)).toBe(10);
  });
  it("sans jalons / cap négatif → 0 (jamais négatif, parité Math.max(0, …) serveur)", () => {
    expect(reportedFromMilestones(undefined, "2026-12-31", 100)).toBe(0);
    expect(reportedFromMilestones([{ date: "2027-01-28", amount: 10 }], "2026-12-31", -5)).toBe(0);
  });
});
