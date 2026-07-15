// Domain PUR — Moteur SLA du module maintenance (mnt_), Lot 3. Aucun I/O → testable.
// Horloge SLA : JOURS OUVRÉS PLEINS Lun–Ven, 24h/jour, base UTC (ADR-002 ; Abidjan = UTC+0). Le
// week-end (sam/dim UTC) ne consomme pas de délai. Pas de jours fériés en v1 (ADR-006). Le seuil d'un
// engagement est en HEURES ouvrées. « à la minute » : tout est en millisecondes.
const HOUR_MS = 3600000;
const DAY_MS = 86400000;
const isWeekend = (ms) => { const d = new Date(ms).getUTCDay(); return d === 0 || d === 6; }; // 0=dim, 6=sam
const startOfUtcDay = (ms) => { const d = new Date(ms); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()); };

// Millisecondes OUVRÉES écoulées entre a et b (segmente jour par jour, ignore le week-end). PUR.
function businessMsBetween(a, b) {
  if (!(b > a)) return 0;
  let ms = 0, cur = a, guard = 0;
  while (cur < b && guard++ < 100000) {
    const dayEnd = startOfUtcDay(cur) + DAY_MS;
    const segEnd = Math.min(b, dayEnd);
    if (!isWeekend(cur)) ms += segEnd - cur;
    cur = segEnd;
  }
  return ms;
}

// Échéance = `start` avancé de `durMs` millisecondes OUVRÉES (saute les week-ends). PUR.
function addBusinessMs(start, durMs) {
  if (!(durMs > 0)) return start;
  let cur = start, remain = durMs, guard = 0;
  while (remain > 0 && guard++ < 100000) {
    if (isWeekend(cur)) { cur = startOfUtcDay(cur) + DAY_MS; continue; }
    const dayEnd = startOfUtcDay(cur) + DAY_MS;
    const avail = dayEnd - cur;
    if (avail >= remain) return cur + remain;
    remain -= avail; cur = dayEnd;
  }
  return cur;
}

/**
 * État SLA d'un engagement pour un ticket. `openMs` = ouverture ; `markMs` = horodatage de l'atteinte
 * (prise en compte ou résolution) ou null si non atteint ; `nowMs` = maintenant.
 * → { seuilHeures, dueMs, elapsedHours, state } où state ∈ 'respecte' | 'rompu' | 'en_cours'.
 *   - marqué : respecté si atteint avant l'échéance ouvrée, sinon rompu.
 *   - non marqué : rompu si l'échéance est déjà dépassée, sinon en cours.
 */
function slaState(engagement, openMs, markMs, nowMs) {
  const seuilHeures = Math.max(0, Number(engagement && engagement.seuilHeures) || 0);
  const dueMs = addBusinessMs(openMs, seuilHeures * HOUR_MS);
  if (markMs != null) {
    const elapsed = businessMsBetween(openMs, markMs);
    return { seuilHeures, dueMs, elapsedHours: Math.round((elapsed / HOUR_MS) * 100) / 100, state: markMs <= dueMs ? "respecte" : "rompu" };
  }
  const elapsed = businessMsBetween(openMs, nowMs);
  return { seuilHeures, dueMs, elapsedHours: Math.round((elapsed / HOUR_MS) * 100) / 100, state: nowMs > dueMs ? "rompu" : "en_cours" };
}

module.exports = { HOUR_MS, businessMsBetween, addBusinessMs, slaState };
