// Pont API Claude pour les SUGGESTIONS DE FUSION de noms clients (l'IA juge quelles graphies désignent la
// même entité). Isolé ici pour que le domaine + les tests n'aient AUCUNE dépendance au SDK. Modèle :
// Claude Opus 4.8, réflexion ADAPTATIVE. Sortie brute TOUJOURS re-validée par
// domain/aiClientNorm.normalizeClientMergeSuggestions (l'IA propose, on ne fait pas confiance).
const { buildClientNormPrompt, normalizeClientMergeSuggestions } = require("../domain/aiClientNorm");
const { parseJson } = require("./anthropic");

const DEFAULT_MODEL = "claude-opus-4-8";

/**
 * Demande à Claude des fusions de graphies pour un inventaire de noms clients OU fournisseurs.
 * @param {string} apiKey  clé Anthropic (Secret Manager)
 * @param {{name:string, count?:number}[]} names inventaire des graphies brutes
 * @param {{model?:string, entity?:"client"|"fournisseur"}} [opts] entité du référentiel (prompt + clé de dédup)
 * @returns {Promise<{suggestions:object[], model:string, usage:object|null}>}
 */
async function aiSuggestClientMerges(apiKey, names, opts = {}) {
  const model = opts.model || DEFAULT_MODEL;
  const entity = opts.entity === "fournisseur" ? "fournisseur" : "client";
  const { system, user } = buildClientNormPrompt(names || [], entity);

  const Anthropic = require("@anthropic-ai/sdk");
  const client = new Anthropic({ apiKey });

  // Non-stream : lot borné (≤ ~400 graphies) → réponse dans le timeout. max_tokens large : réflexion
  // adaptative + un JSON couvrant les fusions. Un JSON tronqué donnerait 0 suggestion (échec silencieux).
  const res = await client.messages.create({
    model,
    max_tokens: 16000,
    thinking: { type: "adaptive" },
    system,
    messages: [{ role: "user", content: user }],
  });

  // Refus explicite du modèle → signalé à l'appelant plutôt que renvoyer vide.
  if (res.stop_reason === "refusal") {
    const err = new Error("Le modèle a refusé de traiter la demande.");
    err.code = "ai_refusal";
    throw err;
  }

  const text = (res.content || []).filter((c) => c && c.type === "text").map((c) => c.text).join("");
  // Clé de dédup/no-op propre au référentiel : canonicalKey (clients) vs cleanName (fournisseurs, ADR-P20).
  const keyFn = entity === "fournisseur" ? require("./ids").cleanName : undefined;
  const suggestions = normalizeClientMergeSuggestions(parseJson(text), names || [], keyFn);
  return { suggestions, model, usage: res.usage || null };
}

module.exports = { aiSuggestClientMerges, DEFAULT_MODEL };
