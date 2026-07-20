// Domain PUR — Moteur SLA du module maintenance (mnt_), Lot 3 + Lot 10 (horloge fidèle). Aucun I/O → testable.
// Horloge SLA en JOURS OUVRÉS ; « à la minute » : tout est en millisecondes. Lot 10 rend l'horloge fidèle au
// terrain via un CALENDRIER optionnel (ADR-P23) : décalage de fuseau, jours fériés éditables, et fenêtre
// d'heures ouvrées B2B. Le calendrier est ABSENT par défaut ⇒ comportement STRICTEMENT identique à avant
// (Abidjan = UTC+0, pas de férié, journée ouvrée pleine 24h Lun–Ven — ADR-002/006). Miroir front : web/src/lib/mntSla.ts.
const HOUR_MS = 3600000;
const DAY_MS = 86400000;

// Calendrier normalisé. `offMin` = décalage LOCAL en minutes (UTC+1 = 60) : détermine où tombe minuit local, donc
// le week-end et les fériés. `holidays` = Set de dates 'AAAA-MM-JJ' LOCALES chômées (sautées comme un week-end).
// `b2b` = fenêtre d'heures ouvrées locale {start,end} en heures [0..24] pour la couverture « ouvre_b2b ».
// Défaut (calendrier absent) : UTC, aucun férié, fenêtre 8–18 (utilisée seulement si couverture b2b).
const DEFAULT_B2B = { start: 8, end: 18 };
function normCalendar(cal) {
  if (!cal) return { offMin: 0, holidays: null, b2b: DEFAULT_B2B };
  const offMin = Number.isFinite(Number(cal.offMin)) ? Number(cal.offMin) : 0;
  const holidays = cal.holidays instanceof Set ? cal.holidays : (Array.isArray(cal.holidays) ? new Set(cal.holidays) : null);
  const b = cal.b2b && Number.isFinite(Number(cal.b2b.start)) && Number.isFinite(Number(cal.b2b.end)) ? { start: Number(cal.b2b.start), end: Number(cal.b2b.end) } : DEFAULT_B2B;
  return { offMin, holidays: holidays && holidays.size ? holidays : null, b2b: b.end > b.start ? b : DEFAULT_B2B };
}

// Minuit LOCAL (exprimé en ms UTC) du jour contenant `ms`, selon le décalage de fuseau.
const localDayStart = (ms, offMin) => Math.floor((ms + offMin * 60000) / DAY_MS) * DAY_MS - offMin * 60000;
// Jour de la semaine LOCAL (0=dim … 6=sam) et date locale 'AAAA-MM-JJ' du minuit local `d0`.
const localDow = (d0, offMin) => new Date(d0 + offMin * 60000).getUTCDay();
const localDateStr = (d0, offMin) => new Date(d0 + offMin * 60000).toISOString().slice(0, 10);
const isHoliday = (d0, cal) => !!cal.holidays && cal.holidays.has(localDateStr(d0, cal.offMin));
const isWorkingDay = (d0, cal) => { const w = localDow(d0, cal.offMin); return w !== 0 && w !== 6 && !isHoliday(d0, cal); };

// Segment OUVRÉ [début, fin] (ms UTC) d'un jour local `d0` : plage comptabilisée. `win` = null → journée pleine
// (00→24 local) ; `win` = {start,end} → fenêtre B2B locale. Renvoie null si le jour n'est pas ouvré.
function daySegment(d0, cal, win) {
  if (!isWorkingDay(d0, cal)) return null;
  if (!win) return [d0, d0 + DAY_MS];
  return [d0 + win.start * HOUR_MS, d0 + win.end * HOUR_MS];
}

