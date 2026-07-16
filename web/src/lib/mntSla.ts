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
// Miroir EXACT de functions/domain/mntSla.js : couverture `h24` → horloge calendaire 24/7 ; sinon jours ouvrés.
export function slaState(engagement: { seuilHeures?: number; couverture?: string } | undefined, openMs: number, markMs: number | null, nowMs: number): SlaState {
  const seuilHeures = Math.max(0, Number(engagement && engagement.seuilHeures) || 0);
  const h24 = !!engagement && engagement.couverture === "h24";
  const dueMs = h24 ? openMs + seuilHeures * HOUR_MS : addBusinessMs(openMs, seuilHeures * HOUR_MS);
  const elapsedMs = (a: number, b: number) => (h24 ? Math.max(0, b - a) : businessMsBetween(a, b));
  if (markMs != null) {
    const elapsed = elapsedMs(openMs, markMs);
    return { seuilHeures, dueMs, elapsedHours: Math.round((elapsed / HOUR_MS) * 100) / 100, state: markMs <= dueMs ? "respecte" : "rompu" };
  }
  const elapsed = elapsedMs(openMs, nowMs);
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
  // Miroir back : contrat non démarré (asOf < dateDebut) → 0 échéance due (pas de fausse sous-facturation).
  if (parse(contrat.dateDebut) && String(asOfIso) >= String(contrat.dateDebut)) {
    // Échéances émises ≤ asOf comptées par DATES RÉELLES (addMonthsIso) — pas via monthsBetween/per — sinon
    // sous-décompte des contrats démarrant le 29/30/31. Miroir EXACT de mntEcheancier.periodsDueAsOf (audit M1).
    periodsDue = periodsDueAsOf(contrat.dateDebut, asOfIso, per);
    // dateFin = borne de RENOUVELLEMENT (EXCLUSIVE) : l'échéance tombant pile sur dateFin (reconduction)
    // n'est pas comptée. On compte les débuts de période dont la date est < dateFin. Miroir mntEcheancier.js.
    if (parse(contrat.dateFin || undefined)) {
      periodsDue = Math.min(periodsDue, periodsInContract(contrat.dateDebut, contrat.dateFin, per));
    }
    periodsDue = Math.max(0, periodsDue);
  }
  const engage = periodsDue * montant;
  const facture = Math.max(0, Math.round(Number(factureTotal) || 0));
  return { periodsDue, engage, facture, ecart: engage - facture };
}

// Ajoute `n` mois à une date ISO (jour ramené au dernier du mois si dépassement). Miroir de mntEcheancier.js.
export function addMonthsIso(iso: string | null | undefined, n: number): string | null {
  const p = parse(iso || undefined);
  if (!p) return null;
  let y = p.y, mo = (p.mo - 1) + n, d = p.d;
  y += Math.floor(mo / 12); mo = ((mo % 12) + 12) % 12;
  const last = new Date(Date.UTC(y, mo + 1, 0)).getUTCDate();
  if (d > last) d = last;
  return `${y}-${String(mo + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

const MAX_PERIODS = 240;

// Nombre de débuts de période (dateDebut, +pas, +2·pas, …) dont la DATE est STRICTEMENT avant dateFin
// (borne de renouvellement exclusive). Miroir EXACT de mntEcheancier.periodsInContract : compté par dates
// réelles (addMonthsIso) pour gérer fins de mois ET durées partielles — un mensuel 01/01→30/06 = 6, un
// annuel 01/01/26→01/01/27 = 1 (l'échéance du 01/01/27 est le renouvellement, non comptée).
function periodsInContract(dateDebut: string | null | undefined, dateFin: string | null | undefined, per: number): number {
  if (!parse(dateDebut || undefined) || !parse(dateFin || undefined)) return 0;
  let n = 0;
  while (n < MAX_PERIODS) {
    const start = addMonthsIso(dateDebut, n * per);
    if (!start || String(start) >= String(dateFin)) break;
    n++;
  }
  return n;
}

// Échéances émises à `asOf` INCLUSE : débuts de période dont la date réelle (addMonthsIso) est ≤ asOf.
// Miroir EXACT de mntEcheancier.periodsDueAsOf (borne asOf inclusive, vs dateFin exclusive) — audit M1.
function periodsDueAsOf(dateDebut: string | null | undefined, asOfIso: string | null | undefined, per: number): number {
  if (!parse(dateDebut || undefined) || !parse(asOfIso || undefined)) return 0;
  let n = 0;
  while (n < MAX_PERIODS) {
    const d = addMonthsIso(dateDebut, n * per);
    if (!d || String(d) > String(asOfIso)) break;
    n++;
  }
  return n;
}

export type EcheancePeriod = { index: number; dateEcheance: string | null; montant: number; cumulEngage: number; statut: "facture" | "du" | "a_venir" };
export type EcheancierPlan = { periods: EcheancePeriod[]; periodsDue: number; engage: number; facture: number; ecart: number };

// Miroir EXACT de mntEcheancier.echeancierPlan : liste datée des échéances (facturée/dûe/à venir).
export function echeancierPlan(
  contrat: { echeanceType?: string; montantEngage?: number; dateDebut?: string; dateFin?: string | null },
  factureTotal: number,
  asOfIso: string,
): EcheancierPlan {
  const per = PERIOD_MONTHS[contrat.echeanceType || "mensuel"] || 1;
  const montant = Math.max(0, Math.round(Number(contrat.montantEngage) || 0));
  const agg = echeancier(contrat, factureTotal, asOfIso);
  let total = agg.periodsDue;
  if (parse(contrat.dateDebut) && parse(contrat.dateFin || undefined)) {
    // dateFin exclusive (borne de renouvellement) — débuts de période < dateFin. Miroir back mntEcheancier.js.
    total = periodsInContract(contrat.dateDebut, contrat.dateFin, per);
  }
  total = Math.min(Math.max(0, total), MAX_PERIODS);
  const periods: EcheancePeriod[] = [];
  for (let i = 0; i < total; i++) {
    const dateEcheance = addMonthsIso(contrat.dateDebut, i * per);
    const cumulEngage = (i + 1) * montant;
    let statut: EcheancePeriod["statut"];
    if (cumulEngage <= agg.facture) statut = "facture";
    else if (dateEcheance && String(dateEcheance) <= String(asOfIso)) statut = "du";
    else statut = "a_venir";
    periods.push({ index: i + 1, dateEcheance, montant, cumulEngage, statut });
  }
  return { periods, periodsDue: agg.periodsDue, engage: agg.engage, facture: agg.facture, ecart: agg.ecart };
}
export const ECHEANCE_STATUT_LABEL: Record<string, string> = { facture: "Facturé", du: "Dû", a_venir: "À venir" };
export const echeanceStatutTone = (s: string): "emerald" | "clay" | "steel" => (s === "facture" ? "emerald" : s === "du" ? "clay" : "steel");
