// ACTIVITÉS & TÂCHES (Lot 3 « niveau Salesforce ») — journal d'actions commerciales rattachées à un
// enregistrement (compte ou opportunité) : appel, e-mail, RDV, note, et TÂCHE à échéance. Comble
// l'écart #3 de l'audit (aucun objet Activité/Tâche : pas de timeline, pas de relances d'actions).
//
// Fonctions PURES (aucun I/O) → testables. La validation/normalisation est partagée par les callables.

const ACTIVITY_TYPES = ["call", "email", "meeting", "note", "task"];
const RELATED_TYPES = ["account", "opportunity"];

// Normalise + valide une entrée d'activité. Renvoie { ok, error?, value? }.
// - type dans la liste ; sujet requis (borné) ; corps borné ; rattachement (type + id) requis ;
// - une TÂCHE peut porter une échéance (dueDate ISO) et un état `done` ; les autres types non ;
// - `at` = date de l'activité (ISO) ; défaut = nowISO (fourni par l'appelant, pas d'horloge ici).
function validateActivity(d, nowISO) {
  const o = d || {};
  const type = String(o.type || "").trim();
  if (!ACTIVITY_TYPES.includes(type)) return { ok: false, error: "type d'activité invalide" };
  const subject = String(o.subject || "").trim().slice(0, 200);
  if (!subject) return { ok: false, error: "sujet requis" };
  const relatedType = String(o.relatedType || "").trim();
  if (!RELATED_TYPES.includes(relatedType)) return { ok: false, error: "type de rattachement invalide" };
  const relatedId = String(o.relatedId || "").trim();
  if (!relatedId) return { ok: false, error: "enregistrement de rattachement requis" };
  const isoOrNull = (v) => { const s = String(v || "").trim(); return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null; };
  const value = {
    type,
    subject,
    body: String(o.body || "").trim().slice(0, 4000),
    relatedType,
    relatedId,
    relatedName: String(o.relatedName || "").trim().slice(0, 200),
    at: isoOrNull(o.at) || isoOrNull(nowISO) || null,
    // Champs de TÂCHE uniquement (sinon neutralisés) : échéance + état d'achèvement.
    dueDate: type === "task" ? isoOrNull(o.dueDate) : null,
    done: type === "task" ? o.done === true : false,
  };
  return { ok: true, value };
}

// Une tâche est EN RETARD si elle est ouverte (non faite) et que son échéance est passée (< aujourd'hui).
function isOverdue(a, todayISO) {
  if (!a || a.type !== "task" || a.done === true || !a.dueDate) return false;
  return String(a.dueDate) < String(todayISO);
}

module.exports = { ACTIVITY_TYPES, RELATED_TYPES, validateActivity, isOverdue };
