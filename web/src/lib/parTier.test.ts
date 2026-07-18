import { describe, it, expect } from "vitest";
import { tierProgress, type Tier, type CoverageRow } from "./parTier";

const tiers: Tier[] = [
  { id: "authorized", name: "Authorized", rank: 1 },
  { id: "silver", name: "Silver", rank: 2 },
  { id: "gold", name: "Gold", rank: 3 },
];
const cov = (tierId: string, target: string, holders: number, minCount: number): CoverageRow => ({ tierId, target, holders, minCount, ok: holders >= minCount });

describe("tierProgress", () => {
  it("niveau tenu = plus haut niveau contigu couvert depuis le bas", () => {
    // Authorized ok, Silver ok, Gold manque 1 → tenu = Silver, prochain = Gold.
    const p = tierProgress(tiers, [cov("authorized", "cert-a", 2, 1), cov("silver", "cert-b", 2, 2), cov("gold", "cert-c", 1, 2)]);
    expect(p.achieved?.id).toBe("silver");
    expect(p.next?.id).toBe("gold");
    expect(p.gaps).toEqual([{ target: "cert-c", holders: 1, minCount: 2, missing: 1 }]);
  });

  it("échelle cumulative : un trou en bas empêche de tenir un niveau supérieur pourtant couvert", () => {
    // Authorized manque, Gold couvert → on ne tient rien (chaîne rompue dès le bas) ; prochain = Authorized.
    const p = tierProgress(tiers, [cov("authorized", "cert-a", 0, 1), cov("gold", "cert-c", 5, 2)]);
    expect(p.achieved).toBe(null);
    expect(p.next?.id).toBe("authorized");
    expect(p.gaps).toEqual([{ target: "cert-a", holders: 0, minCount: 1, missing: 1 }]);
  });

  it("tous niveaux couverts → niveau max tenu, aucun prochain", () => {
    const p = tierProgress(tiers, [cov("authorized", "a", 1, 1), cov("silver", "b", 2, 2), cov("gold", "c", 3, 2)]);
    expect(p.achieved?.id).toBe("gold");
    expect(p.next).toBe(null);
    expect(p.gaps).toEqual([]);
  });

  it("un niveau sans exigence est considéré couvert (rien à satisfaire)", () => {
    // Silver n'a aucune exigence → couvert ; Gold manque.
    const p = tierProgress(tiers, [cov("authorized", "a", 1, 1), cov("gold", "c", 0, 1)]);
    expect(p.achieved?.id).toBe("silver");
    expect(p.next?.id).toBe("gold");
  });

  it("robustesse : tiers/couverture vides", () => {
    expect(tierProgress([], [])).toEqual({ achieved: null, next: null, gaps: [] });
    expect(tierProgress(null, null).achieved).toBe(null);
  });
});
