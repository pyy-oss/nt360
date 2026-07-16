// ASSISTANT IA — ANALYSE DE RÉTENTION / RISQUE DE NON-RENOUVELLEMENT (churn). Partie PURE : prompt +
// NORMALISATION défensive. Le pont LLM vit dans lib/aiChurn.js ; l'I/O (Firestore, secret, RBAC, drapeau)
// dans handlers/maintenance.js. Testable sans SDK.
//
// ADDITIF, PAS UN DOUBLON : le MOTEUR DE RISQUE existant (domain/mntRisque) SCORE déjà la santé d'un contrat
// (SLA rompus, échéance proche, quota, sous-facturation). Ici l'IA ne re-score pas — elle prend ces signaux
// EN ENTRÉE et produit une lecture QUALITATIVE orientée RENOUVELLEMENT : pour chaque contrat à risque, les
// MOTIFS de churn et UNE reco de rétention concrète. « L'IA propose, l'humain décide » : aucune écriture.
//
// GARDE-FOUS (dans normalizeChurnAnalysis) :
//  1. `fp` doit désigner un contrat RÉELLEMENT dans le lot (rapproché par fpKey — aucune hallucination).
//  2. `churnRisk` ∈ {eleve, moyen, faible} sinon la ligne tombe (pas de niveau inventé).
//  3. `drivers` borné (≤ 5, chaînes tronquées) ; `recommendation` tronquée.
//  4. Dé-doublonnage par fp canonique.
const { fpKey } = require("../lib/ids");

const RISKS = new Set(["eleve", "moyen", "faible"]);

/** Construit le prompt (system + user). PUR. @param {object[]} contrats à risque enrichis. */
function buildChurnPrompt(contrats) {
  const list = (contrats || []).map((c) => ({
    fp: String((c && c.fp) || "").slice(0, 40),
    client: String((c && c.client) || "").slice(0, 120),
    niveau: String((c && c.niveau) || "").slice(0, 20),
    signals: Array.isArray(c && c.signals) ? c.signals.slice(0, 8).map((s) => String(s).slice(0, 60)) : [],
    // Échéance INCONNUE (pas de date de fin) → null, jamais 0 : sinon le modèle la lit « imminente ».
    joursEcheance: (c && c.joursEcheance != null && Number.isFinite(Number(c.joursEcheance))) ? Number(c.joursEcheance) : null,
    ticketsOuverts: Number(c && c.ticketsOuverts) || 0,
    slaBreaches: Number(c && c.slaBreaches) || 0,
  })).filter((c) => c.fp);
  const system =
    "Tu conseilles une ESN (zone UEMOA/CEMAC, en français) sur le RISQUE DE NON-RENOUVELLEMENT (churn) de ses " +
    "contrats de maintenance. On te fournit les contrats DÉJÀ repérés à risque par le moteur interne, avec leurs " +
    "signaux (SLA rompus, échéance proche, sous-facturation, quota…), le nombre de tickets ouverts, de SLA " +
    "rompus, et les jours avant l'échéance. Pour CHAQUE contrat, évalue la probabilité que le client NE " +
    "renouvelle PAS (churnRisk : eleve/moyen/faible), donne les MOTIFS déterminants (courts), et UNE " +
    "recommandation de rétention CONCRÈTE et actionnable (ex. revue de service, geste commercial, plan de " +
    "remédiation SLA). Ne réévalue pas la santé technique — pars des signaux fournis. Réponds STRICTEMENT en JSON.";
  const user =
    "Contrats à risque (JSON) :\n" + JSON.stringify(list) +
    '\n\nRenvoie UNIQUEMENT un objet JSON { "analyses": [ { "fp": "<fp fourni>", ' +
    '"churnRisk": "<eleve|moyen|faible>", "drivers": ["<motif court>", …], ' +
    '"recommendation": "<action de rétention concrète>" } ] } en couvrant CHAQUE fp fourni. Aucune prose hors du JSON.';
  return { system, user };
}

/**
 * Normalise + filtre défensivement la sortie du modèle. PUR.
 * @param {object} parsed        { analyses:[...] }
 * @param {object[]} contrats    lot envoyé (pour rejeter les fp hallucinés et retrouver le client)
 * @returns {{fp,client,churnRisk,drivers,recommendation}[]}
 */
function normalizeChurnAnalysis(parsed, contrats) {
  const byKey = new Map();
  for (const c of contrats || []) { const k = fpKey(c && c.fp); if (k && !byKey.has(k)) byKey.set(k, c); }
  const seen = new Set();
  const out = [];
  const order = { eleve: 0, moyen: 1, faible: 2 };
  for (const a of (parsed && parsed.analyses) || []) {
    if (!a) continue;
    const k = fpKey(a.fp);
    if (!k || !byKey.has(k) || seen.has(k)) continue;          // garde-fou 1 + dé-doublonnage
    const churnRisk = String(a.churnRisk || "").trim();
    if (!RISKS.has(churnRisk)) continue;                       // garde-fou 2
    seen.add(k);
    const c = byKey.get(k);
    const drivers = (Array.isArray(a.drivers) ? a.drivers : []).slice(0, 5).map((d) => String(d).slice(0, 120)).filter(Boolean);
    out.push({
      fp: c.fp || k, client: c.client || "", churnRisk,
      drivers, recommendation: String(a.recommendation || "").slice(0, 300),
    });
  }
  out.sort((x, y) => (order[x.churnRisk] - order[y.churnRisk]) || x.client.localeCompare(y.client));
  return out;
}

module.exports = { buildChurnPrompt, normalizeChurnAnalysis };
