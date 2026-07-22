// Pont API Claude pour la SYNTHÈSE « par où commencer » du Centre de correction. Isolé ici pour que le
// domaine + les tests n'aient AUCUNE dépendance au SDK. Modèle : Claude Opus 4.8. Réflexion ADAPTATIVE.
// La sortie brute est TOUJOURS re-validée par domain/aiRemediation.normalizeSynthesis (steps bornés aux
// types réellement présents dans le plan → l'IA ne peut pas inventer un chantier). Un seul passage : c'est
// une NARRATION du plan déterministe, pas une écriture actionnable (donc pas de vérification adverse).

const { buildRemediationPrompt, normalizeSynthesis } = require("../domain/aiRemediation");
const { parseJson } = require("./anthropic");

const DEFAULT_MODEL = "claude-opus-4-8";

// Voix de l'assistant : direction d'ESN (zone UEMOA/CEMAC), pivot FCFA, français sobre et opérationnel.
const SYSTEM = [
  "Tu assistes la direction d'une ESN (zone UEMOA/CEMAC ; devise FCFA/XOF) dans l'assainissement de son",
  "carnet d'affaires. On te donne un plan d'anomalies déjà chiffré et priorisé. Tu le transformes en une",
  "feuille de route « par où commencer » : concise, actionnable, hiérarchisée par impact et effet d'entraînement.",
  "Tu n'inventes AUCUN chiffre et ne cites que les types fournis. Réponds STRICTEMENT en JSON valide.",
].join(" ");

/**
 * Demande à Claude une synthèse « par où commencer » à partir du plan déterministe.
 * @param {string} apiKey  clé Anthropic (Secret Manager)
 * @param {{plan:object}} args  plan = { rows:[{type,label,severity,count,impact,estimated}], totalImpact, totalCount }
 * @param {{model?:string}} [opts]
 * @returns {Promise<{headline:string, steps:{type:string,why:string}[], model:string, usage:object|null}>}
 */
async function summarizeRemediation(apiKey, args, opts = {}) {
  const model = opts.model || DEFAULT_MODEL;
  const plan = (args && args.plan) || {};
  const user = buildRemediationPrompt(plan);
  const validTypes = new Set((Array.isArray(plan.rows) ? plan.rows : []).map((r) => r && r.type).filter(Boolean));

  const Anthropic = require("@anthropic-ai/sdk");
  const client = new Anthropic({ apiKey });

  const res = await client.messages.create({
    model,
    max_tokens: 4000, // une feuille de route courte (headline + ≤ 6 étapes) : marge large, pas de troncature.
    thinking: { type: "adaptive" },
    system: SYSTEM,
    messages: [{ role: "user", content: user }],
  });

  // Refus explicite (politique de sécurité) → signalé à l'appelant plutôt que renvoyer une synthèse vide.
  if (res.stop_reason === "refusal") {
    const err = new Error("Le modèle a refusé de produire la synthèse.");
    err.code = "ai_refusal";
    throw err;
  }

  const text = (res.content || []).filter((c) => c && c.type === "text").map((c) => c.text).join("");
  const { headline, steps } = normalizeSynthesis(parseJson(text), validTypes);
  return { headline, steps, model, usage: res.usage || null };
}

module.exports = { summarizeRemediation, DEFAULT_MODEL };
