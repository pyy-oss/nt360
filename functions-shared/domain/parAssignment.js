// Domain PUR — Assignation de certification (par_) : affecter à un ingénieur l'obtention d'une certif à
// une échéance, avec relances. Aucun I/O → testable. ADR-P03 : RÉFÉRENCE un consultant existant.
// Les relances sont MATÉRIALISÉES en liste (summaries/par_relances) plutôt qu'envoyées par un cron
// écrivant des docs (le kit) — cohérent avec par_alerts. Le statut « en retard » est DÉRIVÉ (échéance
// dépassée & non obtenu), jamais réécrit dans le doc (pas d'effet de bord). todayIso INJECTÉ → pur.
const { plausibleYear } = require("../lib/ids");

// Cycle de vie (code applicatif ; libellés FR à l'affichage). en_retard est aussi DÉRIVABLE.
const ASSIGNMENT_STATUSES = ["a_planifier", "planifie", "en_formation", "en_retard", "obtenu"];
const DEFAULT_REMINDER_OFFSETS = [30, 14, 7];

const isoDate = (v) => { const s = String(v == null ? "" : v).slice(0, 10); return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null; };
const slug = (v) => { const s = String(v == null ? "" : v).trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, ""); return s || null; };
const daysBetween = (a, b) => Math.ceil((new Date(a) - new Date(b)) / 86400000);

// Normalise + valide une assignation. { ok, error?, value? }. targetDate ISO plausible requis.
function validateAssignment(d) {
  const o = d || {};
  const consultantId = String(o.consultantId == null ? "" : o.consultantId).trim().slice(0, 128);
  if (!consultantId) return { ok: false, error: "consultant requis (consultantId)" };
  const partnerId = slug(o.partnerId);
  if (!partnerId) return { ok: false, error: "partenaire requis (partnerId)" };
  const certificationCatalogId = slug(o.certificationCatalogId);
  if (!certificationCatalogId) return { ok: false, error: "certification requise (certificationCatalogId)" };
  const targetDate = isoDate(o.targetDate);
  if (!targetDate) return { ok: false, error: "date cible invalide (AAAA-MM-JJ)" };
  if (!plausibleYear(targetDate.slice(0, 4))) return { ok: false, error: "année cible implausible" };
  const status = ASSIGNMENT_STATUSES.includes(o.status) ? o.status : "planifie";
  let reminderOffsets = Array.isArray(o.reminderOffsets)
    ? [...new Set(o.reminderOffsets.map((n) => Math.round(Number(n))).filter((n) => Number.isFinite(n) && n >= 0))].sort((a, b) => b - a)
    : DEFAULT_REMINDER_OFFSETS;
  if (!reminderOffsets.length) reminderOffsets = DEFAULT_REMINDER_OFFSETS;
  const value = { consultantId, partnerId, certificationCatalogId, targetDate, status, reminderOffsets };
  const assignedDate = isoDate(o.assignedDate);
  if (assignedDate) value.assignedDate = assignedDate;
  const managerUid = String(o.managerUid == null ? "" : o.managerUid).trim().slice(0, 128);
  if (managerUid) value.managerUid = managerUid;
  return { ok: true, value };
}

// Statut EFFECTIF : en_retard si l'échéance est dépassée et l'assignation non obtenue ; sinon le statut
// stocké. Pur (pas de réécriture du doc).
function effectiveStatus(assignment, todayIso) {
  if (!assignment) return null;
  if (assignment.status === "obtenu") return "obtenu";
  if (assignment.targetDate && daysBetween(assignment.targetDate, todayIso) < 0) return "en_retard";
  return assignment.status;
}

/**
 * Liste de relance : assignations non obtenues qui sont EN RETARD ou entrées dans une fenêtre de relance
 * (jours restants ≤ un offset). Palier = "retard" ou "j<offset>" le plus serré. Triée par urgence.
 */
function assignmentWatch(assignments, todayIso) {
  const items = [];
  for (const a of assignments || []) {
    if (!a || a.status === "obtenu" || !a.targetDate) continue;
    const daysLeft = daysBetween(a.targetDate, todayIso);
    const offsets = Array.isArray(a.reminderOffsets) && a.reminderOffsets.length ? a.reminderOffsets : DEFAULT_REMINDER_OFFSETS;
    let bucket = null;
    if (daysLeft < 0) bucket = "retard";
    else { const applic = offsets.filter((o) => daysLeft <= o).sort((x, y) => x - y); if (applic.length) bucket = `j${applic[0]}`; }
    if (!bucket) continue; // pas encore dans une fenêtre de relance
    items.push({
      id: a.id, consultantId: a.consultantId, consultantName: a.consultantName || "", partnerId: a.partnerId,
      cert: a.cert || a.certificationCatalogId, targetDate: a.targetDate, daysLeft, bucket,
      effectiveStatus: effectiveStatus(a, todayIso), managerUid: a.managerUid || null,
    });
  }
  items.sort((a, b) => a.daysLeft - b.daysLeft);
  return items;
}

// Compteurs : total en relance + nombre en retard.
function watchCounts(items) {
  const list = items || [];
  return { total: list.length, late: list.filter((i) => i.bucket === "retard").length };
}

module.exports = { ASSIGNMENT_STATUSES, DEFAULT_REMINDER_OFFSETS, validateAssignment, effectiveStatus, assignmentWatch, watchCounts };
