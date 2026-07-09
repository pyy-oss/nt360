// OBJECTIFS D'OCCUPATION (Lot 18 « 20/10 DirOps ») — cibles de taux d'occupation / TACE, globales et
// affinables PAR GRADE et PAR BU (un junior n'a pas la même cible qu'un manager). Le constaté (Lot 13/15)
// est comparé à ces cibles → détection de DÉRIVE (ressources/BU sous l'objectif) pour agir tôt.
//
// Fonctions PURES (aucun I/O) → testables.

const DEFAULT_TARGET = 85; // cible d'occupation par défaut (%), standard ESN

function clampPct(v, def) { const n = Math.round(Number(v)); return Number.isFinite(n) && n >= 0 && n <= 100 ? n : def; }

// Nettoie une map { clé: pourcentage } (grade ou BU → cible), en ne gardant que les pourcentages valides.
function cleanMap(m) {
  const out = {};
  for (const [k, v] of Object.entries(m || {})) {
    const key = String(k || "").trim();
    const n = Math.round(Number(v));
    if (key && Number.isFinite(n) && n >= 0 && n <= 100) out[key.slice(0, 40)] = n;
  }
  return out;
}

function validateTargets(input) {
  const o = input || {};
  return {
    occupancy: clampPct(o.occupancy, DEFAULT_TARGET),
    tace: clampPct(o.tace, DEFAULT_TARGET),
    byGrade: cleanMap(o.byGrade),
    byBu: cleanMap(o.byBu),
  };
}

// Cible applicable à une ressource : priorité grade > BU > global (le plus spécifique gagne).
function targetFor(targets, { grade, bu } = {}) {
  const t = targets || {};
  if (grade && t.byGrade && t.byGrade[grade] != null) return t.byGrade[grade];
  if (bu && t.byBu && t.byBu[bu] != null) return t.byBu[bu];
  return typeof t.occupancy === "number" ? t.occupancy : DEFAULT_TARGET;
}

// Évalue une liste de ressources { grade, bu, occupancyPct } contre les cibles → ajoute targetPct,
// belowBy (>0 si sous l'objectif) et isBelow. Renvoie aussi le nombre de ressources en dérive.
function evaluate(rows, targets) {
  const out = (rows || []).map((r) => {
    const targetPct = targetFor(targets, { grade: r.grade, bu: r.bu });
    const occ = Number(r.occupancyPct) || 0;
    const belowBy = Math.max(0, targetPct - occ);
    return { ...r, targetPct, belowBy, isBelow: occ < targetPct };
  });
  return { rows: out, belowCount: out.filter((r) => r.isBelow).length };
}

module.exports = { DEFAULT_TARGET, validateTargets, targetFor, evaluate };
