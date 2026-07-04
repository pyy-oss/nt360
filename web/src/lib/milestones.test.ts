import { describe, it, expect } from "vitest";
import { defaultMilestones } from "./milestones";

describe("defaultMilestones (miroir client)", () => {
  it("3 jalons étalés sur les mois futurs jusqu'au 31/12, Σ = montant", () => {
    const d = defaultMilestones(300, "2026-07-15", 2026);
    expect(d.map((m) => m.date)).toEqual(["2026-08-28", "2026-10-28", "2026-12-28"]);
    expect(d.reduce((s, m) => s + m.amount, 0)).toBe(300);
  });
  it("reliquat d'arrondi sur le dernier jalon", () => {
    expect(defaultMilestones(100, "2026-07-15", 2026).map((m) => m.amount)).toEqual([33, 33, 34]);
  });
  it("montant nul → aucun jalon", () => {
    expect(defaultMilestones(0, "2026-07-15", 2026)).toEqual([]);
  });
});
