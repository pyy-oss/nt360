import { describe, it, expect } from "vitest";
const { imputeLaborByFp } = require("../domain/laborImpute");
const { validateAssignment } = require("../domain/assignment");

describe("imputeLaborByFp — impute le coût de main-d'œuvre constaté aux affaires (FP)", () => {
  const consultants = [{ id: "c1", cjm: 100000 }, { id: "c2", cjm: 200000 }];

  it("répartit les jours facturés entre les affectations FP au prorata relatif de l'allocation", () => {
    const assignments = [
      { consultantId: "c1", projectFp: "FP/2026/1", startMonth: "2026-01", endMonth: "2026-03", allocationPct: 60 },
      { consultantId: "c1", projectFp: "FP/2026/2", startMonth: "2026-01", endMonth: "2026-03", allocationPct: 40 },
    ];
    const timesheets = [{ consultantId: "c1", month: "2026-02", billedDays: 20 }];
    const r = imputeLaborByFp(assignments, timesheets, consultants, ["2026-02"]);
    const fp1 = r.byFp.find((x) => x.fp === "FP/2026/1");
    const fp2 = r.byFp.find((x) => x.fp === "FP/2026/2");
    expect(fp1.laborDays).toBe(12);         // 20 × 60/100
    expect(fp2.laborDays).toBe(8);          // 20 × 40/100
    expect(fp1.laborCost).toBe(1200000);    // 12 j × 100 000 CJM
    expect(fp2.laborCost).toBe(800000);
    expect(r.unassignedDays).toBe(0);
    expect(r.missingCjm).toEqual([]);
  });

  it("canonicalise le FP de l'affectation (zéros de tête) pour joindre le carnet", () => {
    // FP/2026/013 et FP/2026/13 = la MÊME affaire (fpKey normalise), donc un seul agrégat.
    const assignments = [
      { consultantId: "c1", projectFp: "FP/2026/013", startMonth: "2026-01", endMonth: "2026-01", allocationPct: 100 },
    ];
    const r = imputeLaborByFp(assignments, [{ consultantId: "c1", month: "2026-01", billedDays: 10 }], consultants, ["2026-01"]);
    expect(r.byFp).toHaveLength(1);
    expect(r.byFp[0].fp).toBe("FP/2026/13");
    expect(r.byFp[0].laborDays).toBe(10);
  });

  it("les jours facturés sans affectation FP ce mois-là restent NON IMPUTÉS", () => {
    const assignments = [
      { consultantId: "c1", projectFp: "FP/2026/1", startMonth: "2026-05", endMonth: "2026-06", allocationPct: 100 },
    ];
    // CRA en 2026-02 : hors de la période de la seule affectation → non rattachable.
    const r = imputeLaborByFp(assignments, [{ consultantId: "c1", month: "2026-02", billedDays: 15 }], consultants, ["2026-02"]);
    expect(r.byFp).toEqual([]);
    expect(r.unassignedDays).toBe(15);
  });

  it("une affectation sans FP interprétable (libellé libre) n'impute rien", () => {
    const assignments = [
      { consultantId: "c1", projectFp: "SUPPORT INTERNE", startMonth: "2026-01", endMonth: "2026-12", allocationPct: 100 },
    ];
    const r = imputeLaborByFp(assignments, [{ consultantId: "c1", month: "2026-03", billedDays: 18 }], consultants, ["2026-03"]);
    expect(r.byFp).toEqual([]);
    expect(r.unassignedDays).toBe(18);
  });

  it("CJM absent → jours comptés, coût 0, consultant signalé (marge non fiable)", () => {
    const assignments = [{ consultantId: "cX", projectFp: "FP/2026/9", startMonth: "2026-01", endMonth: "2026-12", allocationPct: 100 }];
    const r = imputeLaborByFp(assignments, [{ consultantId: "cX", month: "2026-04", billedDays: 10 }], [{ id: "cX" }], ["2026-04"]);
    expect(r.byFp[0].laborDays).toBe(10);
    expect(r.byFp[0].laborCost).toBe(0);
    expect(r.missingCjm).toEqual(["cX"]);
  });

  it("écarte la contribution CRA du module maintenance (source mnt, couverte par le forfait)", () => {
    const assignments = [{ consultantId: "c1", projectFp: "FP/2026/1", startMonth: "2026-01", endMonth: "2026-12", allocationPct: 100 }];
    const timesheets = [
      { consultantId: "c1", month: "2026-01", billedDays: 10 },
      { consultantId: "c1", month: "2026-01", billedDays: 5, source: "mnt" }, // exclu
    ];
    const r = imputeLaborByFp(assignments, timesheets, consultants, ["2026-01"]);
    expect(r.byFp[0].laborDays).toBe(10);
  });

  it("validateAssignment canonicalise projectFp (vrai FP) mais préserve un libellé non-FP", () => {
    expect(validateAssignment({ consultantId: "c1", startMonth: "2026-01", endMonth: "2026-01", allocationPct: 100, projectFp: "fp/2026/013" }).value.projectFp).toBe("FP/2026/13");
    expect(validateAssignment({ consultantId: "c1", startMonth: "2026-01", endMonth: "2026-01", allocationPct: 100, projectFp: "Support interne" }).value.projectFp).toBe("SUPPORT INTERNE");
  });
});
