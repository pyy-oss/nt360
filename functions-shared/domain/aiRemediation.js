// Domain PUR — SYNTHÈSE « par où commencer » du Centre de correction. Aucun I/O → testable.
// Complète le plan DÉTERMINISTE (remediationPlan, priorisé par impact FCFA) d'une NARRATION : l'IA
// ordonne et explique les chantiers en langage naturel, mais UNIQUEMENT à partir des chiffres fournis
// (labels, comptes, impacts) — elle n'invente aucun nombre (garde-fou « n'invente aucune donnée »).
// Ici vivent la CONSTRUCTION du prompt et la NORMALISATION de la réponse ; l'appel Opus est en lib/.

// Compacte les lignes du plan pour le prompt : on ne transmet que le nécessaire (type, label, sévérité,
// nombre, impact arrondi) — borné, jamais le détail des enregistrements (coût/exfiltration).
function planLines(plan) {
  const rows = Array.isArray(plan && plan.rows) ? plan.rows : [];
  return rows
    .filter((r) => r && r.type && (Number(r.count) > 0))
    .slice(0, 20)
    .map((r) => ({
      type: String(r.type),
      label: String(r.label || r.type),
      severity: ["high", "medium", "low"].includes(r.severity) ? r.severity : "medium",
      count: Math.max(0, Math.round(Number(r.count) || 0)),
      impact: Math.max(0, Math.round(Number(r.impact) || 0)),
      estimated: !!r.estimated,
    }));
}

// Prompt utilisateur : la liste chiffrée du plan + la consigne. Le modèle ORDONNE et EXPLIQUE, sans
// jamais produire de nouveau chiffre. Renvoie une chaîne (l'appelant y joint le system prompt).
function buildRemediationPrompt(plan) {
  const lines = planLines(plan);
  const totalImpact = Math.round(Number(plan && plan.totalImpact) || 0);
  const totalCount = Math.round(Number(plan && plan.totalCount) || 0);
  const rowsTxt = lines.map((r) =>
    `- type="${r.type}" · ${r.label} · sévérité=${r.severity} · ${r.count} à traiter · impact≈${r.impact} FCFA${r.estimated ? " (estimé)" : ""}`
  ).join("\n");
  return [
    `Anomalies détectées dans le carnet (total ${totalCount} à traiter, impact cumulé ≈ ${totalImpact} FCFA) :`,
    rowsTxt || "(aucune)",
    "",
    "Produis un plan « par où commencer » : ordonne ces chantiers du plus au moins prioritaire (impact FCFA,",
    "sévérité, effet d'entraînement) et explique EN UNE PHRASE COURTE pourquoi commencer par chacun.",
    "Contraintes STRICTES : n'utilise QUE les types listés ci-dessus (champ \"type\" à recopier tel quel) ;",
    "ne cite AUCUN chiffre que je ne t'ai pas donné ; réponds en français, ton opérationnel et sobre.",
    "Réponds UNIQUEMENT en JSON : {\"headline\": \"…\", \"steps\": [{\"type\": \"…\", \"why\": \"…\"}]}.",
  ].join("\n");
}

// Normalise la réponse parsée : ne conserve que les steps dont le `type` existe dans le plan (l'IA ne
// peut pas inventer un chantier), déduplique, borne les longueurs et le nombre d'étapes. PUR.
function normalizeSynthesis(parsed, validTypes) {
  const valid = validTypes instanceof Set ? validTypes : new Set(Array.isArray(validTypes) ? validTypes : []);
  const headline = String((parsed && parsed.headline) || "").trim().slice(0, 300);
  const seen = new Set();
  const steps = [];
  for (const s of Array.isArray(parsed && parsed.steps) ? parsed.steps : []) {
    const type = String((s && s.type) || "").trim();
    if (!type || !valid.has(type) || seen.has(type)) continue; // type inconnu ou déjà vu → écarté
    const why = String((s && s.why) || "").trim().slice(0, 240);
    if (!why) continue;
    seen.add(type);
    steps.push({ type, why });
    if (steps.length >= 6) break; // borne : une feuille de route, pas une liste exhaustive
  }
  return { headline, steps };
}

module.exports = { planLines, buildRemediationPrompt, normalizeSynthesis };
