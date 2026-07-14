// CONSULTANTS / RESSOURCES (Lot 11 « 20/10 DirOps ») — annuaire des ressources délivrantes d'une ESN :
// grade, BU, TJM cible (facturation), CJM (coût jour moyen — CONFIDENTIEL, comme la marge), compétences
// et statut (staffé / intercontrat / congé / inactif). C'est la fondation du plan de charge (Lot 12) et
// des KPI d'activité (TACE, intercontrat — Lot 13). Comble l'angle mort « métier ESN » de l'audit DirOps.
//
// Fonctions PURES (aucun I/O) → testables.

const GRADES = ["junior", "confirme", "senior", "expert", "manager"];
const STATUSES = ["active", "intercontrat", "conge", "inactive"]; // staffé / intercontrat / congé / sorti
const CONFIDENTIAL = ["cjm"];                                     // coût → droit « rentabilite » requis

// EFFECTIF « EN ACTIVITÉ » (staffable / facturable) = staffé (active) OU au banc (intercontrat). Le banc
// EST de la capacité disponible : il compte dans l'occupation (à 0 %), le taux d'intercontrat et le coût
// de banc — sinon mettre quelqu'un au banc FAIT BAISSER le taux d'intercontrat (contre-sens métier ESN).
// Les congés (conge) et sortis (inactive) sont HORS effectif productif. Base commune de TOUS les KPI ESN.
const WORKFORCE_STATUSES = ["active", "intercontrat"];
const isWorkforce = (status) => WORKFORCE_STATUSES.includes(status || "active");

function num(v) { const n = Number(v); return Number.isFinite(n) && n >= 0 ? n : null; }
function isoOrNull(v) { const s = String(v || "").trim(); return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s.slice(0, 10) : null; }

// Normalise + valide une fiche consultant. Renvoie { ok, error?, value? }.
function validateConsultant(d) {
  const o = d || {};
  const name = String(o.name || "").trim().slice(0, 120);
  if (!name) return { ok: false, error: "nom requis" };
  const value = {
    name,
    email: String(o.email || "").trim().slice(0, 160),
    grade: GRADES.includes(o.grade) ? o.grade : "confirme",
    bu: String(o.bu || "").trim().toUpperCase().slice(0, 40),
    tjmTarget: num(o.tjmTarget),                                  // TJM cible de facturation
    cjm: num(o.cjm),                                              // coût jour moyen (CONFIDENTIEL)
    skills: Array.isArray(o.skills) ? o.skills.map((s) => String(s).trim()).filter(Boolean).slice(0, 30) : [],
    status: STATUSES.includes(o.status) ? o.status : "active",
    managerUid: o.managerUid ? String(o.managerUid).slice(0, 128) : null,
    startDate: isoOrNull(o.startDate),
    clickupUserId: o.clickupUserId ? String(o.clickupUserId).slice(0, 40) : null, // mapping auto-CRA (Lot 20)
  };
  return { ok: true, value };
}

// Retire les champs confidentiels (coût) d'une fiche si l'appelant n'a pas le droit « rentabilite ».
// Miroir du masquage de marge appliqué ailleurs (index.js) — un DirOps voit le coût, pas un commercial.
function stripConfidential(consultant, canSeeCost) {
  if (canSeeCost) return consultant;
  const c = { ...consultant };
  for (const k of CONFIDENTIAL) delete c[k];
  return c;
}

// Marge journalière indicative d'un consultant (TJM cible − CJM) quand les deux sont connus, sinon null.
function dailyMargin(consultant) {
  const t = num(consultant && consultant.tjmTarget), c = num(consultant && consultant.cjm);
  return t != null && c != null ? t - c : null;
}

module.exports = { GRADES, STATUSES, WORKFORCE_STATUSES, isWorkforce, CONFIDENTIAL, validateConsultant, stripConfidential, dailyMargin };
