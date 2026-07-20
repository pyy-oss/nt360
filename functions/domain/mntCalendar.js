// Domain PUR — Calendrier SLA du module maintenance (ADR-P23), Lot 10. Aucun I/O.
// Lit l'overlay config/mntCalendar { tzOffsetMinutes, pays, holidays:[AAAA-MM-JJ], b2b:{start,end} } et le
// normalise pour le moteur SLA (mntSla). Document ABSENT ⇒ calendrier NEUTRE (UTC, aucun férié, fenêtre 8–18)
// ⇒ l'horloge SLA est STRICTEMENT celle d'avant (Abidjan = UTC+0, ADR-002/006). Miroir front : web/src/lib/mntCalendar.ts.
const DEFAULT_B2B = { start: 8, end: 18 };

// Une date de férié plausible : 'AAAA-MM-JJ' (borne d'année 2000..2100 pour écarter les saisies aberrantes).
function isPlausibleDay(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ""));
  if (!m) return false;
  const y = +m[1], mo = +m[2], d = +m[3];
  return y >= 2000 && y <= 2100 && mo >= 1 && mo <= 12 && d >= 1 && d <= 31;
}

// Normalise l'overlay en { offMin, pays, holidays:string[], b2b:{start,end} } — bornes sûres, doublons ôtés.
function mntCalendar(cfg) {
  const c = cfg && typeof cfg === "object" ? cfg : {};
  const off = Number(c.tzOffsetMinutes);
  const offMin = Number.isFinite(off) ? Math.max(-720, Math.min(840, Math.round(off))) : 0; // [-12h .. +14h]
  const pays = typeof c.pays === "string" ? c.pays.slice(0, 40) : null;
  const holidays = Array.isArray(c.holidays)
    ? Array.from(new Set(c.holidays.filter(isPlausibleDay))).sort()
    : [];
  const s = Number(c.b2b && c.b2b.start), e = Number(c.b2b && c.b2b.end);
  const b2b = Number.isFinite(s) && Number.isFinite(e) && e > s && s >= 0 && e <= 24 ? { start: s, end: e } : DEFAULT_B2B;
  return { offMin, pays, holidays, b2b };
}

// Forme passée au moteur SLA (mntSla) : holidays en Set pour un test O(1).
function slaCalendar(cfg) {
  const n = mntCalendar(cfg);
  return { offMin: n.offMin, holidays: new Set(n.holidays), b2b: n.b2b };
}

module.exports = { DEFAULT_B2B, isPlausibleDay, mntCalendar, slaCalendar };
