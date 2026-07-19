// Pont API Claude pour la CURATION de la veille (scoring de pertinence). Isolé ici pour que le reste
// (domaine + tests) n'ait aucune dépendance au SDK. Modèle par défaut : Claude Sonnet 5.
//
// ⚠️ CONFIDENTIALITÉ : ne transmet QUE des signaux DÉ-IDENTIFIÉS (clé technique + libellé GÉNÉRIQUE +
// domaine + sévérité) fournis par domain/newsCuration. Aucun nom (client / AM / fournisseur), aucun
// montant, aucune référence (FP / BC / facture) n'atteint l'API — la garantie tient à la SOURCE des
// signaux (catalogue statique), pas à un filtrage ici.
const DEFAULT_MODEL = "claude-sonnet-5";

/** Extrait le 1er objet OU tableau JSON d'une réponse (tolère un éventuel enrobage ``` / prose). Certains
 * appelants attendent un objet ({scores:[...]}), d'autres un TABLEAU ([{...}] : plan d'action, mapping IA).
 * On tente d'abord un objet enrobé (chemin historique inchangé), puis un tableau enrobé — sinon {}. */
function parseJson(text) {
  const t = String(text || "").trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  try { return JSON.parse(t); } catch (_) { /* repli ci-dessous */ }
  const obj = t.match(/\{[\s\S]*\}/);
  if (obj) { try { return JSON.parse(obj[0]); } catch (_) { /* essai tableau ci-dessous */ } }
  const arr = t.match(/\[[\s\S]*\]/);
  if (arr) { try { return JSON.parse(arr[0]); } catch (_) { /* abandon */ } }
  return {};
}

/**
 * Score la pertinence décisionnelle de chaque TYPE de signal (0-100) via Claude.
 * @param {string} apiKey clé Anthropic (Secret Manager)
 * @param {{key:string, domain?:string, severity?:string, label:string}[]} signals signaux dé-identifiés
 * @param {{model?:string, threshold?:number}} [opts]
 * @returns {Promise<{scores:Object<string,{relevance:number,keep:boolean,note:string}>, model:string, usage:object|null}>}
 */
async function scoreSignals(apiKey, signals, opts = {}) {
  const model = opts.model || DEFAULT_MODEL;
  const threshold = Number.isFinite(opts.threshold) ? opts.threshold : 50;
  const Anthropic = require("@anthropic-ai/sdk");
  const client = new Anthropic({ apiKey });

  const system =
    "Tu es l'éditeur d'un fil de veille pour un cockpit de pilotage du chiffre d'affaires (audience : direction). " +
    "On te fournit une liste de TYPES de signaux, déjà dé-identifiés (aucune donnée nominale, aucun montant). " +
    "Pour chaque type, évalue sa PERTINENCE DÉCISIONNELLE de 0 à 100 : un signal actionnable, qui anticipe un " +
    "risque matériel ou une opportunité, mérite un score élevé ; un signal purement informatif, cosmétique, " +
    "redondant ou peu actionnable mérite un score bas. Tiens compte de la sévérité fournie. Réponds STRICTEMENT en JSON.";
  const user =
    "Signaux à évaluer (JSON) :\n" + JSON.stringify(signals) +
    '\n\nRenvoie UNIQUEMENT un objet JSON de la forme ' +
    '{ "scores": [ { "key": "<clé fournie>", "relevance": <entier 0-100>, "note": "<justification très courte>" } ] } ' +
    "en couvrant CHAQUE clé fournie, sans aucune prose hors du JSON.";

  // max_tokens généreux : ~27 types de signaux × { key, relevance, note } peut dépasser 2000 tokens de
  // sortie. Un JSON tronqué ferait échouer parseJson → objet vide → TOUS les scores perdus (curation muette,
  // no-op silencieux). 8000 laisse une marge confortable pour couvrir chaque clé du catalogue.
  const res = await client.messages.create({
    model,
    max_tokens: 8000,
    system,
    messages: [{ role: "user", content: user }],
  });

  const text = (res.content || []).filter((c) => c && c.type === "text").map((c) => c.text).join("");
  const parsed = parseJson(text);
  const scores = {};
  for (const s of (parsed.scores || [])) {
    const key = String((s && s.key) || "").trim();
    if (!key) continue;
    // Score illisible (absent / non numérique) → on SAUTE l'entrée (le signal garde le défaut du catalogue)
    // plutôt que de le forcer à 0 → masqué à tort. On ne mute que sur un score bas EXPLICITE et valide.
    const raw = Number(s && s.relevance);
    if (!Number.isFinite(raw)) continue;
    const relevance = Math.max(0, Math.min(100, Math.round(raw)));
    scores[key] = { relevance, keep: relevance >= threshold, note: String((s && s.note) || "").slice(0, 200) };
  }
  return { scores, model, usage: res.usage || null };
}

module.exports = { scoreSignals, parseJson, DEFAULT_MODEL };
