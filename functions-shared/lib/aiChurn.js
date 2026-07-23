// Pont API Claude pour l'ANALYSE DE RÉTENTION (churn) des contrats de maintenance. Isolé ici pour que le
// domaine + les tests n'aient AUCUNE dépendance au SDK. Modèle : Claude Opus 4.8, réflexion ADAPTATIVE.
// Sortie brute TOUJOURS re-validée par domain/aiChurn.normalizeChurnAnalysis (l'IA propose, on ne fait pas confiance).
const { buildChurnPrompt, normalizeChurnAnalysis } = require("../domain/aiChurn");
const { parseJson } = require("./anthropic");

const DEFAULT_MODEL = "claude-opus-4-8";

/**
 * @param {string} apiKey    clé Anthropic (Secret Manager)
 * @param {object[]} contrats contrats à risque enrichis (fp, client, niveau, signals, joursEcheance, ticketsOuverts, slaBreaches)
 * @param {{model?:string}} [opts]
 * @returns {Promise<{analyses:object[], model:string, usage:object|null}>}
 */
async function aiAnalyzeChurn(apiKey, contrats, opts = {}) {
  const model = opts.model || DEFAULT_MODEL;
  const { system, user } = buildChurnPrompt(contrats || []);

  const Anthropic = require("@anthropic-ai/sdk");
  const client = new Anthropic({ apiKey });

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
  const analyses = normalizeChurnAnalysis(parseJson(text), contrats || []);
  return { analyses, model, usage: res.usage || null };
}

module.exports = { aiAnalyzeChurn, DEFAULT_MODEL };
