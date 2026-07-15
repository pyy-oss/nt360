import { describe, it, expect } from "vitest";
import { isStaleChunkError } from "./staleChunk";

describe("staleChunk — détection d'un chunk périmé après déploiement", () => {
  it("reconnaît les messages d'échec de chargement de module dynamique", () => {
    expect(isStaleChunkError(new Error("Failed to fetch dynamically imported module: https://x/assets/admin-abc.js"))).toBe(true);
    expect(isStaleChunkError("error loading dynamically imported module")).toBe(true);
    expect(isStaleChunkError(new Error("Loading chunk 12 failed"))).toBe(true);
    expect(isStaleChunkError(new Error("Importing a module script failed."))).toBe(true);
  });
  it("ne confond pas un vrai crash applicatif avec un chunk périmé", () => {
    expect(isStaleChunkError(new Error("Cannot read properties of undefined (reading 'map')"))).toBe(false);
    expect(isStaleChunkError(new Error("permission-denied"))).toBe(false);
    expect(isStaleChunkError(null)).toBe(false);
    expect(isStaleChunkError(undefined)).toBe(false);
  });
});
