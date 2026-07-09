import { describe, it, expect } from "vitest";
import { validateAssignment, monthsRange, coversMonth, buildLoad } from "../domain/assignment.js";

describe("validateAssignment (Lot 12 plan de charge)", () => {
  it("consultant + période + allocation requis", () => {
    expect(validateAssignment({}).ok).toBe(false);
    expect(validateAssignment({ consultantId: "c1" }).ok).toBe(false);
    expect(validateAssignment({ consultantId: "c1", startMonth: "2026-03", endMonth: "2026-01", allocationPct: 50 }).ok).toBe(false); // fin < début
  });
  it("normalise et borne l'allocation à [0,100]", () => {
    const v = validateAssignment({ consultantId: "c1", startMonth: "2026-01", endMonth: "2026-03", allocationPct: 150, projectFp: "fp/26/1", tjmBilled: 700 }).value;
    expect(v.allocationPct).toBe(100);
    expect(v.projectFp).toBe("FP/26/1");
    expect(v.tjmBilled).toBe(700);
    expect(v.status).toBe("confirmed");
  });
  it("accepte une date ISO complète (tronquée au mois)", () => {
    const v = validateAssignment({ consultantId: "c1", startMonth: "2026-01-15", endMonth: "2026-02-28", allocationPct: 80 }).value;
    expect(v.startMonth).toBe("2026-01");
    expect(v.endMonth).toBe("2026-02");
  });
});

describe("monthsRange / coversMonth", () => {
  it("liste les mois inclus", () => {
    expect(monthsRange("2026-01", "2026-04")).toEqual(["2026-01", "2026-02", "2026-03", "2026-04"]);
    expect(monthsRange("2025-11", "2026-02")).toEqual(["2025-11", "2025-12", "2026-01", "2026-02"]);
  });
  it("coversMonth", () => {
    const a = { startMonth: "2026-01", endMonth: "2026-03" };
    expect(coversMonth(a, "2026-02")).toBe(true);
    expect(coversMonth(a, "2026-04")).toBe(false);
  });
});

describe("buildLoad — plan de charge + détection sur/sous-charge", () => {
  const months = ["2026-01", "2026-02"];
  it("cumule les allocations par consultant/mois", () => {
    const a = [
      { consultantId: "c1", startMonth: "2026-01", endMonth: "2026-02", allocationPct: 60 },
      { consultantId: "c1", startMonth: "2026-02", endMonth: "2026-02", allocationPct: 60 },
    ];
    const { byConsultant, flags } = buildLoad(a, months, ["c1"]);
    expect(byConsultant.c1["2026-01"]).toBe(60);
    expect(byConsultant.c1["2026-02"]).toBe(120);       // cumul → sur-charge
    expect(flags.over).toEqual([{ id: "c1", month: "2026-02", pct: 120 }]);
  });
  it("signale l'intercontrat (actif mais non staffé)", () => {
    const { flags } = buildLoad([], months, ["c2"]);
    expect(flags.idle).toEqual([{ id: "c2", month: "2026-01" }, { id: "c2", month: "2026-02" }]);
  });
  it("un consultant NON actif non staffé n'est pas signalé en intercontrat", () => {
    const { flags } = buildLoad([], months, []);
    expect(flags.idle).toEqual([]);
  });
});
