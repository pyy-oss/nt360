import { describe, it, expect } from "vitest";
import { winLossBySegment } from "./winLoss";

// TAUX DE GAIN PAR SEGMENT (Lot cockpit C4) — prouve : (1) seules les opps clôturées (6/7) comptent ;
// (2) le taux = gagné/(gagné+perdu) ; (3) le regroupement par clé et le tri par volume clôturé.
describe("winLossBySegment — taux de gain par segment", () => {
  const rows = [
    { stage: 6, amount: 100, leadSource: "Web" },   // gagné Web
    { stage: 7, amount: 40, leadSource: "Web" },     // perdu Web
    { stage: 6, amount: 200, leadSource: "Salon" },  // gagné Salon
    { stage: 2, amount: 999, leadSource: "Web" },    // ACTIVE → ignorée
    { stage: 7, amount: 30, leadSource: "" },        // perdu sans source → "—"
  ] as any[];

  it("ne compte que les opps clôturées (6/7) et calcule le taux de gain par clé", () => {
    const r = winLossBySegment(rows, (o) => (o.leadSource || "").trim() || "—");
    const web = r.find((x) => x.key === "Web");
    expect(web).toMatchObject({ won: 1, lost: 1, total: 2, wonAmount: 100, lostAmount: 40 });
    expect(web!.winRate).toBeCloseTo(0.5, 6);
    const salon = r.find((x) => x.key === "Salon");
    expect(salon).toMatchObject({ won: 1, lost: 0, total: 1 });
    expect(salon!.winRate).toBe(1);
    expect(r.find((x) => x.key === "—")).toMatchObject({ won: 0, lost: 1, winRate: 0 });
  });

  it("l'opp active (étape 2) n'entre dans aucun segment", () => {
    const r = winLossBySegment(rows, (o) => (o.leadSource || "").trim() || "—");
    const web = r.find((x) => x.key === "Web")!;
    expect(web.total).toBe(2); // 1 gagné + 1 perdu, l'active exclue
  });

  it("trie par volume clôturé décroissant (segment le plus joué d'abord)", () => {
    const r = winLossBySegment(rows, (o) => (o.leadSource || "").trim() || "—");
    expect(r[0].key).toBe("Web"); // total 2 > Salon 1 / — 1
  });
});
