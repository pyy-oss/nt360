import { describe, it, expect, vi, afterEach } from "vitest";
import { relTime } from "./format";

describe("relTime — temps relatif", () => {
  afterEach(() => vi.useRealTimers());
  const at = (iso: string) => ({ toMillis: () => Date.parse(iso) });

  it("vide si horodatage absent", () => {
    expect(relTime(null)).toBe("");
    expect(relTime({})).toBe("");
  });
  it("échelles à l'instant / min / h / j", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-10T12:00:00Z"));
    expect(relTime(at("2026-01-10T11:59:30Z"))).toBe("à l'instant");
    expect(relTime(at("2026-01-10T11:30:00Z"))).toBe("il y a 30 min");
    expect(relTime(at("2026-01-10T09:00:00Z"))).toBe("il y a 3 h");
    expect(relTime(at("2026-01-07T12:00:00Z"))).toBe("il y a 3 j");
  });
  it("supporte le format {seconds}", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-10T12:00:00Z"));
    expect(relTime({ seconds: Date.parse("2026-01-10T11:30:00Z") / 1000 })).toBe("il y a 30 min");
  });
});
