// Domain PUR — IA du module Partenariats (par_) : construction des prompts + validation des sorties.
// Aucune dépendance SDK (le pont vit dans lib/parAi.js). « L'IA propose, on ne fait pas confiance » : la
// sortie brute est TOUJOURS re-validée par normalizeActionPlan / normalizeQbr (structure garantie).
// Montants en XOF (FCFA) — jamais l'euro du kit. Snapshots construits à partir des summaries par_*.

const { allocationsFor } = require("./parRevenue"); // UNE seule autorité de normalisation des poids (ADR-P14)

const str = (v, max = 300) => String(v == null ? "" : v).trim().slice(0, max);
const strArr = (v, n = 8, max = 200) => (Array.isArray(v) ? v.map((x) => str(x, max)).filter(Boolean).slice(0, n) : []);
const PRIORITES = ["haute", "moyenne", "basse"];

// Exercice fiscal du partenaire (ADR-P12) : mois de début 1–12 → libellé « <mois> → <mois−1> ». Les
// constructeurs n'ont pas tous la même année fiscale (Cisco : août→juillet) — l'IA en tient compte pour
// juger le RYTHME du CA. Absent/hors bornes = calendaire (janvier→décembre). Miroir back du front fiscalMonthsLabel.
const FR_MONTHS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
function fiscalMonthsLabel(startMonth) {
  const m = Math.round(Number(startMonth));
  if (!Number.isFinite(m) || m < 1 || m > 12) return "calendaire (janvier → décembre)";
  const end = m === 1 ? 12 : m - 1;
  return `${FR_MONTHS[m - 1]} → ${FR_MONTHS[end - 1]}`;
}
// Écart de couverture chiffré : « <cible> : <holders>/<minCount> certifié(s)[ — manque N] ». N = déficit
// d'ingénieurs (minCount − holders, borné à 0). Rend l'ampleur du trou VISIBLE pour l'IA (un manque de 3
// n'appelle pas la même action qu'un manque de 1).
function gapLabel(target, holders, minCount, okSuffix) {
  const need = Math.max(0, (Number(minCount) || 0) - (Number(holders) || 0));
  const suf = need ? ` — manque ${need}` : (okSuffix || "");
  return `${target} : ${Number(holders) || 0}/${Number(minCount) || 0} certifié(s)${suf}`;
}

// ── Snapshots (PURS) — dérivés des summaries, dé-bruités pour l'IA. Montants en FCFA.
function actionPlanSnapshot({ dateIso, ca, quotas, relances }) {
  // CA MIXTE (ADR-P12) : on transmet la ventilation par partenaire — part adossée aux BC (fiable, traçable)
  // vs part déclarative (à confirmer). L'IA distingue ainsi un CA solide d'un CA à fiabiliser.
  const caByPartner = {}; for (const p of (ca && ca.byPartner) || []) caByPartner[p.partnerId] = p;
  const partners = ((quotas && quotas.partners) || []).map((q) => {
    const c = caByPartner[q.partnerId] || {};
    return {
      nom: str(q.name || q.partnerId, 80),
      statut_conformite: str(q.status, 20),
      ca_ytd_fcfa: Number(c.revenueXof || 0),
      // Ventilation EFFECTIVE : le déclaratif n'est compté que lorsqu'il est la source (BC prime, ADR-P12).
      // La part déclarative effective = CA effectif − part BC (jamais le déclaré BRUT, ignoré si des BC existent).
      ca_dont_bc_fcfa: Number(c.bcXof || 0),
      ca_dont_declare_fcfa: Math.max(0, Number(c.revenueXof || 0) - Number(c.bcXof || 0)),
      quotas_manquants: ((q.gaps || []).map((g) => gapLabel(g.target, g.holders, g.minCount))).slice(0, 6),
    };
  });
  const relancesEnRetard = ((relances && relances.items) || []).filter((r) => r.bucket === "retard")
    .map((r) => `${str(r.consultantName || r.consultantId, 60)} — ${str(r.cert, 40)} (${str(r.partnerId, 20)})`).slice(0, 12);
  return { date: str(dateIso, 10), partners, assignations_en_retard: relancesEnRetard };
}

