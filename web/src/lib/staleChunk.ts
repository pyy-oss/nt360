// Résilience aux DÉPLOIEMENTS — chunk paresseux périmé. Après un déploiement, les anciens chunks hashés
// disparaissent du hosting ; un onglet resté ouvert qui charge un module paresseux (React.lazy) échoue
// avec « Failed to fetch dynamically imported module ». Ce n'est PAS un bug applicatif : c'est un artefact
// de déploiement. La bonne réponse est de RECHARGER une fois (nouvel index + chunks), pas d'afficher un
// crash ni de polluer l'observabilité. Ce module centralise la détection + le rechargement (garde
// anti-boucle : au plus un rechargement par tranche de 10 s), partagé par le handler `vite:preloadError`
// (main.tsx, chemin PRELOAD) et l'ErrorBoundary (chemin RUNTIME import()).
const RELOAD_KEY = "nt360-chunk-reload";
// Messages émis selon le navigateur/bundler pour un échec de chargement de module dynamique.
const STALE_CHUNK_RE = /(dynamically imported module|failed to fetch|loading chunk|importing a module script failed|error loading dynamically|module script failed)/i;

/** Vrai si l'erreur est un échec de chargement de chunk paresseux (chunk périmé après déploiement). */
export function isStaleChunkError(err: unknown): boolean {
  const msg = typeof err === "string" ? err : (err && (err as { message?: unknown }).message) || "";
  return STALE_CHUNK_RE.test(String(msg));
}

/** Recharge la page AU PLUS une fois par tranche de 10 s. Renvoie true si un rechargement a été déclenché. */
export function reloadForStaleChunk(): boolean {
  try {
    const last = Number(sessionStorage.getItem(RELOAD_KEY) || 0);
    if (Date.now() - last > 10000) {
      sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
      window.location.reload();
      return true;
    }
  } catch { /* sessionStorage indisponible → pas de rechargement automatique */ }
  return false;
}
