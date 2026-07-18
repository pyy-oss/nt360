// APPROBATIONS (Lot 4 « niveau Salesforce ») — processus d'approbation : une action sensible
// (remise/DR sur une opportunité, dépassement d'un plafond BC, commande saisie manuellement) est
// SOUMISE à décision, routée vers l'approbateur (le manager du demandeur — hiérarchie Lot 2 — sinon
// la direction), puis APPROUVÉE ou REJETÉE avec traçabilité. Comble l'écart #4 de l'audit (aucun
// processus gouvernable : validations, approbations).
//
// Fonctions PURES (aucun I/O) → testables. Validation partagée par les callables.

// Nature de la demande (libellé métier). entityType borne le rattachement.
// Natures ajoutées par le module Contrats de maintenance (Lot 4) : renouvellement / résiliation d'un
// contrat, rattachés à l'entité `mnt_contrat`. Nature `astreinte` (ADR-035) : demande d'astreinte (on-call)
// imputée en charge, rattachée à l'entité `astreinte`. Extension ADDITIVE (aucune valeur existante retirée).
const APPROVAL_KINDS = ["remise_opp", "depassement_bc", "commande_manuelle", "renouvellement_contrat", "resiliation_contrat", "astreinte", "autre"];
const APPROVAL_ENTITIES = ["opportunity", "bcLine", "order", "mnt_contrat", "astreinte", "other"];
const APPROVAL_STATES = ["pending", "approved", "rejected"];

// Normalise + valide une demande d'approbation. { ok, error?, value? }.
function validateApprovalRequest(d) {
  const o = d || {};
  const kind = String(o.kind || "").trim();
  if (!APPROVAL_KINDS.includes(kind)) return { ok: false, error: "nature d'approbation invalide" };
  const entityType = String(o.entityType || "").trim();
  if (!APPROVAL_ENTITIES.includes(entityType)) return { ok: false, error: "type d'entité invalide" };
  const entityId = String(o.entityId || "").trim();
  if (!entityId) return { ok: false, error: "identifiant d'entité requis" };
  const amountRaw = o.amount;
  const amount = amountRaw === undefined || amountRaw === null || amountRaw === "" ? null
    : (Number.isFinite(Number(amountRaw)) && Number(amountRaw) >= 0 ? Number(amountRaw) : null);
  return {
    ok: true,
    value: {
      kind,
      entityType,
      entityId,
      entityLabel: String(o.entityLabel || "").trim().slice(0, 200),
      amount,
      note: String(o.note || "").trim().slice(0, 1000),
    },
  };
}

// Approbateur d'un demandeur : son manager (hiérarchie), sinon repli sur la direction (fallbackUid).
// usersMap : uid → { managerUid }. Ne se désigne jamais soi-même comme approbateur (repli fallback).
function approverFor(usersMap, requesterUid, fallbackUid) {
  const map = usersMap || {};
  const mgr = map[requesterUid] && map[requesterUid].managerUid ? String(map[requesterUid].managerUid) : "";
  if (mgr && mgr !== requesterUid) return mgr;
  return fallbackUid && fallbackUid !== requesterUid ? fallbackUid : null;
}

module.exports = { APPROVAL_KINDS, APPROVAL_ENTITIES, APPROVAL_STATES, validateApprovalRequest, approverFor };
