// LIVRAISON DURABLE des webhooks sortants (R7 « #29 → 10 ») — quand un SI tiers est indisponible, on ne
// PERD plus l'événement : il est mis en file (outboundQueue) et re-tenté avec un backoff exponentiel
// jusqu'à succès ou épuisement des tentatives (dead-letter). Ces fonctions PURES (aucun I/O, aucune
// horloge — `nowMs` fourni) portent la POLITIQUE de rejeu et sont testables.

const MAX_ATTEMPTS = 6; // ~ 1+2+4+8+16+32 min ≈ 1 h de fenêtre de rejeu avant abandon

// Délai avant la prochaine tentative (ms), backoff exponentiel plafonné à 1 h. `attempts` = nombre de
// tentatives DÉJÀ effectuées (1 après le premier échec).
function nextBackoffMs(attempts) {
  const a = Math.max(1, Number(attempts) || 1);
  return Math.min(60 * 60_000, 60_000 * Math.pow(2, a - 1));
}

// Un item est REJOUABLE s'il est en attente et que l'instant de prochaine tentative est atteint.
function isDue(item, nowMs) {
  return !!item && item.status === "pending" && (Number(item.nextAttemptMs) || 0) <= nowMs;
}

// Calcule l'état suivant après une tentative. `ok` = livraison réussie. Renvoie le patch à appliquer.
function nextState(item, ok, nowMs, error) {
  const attempts = (Number(item && item.attempts) || 0) + 1;
  if (ok) return { status: "delivered", attempts, deliveredMs: nowMs, lastError: null };
  if (attempts >= MAX_ATTEMPTS) return { status: "failed", attempts, lastError: String(error || "").slice(0, 500) };
  return { status: "pending", attempts, nextAttemptMs: nowMs + nextBackoffMs(attempts), lastError: String(error || "").slice(0, 500) };
}

module.exports = { MAX_ATTEMPTS, nextBackoffMs, isDue, nextState };