function qbrSnapshot({ partnerId, partner, periode, ca, quotas, certifs, relances }) {
  const rev = ((ca && ca.byPartner) || []).find((p) => p.partnerId === partnerId) || {};
  const q = ((quotas && quotas.partners) || []).find((p) => p.partnerId === partnerId);
  const recentes = (certifs || []).filter((c) => c.partnerId === partnerId && c.status === "active")
    .map((c) => str(c.certName || c.certificationCatalogId, 60)).slice(0, 8);
  const enRetard = ((relances && relances.items) || []).filter((r) => r.partnerId === partnerId)
    .map((r) => `${str(r.consultantName, 60)} — ${str(r.cert, 40)} (${r.bucket === "retard" ? "en retard" : "à venir"})`).slice(0, 8);
  return {
    partenaire: str((partner && partner.name) || partnerId, 80),
    periode: str(periode, 40),
    // Exercice fiscal du constructeur (borne le rythme du YTD) — non confidentiel, toujours transmis.
    exercice_fiscal: fiscalMonthsLabel(partner && partner.fiscalStartMonth),
    statut_conformite: str(q && q.status, 20),
    ca_realise_ytd_fcfa: Number(rev.revenueXof || 0),
    // Ventilation CA MIXTE EFFECTIVE (ADR-P12) : part BC (fiable) vs part déclarative effective = CA − part BC
    // (le déclaré BRUT est ignoré quand des BC existent, BC prime). 0 partout si CA masqué (ADR-P07).
    ca_dont_bc_fcfa: Number(rev.bcXof || 0),
    ca_dont_declare_fcfa: Math.max(0, Number(rev.revenueXof || 0) - Number(rev.bcXof || 0)),
    quotas: ((q && q.coverage) || []).map((c) => gapLabel(c.target, c.holders, c.minCount, c.ok ? " ✓" : "")).slice(0, 10),
    certifications_actives: recentes,
    assignations: enRetard,
  };
}

