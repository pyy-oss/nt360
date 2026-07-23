// Pont API Claude pour les LIGNÉES DE RENOUVELLEMENT (ADR-030) : l'IA confirme qu'un groupe de contrats
// candidats est bien la RECONDUCTION du même engagement (pas un rapprochement fortuit). Isolé ici pour que le
// domaine + les tests n'aient AUCUNE dépendance au SDK. Modèle : Claude Opus 4.8. Réflexion ADAPTATIVE. La
// sortie brute est TOUJOURS re-validée par domain/mntLignee.normalizeLigneeConfirmations (l'IA propose, on ne
// fait pas confiance).
const { buildLigneePrompt, normalizeLigneeConfirmations } = require("../domain/mntLignee");
const { parseJson } = require("./anthropic");

const DEFAULT_MODEL = "claude-opus-4-8";

/**
 * Demande à Claude de confirmer des lignées candidates.
 * @param {string} apiKey    clé Anthropic (Secret Manager)
 * @param {object[]} lignees lignées candidates { numero, client, contrats:[...] }
 * @param {{model?:string}} [opts]
 * @returns {Promise<{confirmations:object[], model:string, usage:object|null}>}
 */
async function aiConfirmMntLignees(apiKey, lignees, opts = {}) {
  const model = opts.model || DEFAULT_MODEL;
  const { system, user } = buildLigneePrompt(lignees || []);

  const Anthropic = require("@anthropic-ai/sdk");
  const client = new Anthropic({ apiKey });

  // Non-stream : lot borné → réponse dans le timeout du callable. max_tokens large (réflexion adaptative + un
  // JSON couvrant chaque numéro) ; une troncature donnerait 0 confirmation (échec silencieux), la marge l'évite.
  const res = await client.messages.create({
    model,
    max_tokens: 16000,
    thinking: { type: "adaptive" },
    system,
    messages: [{ role: "user", content: user }],
  });

  if (res.stop_reason === "refusal") {
    const err = new Error("Le modèle a refusé de traiter la demande.");
    err.code = "ai_refusal";
    throw err;
  }

  const text = (res.content || []).filter((c) => c && c.type === "text").map((c) => c.text).join("");
  const confirmations = normalizeLigneeConfirmations(parseJson(text), lignees || []);
  return { confirmations, model, usage: res.usage || null };
}

module.exports = { aiConfirmMntLignees, DEFAULT_MODEL };
