// Domain PUR — Contrat de maintenance (mnt_) : validation + énumérations. Aucun I/O → testable.
// Règles de l'ERP (02-REGLES.md) : montants `number` arrondis FCFA ENTIER (Math.round), dates métier
// string ISO AAAA-MM-JJ, statuts en CODE applicatif (comme `stage`), N° FP canonicalisé par `fpKey`
// (jamais brut — ADR-001 : 1 contrat = 1 affaire). Les engagements SLA sont EMBARQUÉS (ADR-012).
const { fpKey, num, cleanName, cleanBu, cleanPerson } = require("../lib/ids");

// Énumérations (code applicatif). Libellés FR à l'affichage (côté front), valeurs stables ici.
const STATUTS = ["brouillon", "actif", "suspendu", "echu", "resilie"];
const ECHEANCES = ["mensuel", "trimestriel", "annuel"];
const SLA_TYPES = ["prise_en_compte", "resolution"];
const COUVERTURES = ["ouvre_lun_ven", "h24"];

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
  const dateFin = o.dateFin ? isoDate(o.dateFin) : null;
  if (o.dateFin && !dateFin) return { ok: false, error: "date de fin invalide (AAAA-MM-JJ)" };
  if (dateFin && dateFin < dateDebut) return { ok: false, error: "la date de fin précède la date de début" };
  // Montant d'engagement PROPRE au contrat (ADR-005) — entier XOF (le FCFA n'a pas de subdivision).
  const montantEngage = Math.max(0, Math.round(num(o.montantEngage)));
  const deviseEngage = (String(o.deviseEngage || "XOF").toUpperCase().trim()) || "XOF";
  const rawEng = Array.isArray(o.engagements) ? o.engagements : [];
  const engagements = [];
  for (const e of rawEng) { const v = validateEngagement(e); if (!v.ok) return { ok: false, error: v.error }; engagements.push(v.value); }
  return {
    ok: true,
    value: { fp, client, bu: cleanBu(o.bu), am: cleanPerson(o.am), statut, echeanceType, dateDebut, dateFin, montantEngage, deviseEngage, engagements },
  };
}

module.exports = { STATUTS, ECHEANCES, SLA_TYPES, COUVERTURES, validateEngagement, validateMntContrat };
