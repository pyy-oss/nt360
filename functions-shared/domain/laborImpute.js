// KEYSTONE « EXÉCUTION ↔ AFFAIRE » (DO Lot 1) — impute le COÛT DE MAIN-D'ŒUVRE CONSTATÉ aux AFFAIRES (FP).
//
// Problème résolu : le CRA (domain/timesheet.js) ne porte PAS de N° FP — il ne connaît que le consultant
// et le mois. Le coût du travail réellement consommé n'atterrit donc jamais sur une affaire, si bien que
// la marge par affaire ignore la main-d'œuvre (le premier poste de coût d'une ESN) et qu'aucune dérive
// de marge n'est détectable en cours d'exécution.
//
// Pont : les AFFECTATIONS (domain/assignment.js) rattachent un consultant à un projet (`projectFp`,
// désormais canonicalisé via fpKey). Pour chaque (consultant × mois), on RÉPARTIT ses jours FACTURÉS du
// CRA entre ses affectations rattachées à un N° FP, au prorata RELATIF de l'allocation (%). Chaque part
// est valorisée au CJM (coût journalier, SOURCE UNIQUE `consultants.cjm` — la même que resourcePnl /
// mntContratPnl : aucune deuxième vérité du coût ressource).
//
// Honnêteté (comme missingTjm/missingCjm ailleurs) :
//  - jours facturés d'un consultant SANS affectation FP ce mois-là → `unassignedDays` (jamais forcés sur
//    une affaire au hasard) ;
//  - CJM absent → consultant listé dans `missingCjm`, jours comptés mais coût 0 (marge non fiable, signalée).
//
// ADDITIF STRICT : `coutLabor` est un agrégat à CÔTÉ du carnet. Il ne fusionne JAMAIS dans le `costTotal`
// ni le `mb` de mergeCommandes — pour les lignes P&L « manuel » (import Excel), le coût de main-d'œuvre
// peut déjà être baké dans le coût importé ; l'additionner produirait un double-compte. La marge de
// livraison (DO Lot 2) confronte ce coût constaté à la marge PRÉVUE, elle ne le somme pas au coût d'import.
//
// Fonctions PURES (aucun I/O, mois fournis par l'appelant) → testables.

const { fpKey } = require("../lib/ids");
const { coversMonth } = require("./assignment");
const { excludeMaintenance } = require("./timesheet");

const round1 = (n) => Math.round((Number(n) || 0) * 10) / 10;

/**
 * Impute le coût de main-d'œuvre constaté (jours facturés du CRA) aux affaires (FP) via les affectations.
 * @param {Array} assignments consultantId, projectFp, startMonth, endMonth, allocationPct
 * @param {Array} timesheets  consultantId, month, billedDays (les CRA `source:"mnt"` sont écartés)
 * @param {Array} consultants id, cjm (coût journalier moyen chargé)
 * @param {string[]} months   plage de mois AAAA-MM à considérer
 * @returns {{byFp:{fp:string,laborDays:number,laborCost:number,byConsultant:Object}[], unassignedDays:number, missingCjm:string[]}}
 */
function imputeLaborByFp(assignments, timesheets, consultants, months) {
  const monthSet = new Set(months || []);
  const cjmOf = new Map();
  for (const c of consultants || []) {
    const id = String((c && c.id) || "").trim();
    if (id) cjmOf.set(id, Number(c.cjm));
  }
  // Affectations rattachées à un VRAI N° FP (canonicalisable), groupées par consultant.
  const fpAssignsByConsultant = new Map();
  for (const a of assignments || []) {
    if (!a || !a.consultantId) continue;
    const fk = fpKey(a.projectFp);
    if (!fk) continue; // affectation sans FP interprétable → pas d'imputation possible (opp, libellé libre)
    const id = String(a.consultantId).trim();
    let arr = fpAssignsByConsultant.get(id);
    if (!arr) { arr = []; fpAssignsByConsultant.set(id, arr); }
    arr.push({ startMonth: a.startMonth, endMonth: a.endMonth, allocationPct: Number(a.allocationPct) || 0, fp: fk });
  }
  const byFp = new Map();
  let unassignedDays = 0;
  const missingCjm = new Set();
  const rows = excludeMaintenance(timesheets || []).filter((t) => monthSet.has(t.month));
  for (const t of rows) {
    const billed = Number(t.billedDays) || 0;
    if (billed <= 0) continue;
    const id = String(t.consultantId || "").trim();
    const active = (fpAssignsByConsultant.get(id) || []).filter((a) => coversMonth(a, t.month));
    if (!active.length) { unassignedDays += billed; continue; } // jours facturés non rattachables à une affaire
    const totW = active.reduce((s, a) => s + a.allocationPct, 0);
    const cjm = cjmOf.get(id);
    const hasCjm = Number.isFinite(cjm) && cjm >= 0;
    if (!hasCjm) missingCjm.add(id);
    for (const a of active) {
      // Prorata RELATIF entre les affectations FP du consultant (les jours FACTURÉS vont aux affaires
      // clientes ; l'allocation interne n'absorbe pas de jours facturés). totW=0 → répartition égale.
      const w = totW > 0 ? a.allocationPct / totW : 1 / active.length;
      const days = billed * w;
      const cost = hasCjm ? days * cjm : 0;
      const e = byFp.get(a.fp) || { fp: a.fp, laborDays: 0, laborCost: 0, byConsultant: {} };
      e.laborDays += days; e.laborCost += cost;
      const bc = e.byConsultant[id] || (e.byConsultant[id] = { days: 0, cost: 0 });
      bc.days += days; bc.cost += cost;
      byFp.set(a.fp, e);
    }
  }
  const byFpList = [...byFp.values()].map((e) => ({
    fp: e.fp,
    laborDays: round1(e.laborDays),
    laborCost: Math.round(e.laborCost),
    byConsultant: Object.fromEntries(Object.entries(e.byConsultant).map(([id, v]) => [id, { days: round1(v.days), cost: Math.round(v.cost) }])),
  })).sort((a, b) => b.laborCost - a.laborCost);
  return { byFp: byFpList, unassignedDays: round1(unassignedDays), missingCjm: [...missingCjm] };
}

module.exports = { imputeLaborByFp };
