import { describe, it, expect } from "vitest";
import { validateCandidate, isActive, recruitmentFunnel } from "../domain/candidate.js";

describe("validateCandidate (Lot 16 vivier)", () => {
  it("nom requis, défauts sûrs", () => {
    expect(validateCandidate({}).ok).toBe(false);
    const v = validateCandidate({ name: "Alice", gradeTarget: "?", status: "?", bu: "data" }).value;
    expect(v.gradeTarget).toBe("confirme");
    expect(v.status).toBe("sourced");
    expect(v.bu).toBe("DATA");
  });
  it("normalise compétences, TJM, mois cible", () => {
    const v = validateCandidate({ name: "Bob", skills: ["Go", ""], tjmTarget: "650", expectedStartMonth: "2026-03-01" }).value;
    expect(v.skills).toEqual(["Go"]);
    expect(v.tjmTarget).toBe(650);
    expect(v.expectedStartMonth).toBe("2026-03");
  });
});

describe("isActive", () => {
  it("actif tant que ni embauché ni rejeté", () => {
    expect(isActive({ status: "interview" })).toBe(true);
    expect(isActive({ status: "hired" })).toBe(false);
    expect(isActive({ status: "rejected" })).toBe(false);
  });
});

describe("recruitmentFunnel — funnel + capacité future attendue par BU", () => {
  const cands = [
    { name: "A", bu: "DATA", status: "sourced" },
    { name: "B", bu: "DATA", status: "offer" },
    { name: "C", bu: "DATA", status: "rejected" },
    { name: "D", bu: "CLOUD", status: "hired" },
  ];
  it("compte le funnel et pondère les embauches attendues par BU", () => {
    const r = recruitmentFunnel(cands);
    expect(r.counts.sourced).toBe(1);
    expect(r.counts.offer).toBe(1);
    expect(r.counts.rejected).toBe(1);
    expect(r.inPipeline).toBe(2); // sourced + interview + offer
    const data = r.byBu.find((b) => b.bu === "DATA");
    // DATA : sourced(0.1) + offer(0.7) = 0.8 embauche attendue ; rejeté ignoré
    expect(data.expectedHires).toBe(0.8);
    expect(data.active).toBe(2);
    const cloud = r.byBu.find((b) => b.bu === "CLOUD");
    expect(cloud.expectedHires).toBe(1); // hired = 1, mais active=0
    expect(cloud.active).toBe(0);
  });
});
