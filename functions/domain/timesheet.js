// CRA / TEMPS CONSTATÉ (Lot 15 « 20/10 DirOps ») — compte rendu d'activité mensuel PAR CONSULTANT :
// jours réellement FACTURÉS (client), jours de CONGÉ/absence, jours INTERNES (avant-vente, formation,
// R&D…). Permet de calculer le TACE et le taux d'occupation CONSTATÉS (réels), à comparer au prévisionnel
// dérivé du plan de charge (Lot 12/13). Sort nt360 du « tout prévisionnel » — l'exigence d'honnêteté de
// l'évaluation DirOps : mesurer, pas seulement prévoir.
//
// Fonctions PURES (aucun I/O) → testables.

const WORKING_DAYS_PER_MONTH = 20; // cohérent avec activityKpi (jours ouvrés standard)

function ym(v) { const s = String(v || "").trim(); return /^\d{4}-\d{2}$/.test(s) ? s : (/^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 7) : null); }
function days(v, max) { const n = Number(v); return Number.isFinite(n) && n >= 0 ? Math.min(max, n) : 0; }

// Normalise + valide un CRA mensuel. billed/leave/internal en JOURS (bornés au mois ouvré).
function validateTimesheet(d) {
  const o = d || {};
  const consultantId = String(o.consultantId || "").trim();
  if (!consultantId) return { ok: false, error: "consultant requis" };
  const month = ym(o.month);
  if (!month) return { ok: false, error: "mois requis (AAAA-MM)" };
  const value = {
    consultantId, month,
    billedDays: days(o.billedDays, 31),
    leaveDays: days(o.leaveDays, 31),
    internalDays: days(o.internalDays, 31),
  };
  return { ok: true, value };
}

// TACE CONSTATÉ d'un CRA = jours facturés ÷ jours OUVRABLES (jours ouvrés − congés). Congés exclus du
// dénominateur (définition standard « Taux d'Activité Congés Exclus »). Renvoie 0..1 (null si dénominateur nul).
function tace(ts, workingDays = WORKING_DAYS_PER_MONTH) {
  const avail = Math.max(0, workingDays - (Number(ts.leaveDays) || 0));
  return avail > 0 ? Math.min(1, (Number(ts.billedDays) || 0) / avail) : null;
}

// Taux d'occupation constaté = (facturé + interne) ÷ jours ouvrés (l'interne « occupe » sans facturer).
function occupancy(ts, workingDays = WORKING_DAYS_PER_MONTH) {
  return workingDays > 0 ? Math.min(1, ((Number(ts.billedDays) || 0) + (Number(ts.internalDays) || 0)) / workingDays) : 0;
}

// Agrège une liste de CRA (sur la plage de mois choisie) en KPI constatés global + par consultant.
function computeConstat(timesheets, months) {
  const set = new Set(months);
  const rows = (timesheets || []).filter((t) => set.has(t.month));
  const byConsultant = {};
  for (const t of rows) {
    const c = byConsultant[t.consultantId] || (byConsultant[t.consultantId] = { consultantId: t.consultantId, billedDays: 0, leaveDays: 0, internalDays: 0, months: 0 });
    c.billedDays += Number(t.billedDays) || 0; c.leaveDays += Number(t.leaveDays) || 0; c.internalDays += Number(t.internalDays) || 0; c.months += 1;
  }
  const list = Object.values(byConsultant).map((c) => {
    const workable = Math.max(1, c.months * WORKING_DAYS_PER_MONTH - c.leaveDays);
    return { ...c, tacePct: Math.round(c.billedDays / workable * 100), occupancyPct: Math.round((c.billedDays + c.internalDays) / Math.max(1, c.months * WORKING_DAYS_PER_MONTH) * 100) };
  });
  const totBilled = list.reduce((s, c) => s + c.billedDays, 0);
  const totLeave = list.reduce((s, c) => s + c.leaveDays, 0);
  const totInternal = list.reduce((s, c) => s + c.internalDays, 0);
  const totMonths = list.reduce((s, c) => s + c.months, 0);
  const workable = Math.max(1, totMonths * WORKING_DAYS_PER_MONTH - totLeave);
  const global = {
    tacePct: Math.round(totBilled / workable * 100),
    occupancyPct: Math.round((totBilled + totInternal) / Math.max(1, totMonths * WORKING_DAYS_PER_MONTH) * 100),
    billedDays: totBilled, leaveDays: totLeave, internalDays: totInternal, reportedConsultants: list.length,
  };
  return { global, rows: list.sort((a, b) => a.tacePct - b.tacePct) };
}

module.exports = { WORKING_DAYS_PER_MONTH, validateTimesheet, tace, occupancy, computeConstat };
