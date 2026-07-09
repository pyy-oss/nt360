import { describe, it, expect } from "vitest";
import { MAX_SCAN, sliceCapped } from "../domain/scan.js";

describe("sliceCapped — garde-fou des scans pleins (R1)", () => {
  it("ne tronque pas sous le plafond", () => {
    const r = sliceCapped([1, 2, 3], 5);
    expect(r.capped).toBe(false);
    expect(r.docs).toEqual([1, 2, 3]);
  });
  it("ne tronque pas exactement au plafond", () => {
    const r = sliceCapped([1, 2, 3], 3);
    expect(r.capped).toBe(false);
    expect(r.docs.length).toBe(3);
  });
  it("tronque et signale au-delà du plafond (lecture cap+1)", () => {
    const r = sliceCapped([1, 2, 3, 4], 3);
    expect(r.capped).toBe(true);
    expect(r.docs).toEqual([1, 2, 3]);
  });
  it("tolère une entrée non tableau", () => {
    const r = sliceCapped(undefined, 3);
    expect(r.capped).toBe(false);
    expect(r.docs).toEqual([]);
  });
  it("utilise MAX_SCAN par défaut", () => {
    expect(MAX_SCAN).toBeGreaterThanOrEqual(100_000);
    const r = sliceCapped([1, 2], undefined);
    expect(r.capped).toBe(false);
  });
});
