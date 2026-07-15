// Miroir FRONT du moteur SLA + échéancier (functions/domain/mntSla.js + mntEcheancier.js). Doit rester
// EXACTEMENT aligné (règle « miroir exact » de l'ERP). Horloge = jours ouvrés pleins Lun–Ven, UTC
// (ADR-002). Pur → testable sans React.
const HOUR_MS = 3600000;
const DAY_MS = 86400000;
const isWeekend = (ms: number) => { const d = new Date(ms).getUTCDay(); return d === 0 || d === 6; };
const startOfUtcDay = (ms: number) => { const d = new Date(ms); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()); };

export function businessMsBetween(a: number, b: number): number {
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
export function addBusinessMs(start: number, durMs: number): number {
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
export type SlaState = { seuilHeures: number; dueMs: number; elapsedHours: number; state: "respecte" | "rompu" | "en_cours" };
export function slaState(engagement: { seuilHeures?: number } | undefined, openMs: number, markMs: number | null, nowMs: number): SlaState {
  const seuilHeures = Math.max(0, Number(engagement && engagement.seuilHeures) || 0);
  const dueMs = addBusinessMs(openMs, seuilHeures * HOUR_MS);
  if (markMs != null) {
    const elapsed = businessMsBetween(openMs, markMs);
    return { seuilHeures, dueMs, elapsedHours: Math.round((elapsed / HOUR_MS) * 100) / 100, state: markMs <= dueMs ? "respecte" : "rompu" };
  }
  const elapsed = businessMsBetween(openMs, nowMs);
  return { seuilHeures, dueMs, elapsedHours: Math.round((elapsed / HOUR_MS) * 100) / 100, state: nowMs > dueMs ? "rompu" : "en_cours" };
}
export const slaTone = (s: string): "emerald" | "clay" | "steel" | "neutral" => (s === "respecte" ? "emerald" : s === "rompu" ? "clay" : s === "en_cours" ? "steel" : "neutral");
export const SLA_STATE_LABEL: Record<string, string> = { respecte: "Respecté", rompu: "Rompu", en_cours: "En cours" };

// --- Échéancier (miroir de mntEcheancier.js) ---
const PERIOD_MONTHS: Record<string, number> = { mensuel: 1, trimestriel: 3, annuel: 12 };
const parse = (iso?: string) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || "")); return m ? { y: +m[1], mo: +m[2], d: +m[3] } : null; };
export function monthsBetween(aIso?: string, bIso?: string): number {
  const a = parse(aIso), b = parse(bIso);
  if (!a || !b) return 0;
  let m = (b.y - a.y) * 12 + (b.mo - a.mo);
  if (b.d < a.d) m -= 1;
  return Math.max(0, m);
}
export type Echeancier = { periodsDue: number; engage: number; facture: number; ecart: number };
export function echeancier(contrat: { echeanceType?: string; montantEngage?: number; dateDebut?: string; dateFin?: string | null }, factureTotal: number, asOfIso: string): Echeancier {
  const per = PERIOD_MONTHS[contrat.echeanceType || "mensuel"] || 1;
  const montant = Math.max(0, Math.round(Number(contrat.montantEngage) || 0));
  let periodsDue = 0;
  if (parse(contrat.dateDebut)) {
    periodsDue = Math.floor(monthsBetween(contrat.dateDebut, asOfIso) / per) + 1;
    if (parse(contrat.dateFin || undefined)) {
      const total = Math.floor(monthsBetween(contrat.dateDebut, contrat.dateFin || undefined) / per) + 1;
      periodsDue = Math.min(periodsDue, Math.max(0, total));
    }
    periodsDue = Math.max(0, periodsDue);
  }
  const engage = periodsDue * montant;
  const facture = Math.max(0, Math.round(Number(factureTotal) || 0));
  return { periodsDue, engage, facture, ecart: engage - facture };
}
