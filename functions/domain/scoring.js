// SCORING IA EXPLICABLE (Lot 5b « niveau Salesforce ») — probabilité de gain d'une opportunité OUVERTE,
// façon Einstein Lead/Opportunity Scoring mais TRANSPARENTE : modèle additif à poids fixes, dont chaque
// contribution est restituée (facteurs). Comble l'écart #5 (aucune IA prédictive). Déterministe (aucun
// appel LLM, aucun coût, testable) et auditable — on préfère l'explicabilité à une boîte noire.
//
// Fonction PURE (aucun I/O, aucune horloge → `todayISO` fourni par l'appelant).

const OPEN_MIN = 1, OPEN_MAX = 5; // étapes ouvertes (hors Gagné=6 / Perdu=7)

// Contributions signées (points autour d'une base 50). Libellés restitués au commercial.
function factorsFor(o, todayISO) {
  const f = [];
  const stage = Number(o.stage) || 0;
  const prob = Number(o.probability);
  f.push({ label: `Étape ${stage}/6`, impact: Math.round((stage - 3) * 8) });
  if (Number.isFinite(prob) && prob > 0) f.push({ label: `Indice de confiance ${Math.round(prob * 100)}%`, impact: Math.round((prob - 0.5) * 40) });
  const cat = o.forecastCategory;
  if (cat === "commit") f.push({ label: "Prévision : Commit", impact: 15 });
  else if (cat === "best_case") f.push({ label: "Prévision : Best Case", impact: 8 });
  else if (cat === "omitted") f.push({ label: "Prévision : Omitted", impact: -20 });
  const hasNext = !!String(o.nextStep || "").trim();
  f.push(hasNext ? { label: "Prochaine action définie", impact: 10 } : { label: "Aucune prochaine action", impact: -8 });
  if (hasNext && o.nextStepDate && String(o.nextStepDate) < String(todayISO)) f.push({ label: "Action en retard", impact: -12 });
  if (o.dr === true) f.push({ label: "Deal Registration (DR)", impact: 6 });
  if (o.stale === true) f.push({ label: "Opportunité dormante", impact: -25 });
  const mb = Number(o.mbPrev);
  if (Number.isFinite(mb) && mb >= 20) f.push({ label: `Marge prév. saine (${Math.round(mb)}%)`, impact: 4 });
  return f;
}

function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

// Score 0..100 + bande (hot/warm/cold) + facteurs triés par poids décroissant. Les opportunités
// fermées (gagné/perdu) renvoient un score dégénéré (100/0) sans facteurs (hors périmètre de scoring).
function scoreOpportunity(o, todayISO) {
  const stage = Number(o && o.stage) || 0;
  if (stage === 6) return { score: 100, band: "won", factors: [] };
  if (stage === 7) return { score: 0, band: "lost", factors: [] };
  const factors = factorsFor(o || {}, todayISO).sort((a, b) => Math.abs(b.impact) - Math.abs(a.impact));
  const score = clamp(Math.round(50 + factors.reduce((s, x) => s + x.impact, 0)), 0, 100);
  const band = score >= 70 ? "hot" : score >= 45 ? "warm" : "cold";
  return { score, band, factors };
}

// True si l'étape est ouverte (éligible au scoring / au classement).
function isOpen(o) { const s = Number(o && o.stage) || 0; return s >= OPEN_MIN && s <= OPEN_MAX; }

module.exports = { scoreOpportunity, factorsFor, isOpen };
