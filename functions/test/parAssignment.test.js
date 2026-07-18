import { describe, it, expect } from "vitest";
const { validateAssignment, effectiveStatus, assignmentWatch, watchCounts, DEFAULT_REMINDER_OFFSETS } = require("../domain/parAssignment");

describe("parAssignment — assignations & relances", () => {
  const base = { consultantId: "c1", partnerId: "Fortinet", certificationCatalogId: "fortinet-nse7", targetDate: "2026-09-30" };

  it("valide et normalise (partnerId slug, offsets triés desc dédoublonnés, défaut)", () => {
    const v = validateAssignment({ ...base, reminderOffsets: [7, 30, 7, 14] });
    expect(v.ok).toBe(true);
    expect(v.value).toMatchObject({ partnerId: "fortinet", status: "planifie", reminderOffsets: [30, 14, 7] });
    expect(validateAssignment(base).value.reminderOffsets).toEqual(DEFAULT_REMINDER_OFFSETS);
  });

  it("rejette sans consultant / cible / date implausible", () => {
    expect(validateAssignment({ ...base, consultantId: "" }).ok).toBe(false);
    expect(validateAssignment({ ...base, targetDate: "1899-01-01" }).ok).toBe(false);
  });

  it("effectiveStatus : en_retard dérivé si échéance dépassée et non obtenu", () => {
    expect(effectiveStatus({ status: "en_formation", targetDate: "2026-07-01" }, "2026-07-18")).toBe("en_retard");
    expect(effectiveStatus({ status: "en_formation", targetDate: "2026-12-01" }, "2026-07-18")).toBe("en_formation");
    expect(effectiveStatus({ status: "obtenu", targetDate: "2026-07-01" }, "2026-07-18")).toBe("obtenu");
  });

  it("assignmentWatch : retenue si en retard ou dans une fenêtre de relance ; palier le plus serré", () => {
    const assigns = [
      { id: "a1", consultantId: "c1", partnerId: "fortinet", cert: "NSE7", targetDate: "2026-08-01", status: "planifie" }, // ~14 j → j14
      { id: "a2", consultantId: "c2", partnerId: "fortinet", cert: "NSE4", targetDate: "2026-07-01", status: "en_formation" }, // retard
      { id: "a3", consultantId: "c3", partnerId: "cisco", cert: "CCNA", targetDate: "2027-01-01", status: "planifie" }, // lointain → exclu
      { id: "a4", consultantId: "c4", partnerId: "dell", cert: "DCC", targetDate: "2026-07-20", status: "obtenu" }, // obtenu → exclu
    ];
    const items = assignmentWatch(assigns, "2026-07-18");
    expect(items.map((i) => i.id)).toEqual(["a2", "a1"]); // retard d'abord
    expect(items[0]).toMatchObject({ bucket: "retard", effectiveStatus: "en_retard" });
    expect(items[1].bucket).toBe("j14");
  });

  it("watchCounts : total + retards", () => {
    expect(watchCounts([{ bucket: "retard" }, { bucket: "j14" }, { bucket: "retard" }])).toEqual({ total: 3, late: 2 });
  });
});
