import { describe, it, expect } from "vitest";
const { validateApprovalRequest, approverFor, APPROVAL_KINDS } = require("../domain/approval");

describe("validateApprovalRequest — normalisation + garde-fous", () => {
  it("accepte une demande de remise sur opportunité", () => {
    const r = validateApprovalRequest({ kind: "remise_opp", entityType: "opportunity", entityId: "saisie_x", amount: 5000, note: "remise 15%" });
    expect(r.ok).toBe(true);
    expect(r.value.amount).toBe(5000);
    expect(r.value.note).toBe("remise 15%");
  });
  it("montant vide/négatif/non numérique → null (pas d'échec)", () => {
    expect(validateApprovalRequest({ kind: "autre", entityType: "other", entityId: "X", amount: "" }).value.amount).toBeNull();
    expect(validateApprovalRequest({ kind: "autre", entityType: "other", entityId: "X", amount: -3 }).value.amount).toBeNull();
    expect(validateApprovalRequest({ kind: "autre", entityType: "other", entityId: "X", amount: "abc" }).value.amount).toBeNull();
  });
  it("rejette nature/entité invalides ou identifiant manquant", () => {
    expect(validateApprovalRequest({ kind: "x", entityType: "opportunity", entityId: "a" }).ok).toBe(false);
    expect(validateApprovalRequest({ kind: "autre", entityType: "z", entityId: "a" }).ok).toBe(false);
    expect(validateApprovalRequest({ kind: "autre", entityType: "other", entityId: "" }).ok).toBe(false);
  });
  it("borne note (1000) et libellé (200)", () => {
    const r = validateApprovalRequest({ kind: "autre", entityType: "other", entityId: "X", note: "n".repeat(2000), entityLabel: "l".repeat(500) });
    expect(r.value.note).toHaveLength(1000);
    expect(r.value.entityLabel).toHaveLength(200);
  });
  it("couvre les natures attendues", () => {
    expect(APPROVAL_KINDS).toContain("remise_opp");
    expect(APPROVAL_KINDS).toContain("depassement_bc");
  });
});

describe("approverFor — routage vers le manager (hiérarchie) sinon direction", () => {
  const USERS = { alice: { managerUid: "boss" }, boss: { managerUid: "dg" }, solo: {} };
  it("route vers le manager direct", () => {
    expect(approverFor(USERS, "alice", "dg")).toBe("boss");
  });
  it("sans manager → repli sur la direction", () => {
    expect(approverFor(USERS, "solo", "dg")).toBe("dg");
  });
  it("jamais soi-même : si le repli est le demandeur → null", () => {
    expect(approverFor(USERS, "solo", "solo")).toBeNull();
  });
  it("manager == soi ignoré → repli", () => {
    expect(approverFor({ x: { managerUid: "x" } }, "x", "dg")).toBe("dg");
  });
});
