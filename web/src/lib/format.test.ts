import { describe, it, expect, vi, afterEach } from "vitest";
import { relTime, ageDays } from "./format";

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

describe("ageDays — âge en jours (garde-fou fraîcheur)", () => {
  const now = Date.parse("2026-01-10T12:00:00Z");
  const at = (iso: string) => ({ toMillis: () => Date.parse(iso) });
  it("-1 si horodatage inconnu (distinct de 0 j)", () => {
    expect(ageDays(null, now)).toBe(-1);
    expect(ageDays({}, now)).toBe(-1);
  });
  it("compte les jours entiers écoulés", () => {
    expect(ageDays(at("2026-01-10T09:00:00Z"), now)).toBe(0); // même jour
    expect(ageDays(at("2026-01-09T12:00:00Z"), now)).toBe(1);
    expect(ageDays(at("2026-01-05T12:00:00Z"), now)).toBe(5);
  });
});
