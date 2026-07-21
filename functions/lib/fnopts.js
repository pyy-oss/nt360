// Options de déploiement des fonctions — traduction `memoryMiB` → `memory` (firebase-functions v2).
//
// BUG HISTORIQUE (2026-07, « échec import ») : l'ERP déclare partout `memoryMiB: N`, mais cette option
// N'EXISTE PAS dans firebase-functions v2 — l'option s'appelle `memory` et prend une chaîne ("512MiB",
// "2GiB"). Le SDK l'IGNORAIT en silence (aucune erreur, availableMemoryMb: null) : TOUTES les fonctions
// tournaient au défaut de 256 Mio. Les fonctions lourdes mouraient en OOM au premier fichier réel —
// importDelta (2 Gio voulus) répondait 503 sans en-têtes CORS, systématiquement, sans jamais atteindre
// le code. Traduction CENTRALE ici (les ~175 sites gardent leur forme `memoryMiB`), valeur inconnue =
// ERREUR AU CHARGEMENT (fail-fast au déploiement, jamais un silence). PUR → testé (fnopts.test.js fige
// availableMemoryMb sur un vrai onCall — le filet qui aurait attrapé ce bug).
const MEMORY_BY_MIB = { 128: "128MiB", 256: "256MiB", 512: "512MiB", 1024: "1GiB", 2048: "2GiB", 4096: "4GiB" };

function withMemory(opts) {
  const { memoryMiB, ...rest } = opts || {};
  if (memoryMiB != null) {
    const memory = MEMORY_BY_MIB[memoryMiB];
    if (!memory) throw new Error(`memoryMiB invalide (${memoryMiB}) — valeurs admises : ${Object.keys(MEMORY_BY_MIB).join(", ")}`);
    rest.memory = memory;
  }
  return rest;
}

module.exports = { MEMORY_BY_MIB, withMemory };
