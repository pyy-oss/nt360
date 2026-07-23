import { describe, it, expect } from "vitest";
const { parAssignmentTaskPayload } = require("../domain/parClickup");

describe("parClickup — payload de tâche ClickUp d'assignation (Lot P4)", () => {
  it("nom + description + due_date (epoch ms) depuis targetDate", () => {
    const p = parAssignmentTaskPayload({ cert: "NSE7", consultantName: "Awa Dupont", partnerId: "fortinet", targetDate: "2026-09-30", status: "planifie" });
    expect(p.name).toBe("Certification NSE7 — Awa Dupont");
    expect(p.description).toContain("Constructeur : fortinet");
    expect(p.description).toContain("Échéance cible : 2026-09-30");
    expect(p.due_date).toBe(Date.parse("2026-09-30T00:00:00Z"));
    expect(p.due_date_time).toBe(false);
  });
  it("sans targetDate valide ⇒ pas de due_date ; fallback sur certificationCatalogId", () => {
    const p = parAssignmentTaskPayload({ certificationCatalogId: "fortinet-nse7", targetDate: "" });
    expect(p.name).toBe("Certification fortinet-nse7");
    expect(p.due_date).toBeUndefined();
  });
  it("tolère un objet vide", () => {
    const p = parAssignmentTaskPayload();
    expect(p.name).toBe("Certification certification");
    expect(p.due_date).toBeUndefined();
  });
});
