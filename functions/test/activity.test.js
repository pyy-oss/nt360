import { describe, it, expect } from "vitest";
const { validateActivity, isOverdue, ACTIVITY_TYPES } = require("../domain/activity");

const NOW = "2026-07-08";

describe("validateActivity — normalisation + garde-fous", () => {
  it("accepte une note rattachée à un compte", () => {
    const r = validateActivity({ type: "note", subject: "Point annuel", relatedType: "account", relatedId: "ORANGE" }, NOW);
    expect(r.ok).toBe(true);
    expect(r.value.subject).toBe("Point annuel");
    expect(r.value.at).toBe(NOW);
    expect(r.value.dueDate).toBeNull(); // non-tâche → pas d'échéance
    expect(r.value.done).toBe(false);
  });
  it("une tâche conserve échéance + état, tronqués à AAAA-MM-JJ", () => {
    const r = validateActivity({ type: "task", subject: "Relancer", relatedType: "opportunity", relatedId: "saisie_x", dueDate: "2026-07-20T10:00:00Z", done: true }, NOW);
    expect(r.value.dueDate).toBe("2026-07-20");
    expect(r.value.done).toBe(true);
  });
  it("un type non-tâche ne porte JAMAIS d'échéance ni de done, même fournis", () => {
    const r = validateActivity({ type: "call", subject: "Appel", relatedType: "account", relatedId: "X", dueDate: "2026-07-20", done: true }, NOW);
    expect(r.value.dueDate).toBeNull();
    expect(r.value.done).toBe(false);
  });
  it("rejette type inconnu, sujet vide, rattachement invalide", () => {
    expect(validateActivity({ type: "sms", subject: "x", relatedType: "account", relatedId: "X" }, NOW).ok).toBe(false);
    expect(validateActivity({ type: "note", subject: "  ", relatedType: "account", relatedId: "X" }, NOW).ok).toBe(false);
    expect(validateActivity({ type: "note", subject: "x", relatedType: "client", relatedId: "X" }, NOW).ok).toBe(false);
    expect(validateActivity({ type: "note", subject: "x", relatedType: "account", relatedId: "" }, NOW).ok).toBe(false);
  });
  it("borne sujet (200) et corps (4000)", () => {
    const r = validateActivity({ type: "note", subject: "a".repeat(500), body: "b".repeat(5000), relatedType: "account", relatedId: "X" }, NOW);
    expect(r.value.subject).toHaveLength(200);
    expect(r.value.body).toHaveLength(4000);
  });
  it("couvre les 5 types", () => {
    expect(ACTIVITY_TYPES).toEqual(["call", "email", "meeting", "note", "task"]);
  });
});

describe("isOverdue — tâche ouverte à échéance passée", () => {
  it("tâche ouverte échue = en retard", () => {
    expect(isOverdue({ type: "task", done: false, dueDate: "2026-07-01" }, NOW)).toBe(true);
  });
  it("tâche faite, ou future, ou non-tâche = pas en retard", () => {
    expect(isOverdue({ type: "task", done: true, dueDate: "2026-07-01" }, NOW)).toBe(false);
    expect(isOverdue({ type: "task", done: false, dueDate: "2026-07-20" }, NOW)).toBe(false);
    expect(isOverdue({ type: "note", dueDate: "2026-07-01" }, NOW)).toBe(false);
    expect(isOverdue({ type: "task", done: false, dueDate: null }, NOW)).toBe(false);
  });
});