// ── Plan d'action business
function buildActionPlanPrompt(snapshot) {
  const system = "Tu es analyste business partenariats pour une ESN à Abidjan (Côte d'Ivoire, zone FCFA) qui revend et intègre du Dell, Cisco, Fortinet et Huawei. Tu réponds en français, uniquement en JSON valide, sans texte ni balises autour.";
  const user = `État actuel des partenariats et certifications (montants en FCFA) :

${JSON.stringify(snapshot, null, 2)}

Lecture des données : pour chaque partenaire, le CA réalisé est VENTILÉ — \`ca_dont_bc_fcfa\` est adossé aux bons de commande fournisseurs (fiable, traçable) tandis que \`ca_dont_declare_fcfa\` est déclaratif (à confirmer). Un CA majoritairement déclaratif est un signal de fiabilisation, pas forcément un vrai retard. Les quotas manquants précisent « manque N » : l'ampleur du déficit d'ingénieurs certifiés doit moduler la priorité.

Génère un plan d'action priorisé pour sécuriser/améliorer les statuts de partenariat sur l'exercice. Concentre-toi sur les leviers réels d'une ESN : combler les quotas de certification (former/certifier les bons profils, en proportion du « manque N »), accélérer le CA sur les partenaires en retard de rythme, fiabiliser le CA déclaratif via les BC, résorber les assignations en retard, sécuriser les niveaux avant audit.

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

Lecture des données : le CA réalisé est ventilé — \`ca_dont_bc_fcfa\` est adossé aux bons de commande fournisseurs (fiable), \`ca_dont_declare_fcfa\` est déclaratif (à confirmer). L'\`exercice_fiscal\` borne le rythme du YTD (juge l'avancement à l'aune de cet exercice, pas de l'année civile). Les quotas indiquent « manque N » quand une exigence n'est pas couverte.

Rédige une synthèse de QBR prête à présenter, en t'appuyant sur ces éléments : valorise le CA adossé aux BC, situe l'avancement dans l'exercice fiscal du constructeur, et quantifie les écarts de certification (« manque N »). Réponds UNIQUEMENT avec un objet JSON valide. Format exact :
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

// ── Mapping assisté (IA) : proposer, pour chaque fournisseur NON rattaché, le(s) constructeur(s) qu'il
// distribue (ADR-P14 : un distributeur porte plusieurs marques). L'IA PROPOSE une répartition ; l'humain la
// valide dans l'éditeur avant setParPartnerMap. Aucun montant CA dans le snapshot — la tâche est un
// rapprochement de NOMS (fournisseur ↔ marque), pas une analyse de volume → rien de confidentiel n'est transmis.
function mapSuggestSnapshot({ unmapped, partners }) {
  const fournisseurs = ((unmapped) || []).map((u) => ({
    nom: str(u && u.supplier, 120), nb_bc: Number((u && u.bcCount) || 0),
  })).filter((f) => f.nom).slice(0, 40);
  const partenaires = ((partners) || []).map((p) => ({
    id: str(p && p.id, 80), nom: str((p && p.name) || (p && p.id), 120), marque: str((p && p.programName) || (p && p.name), 120),
  })).filter((p) => p.id).slice(0, 60);
  return { fournisseurs_non_rattaches: fournisseurs, partenaires_connus: partenaires };
}

function buildMapSuggestPrompt(snapshot) {
  const system = "Tu es analyste achats pour une ESN à Abidjan (Côte d'Ivoire, zone FCFA) qui revend et intègre du matériel constructeur (Dell, Cisco, Fortinet, Huawei, etc.). On te donne des FOURNISSEURS (distributeurs) non encore rattachés à un constructeur, et la liste des constructeurs partenaires connus. Ta tâche : dire, pour chaque fournisseur, quel(s) constructeur(s) de la liste il distribue. Un distributeur porte souvent PLUSIEURS marques : tu répartis alors par des poids. Tu réponds en français, uniquement en JSON valide, sans texte ni balises autour.";
  const user = `Fournisseurs à rattacher et constructeurs partenaires connus :

${JSON.stringify(snapshot, null, 2)}

Pour chaque fournisseur, propose la répartition vers un ou plusieurs constructeurs de la liste "partenaires_connus" (utilise EXACTEMENT les valeurs du champ "id"). N'invente aucun id hors de cette liste. Si tu n'es pas raisonnablement sûr de rattacher un fournisseur, OMETS-LE (mieux vaut aucune proposition qu'une erreur — un humain valide ensuite).

Réponds UNIQUEMENT avec un tableau JSON valide. Format exact :
[
  { "fournisseur": "nom exact du fournisseur", "repartition": [ { "id": "id-constructeur", "poids": 0.7 }, { "id": "autre-id", "poids": 0.3 } ], "justification": "raison courte (max 15 mots)" }
]
Les poids d'un fournisseur doivent sommer à 1 (un seul constructeur → poids 1). Ne propose que les fournisseurs que tu peux rattacher avec confiance.`;
  return { system, user };
}

// Re-validation stricte : ne garde que des id de constructeurs CONNUS et des poids > 0, normalisés à somme 1
// (via allocationsFor, l'autorité ADR-P14). Une proposition sans allocation valide est écartée. La clé
// fournisseur reste le nom BRUT (rapproché en MAJUSCULES au moment du setParPartnerMap, comme le CA).
function normalizeMapSuggest(parsed, validIds) {
  const known = new Set((validIds || []).map((v) => str(v, 80)).filter(Boolean));
  const arr = Array.isArray(parsed) ? parsed : (parsed && Array.isArray(parsed.suggestions) ? parsed.suggestions : []);
  const out = [];
  const seen = new Set();
  for (const it of arr) {
    if (!it || typeof it !== "object") continue;
    const fournisseur = str(it.fournisseur || it.supplier, 120);
    if (!fournisseur) continue;
    const key = fournisseur.toUpperCase();
    if (seen.has(key)) continue; // une proposition par fournisseur (première gagne)
    // Construit { id: poids } en n'acceptant QUE des constructeurs connus, puis normalise à somme 1.
    const raw = {};
    for (const a of Array.isArray(it.repartition) ? it.repartition : (Array.isArray(it.allocations) ? it.allocations : [])) {
      if (!a || typeof a !== "object") continue;
      const id = str(a.id || a.partnerId, 80);
      const w = Number(a.poids != null ? a.poids : a.weight);
      if (known.has(id) && Number.isFinite(w) && w > 0) raw[id] = (raw[id] || 0) + w;
    }
    const allocations = allocationsFor(raw).map((x) => ({ partnerId: x.partnerId, weight: Math.round(x.weight * 100) / 100 }));
    if (!allocations.length) continue; // aucun constructeur connu rattaché → proposition inutile
    seen.add(key);
    out.push({ supplier: fournisseur, allocations, rationale: str(it.justification || it.rationale, 200) });
  }
  return out.slice(0, 40);
}

module.exports = { PRIORITES, fiscalMonthsLabel, gapLabel, actionPlanSnapshot, qbrSnapshot, buildActionPlanPrompt, normalizeActionPlan, buildQbrPrompt, normalizeQbr, mapSuggestSnapshot, buildMapSuggestPrompt, normalizeMapSuggest };
