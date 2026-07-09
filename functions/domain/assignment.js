// PLAN DE CHARGE / STAFFING (Lot 12 « 20/10 DirOps ») — affectations d'un consultant à une mission
// (projet/FP ou opportunité) sur une PÉRIODE, à un pourcentage d'allocation et un TJM facturé. Permet
// au Directeur des Opérations de voir QUI est staffé sur QUOI, QUAND, et de détecter la SUR-charge
// (>100 % cumulés) et la SOUS-charge (intercontrat) — le cœur du pilotage d'activité d'une ESN.
//
// Fonctions PURES (aucun I/O, aucune horloge → mois fournis par l'appelant) → testables.

function num(v, lo, hi) {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.max(lo, Math.min(hi, n));
}
function ym(v) { const s = String(v || "").trim(); return /^\d{4}-\d{2}$/.test(s) ? s : (/^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 7) : null); }

// Normalise + valide une affectation. period = [startMonth, endMonth] au format YYYY-MM (inclus).
function validateAssignment(d) {
  const o = d || {};
  const consultantId = String(o.consultantId || "").trim();
  if (!consultantId) return { ok: false, error: "consultant requis" };
  const start = ym(o.startMonth), end = ym(o.endMonth);
  if (!start || !end) return { ok: false, error: "période (mois début/fin) requise au format AAAA-MM" };
  if (end < start) return { ok: false, error: "le mois de fin précède le mois de début" };
  const allocationPct = num(o.allocationPct, 0, 100);
  if (allocationPct == null) return { ok: false, error: "allocation (%) invalide" };
  const value = {
    consultantId,
    projectFp: String(o.projectFp || "").trim().toUpperCase().slice(0, 60) || null, // rattachement projet (N° FP)
    label: String(o.label || "").trim().slice(0, 160),                                // libellé mission / client
    startMonth: start,
    endMonth: end,
    allocationPct,
    tjmBilled: num(o.tjmBilled, 0, 1_000_000),                                        // TJM réellement facturé
    status: ["planned", "confirmed"].includes(o.status) ? o.status : "confirmed",
  };
  return { ok: true, value };
}

// Liste ORDONNÉE des mois (YYYY-MM) entre from et to inclus (bornée pour éviter les plages absurdes).
function monthsRange(fromYm, toYm, cap = 36) {
  const out = [];
  let [y, m] = String(fromYm).split("-").map(Number);
  const [ty, tm] = String(toYm).split("-").map(Number);
  while ((y < ty || (y === ty && m <= tm)) && out.length < cap) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m += 1; if (m > 12) { m = 1; y += 1; }
  }
  return out;
}

// Une affectation couvre-t-elle le mois donné ?
function coversMonth(a, monthYm) {
  return a && a.startMonth <= monthYm && a.endMonth >= monthYm;
}

// PLAN DE CHARGE : pour chaque consultant et chaque mois de la plage, somme des allocations (%).
// Renvoie { byConsultant: { [id]: { [month]: pct } }, flags: { over:[{id,month,pct}], idle:[{id,month}] } }.
// `activeIds` = consultants au statut « actif/staffable » (pour ne signaler l'intercontrat que sur eux).
function buildLoad(assignments, months, activeIds) {
  const active = new Set(activeIds || []);
  const byConsultant = {};
  for (const a of assignments || []) {
    if (!a || !a.consultantId) continue;
    const row = byConsultant[a.consultantId] || (byConsultant[a.consultantId] = {});
    for (const mth of months) if (coversMonth(a, mth)) row[mth] = (row[mth] || 0) + (Number(a.allocationPct) || 0);
  }
  const over = [], idle = [];
  for (const id of new Set([...Object.keys(byConsultant), ...active])) {
    for (const mth of months) {
      const pct = (byConsultant[id] && byConsultant[id][mth]) || 0;
      if (pct > 100) over.push({ id, month: mth, pct });
      else if (pct === 0 && active.has(id)) idle.push({ id, month: mth }); // intercontrat : actif mais non staffé
    }
  }
  return { byConsultant, flags: { over, idle } };
}

module.exports = { validateAssignment, monthsRange, coversMonth, buildLoad };
