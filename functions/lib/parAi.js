// Pont API Claude pour l'IA du module Partenariats (plan d'action + synthèse QBR). Isolé ici pour que le
// domaine + les tests n'aient AUCUNE dépendance au SDK. Modèle : Claude Opus 4.8, réflexion ADAPTATIVE,
// gestion du refus. Sortie brute TOUJOURS re-validée par domain/parAi (normalizeActionPlan / normalizeQbr).
const { buildActionPlanPrompt, normalizeActionPlan, buildQbrPrompt, normalizeQbr, buildMapSuggestPrompt, normalizeMapSuggest } = require("../domain/parAi");
const { parseJson } = require("./anthropic");

const DEFAULT_MODEL = "claude-opus-4-8";

async function callClaude(apiKey, system, user, model) {
  const Anthropic = require("@anthropic-ai/sdk");
  const client = new Anthropic({ apiKey });
  const res = await client.messages.create({
    model: model || DEFAULT_MODEL,
    max_tokens: 8000,
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
  return { text, usage: res.usage || null, model: model || DEFAULT_MODEL };
}

// Plan d'action business. snapshot = domain/parAi.actionPlanSnapshot(...).
async function generateActionPlan(apiKey, snapshot, opts = {}) {
  const { system, user } = buildActionPlanPrompt(snapshot);
  const { text, usage, model } = await callClaude(apiKey, system, user, opts.model);
  return { plan: normalizeActionPlan(parseJson(text)), model, usage };
}

// Synthèse QBR par partenaire. snapshot = domain/parAi.qbrSnapshot(...).
async function generateQbr(apiKey, snapshot, opts = {}) {
  const { system, user } = buildQbrPrompt(snapshot);
  const { text, usage, model } = await callClaude(apiKey, system, user, opts.model);
  return { qbr: normalizeQbr(parseJson(text), snapshot), model, usage };
}

// Mapping assisté : propose la répartition fournisseur → constructeur(s). snapshot = mapSuggestSnapshot(...).
// La sortie est re-validée contre les id connus (validIds) — l'IA ne peut PAS introduire un constructeur inconnu.
async function suggestPartnerMap(apiKey, snapshot, opts = {}) {
  const { system, user } = buildMapSuggestPrompt(snapshot);
  const { text, usage, model } = await callClaude(apiKey, system, user, opts.model);
  const validIds = (snapshot.partenaires_connus || []).map((p) => p.id);
  return { suggestions: normalizeMapSuggest(parseJson(text), validIds), model, usage };
}

module.exports = { generateActionPlan, generateQbr, suggestPartnerMap, DEFAULT_MODEL };
