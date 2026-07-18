// Domain PUR — IA du module Partenariats (par_) : construction des prompts + validation des sorties.
// Aucune dépendance SDK (le pont vit dans lib/parAi.js). « L'IA propose, on ne fait pas confiance » : la
// sortie brute est TOUJOURS re-validée par normalizeActionPlan / normalizeQbr (structure garantie).
// Montants en XOF (FCFA) — jamais l'euro du kit. Snapshots construits à partir des summaries par_*.

const str = (v, max = 300) => String(v == null ? "" : v).trim().slice(0, max);
const strArr = (v, n = 8, max = 200) => (Array.isArray(v) ? v.map((x) => str(x, max)).filter(Boolean).slice(0, n) : []);
const PRIORITES = ["haute", "moyenne", "basse"];

// ── Snapshots (PURS) — dérivés des summaries, dé-bruités pour l'IA. Montants en FCFA.
function actionPlanSnapshot({ dateIso, ca, quotas, relances }) {
  const revByPartner = {}; for (const p of (ca && ca.byPartner) || []) revByPartner[p.partnerId] = p.revenueXof;
  const partners = ((quotas && quotas.partners) || []).map((q) => ({
    nom: str(q.name || q.partnerId, 80),
    statut_conformite: str(q.status, 20),
    ca_ytd_fcfa: Number(revByPartner[q.partnerId] || 0),
    quotas_manquants: ((q.gaps || []).map((g) => `${g.target} : ${g.holders}/${g.minCount} certifié(s)`)).slice(0, 6),
  }));
  const relancesEnRetard = ((relances && relances.items) || []).filter((r) => r.bucket === "retard")
    .map((r) => `${str(r.consultantName || r.consultantId, 60)} — ${str(r.cert, 40)} (${str(r.partnerId, 20)})`).slice(0, 12);
  return { date: str(dateIso, 10), partners, assignations_en_retard: relancesEnRetard };
}

function qbrSnapshot({ partnerId, partner, periode, ca, quotas, certifs, relances }) {
  const rev = ((ca && ca.byPartner) || []).find((p) => p.partnerId === partnerId);
  const q = ((quotas && quotas.partners) || []).find((p) => p.partnerId === partnerId);
  const recentes = (certifs || []).filter((c) => c.partnerId === partnerId && c.status === "active")
    .map((c) => str(c.certName || c.certificationCatalogId, 60)).slice(0, 8);
  const enRetard = ((relances && relances.items) || []).filter((r) => r.partnerId === partnerId)
    .map((r) => `${str(r.consultantName, 60)} — ${str(r.cert, 40)} (${r.bucket === "retard" ? "en retard" : "à venir"})`).slice(0, 8);
  return {
    partenaire: str((partner && partner.name) || partnerId, 80),
    periode: str(periode, 40),
    statut_conformite: str(q && q.status, 20),
    ca_realise_ytd_fcfa: Number((rev && rev.revenueXof) || 0),
    quotas: ((q && q.coverage) || []).map((c) => `${c.target} : ${c.holders}/${c.minCount}${c.ok ? " ✓" : ""}`).slice(0, 10),
    certifications_actives: recentes,
    assignations: enRetard,
  };
}

// ── Plan d'action business
function buildActionPlanPrompt(snapshot) {
  const system = "Tu es analyste business partenariats pour une ESN à Abidjan (Côte d'Ivoire, zone FCFA) qui revend et intègre du Dell, Cisco, Fortinet et Huawei. Tu réponds en français, uniquement en JSON valide, sans texte ni balises autour.";
  const user = `État actuel des partenariats et certifications (montants en FCFA) :

${JSON.stringify(snapshot, null, 2)}

Génère un plan d'action priorisé pour sécuriser/améliorer les statuts de partenariat sur l'exercice. Concentre-toi sur les leviers réels d'une ESN : combler les quotas de certification (former/certifier les bons profils), accélérer le CA sur les partenaires en retard de rythme, résorber les assignations en retard, sécuriser les niveaux avant audit.

Réponds UNIQUEMENT avec un tableau JSON valide. Format exact :
[
  { "priorite": "haute|moyenne|basse", "partenaire": "nom", "titre": "titre court (max 8 mots)", "constat": "le problème en une phrase", "actions": ["action concrète 1", "action concrète 2"], "impact": "résultat attendu en une phrase" }
]
Entre 3 et 6 recommandations, triées par priorité décroissante.`;
  return { system, user };
}

// Re-validation stricte : ne conserve que des items bien formés, priorité normalisée, 3-6 items.
function normalizeActionPlan(parsed) {
  const arr = Array.isArray(parsed) ? parsed : (parsed && Array.isArray(parsed.plan) ? parsed.plan : []);
  const items = [];
  for (const it of arr) {
    if (!it || typeof it !== "object") continue;
    const priorite = PRIORITES.includes(it.priorite) ? it.priorite : "moyenne";
    const titre = str(it.titre, 80);
    if (!titre) continue;
    items.push({
      priorite, partenaire: str(it.partenaire, 80), titre,
      constat: str(it.constat, 300), actions: strArr(it.actions, 6, 200), impact: str(it.impact, 300),
    });
  }
  const order = { haute: 0, moyenne: 1, basse: 2 };
  items.sort((a, b) => order[a.priorite] - order[b.priorite]);
  return items.slice(0, 6);
}

// ── Synthèse QBR (revue trimestrielle par partenaire)
function buildQbrPrompt(snapshot) {
  const system = `Tu prépares une revue trimestrielle de partenariat (QBR) pour une ESN à Abidjan (zone FCFA), à présenter au responsable partenaire ${snapshot.partenaire}. Ton professionnel, factuel, orienté relation partenaire. Tu réponds en français, uniquement en JSON valide, sans texte ni balises autour.`;
  const user = `Données de la période (montants en FCFA) :

${JSON.stringify(snapshot, null, 2)}

Rédige une synthèse de QBR prête à présenter. Réponds UNIQUEMENT avec un objet JSON valide. Format exact :
{
  "titre": "QBR ${snapshot.partenaire} — ${snapshot.periode || "période"}",
  "synthese_executive": "2-3 phrases d'ouverture",
  "points_forts": ["réalisation valorisante 1", "..."],
  "statut_certifications": "état des quotas et compétences en une à deux phrases",
  "points_attention": ["écart ou risque à adresser 1", "..."],
  "engagements_neurones": ["engagement concret pour le prochain trimestre", "..."],
  "demandes_constructeur": ["demande de support/lead/remise/formation", "..."]
}`;
  return { system, user };
}

function normalizeQbr(parsed, snapshot) {
  const o = parsed && typeof parsed === "object" ? parsed : {};
  return {
    titre: str(o.titre, 160) || `QBR ${str(snapshot && snapshot.partenaire, 80)} — ${str(snapshot && snapshot.periode, 40)}`,
    synthese_executive: str(o.synthese_executive, 800),
    points_forts: strArr(o.points_forts, 8, 300),
    statut_certifications: str(o.statut_certifications, 600),
    points_attention: strArr(o.points_attention, 8, 300),
    engagements_neurones: strArr(o.engagements_neurones, 8, 300),
    demandes_constructeur: strArr(o.demandes_constructeur, 8, 300),
  };
}

module.exports = { PRIORITES, actionPlanSnapshot, qbrSnapshot, buildActionPlanPrompt, normalizeActionPlan, buildQbrPrompt, normalizeQbr };
