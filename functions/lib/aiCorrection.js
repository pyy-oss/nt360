// Pont API Claude pour l'ASSISTANT DU CENTRE DE CORRECTION (propositions de correction). Isolé ici pour
// que le domaine + les tests n'aient AUCUNE dépendance au SDK. Modèle : Claude Opus 4.8 (raisonnement de
// rapprochement). Réflexion ADAPTATIVE (le modèle dose son analyse). La sortie brute est TOUJOURS
// re-validée par domain/aiCorrection.normalizeSuggestions (l'IA propose, on ne fait pas confiance).

const { buildCorrectionPrompt, normalizeSuggestions, buildVerificationPrompt, applyVerdicts } = require("../domain/aiCorrection");
const { parseJson } = require("./anthropic");

const DEFAULT_MODEL = "claude-opus-4-8";

/**
 * Demande à Claude des propositions de correction pour un lot d'anomalies d'un même type.
 * @param {string} apiKey  clé Anthropic (Secret Manager)
 * @param {{type:string, records:object[], context?:object}} args
 * @param {{model?:string}} [opts]
 * @returns {Promise<{suggestions:object[], model:string, usage:object|null}>}
 */
async function suggestCorrections(apiKey, args, opts = {}) {
  const model = opts.model || DEFAULT_MODEL;
  const { type, records, context } = args || {};
  const { system, user } = buildCorrectionPrompt(type, records || [], context || {});

  const Anthropic = require("@anthropic-ai/sdk");
  const client = new Anthropic({ apiKey });

  // Non-stream : lot borné (≤ ~60 enregistrements) → réponse rapide dans le timeout du callable. max_tokens
  // large : réflexion adaptative + un JSON couvrant chaque ref. Un JSON tronqué donnerait 0 proposition
  // (parseJson → {} → normalize → []), échec silencieux — la marge évite la troncature.
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
  const parsed = parseJson(text);
  let suggestions = normalizeSuggestions(parsed, records || [], type);

  // 2e PASSAGE — VÉRIFICATION ADVERSE (fiabilité max) : sauf si opts.verify === false. On ne l'exécute que
  // s'il existe des propositions actionnables (les « review » n'ont rien à appliquer). Best-effort : si la
  // vérification échoue, on renvoie les propositions NON vérifiées (verified=false) plutôt que d'échouer tout.
  let usageVerify = null;
  const actionable = suggestions.filter((s) => s.action !== "review");
  if (opts.verify !== false && actionable.length) {
    try {
      const vp = buildVerificationPrompt(type, suggestions, records || [], context || {});
      const vres = await client.messages.create({
        model, max_tokens: 12000, thinking: { type: "adaptive" },
        system: vp.system, messages: [{ role: "user", content: vp.user }],
      });
      if (vres.stop_reason !== "refusal") {
        const vtext = (vres.content || []).filter((c) => c && c.type === "text").map((c) => c.text).join("");
        suggestions = applyVerdicts(suggestions, parseJson(vtext));
        usageVerify = vres.usage || null;
      }
    } catch (_) { /* best-effort : propositions renvoyées non vérifiées */ }
  }

  const verifiedCount = suggestions.filter((s) => s.verified).length;
  return { suggestions, model, usage: res.usage || null, usageVerify, verifiedCount, verified: opts.verify !== false };
}

module.exports = { suggestCorrections, DEFAULT_MODEL };
