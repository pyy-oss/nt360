import { describe, it, expect } from "vitest";
import { PROJ, MARGIN, DERIVE_SUSPECT_PCT, FIAB, QUALITY } from "./thresholds";

// Fige les seuils éditoriaux : toute modif est intentionnelle et doit être répercutée côté serveur
// (functions/domain/chaine.js projectionWeight + functions/domain/thresholds.js ALERT_DEFAULTS).
describe("thresholds — contrat serveur ↔ client (garde-fou anti-dérive)", () => {
  it("paliers de projection = miroir de projectionWeight (100 / 20 / 10 %)", () => {
    expect(PROJ.FULL).toBe(0.9);
    expect(PROJ.T2).toBe(0.7);
    expect(PROJ.T3).toBe(0.5);
    expect(PROJ.W_FULL).toBe(1);
    expect(PROJ.W_T2).toBe(0.2);
    expect(PROJ.W_T3).toBe(0.1);
  });
  it("seuils %MB / RAF suspect / fiabilité / qualité", () => {
    expect(MARGIN).toEqual({ LOW: 0.1, OK: 0.2 });
    expect(DERIVE_SUSPECT_PCT).toBe(0.05);
    expect(FIAB).toEqual({ GOOD: 0.8, FAIR: 0.5 });
    expect(QUALITY).toEqual({ GOOD: 0.9, FAIR: 0.7 });
  });
});
