// Pont API Claude pour la détermination AUTOMATIQUE du statut d'un contrat (cas de JUGEMENT uniquement —
// les transitions mécaniques sont tranchées par les règles de domain/mntStatutAuto, sans IA). Isolé ici
// pour que le domaine + les tests restent SANS dépendance au SDK. Modèle : Claude Opus 4.8, réflexion
// ADAPTATIVE. La sortie brute est TOUJOURS re-validée par normalizeStatutProposals (l'IA propose, on vérifie).
const { buildStatutPrompt, normalizeStatutProposals } = require("../domain/mntStatutAuto");
const { parseJson } = require("./anthropic");

const DEFAULT_MODEL = "claude-opus-4-8";

/**
 * Demande à Claude de juger le statut d'un lot de contrats (cas ambigus seulement).
 * @param {string} apiKey  clé Anthropic (Secret Manager)
 * @param {object[]} cases contrats à juger { id, fp, current, hint, ticketsOuverts, dernierTicketJours, joursAvantFin, risqueNiveau }
 * @param {{model?:string}} [opts]
 * @returns {Promise<{proposals:object[], model:string, usage:object|null}>}
 */
async function aiMntContratStatut(apiKey, cases, opts = {}) {
  const model = opts.model || DEFAULT_MODEL;
  const { system, user } = buildStatutPrompt(cases || []);

  const Anthropic = require("@anthropic-ai/sdk");
  const client = new Anthropic({ apiKey });

  const res = await client.messages.create({
    model,
    max_tokens: 8000,
    thinking: { type: "adaptive" },
    system,
    messages: [{ role: "user", content: user }],
  });

  // Refus explicite (politique de sécurité) → signalé à l'appelant plutôt qu'un vide silencieux.
  if (res.stop_reason === "refusal") {
    const err = new Error("Le modèle a refusé de traiter la demande.");
    err.code = "ai_refusal";
    throw err;
  }

  const text = (res.content || []).filter((c) => c && c.type === "text").map((c) => c.text).join("");
  const proposals = normalizeStatutProposals(parseJson(text), cases || []);
  return { proposals, model, usage: res.usage || null };
}

module.exports = { aiMntContratStatut, DEFAULT_MODEL };
