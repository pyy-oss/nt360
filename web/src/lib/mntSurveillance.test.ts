import { describe, it, expect } from "vitest";
import { watchMatchesEvent, hasAnyWatch, severityTone, EVENT_TYPE_LABEL, type MntSurveillanceEvent } from "./mntSurveillance";

const ev = (o: Partial<MntSurveillanceEvent> = {}): MntSurveillanceEvent => ({
  id: "C1:sla_rompu", contratId: "C1", fp: "FP/2026/7", client: "ACME", am: "Awa", bu: "ICT",
  type: "sla_rompu", severity: "high", message: "…", ...o,
});

describe("mntSurveillance (front) — filtrage par abonnement, miroir du back", () => {
  it("global couvre tout ; sinon match par contrat / client / AM", () => {
    expect(watchMatchesEvent({ global: true }, ev())).toBe(true);
    expect(watchMatchesEvent({ contrats: ["C1"] }, ev())).toBe(true);
    expect(watchMatchesEvent({ clients: ["ACME"] }, ev())).toBe(true);
    expect(watchMatchesEvent({ ams: ["Awa"] }, ev())).toBe(true);
    expect(watchMatchesEvent({ contrats: ["C9"], clients: ["X"], ams: ["Z"] }, ev())).toBe(false);
    expect(watchMatchesEvent(null, ev())).toBe(false);
  });
  it("hasAnyWatch : vrai dès un abonnement, faux si tout est vide", () => {
    expect(hasAnyWatch({ global: true })).toBe(true);
    expect(hasAnyWatch({ contrats: ["C1"] })).toBe(true);
    expect(hasAnyWatch({ global: false, contrats: [], clients: [], ams: [] })).toBe(false);
    expect(hasAnyWatch(null)).toBe(false);
  });
  it("ton de sévérité aligné sur la palette de risque et libellés de type présents", () => {
    expect(severityTone("high")).toBe("clay");
    expect(severityTone("medium")).toBe("gold");
    expect(severityTone("low")).toBe("steel");
    expect(EVENT_TYPE_LABEL.echeance_proche).toBe("Renouvellement");
  });
});
