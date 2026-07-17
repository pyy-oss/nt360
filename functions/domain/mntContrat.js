// Domain PUR — Contrat de maintenance (mnt_) : validation + énumérations. Aucun I/O → testable.
// Règles de l'ERP (02-REGLES.md) : montants `number` arrondis FCFA ENTIER (Math.round), dates métier
// string ISO AAAA-MM-JJ, statuts en CODE applicatif (comme `stage`), N° FP canonicalisé par `fpKey`
// (jamais brut — ADR-001 : 1 contrat = 1 affaire). Les engagements SLA sont EMBARQUÉS (ADR-012).
const { fpKey, num, cleanName, cleanBu, cleanPerson, plausibleYear } = require("../lib/ids");

// Énumérations (code applicatif). Libellés FR à l'affichage (côté front), valeurs stables ici.
const STATUTS = ["brouillon", "actif", "suspendu", "echu", "resilie"];
const ECHEANCES = ["mensuel", "trimestriel", "annuel"];
const SLA_TYPES = ["prise_en_compte", "resolution"];
const COUVERTURES = ["ouvre_lun_ven", "h24"];
// Types de maintenance (ADR-025) : classent tickets ET interventions ; objectifs (max) posés PAR CONTRAT.
// Code applicatif ; libellés FR à l'affichage (Prédictive / Corrective / Évolutive / Veille technologique).
const TYPES_MAINTENANCE = ["predictive", "corrective", "evolutive", "veille"];

// Objectifs de maintenance EMBARQUÉS dans le contrat (ADR-025, cohérent avec les engagements ADR-012) :
// un maximum (entier ≥ 0) optionnel par type. On ne conserve que les clés valides RENSEIGNÉES (absent =
// pas d'objectif sur ce type). Toute valeur négative/non entière est rejetée (pas de coercion silencieuse).
function validateObjectifsMaintenance(o) {
  if (o == null) return { ok: true, value: null };
  if (typeof o !== "object") return { ok: false, error: "objectifs de maintenance invalides" };
  const out = {};
  for (const t of TYPES_MAINTENANCE) {
    const v = o[t];
    if (v == null || v === "") continue;
    const n = Math.round(num(v));
    if (n < 0) return { ok: false, error: `objectif ${t} invalide (négatif)` };
    out[t] = n;
  }
  return { ok: true, value: Object.keys(out).length ? out : null };
}

const isoDate = (v) => { const s = String(v == null ? "" : v).slice(0, 10); return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null; };

// Un engagement SLA : type (prise en compte / résolution), couverture (jours ouvrés ou 24/7), seuil en
// HEURES ouvrées (entier > 0), quota optionnel (nb de tickets/mois, entier ≥ 0). PUR.
function validateEngagement(e) {
  const o = e || {};
  const type = String(o.type || "").trim();
  if (!SLA_TYPES.includes(type)) return { ok: false, error: "type d'engagement SLA invalide" };
  const couverture = String(o.couverture || "").trim();
  if (!COUVERTURES.includes(couverture)) return { ok: false, error: "couverture d'engagement invalide" };
  const seuilHeures = Math.round(num(o.seuilHeures));
  if (!(seuilHeures > 0)) return { ok: false, error: "seuil d'heures invalide (> 0 requis)" };
  const quota = o.quota == null || o.quota === "" ? null : Math.max(0, Math.round(num(o.quota)));
  return { ok: true, value: { type, couverture, seuilHeures, quota } };
}

/**
 * Normalise + valide un contrat de maintenance. { ok, error?, value? }.
 * value.fp est CANONIQUE (fpKey) ; montantEngage est un ENTIER XOF ; engagements est un tableau validé.
 */
function validateMntContrat(d) {
  const o = d || {};
  const fp = fpKey(o.fp);
  if (!fp) return { ok: false, error: "N° FP invalide (format FP/AAAA/N requis)" };
  const client = cleanName(o.client);
  if (!client) return { ok: false, error: "client requis" };
  const statut = String(o.statut || "").trim();
  if (!STATUTS.includes(statut)) return { ok: false, error: "statut invalide" };
  const echeanceType = String(o.echeanceType || "").trim();
  if (!ECHEANCES.includes(echeanceType)) return { ok: false, error: "périodicité d'échéance invalide" };
  const dateDebut = isoDate(o.dateDebut);
  if (!dateDebut) return { ok: false, error: "date de début invalide (AAAA-MM-JJ)" };
  // Discipline `plausibleYear` de l'ERP (comme le pipeline/carnet) : une année aberrante (sentinelle Excel
  // 1899-12-30, saisie erronée) passerait la regex mais gonflerait l'échéancier (240 périodes → engagé faux,
  // faux signal « sous-facturation » critique, cf. audit 2026-07). On la REJETTE à la frontière.
  if (!plausibleYear(dateDebut.slice(0, 4))) return { ok: false, error: "année de début implausible (hors [2015 .. année+3])" };
  const dateFin = o.dateFin ? isoDate(o.dateFin) : null;
  if (o.dateFin && !dateFin) return { ok: false, error: "date de fin invalide (AAAA-MM-JJ)" };
  // dateFin est la borne de RENOUVELLEMENT (exclusive) : une fin ≤ début donne un contrat à couverture NULLE
  // (0 échéance) — on l'interdit plutôt que de créer un contrat dégénéré silencieux (audit info).
  if (dateFin && dateFin <= dateDebut) return { ok: false, error: "la date de fin doit être postérieure à la date de début" };
  // Montant d'engagement PROPRE au contrat (ADR-005) — entier XOF (le FCFA n'a pas de subdivision).
  // Un montant NÉGATIF (format comptable « (500 000) », « 500000- », signe parasite) est une donnée
  // aberrante : on la REJETTE explicitement plutôt que de la coercer à 0 en silence — sinon un import de
  // mise à jour effacerait un montant stocké sans alerte (audit m1). Absent/vide → num()=0 → accepté.
  const montantEngage = Math.round(num(o.montantEngage));
  if (montantEngage < 0) return { ok: false, error: "montant engagé invalide (négatif)" };
  // Module à DEVISE PIVOT : montantEngage est traité comme un ENTIER XOF partout (échéancier, rentabilité),
  // sans conversion. On REJETTE toute devise ≠ XOF plutôt que de stocker une étiquette trompeuse sur un
  // montant traité en FCFA (audit info : sinon « 1500 EUR » compté comme 1500 FCFA en silence). ADR-024.
  const deviseEngage = (String(o.deviseEngage || "XOF").toUpperCase().trim()) || "XOF";
  if (deviseEngage !== "XOF") return { ok: false, error: "devise non supportée (XOF/FCFA uniquement)" };
  const rawEng = Array.isArray(o.engagements) ? o.engagements : [];
  const engagements = [];
  for (const e of rawEng) { const v = validateEngagement(e); if (!v.ok) return { ok: false, error: v.error }; engagements.push(v.value); }
  const objM = validateObjectifsMaintenance(o.objectifsMaintenance);
  if (!objM.ok) return { ok: false, error: objM.error };
  return {
    ok: true,
    value: { fp, client, bu: cleanBu(o.bu), am: cleanPerson(o.am), statut, echeanceType, dateDebut, dateFin, montantEngage, deviseEngage, engagements, objectifsMaintenance: objM.value },
  };
}

module.exports = { STATUTS, ECHEANCES, SLA_TYPES, COUVERTURES, TYPES_MAINTENANCE, validateEngagement, validateObjectifsMaintenance, validateMntContrat };
