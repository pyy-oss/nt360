// Pont API Claude pour les SUGGESTIONS DE CONTRATS DE MAINTENANCE (l'IA juge quelles affaires du carnet
// relèvent d'une prestation récurrente). Isolé ici pour que le domaine + les tests n'aient AUCUNE dépendance
// au SDK. Modèle : Claude Opus 4.8 (jugement de rapprochement). Réflexion ADAPTATIVE (le modèle dose son
// analyse). La sortie brute est TOUJOURS re-validée par domain/mntSuggest.normalizeMntSuggestions
// (l'IA propose, on ne fait pas confiance).
const { buildMntSuggestPrompt, normalizeMntSuggestions } = require("../domain/mntSuggest");
const { parseJson } = require("./anthropic");

const DEFAULT_MODEL = "claude-opus-4-8";

/**
 * Demande à Claude de juger un lot de candidats (affaires du carnet sans contrat).
 * @param {string} apiKey       clé Anthropic (Secret Manager)
 * @param {object[]} candidates affaires { fp, client, bu, am, affaire, cas }
 * @param {{model?:string}} [opts]
 * @returns {Promise<{suggestions:object[], model:string, usage:object|null}>}
 */
async function aiSuggestMntContrats(apiKey, candidates, opts = {}) {
  const model = opts.model || DEFAULT_MODEL;
  const { system, user } = buildMntSuggestPrompt(candidates || []);

  const Anthropic = require("@anthropic-ai/sdk");
  const client = new Anthropic({ apiKey });

  // Non-stream : lot borné (≤ ~60 candidats) → réponse dans le timeout du callable. max_tokens large :
  // réflexion adaptative + un JSON couvrant chaque fp. Un JSON tronqué donnerait 0 suggestion (parseJson
  // → {} → normalize → []), échec silencieux — la marge évite la troncature.
  const res = await client.messages.create({
    model,
    max_tokens: 16000,
    thinking: { type: "adaptive" },
    system,
    messages: [{ role: "user", content: user }],
  });

  // Refus explicite du modèle (politique de sécurité) → on le signale à l'appelant plutôt que de renvoyer vide.
  if (res.stop_reason === "refusal") {
    const err = new Error("Le modèle a refusé de traiter la demande.");
    err.code = "ai_refusal";
    throw err;
  }

  const text = (res.content || []).filter((c) => c && c.type === "text").map((c) => c.text).join("");
  const suggestions = normalizeMntSuggestions(parseJson(text), candidates || []);
  return { suggestions, model, usage: res.usage || null };
}

module.exports = { aiSuggestMntContrats, DEFAULT_MODEL };
