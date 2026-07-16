// Pipeline pondéré (BUILD_KIT §7, §18.5).
// Actif = étapes 1-5, veille = 8, conversion = 6 (gagné) vs 7 (perdu).
// « Pondéré » = PROJECTION à 3 niveaux CONFIGURABLES (domain/projection : Certitudes ≥90 · Forecast
// 70-90 · Pipe 50-70, chacun activable/pondérable ; défaut 100/20/5). Le KPI Pondéré, les
// ventilations, le funnel et l'analyse de closing utilisent tous ces mêmes niveaux (cohérence
// avec l'atterrissage et la Vue d'ensemble).
const { sum } = require("./chaine");
const { fpKey } = require("../lib/ids");
const { projectionWeight, tierBreakdown, normalizeTiers, p01 } = require("./projection");
const { groupSum } = require("./backlog");
const { isDormantClosing } = require("./oppLifecycle");

const CONFIANCE_MIN = 0.9;
const isActive = (o) => o.stage >= 1 && o.stage <= 5;
// Éligible « certain » (IdC ≥ 90 %) — conservé pour les certitudes.
const isEligible = (o) => isActive(o) && p01(o.probability || 0) >= CONFIANCE_MIN;

// Analyse temporelle du closing (D Prev) sur les opps ACTIVES — uniquement à partir de la
// closingDate réelle (aucune date de création/étape en source → pas de vélocité/âge inventés).
// `pw` = pondération de projection liée aux niveaux configurés.
function closingAnalysis(active, asOf, pw) {
  const today = String(asOf);
  const ym = today.slice(0, 7), yr = today.slice(0, 4);
  const q = Math.floor((Number(today.slice(5, 7)) - 1) / 3);
  const mk = () => ({ brut: 0, pond: 0, count: 0 });
  const B = { retard: mk(), mois: mk(), trim: mk(), plus: mk(), sans: mk() };
  const stale = [];
  for (const o of active) {
    const d = o.closingDate ? String(o.closingDate) : "";
    let key;
    if (!d) key = "sans";
    else if (d < today) key = "retard"; // clôture prévue déjà passée → à requalifier
    else if (d.slice(0, 7) === ym) key = "mois";
    else if (d.slice(0, 4) === yr && Math.floor((Number(d.slice(5, 7)) - 1) / 3) === q) key = "trim";
    else key = "plus";
    B[key].brut += o.amount || 0; B[key].pond += pw(o); B[key].count++;
    if (key === "retard") stale.push(o);
  }
  const staleTop = stale
    .sort((a, b) => pw(b) - pw(a))
    .slice(0, 10)
    .map((o) => ({ oppId: o.oppId, client: o.client, am: o.am, amount: o.amount, weighted: pw(o), closingDate: o.closingDate, stageLabel: o.stageLabel }));
  // ANCIENNETÉ du retard : jours écoulés depuis la D Prev dépassée, en tranches → priorise les
  // affaires les plus enlisées (les >90 j sont les plus à risque). Âge légitime (basé sur la D Prev,
  // pas une date de création inventée).
  const overdueAge = { d30: mk(), d90: mk(), dPlus: mk() };
  let overdueDaysSum = 0;
  for (const o of stale) {
    const days = Math.max(0, Math.floor((Date.parse(today) - Date.parse(String(o.closingDate).slice(0, 10))) / 86400000));
    overdueDaysSum += days;
    const k = days <= 30 ? "d30" : days <= 90 ? "d90" : "dPlus";
    overdueAge[k].brut += o.amount || 0; overdueAge[k].pond += pw(o); overdueAge[k].count++;
  }
  const avgOverdueDays = stale.length ? Math.round(overdueDaysSum / stale.length) : 0;
  return { buckets: B, staleCount: stale.length, staleBrut: stale.reduce((s, o) => s + (o.amount || 0), 0), staleTop, overdueAge, avgOverdueDays };
}

// Opportunités DORMANTES (isDormantClosing) : ouvertes dont la D Prev est d'un millésime révolu.
// Renvoie le VOLUME (count), la VALEUR brute (Σ montant) et l'ANCIENNETÉ en jours depuis la D Prev
// passée (min / max / moyen). Base de la tuile « Opportunité dormante » ET du montant exclu de la
// prévision cumulée. PURE. Calculée sur l'assiette active GLOBALE (indépendante de la période).
function dormantSummary(opps, currentFy, asOf) {
  const tp = Date.parse(String(asOf || ""));
  let count = 0, brut = 0, ageSum = 0, aged = 0, ageMin = null, ageMax = null;
  for (const o of opps || []) {
    if (!isDormantClosing(o, currentFy)) continue;
    count++; brut += o.amount || 0;
    const dp = Date.parse(String(o.closingDate || "").slice(0, 10));
    if (Number.isFinite(tp) && Number.isFinite(dp)) {
      const days = Math.max(0, Math.floor((tp - dp) / 86400000));
      ageSum += days; aged++;
      ageMin = ageMin == null ? days : Math.min(ageMin, days);
      ageMax = ageMax == null ? days : Math.max(ageMax, days);
    }
  }
  return { count, brut, ageMin: ageMin || 0, ageMax: ageMax || 0, ageAvg: aged ? Math.round(ageSum / aged) : 0 };
}

