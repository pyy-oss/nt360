import { describe, it, expect } from "vitest";
import { marginWaterfall } from "./waterfall";

describe("marginWaterfall — cascade des contributions de marge par domaine", () => {
  it("cumule les contributions, trie par marge décroissante, termine au total", () => {
    const { steps, total } = marginWaterfall([{ bu: "ICT", mb: 300 }, { bu: "CLOUD", mb: 100 }, { bu: "FORM", mb: 50 }]);
    expect(total).toBe(450);
    expect(steps.map((s) => s.label)).toEqual(["ICT", "CLOUD", "FORM", "Total marge"]);
    // ICT : 0→300 ; CLOUD : 300→400 ; FORM : 400→450 ; Total : 0→450.
    expect(steps[0]).toMatchObject({ start: 0, end: 300, kind: "pos" });
    expect(steps[1]).toMatchObject({ start: 300, end: 400 });
    expect(steps[3]).toMatchObject({ start: 0, end: 450, kind: "total" });
  });
  it("gère une contribution NÉGATIVE (BU à marge négative tire la cascade vers le bas)", () => {
    const { steps, total } = marginWaterfall([{ bu: "A", mb: 200 }, { bu: "B", mb: -80 }]);
    expect(total).toBe(120);
    const b = steps.find((s) => s.label === "B")!;
    expect(b.kind).toBe("neg");
    expect(b.start).toBe(120); // 200 - 80 = 120
    expect(b.end).toBe(200);
  });
  it("liste vide → seul le total (0)", () => {
    const { steps, total } = marginWaterfall([]);
    expect(total).toBe(0);
    expect(steps).toHaveLength(1);
    expect(steps[0].label).toBe("Total marge");
  });
  it("ignore les entrées sans BU", () => {
    const { steps } = marginWaterfall([{ mb: 100 }, { bu: "X", mb: 50 }]);
    expect(steps.map((s) => s.label)).toEqual(["X", "Total marge"]);
  });
});