// Millisecondes OUVRÉES écoulées entre a et b (segmente jour local par jour local ; ignore week-ends, fériés,
// et — en mode B2B — les heures hors fenêtre). PUR. `win`/`cal` optionnels (défauts = comportement historique).
function businessMsBetween(a, b, cal, win) {
  if (!(b > a)) return 0;
  const c = normCalendar(cal);
  let ms = 0, d0 = localDayStart(a, c.offMin), guard = 0;
  while (d0 < b && guard++ < 100000) {
    const seg = daySegment(d0, c, win);
    if (seg) { const s = Math.max(a, seg[0]), e = Math.min(b, seg[1]); if (e > s) ms += e - s; }
    d0 += DAY_MS;
  }
  return ms;
}

// Échéance = `start` avancé de `durMs` millisecondes OUVRÉES (saute week-ends/fériés et — B2B — les heures hors
// fenêtre). Si `start` précède l'ouverture d'un jour ouvré, l'horloge démarre à l'ouverture. PUR.
function addBusinessMs(start, durMs, cal, win) {
  if (!(durMs > 0)) return start;
  const c = normCalendar(cal);
  let remain = durMs, d0 = localDayStart(start, c.offMin), guard = 0;
  while (remain > 0 && guard++ < 100000) {
    const seg = daySegment(d0, c, win);
    if (seg) {
      const s = Math.max(start, seg[0]); // pas avant l'ouverture, ni avant `start`
      const avail = seg[1] - s;
      if (avail >= remain) return s + remain;
      if (avail > 0) remain -= avail;
    }
    d0 += DAY_MS;
  }
  return d0; // garde-fou (jamais atteint en pratique)
}

// Fenêtre B2B applicable à un engagement selon sa couverture (null hors mode B2B → journée pleine).
const winFor = (engagement, cal) => (engagement && engagement.couverture === "ouvre_b2b" ? normCalendar(cal).b2b : null);

/**
 * État SLA d'un engagement pour un ticket. `openMs` = ouverture ; `markMs` = horodatage de l'atteinte
 * (prise en compte ou résolution) ou null si non atteint ; `nowMs` = maintenant ; `cal` = calendrier
 * optionnel (fuseau/fériés/fenêtre B2B — ADR-P23).
 * → { seuilHeures, dueMs, elapsedHours, state } où state ∈ 'respecte' | 'rompu' | 'en_cours'.
 *   - marqué : respecté si atteint avant l'échéance, sinon rompu.
 *   - non marqué : rompu si l'échéance est déjà dépassée, sinon en cours.
 * COUVERTURE : `ouvre_lun_ven` (défaut) → horloge JOURS OUVRÉS pleins (saute le week-end) ; `ouvre_b2b` →
 * mêmes jours ouvrés mais bornés à la FENÊTRE d'heures ouvrées locale (ADR-P23) ; `h24` → horloge CALENDAIRE
 * 24/7 (le week-end consomme du délai). Sans cette distinction, un engagement 24/7 serait calculé comme du
 * Lun–Ven et sous-estimerait ses ruptures (audit Lot 5).
 */
function slaState(engagement, openMs, markMs, nowMs, cal) {
  const seuilHeures = Math.max(0, Number(engagement && engagement.seuilHeures) || 0);
  const h24 = engagement && engagement.couverture === "h24";
  const win = winFor(engagement, cal);
  const dueMs = h24 ? openMs + seuilHeures * HOUR_MS : addBusinessMs(openMs, seuilHeures * HOUR_MS, cal, win);
  const elapsedMs = (a, b) => (h24 ? Math.max(0, b - a) : businessMsBetween(a, b, cal, win));
  if (markMs != null) {
    const elapsed = elapsedMs(openMs, markMs);
    return { seuilHeures, dueMs, elapsedHours: Math.round((elapsed / HOUR_MS) * 100) / 100, state: markMs <= dueMs ? "respecte" : "rompu" };
  }
  const elapsed = elapsedMs(openMs, nowMs);
  return { seuilHeures, dueMs, elapsedHours: Math.round((elapsed / HOUR_MS) * 100) / 100, state: nowMs > dueMs ? "rompu" : "en_cours" };
}

module.exports = { HOUR_MS, normCalendar, businessMsBetween, addBusinessMs, slaState };