function pipeline(opps, asOf, tiers, orders) {
  const t = tiers || normalizeTiers();
  const pw = (o) => projectionWeight(o, t);
  const active = opps.filter(isActive);
  // PARITÉ chaine/atterrissage (audit cohérence chiffres, divergence A) : une opp active dont le FP porte
  // DÉJÀ une commande (P&L) est déjà comptée dans le CAS. La garder dans le « pondéré PROJETÉ »
  // (tot.weighted, tierBreakdown, ventilations, top) la double-compterait → même libellé « Commit »/
  // « Pondéré projeté » que la Vue d'ensemble, mais deux nombres. On l'exclut donc de la PROJECTION,
  // en gardant `active` (funnel byStage, conversion, comptages bruts) inchangé. FP canonique des deux côtés.
  const bookedFps = new Set((orders || []).map((o) => fpKey(o.fp)).filter(Boolean));
  const notBooked = (o) => { const k = o.fp ? fpKey(o.fp) : ""; return !(k && bookedFps.has(k)); };
  const proj = bookedFps.size ? active.filter(notBooked) : active; // opps projetables (hors carnet)
  const projected = proj.filter((o) => pw(o) > 0); // contribuent à la projection (IdC ≥ 50 %)
  const suspended = opps.filter((o) => o.stage === 8);
  const won = opps.filter((o) => o.stage === 6);
  const lost = opps.filter((o) => o.stage === 7);

  const byStage = {};
  for (const o of opps) {
    const s = o.stage || 0;
    byStage[s] = byStage[s] || { count: 0, amount: 0, weighted: 0 };
    byStage[s].count++;
    byStage[s].amount += o.amount || 0;
    byStage[s].weighted += pw(o); // funnel = projection tiérée
  }

  const month = (o) => (o.closingDate ? String(o.closingDate).slice(0, 7) : "?");
  // Top opportunités contribuant à la projection, triées par montant PROJETÉ.
  const topOpps = [...projected]
    .sort((a, b) => pw(b) - pw(a))
    .slice(0, 10)
    .map((o) => ({ oppId: o.oppId, client: o.client, am: o.am, bu: o.bu, amount: o.amount, weighted: pw(o), stage: o.stage, probability: o.probability }));

  // Conversion par commercial (AM) : gagné / perdu / taux + pipeline actif projeté.
  const ams = [...new Set(opps.map((o) => o.am).filter(Boolean))];
  const byAmConv = ams
    .map((am) => {
      const w = won.filter((o) => o.am === am).length;
      const l = lost.filter((o) => o.am === am).length;
      const act = active.filter((o) => o.am === am);
      // weighted = projeté NET du carnet (parité tot.weighted) ; activeCount = funnel actif brut.
      return { am, won: w, lost: l, conv: w + l > 0 ? w / (w + l) : 0, activeCount: act.length, weighted: sum(act.filter(notBooked), pw) };
    })
    .filter((x) => x.won + x.lost + x.activeCount > 0)
    .sort((a, b) => (b.weighted - a.weighted) || (b.won - a.won));

  const wonCount = won.length, lostCount = lost.length;
  return {
    // brut = toute la funnel active ; « pondéré » = PROJECTION tiérée des actives HORS carnet (net).
    tot: { brut: sum(active, (o) => o.amount), weighted: sum(proj, pw), count: active.length, countConf: projected.length },
    susp: { brut: sum(suspended, (o) => o.amount), count: suspended.length },
    confianceMin: CONFIANCE_MIN,
    // Décomposition du pondéré projeté par niveau (Certitudes / Forecast / Pipe) — jamais mélangée, net du carnet.
    tierBreakdown: tierBreakdown(proj, t),
    byStage,
    byAM: groupSum(proj, (o) => o.am, pw),
    byBU: groupSum(proj, (o) => o.bu, pw),
    byMonth: groupSum(proj, month, pw),
    conv: wonCount + lostCount > 0 ? wonCount / (wonCount + lostCount) : 0,
    wonCount,
    lostCount,
    byAmConv,
    topOpps,
    // Analyse du closing (D Prev) sur les opps projetables (hors carnet, parité atterrissage.pipelineRetard).
    closing: asOf ? closingAnalysis(proj, asOf, pw) : null,
  };
}

module.exports = { pipeline, closingAnalysis, dormantSummary, isActive, isEligible, CONFIANCE_MIN };
