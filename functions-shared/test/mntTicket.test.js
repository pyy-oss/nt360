import { describe, it, expect } from "vitest";
const { validateTicket, validateIntervention, craDaysFromHours, monthOf, HOURS_PER_DAY } = require("../domain/mntTicket");

const tk = { contratId: "FP_2026_7", fp: "FP/2026/7", client: "ACME", titre: "Panne serveur", statut: "ouvert", priorite: "haute" };
const iv = { ticketId: "T1", contratId: "FP_2026_7", fp: "FP/2026/007", consultantId: "C1", date: "2026-03-04", heures: 4 };

describe("mntTicket — ticket", () => {
  it("accepte un ticket bien formé", () => {
    const v = validateTicket(tk);
    expect(v.ok).toBe(true); expect(v.value.priorite).toBe("haute");
  });
  it("rejette contrat manquant / statut ou priorité hors énumération / FP invalide", () => {
    expect(validateTicket({ ...tk, contratId: "" }).ok).toBe(false);
    expect(validateTicket({ ...tk, statut: "x" }).ok).toBe(false);
    expect(validateTicket({ ...tk, priorite: "urgente" }).ok).toBe(false);
    expect(validateTicket({ ...tk, fp: "FP/2026/0000" }).ok).toBe(false);
  });
  it("type de maintenance optionnel : absent → null, valide accepté, invalide rejeté (ADR-025)", () => {
    expect(validateTicket(tk).value.typeMaintenance).toBeNull();
    expect(validateTicket({ ...tk, typeMaintenance: "evolutive" }).value.typeMaintenance).toBe("evolutive");
    expect(validateTicket({ ...tk, typeMaintenance: "curative" }).ok).toBe(false);
  });
});

describe("mntTicket — intervention", () => {
  it("accepte + canonicalise le FP + arrondit les heures", () => {
    const v = validateIntervention({ ...iv, heures: 4.005 });
    expect(v.ok).toBe(true); expect(v.value.fp).toBe("FP/2026/7"); expect(v.value.heures).toBe(4.01);
  });
  it("rejette consultant/ticket manquant, heures ≤ 0, date mal formée", () => {
    expect(validateIntervention({ ...iv, consultantId: "" }).ok).toBe(false);
    expect(validateIntervention({ ...iv, ticketId: "" }).ok).toBe(false);
    expect(validateIntervention({ ...iv, heures: 0 }).ok).toBe(false);
    expect(validateIntervention({ ...iv, date: "04/03/2026" }).ok).toBe(false);
  });
  it("type de maintenance optionnel sur intervention (absent → null, invalide rejeté)", () => {
    expect(validateIntervention(iv).value.typeMaintenance).toBeNull();
    expect(validateIntervention({ ...iv, typeMaintenance: "predictive" }).value.typeMaintenance).toBe("predictive");
    expect(validateIntervention({ ...iv, typeMaintenance: "x" }).ok).toBe(false);
  });
});

describe("mntTicket — conversion CRA (ADR-013)", () => {
  it("heures → jours (8 h = 1 j) et mois d'une date", () => {
    expect(HOURS_PER_DAY).toBe(8);
    expect(craDaysFromHours(8)).toBe(1);
    expect(craDaysFromHours(4)).toBe(0.5);
    expect(craDaysFromHours(0)).toBe(0);
    expect(monthOf("2026-03-04")).toBe("2026-03");
    expect(monthOf("")).toBeNull();
  });
});
