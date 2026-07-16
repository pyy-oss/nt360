import { describe, it, expect } from "vitest";
const { applyMntDecision } = require("../domain/mntDecision");

describe("applyMntDecision — effet d'une décision approuvée (ADR-022)", () => {
  it("résiliation → statut resilie", () => {
    const r = applyMntDecision("resiliation_contrat", { statut: "actif", dateDebut: "2026-01-01", dateFin: "2027-01-01" });
    expect(r.applied).toBe(true);
    expect(r.patch).toEqual({ statut: "resilie" });
  });
  it("résiliation d'un contrat DÉJÀ résilié → sans effet (idempotent)", () => {
    const r = applyMntDecision("resiliation_contrat", { statut: "resilie" });
    expect(r.applied).toBe(false);
    expect(r.patch).toBeNull();
  });
  it("renouvellement → dateFin repoussée d'un terme (durée initiale)", () => {
    // Annuel 01/01/26→01/01/27 (terme 12 mois) → nouvelle fin 01/01/28.
    const r = applyMntDecision("renouvellement_contrat", { statut: "actif", dateDebut: "2026-01-01", dateFin: "2027-01-01" });
    expect(r.applied).toBe(true);
    expect(r.patch).toEqual({ dateFin: "2028-01-01" });
  });
  it("renouvellement d'un contrat résilié/échu → réactive (statut actif) + repousse la fin", () => {
    const r = applyMntDecision("renouvellement_contrat", { statut: "echu", dateDebut: "2026-01-01", dateFin: "2027-01-01" });
    expect(r.applied).toBe(true);
    expect(r.patch).toEqual({ dateFin: "2028-01-01", statut: "actif" });
  });
  it("renouvellement sans date de fin → non applicable (pas de borne à repousser)", () => {
    const r = applyMntDecision("renouvellement_contrat", { statut: "actif", dateDebut: "2026-01-01", dateFin: null });
    expect(r.applied).toBe(false);
  });
  it("nature de décision inconnue → non applicable", () => {
    expect(applyMntDecision("autre", { statut: "actif" }).applied).toBe(false);
  });
});
