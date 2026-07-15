// CAPACITÉ ⇄ PIPELINE (Lot 14 « 20/10 DirOps ») — le rapprochement stratégique d'une ESN : ai-je la
// CAPACITÉ de délivrance (consultants disponibles) pour honorer le PIPELINE qui va se signer ? Compare,
// sur un horizon, la capacité disponible (jours-homme non staffés des actifs) à la demande pipeline
// pondérée (Σ montant × probabilité ÷ TJM moyen, convertie en jours de delivery). Le GAP signale un
// besoin de RECRUTEMENT (sous-capacité) ou un risque de BANC/intercontrat (sur-capacité).
//
// Fonctions PURES (aucun I/O) → testables. WORKING_DAYS réutilisé de activityKpi (cohérence des hypothèses).

const { WORKING_DAYS_PER_MONTH } = require("./activityKpi");
const { isWorkforce } = require("./consultant");
const { p01 } = require("./projection"); // IdC en % (0-100) ⇒ ratio 0-1 pour le repli montant×IdC

// Jours-homme disponibles d'un consultant actif sur la plage = Σ mois (1 − occupation) × jours ouvrés.
function availableDays(consultantId, loadByConsultant, months) {
  const row = (loadByConsultant && loadByConsultant[consultantId]) || {};
  let d = 0;
  for (const m of months) { const alloc = Math.min(100, Number(row[m]) || 0); d += (1 - alloc / 100) * WORKING_DAYS_PER_MONTH; }
  return d;
}

// TJM moyen cible de l'effectif EN ACTIVITÉ (fallback si aucun renseigné), pour convertir un montant en
// jours. Fallback en PIVOT XOF (≈ 380 €/j au peg) : l'ancien 600 XOF (~1 €/j) faisait exploser demandDays.
function avgTjm(consultants, fallback = 250000) {
  const v = (consultants || []).filter((c) => isWorkforce(c.status)).map((c) => Number(c.tjmTarget)).filter((n) => Number.isFinite(n) && n > 0);
  return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : fallback;
}

// Demande pipeline en jours de delivery : pondéré ÷ TJM moyen. On privilégie `pw` (pondéré TIÉRÉ, source
// unique du « pondéré » — CLAUDE.md) fourni par l'appelant ; repli `weighted` linéaire puis montant×proba.
function demandDaysOf(opp, tjm) {
  const pw = Number(opp.pw);
  const weighted = Number(opp.weighted);
  const w = Number.isFinite(pw) ? pw : Number.isFinite(weighted) ? weighted : (Number(opp.amount) || 0) * p01(opp.probability);
  return tjm > 0 ? w / tjm : 0;
}

// Rapprochement global + par BU. `opps` = opportunités OUVERTES (pondérées). Renvoie jours et
// équivalents ETP (jours ÷ (mois × jours ouvrés)).
function capacityVsPipeline({ consultants, loadByConsultant, months, opps }) {
  const tjm = avgTjm(consultants);
  // Capacité disponible = effectif EN ACTIVITÉ = staffé + intercontrat (le banc EST 100 % disponible).
  const active = (consultants || []).filter((c) => isWorkforce(c.status));
  const horizonDays = Math.max(1, months.length) * WORKING_DAYS_PER_MONTH;

  const capById = {};
  for (const c of active) capById[c.id] = availableDays(c.id, loadByConsultant, months);
  const capacityDays = Object.values(capById).reduce((a, b) => a + b, 0);
  const demandDays = (opps || []).reduce((s, o) => s + demandDaysOf(o, tjm), 0);
  const gapDays = capacityDays - demandDays;

  // Par BU : capacité (consultants de la BU) vs demande (opps de la BU).
  const buCap = {}, buDem = {};
  for (const c of active) { const k = c.bu || "—"; buCap[k] = (buCap[k] || 0) + (capById[c.id] || 0); }
  for (const o of opps || []) { const k = (o.bu || "—"); buDem[k] = (buDem[k] || 0) + demandDaysOf(o, tjm); }
  const byBu = [...new Set([...Object.keys(buCap), ...Object.keys(buDem)])].map((bu) => {
    const capacityDays = Math.round(buCap[bu] || 0), demandDays = Math.round(buDem[bu] || 0);
    return { bu, capacityDays, demandDays, gapDays: capacityDays - demandDays, fteGap: +((capacityDays - demandDays) / horizonDays).toFixed(1) };
  }).sort((a, b) => a.gapDays - b.gapDays);

  return {
    tjm, capacityDays: Math.round(capacityDays), demandDays: Math.round(demandDays), gapDays: Math.round(gapDays),
    fteGap: +(gapDays / horizonDays).toFixed(1), // ETP : négatif = recrutement, positif = banc à risque
    byBu,
  };
}

module.exports = { availableDays, avgTjm, demandDaysOf, capacityVsPipeline };
