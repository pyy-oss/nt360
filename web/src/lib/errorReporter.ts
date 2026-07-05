// Remontée d'erreurs client (observabilité front) : capture les erreurs JS non gérées, les rejets
// de promesses non gérés et les crashs de rendu (via ErrorBoundary) → callable logClientError →
// collection errorLog (Admin). Best-effort et défensif : ne lève JAMAIS, dédoublonne et plafonne
// par session (anti-boucle / anti-spam). Les erreurs pré-authentification sont ignorées côté serveur
// (callable réservé aux sessions connectées).
import { logClientError } from "./writes";

let installed = false;
let sent = 0;
const MAX_PER_SESSION = 20;
const seen = new Set<string>();

/** Signale une erreur (dédoublonnée, plafonnée). Ne lève jamais. */
export function reportError(message: string, source: string, stack?: string) {
  try {
    if (sent >= MAX_PER_SESSION) return;
    const msg = String(message || "").slice(0, 1000) || "(sans message)";
    const key = `${source}|${msg}`.slice(0, 240);
    if (seen.has(key)) return;
    seen.add(key);
    sent += 1;
    // Fire-and-forget : un échec de remontée (hors ligne, non authentifié…) est silencieux — on ne
    // remonte jamais l'échec du reporter lui-même (sinon boucle).
    logClientError({
      message: msg,
      stack: stack ? String(stack).slice(0, 4000) : undefined,
      url: (typeof location !== "undefined" ? location.href : "").slice(0, 500),
      module: source.slice(0, 120),
      ua: (typeof navigator !== "undefined" ? navigator.userAgent : "").slice(0, 300),
    }).catch(() => { /* silencieux */ });
  } catch { /* le reporter ne doit jamais casser l'app */ }
}

/** Installe les gestionnaires globaux (une seule fois). */
export function installErrorReporter() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  window.addEventListener("error", (e) => {
    reportError(e.message || "Erreur JS", "window.onerror", (e.error && e.error.stack) || undefined);
  });
  window.addEventListener("unhandledrejection", (e) => {
    const r: any = e.reason;
    reportError((r && r.message) || String(r), "unhandledrejection", r && r.stack);
  });
}
