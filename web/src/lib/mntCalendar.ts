// Miroir FRONT du calendrier SLA (ADR-P23, functions/domain/mntCalendar.js). Normalise l'overlay
// config/mntCalendar { tzOffsetMinutes, pays, holidays, b2b } et fabrique la forme attendue par slaState
// (holidays en Set). Document absent ⇒ calendrier neutre (UTC, aucun férié, fenêtre 8–18). Pur → testable.
import type { SlaCalendar } from "./mntSla";

export type MntCalendarDoc = { tzOffsetMinutes?: number; pays?: string | null; holidays?: string[]; b2b?: { start: number; end: number } };
export const DEFAULT_B2B = { start: 8, end: 18 };

export function isPlausibleDay(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ""));
  if (!m) return false;
  const y = +m[1], mo = +m[2], d = +m[3];
  return y >= 2000 && y <= 2100 && mo >= 1 && mo <= 12 && d >= 1 && d <= 31;
}

// Forme NORMALISÉE pour l'affichage (fériés triés/dédupliqués, bornes sûres).
export function mntCalendar(cfg?: MntCalendarDoc | null): { offMin: number; pays: string | null; holidays: string[]; b2b: { start: number; end: number } } {
  const c = cfg && typeof cfg === "object" ? cfg : {};
  const off = Number(c.tzOffsetMinutes);
  const offMin = Number.isFinite(off) ? Math.max(-720, Math.min(840, Math.round(off))) : 0;
  const pays = typeof c.pays === "string" ? c.pays.slice(0, 40) : null;
  const holidays = Array.isArray(c.holidays) ? Array.from(new Set(c.holidays.filter(isPlausibleDay))).sort() : [];
  const s = Number(c.b2b && c.b2b.start), e = Number(c.b2b && c.b2b.end);
  const b2b = Number.isFinite(s) && Number.isFinite(e) && e > s && s >= 0 && e <= 24 ? { start: s, end: e } : DEFAULT_B2B;
  return { offMin, pays, holidays, b2b };
}

// Forme passée à slaState (holidays en Set). Absent ⇒ calendrier neutre.
export function slaCalendar(cfg?: MntCalendarDoc | null): SlaCalendar {
  const n = mntCalendar(cfg);
  return { offMin: n.offMin, holidays: new Set(n.holidays), b2b: n.b2b };
}
