import { describe, it, expect } from "vitest";
import { MARGIN, DERIVE_SUSPECT_PCT, FIAB, QUALITY } from "./thresholds";

// Fige les seuils éditoriaux : toute modif est intentionnelle et doit être répercutée côté serveur
// (functions/domain/thresholds.js ALERT_DEFAULTS). Les paliers de projection sont testés à part
// (lib/projection via le moteur configurable).
describe("thresholds — contrat serveur ↔ client (garde-fou anti-dérive)", () => {
  it("seuils %MB / RAF suspect / fiabilité / qualité", () => {
    expect(MARGIN).toEqual({ LOW: 0.1, OK: 0.2 });
    expect(DERIVE_SUSPECT_PCT).toBe(0.05);
    expect(FIAB).toEqual({ GOOD: 0.8, FAIR: 0.5 });
    expect(QUALITY).toEqual({ GOOD: 0.9, FAIR: 0.7 });
  });
});
