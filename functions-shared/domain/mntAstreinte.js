// Domain PUR — Astreintes (on-call) du module maintenance (mnt_). Aucun I/O. Testé avec vitest.
// Une astreinte = une période d'astreinte d'un consultant, IMPUTÉE EN CHARGE à une affaire (N° FP) et
// éventuellement rattachée à un contrat de maintenance. Le `montant` est SAISI (charge manuelle, XOF
// entier) : c'est la PREMIÈRE ligne de coût saisissable de l'ERP (ADR-035) — les autres coûts sont soit
// dérivés (jours CRA × CJM), soit importés (P&L), soit portés par la fiche affaire. Une astreinte n'est
// ni dans le P&L importé ni dans le CRA labor → additive, sans double-compte.
// Cycle : demande → validation (approbations génériques, entityType "astreinte") → comptabilisation.
// SEULES les astreintes « validee » pèsent en charge (une demande en attente ou rejetée ne charge rien).
const { fpKey } = require("../lib/ids");

const ASTREINTE_STATUTS = ["en_attente", "validee", "rejetee"];
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Normalise + valide une demande d'astreinte. { ok, error?, value? }.
 * L'affaire (fp) est OBLIGATOIRE : c'est elle qui porte la charge (rapprochée par fpKey côté agrégat).
 * Le contrat est optionnel (une astreinte peut couvrir une affaire sans contrat de maintenance).
 */
function validateAstreinte(d) {
  const o = d || {};
  const fp = String(o.fp || "").trim().toUpperCase().slice(0, 60);
  if (!fpKey(fp)) return { ok: false, error: "N° FP invalide" };
  const montant = Number(o.montant);
  if (!Number.isFinite(montant) || montant <= 0) return { ok: false, error: "montant d'astreinte requis (> 0)" };
  const dateDebut = ISO_DAY.test(String(o.dateDebut || "")) ? String(o.dateDebut) : null;
  const dateFin = ISO_DAY.test(String(o.dateFin || "")) ? String(o.dateFin) : null;
  if (!dateDebut || !dateFin) return { ok: false, error: "période d'astreinte requise (dates début/fin)" };
  if (dateFin < dateDebut) return { ok: false, error: "date de fin antérieure au début" };
  return {
    ok: true,
    value: {
      fp, // conservé tel quel pour l'affichage ; rapproché par fpKey à l'agrégation
      contratId: o.contratId ? String(o.contratId).trim().slice(0, 80) : null,
      consultantId: o.consultantId ? String(o.consultantId).trim().slice(0, 80) : null,
      dateDebut,
      dateFin,
      montant: Math.round(montant),
      motif: String(o.motif || "").trim().slice(0, 500),
    },
  };
}

/**
 * Coût des astreintes VALIDÉES agrégé par N° FP canonique (fpKey). SOURCE UNIQUE de la charge astreinte,
 * consommée à l'identique par la rentabilité contrat (computeContratPnl) ET la marge de livraison
 * (deliveryMargin) — jamais recalculée ailleurs (invariant « même métrique = même nombre »).
 * @param {{fp?:string, montant?:number, statut?:string}[]} astreintes
 * @returns {Object<string,number>}  fpKey → charge XOF entière
 */
function astreinteCostByFp(astreintes) {
  const out = {};
  for (const a of astreintes || []) {
    if (!a || a.statut !== "validee") continue;
    const k = fpKey(a.fp);
    if (!k) continue;
    out[k] = (out[k] || 0) + (Math.round(Number(a.montant)) || 0);
  }
  return out;
}

module.exports = { ASTREINTE_STATUTS, validateAstreinte, astreinteCostByFp };
