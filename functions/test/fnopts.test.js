import { describe, it, expect } from "vitest";
const { withMemory } = require("../lib/fnopts");
const { onCall } = require("firebase-functions/v2/https");

describe("fnopts — traduction memoryMiB → memory (firebase-functions v2)", () => {
  it("traduit chaque valeur admise en option v2 et retire memoryMiB", () => {
    expect(withMemory({ memoryMiB: 2048, timeoutSeconds: 540 })).toEqual({ memory: "2GiB", timeoutSeconds: 540 });
    expect(withMemory({ memoryMiB: 1024 }).memory).toBe("1GiB");
    expect(withMemory({ memoryMiB: 512 }).memory).toBe("512MiB");
    expect("memoryMiB" in withMemory({ memoryMiB: 256 })).toBe(false);
  });
  it("valeur inconnue = erreur au CHARGEMENT (fail-fast au déploiement, jamais un silence)", () => {
    expect(() => withMemory({ memoryMiB: 384 })).toThrow(/memoryMiB invalide/);
  });
  it("sans memoryMiB : options inchangées (secrets, cors, schedule… passent tels quels)", () => {
    expect(withMemory({ timeoutSeconds: 60, cors: false })).toEqual({ timeoutSeconds: 60, cors: false });
    expect(withMemory(undefined)).toEqual({});
  });
  it("LE FILET : la mémoire est RÉELLEMENT résolue par firebase-functions (availableMemoryMb posé)", () => {
    // Bug d'origine (« échec import », 503 OOM) : onCall({ memoryMiB: 2048 }) → option inconnue IGNORÉE
    // par le SDK → availableMemoryMb null → 256 Mio par défaut en prod → importDelta tué au parse.
    const fixed = onCall(withMemory({ memoryMiB: 2048 }), () => {});
    expect(fixed.__endpoint.availableMemoryMb).toBe(2048);
    // Documente le silence du SDK : sans traduction, les 2 Gio demandés ne sont JAMAIS appliqués
    // (null en Node pur, sentinelle de reset sous vitest — dans les deux cas ≠ 2048 → défaut 256 Mio).
    const buggy = onCall({ memoryMiB: 2048 }, () => {});
    expect(buggy.__endpoint.availableMemoryMb === 2048).toBe(false);
  });
});
