// Curation de la veille — partie PURE (catalogue dé-identifié + construction des signaux). Le pont LLM
// vit dans lib/anthropic.js, l'I/O (Firestore, secret, planification) dans index.js. Testable sans SDK.
//
// PRINCIPE DE CONFIDENTIALITÉ (dé-identification par CONSTRUCTION) : on n'envoie JAMAIS le texte réel
// d'un bulletin (title/detail/refs portent noms clients/AM/fournisseurs, N° FP/BC/facture, montants).
// On envoie uniquement : la CLÉ TECHNIQUE stable du type (`id`, un slug sans donnée), le domaine, la
// sévérité, et un LIBELLÉ GÉNÉRIQUE issu du CATALOGUE ci-dessous (chaîne codée en dur, aucune donnée).
// La pertinence se juge au niveau du TYPE de signal — pas de l'instance — ce qui suffit à filtrer le bruit.

// Miroir des `id` de domain/news.js → libellé générique neutre (à maintenir si de nouveaux `id` apparaissent).
const SIGNAL_CATALOG = {
  cas_sous_objectif: "Atterrissage de la prise de commande (CAS) sous l'objectif annuel.",
  objectif_absent: "Objectif annuel de prise de commande non défini.",
  opps_a_reconcilier: "Affaires gagnées non transformées en commande (CAS/backlog manquants).",
  caf_sous_objectif: "Atterrissage de la facturation (CAF) sous l'objectif annuel.",
  facturation_recul: "Facturation en recul par rapport à l'an dernier.",
  pipeline_couverture: "Pipeline pondéré insuffisant pour couvrir l'écart à l'objectif.",
  closing_retard: "Opportunités dont la date de clôture prévue est dépassée.",
  pipeline_concentration: "Pipeline concentré sur un seul commercial (risque de dépendance).",
  conversion_faible: "Taux de conversion des ventes faible.",
  pipeline_suspendu: "Part importante du pipeline à l'état suspendu.",
  top_opportunite: "Mise en avant de la plus grosse opportunité active (positif).",
  backlog_derive: "Backlog majoritairement dérivé (non curaté, fiabilité à revoir).",
  report_n1_eleve: "Part importante du backlog reportée sur l'exercice suivant.",
  backlog_concentration_client: "Backlog concentré sur un seul client (risque de dépendance).",
  backlog_dormant: "Backlog porté par des commandes de millésimes anciens (à solder).",
  livraison_retard: "Projets en retard de livraison (date contractuelle dépassée).",
  bc_achat_retard: "Bons de commande fournisseurs en retard de livraison (ETA dépassée).",
  projet_bloque: "Projets bloqués ou en priorité urgente (risque d'exécution).",
  facturation_retard_plan: "Facturation en retard sur le plan de jalons.",
  trajectoire_dec_sous_objectif: "Trajectoire de facturation au 31/12 sous l'objectif.",
  creances_echues: "Créances clients échues élevées.",
  dso_eleve: "Délai moyen d'encaissement (DSO) élevé.",
  factures_orphelines: "Factures non rattachées à une commande.",
  fournisseur_sature: "Fournisseurs en saturation de ligne de crédit.",
  bc_en_retard: "Bons de commande en retard (ETA dépassée, non livrés).",
  qualite_donnees: "Qualité / complétude des données dégradée.",
  pic_erreurs_client: "Pic d'erreurs applicatives clientes (régression front à investiguer).",
};

// Seuil de rétention par défaut : un type dont la pertinence < seuil est démoté (masqué derrière « voir tout »
// côté UI, sauf sévérité « high » jamais masquée). Réglable.
const CURATION_THRESHOLD = 50;

/** Slug (`pipeline_concentration`) → libellé lisible neutre — repli si un `id` n'est pas au catalogue. */
function humanizeId(id) {
  return String(id || "").replace(/_/g, " ").replace(/\s+/g, " ").trim().replace(/^\w/, (c) => c.toUpperCase());
}

/**
 * Construit la liste des SIGNAUX dé-identifiés à scorer. Base = tout le catalogue (score stable pour chaque
 * type connu, même inactif ce jour) ; enrichi par les bulletins ACTIFS (domaine/sévérité réels — non
 * sensibles — et capture d'un éventuel `id` nouveau non catalogué, via humanizeId). N'expose JAMAIS
 * title/detail/refs. Sortie : objets { key, domain, severity, label } uniquement.
 * @param {{id?:string, domain?:string, severity?:string}[]} bulletins bulletins actifs (6 docs news*)
 */
function buildSignals(bulletins) {
  const out = new Map();
  for (const [id, label] of Object.entries(SIGNAL_CATALOG)) {
    out.set(id, { key: id, domain: "", severity: "", label });
  }
  for (const b of (bulletins || [])) {
    const id = String((b && b.id) || "").trim();
    if (!id) continue;
    out.set(id, {
      key: id,
      domain: String((b && b.domain) || ""),
      severity: String((b && b.severity) || ""),
      label: SIGNAL_CATALOG[id] || humanizeId(id),
    });
  }
  return [...out.values()];
}

module.exports = { SIGNAL_CATALOG, CURATION_THRESHOLD, humanizeId, buildSignals };
