import { describe, it, expect } from "vitest";
import { subHasLimit, DEFAULT_SUB_CAP } from "./hooks";
import type { QueryConstraint } from "firebase/firestore";

// On teste la logique PURE de détection de borne (Lot 12) avec des contraintes factices portant `.type`
// (forme réelle des QueryConstraint Firestore : where→"where", orderBy→"orderBy", limit→"limit").
const c = (type: string) => ({ type } as unknown as QueryConstraint);

describe("subHasLimit (Lot 12 — bornage des abonnements)", () => {
  it("aucune contrainte → pas de borne", () => {
    expect(subHasLimit([])).toBe(false);
  });
  it("where/orderBy seuls → pas de borne (l'abonnement doit être plafonné)", () => {
    expect(subHasLimit([c("where"), c("orderBy")])).toBe(false);
  });
  it("limit présent → borné (on ne double pas le plafond)", () => {
    expect(subHasLimit([c("orderBy"), c("limit")])).toBe(true);
  });
  it("limitToLast présent → borné", () => {
    expect(subHasLimit([c("limitToLast")])).toBe(true);
  });
  it("plafond par défaut raisonnable (> 1000, borne de sécurité)", () => {
    expect(DEFAULT_SUB_CAP).toBeGreaterThan(1000);
  });
});
