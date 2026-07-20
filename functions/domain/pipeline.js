// Pipeline pondéré (BUILD_KIT §7, §18.5).
// Actif = étapes 1-5, veille = 8, conversion = 6 (gagné) vs 7 (perdu).
// « Pondéré » = PROJECTION à 3 niveaux CONFIGURABLES (domain/projection : Certitudes ≥90 · Forecast
// 70-90 · Pipe 50-70, chacun activable/pondérable ; défaut 100/20/5). Le KPI Pondéré, les
// ventilations, le funnel et l'analyse de closing utilisent tous ces mêmes niveaux (cohérence
// avec l'atterrissage et la Vue d'ensemble).
const { sum } = require("./chaine");
const { fpKey, plausibleYear } = require("../lib/ids");
const { projectionWeight, tierBreakdown, normalizeTiers, p01 } = require("./projection");
const { groupSum } = require("./backlog");
const { isDormantClosing } = require("./oppLifecycle");

const CONFIANCE_MIN = 0.9;
const isActive = (o) => o.stage >= 1 && o.stage <= 5;

// Semaine ISO 8601 (`AAAA-Www`) d'une date `AAAA-MM-JJ` — granularité HEBDO du closing (D Prev).
// Pure/déterministe (ne dépend que de l'entrée, aucune horloge). Sert à ventiler l'écoulement du
// pipeline par semaine, complément fin du mensuel `byMonth`. La clé zéro-padée trie lexicographiquement.
// NB : pas de date de CRÉATION en source → c'est bien un écoulement du closing prévu, jamais un « entrant ».
function isoWeek(iso) {
  const dt = new Date(String(iso).slice(0, 10) + "T00:00:00Z");
  if (isNaN(dt.getTime())) return "?";
  const day = (dt.getUTCDay() + 6) % 7; // Lundi=0 … Dimanche=6
  dt.setUTCDate(dt.getUTCDate() - day + 3); // jeudi de la semaine ISO → porte le millésime de semaine
  const year = dt.getUTCFullYear();
  const jan4 = new Date(Date.UTC(year, 0, 4)); // le 4 janvier est toujours en semaine 1
  const week = 1 + Math.round(((dt.getTime() - jan4.getTime()) / 86400000 - 3 + ((jan4.getUTCDay() + 6) % 7)) / 7);
  return `${year}-W${String(week).padStart(2, "0")}`;
}

// Éligible « certain » (IdC ≥ 90 %) — conservé pour les certitudes.
const isEligible = (o) => isActive(o) && p01(o.probability || 0) >= CONFIANCE_MIN;

// Classification transverse des opportunités ACTIVES en « phases amont » (mutuellement exclusives) —
// dérivée des SEULS champs existants (désignation, étape, âge), sans aucune nouvelle donnée source :
//   BUDGET : désignation commençant par « budget » (offre budgétaire — prioritaire) ;
//   sinon, si l'offre n'est PAS encore transmise au client (étape < 3 « Transmise ») :
//     GELE : âge > seuil (paramétrable, défaut 6 mois) — dossier enlisé ;
//     DEV  : sinon — offre en cours d'élaboration, non encore transmise.
//   étape ≥ 3 (transmise) et non budgétaire → aucune phase amont (dans le funnel normal).
// Tag TRANSVERSE : ne modifie ni l'étape, ni le pondéré ; sert au seul pilotage « Vue d'ensemble ».
const DAYS_PER_MONTH = 30.44; // 365,25/12 — seuil GELE exprimé en MOIS → jours (comparé à ageDays « Âge Auto »)
function classifyPhase0(o, geleDays) {
  if (!isActive(o)) return null; // uniquement les opps actives (étapes 1..5)
  if (String(o.designation || "").trim().toLowerCase().startsWith("budget")) return "budget";
  if ((o.stage || 0) < 3) { // avant l'étape 3 (Transmise) = offre pas encore transmise au client
    const age = Number(o.ageDays);
    return Number.isFinite(age) && age > geleDays ? "gele" : "dev"; // âge inconnu → dev (jamais gelé par défaut)
  }
  return null; // étape ≥ 3, non budgétaire → funnel normal
}

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
    // Millésime BORNÉ (plausibleYear) : un closing aberrant (« 20226-… » trie AVANT « 2026 » en comparaison
    // de chaînes → faux « en retard ») est traité comme non attribuable → seau « sans » (à requalifier).
    // Année = token AVANT le premier « - » (PAS slice(0,4) : « 20226 ».slice(0,4)==« 2022 » resterait plausible).
    const y = d ? plausibleYear(Number(d.split("-")[0])) : 0;
    let key;
    if (!d || !y) key = "sans";
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

// ÂGE & CYCLE des opportunités actives — fondé sur la SEULE date de création RÉELLE présente en source :
// `dateCreation` (Odoo `create_date`), ABSENTE des opps Excel salesData (d'où les gardes « pas de date de
// création » ailleurs dans ce fichier). On ne calcule donc l'âge QUE sur les opps qui la portent, et on
// expose la COUVERTURE (`withDate` / `total`) pour que le front dise honnêtement « mesuré sur X opps datées »
// — jamais d'âge inventé pour une opp sans date. PURE (asOf explicite, aucune horloge).
const DAY_MS = 86400000;
function daysBetweenIso(fromIso, toIso) {
  const a = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(fromIso || ""));
  const b = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(toIso || ""));
  if (!a || !b) return null;
  return Math.round((Date.UTC(+b[1], +b[2] - 1, +b[3]) - Date.UTC(+a[1], +a[2] - 1, +a[3])) / DAY_MS);
}
function agingAnalysis(active, asOf) {
  const today = String(asOf || "").slice(0, 10);
  const mk = () => ({ brut: 0, count: 0 });
  const buckets = { d30: mk(), d90: mk(), d180: mk(), dPlus: mk() }; // ≤30 · 31-90 · 91-180 · >180 j
  let withDate = 0, ageSum = 0, cycleSum = 0, cycleCount = 0;
  const aged = [];
  for (const o of active) {
    const dc = o.dateCreation ? String(o.dateCreation).slice(0, 10) : "";
    const age = daysBetweenIso(dc, today);
    // Millésime de création BORNÉ (plausibleYear) : une date aberrante (« 1900-… ») ne tombe pas en tranche
    // « ancienne » à tort. Pas de date (opp Excel) ou incohérente/aberrante → ignorée (couverture withDate honnête).
    if (age == null || age < 0 || !plausibleYear(Number(dc.slice(0, 4)))) continue;
    withDate++; ageSum += age;
    const k = age <= 30 ? "d30" : age <= 90 ? "d90" : age <= 180 ? "d180" : "dPlus";
    buckets[k].brut += o.amount || 0; buckets[k].count++;
    aged.push({ oppId: o.oppId, client: o.client, am: o.am, amount: o.amount, stage: o.stage, dateCreation: dc, ageDays: age });
    // Cycle PRÉVISIONNEL : création → clôture PRÉVUE (D Prev). Les deux dates sont réelles (l'une prévue) :
    // combien de temps une opp met, de sa création à sa clôture attendue. Jamais un « cycle réalisé » (il
    // faudrait une date de gain, absente en source).
    const cyc = o.closingDate ? daysBetweenIso(dc, String(o.closingDate).slice(0, 10)) : null;
    if (cyc != null && cyc >= 0) { cycleSum += cyc; cycleCount++; }
  }
  aged.sort((a, b) => b.ageDays - a.ageDays);
  return {
    total: active.length, withDate, // couverture : opps datées vs total actives (honnêteté du périmètre)
    avgAge: withDate ? Math.round(ageSum / withDate) : 0,
    avgProjectedCycle: cycleCount ? Math.round(cycleSum / cycleCount) : 0,
    buckets, top: aged.slice(0, 10),
  };
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

function pipeline(opps, asOf, tiers, orders, geleMonths = 6) {
  const t = tiers || normalizeTiers();
  const pw = (o) => projectionWeight(o, t);
  const active = opps.filter(isActive);
  // Phases amont (tag transverse, dérivé) : ventile les opps actives en Budget / Gelé / Dev.
  const geleDays = (geleMonths > 0 ? geleMonths : 6) * DAYS_PER_MONTH;
  const phase0 = { budget: { count: 0, brut: 0 }, gele: { count: 0, brut: 0 }, dev: { count: 0, brut: 0 } };
  for (const o of active) {
    const p = classifyPhase0(o, geleDays);
    if (p) { phase0[p].count++; phase0[p].brut += o.amount || 0; }
  }
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
    bySource: groupSum(proj, (o) => o.leadSource || "—", pw), // pipeline pondéré par ORIGINE de lead (canal)
    byMonth: groupSum(proj, month, pw),
    // Écoulement HEBDO du closing (D Prev) — même population/pondération que byMonth, granularité semaine.
    byWeek: groupSum(proj, (o) => (o.closingDate ? isoWeek(o.closingDate) : "?"), pw),
    // Phases amont (tag transverse) : ventilation des opps ACTIVES par Budget / Gelé / Dev — volume + brut.
    phase0,
    geleMonths, // seuil GELE appliqué (mois) — affiché dans la légende front
    conv: wonCount + lostCount > 0 ? wonCount / (wonCount + lostCount) : 0,
    wonCount,
    lostCount,
    byAmConv,
    topOpps,
    // Analyse du closing (D Prev) sur les opps projetables (hors carnet, parité atterrissage.pipelineRetard).
    closing: asOf ? closingAnalysis(proj, asOf, pw) : null,
    // ÂGE des opps actives (périmètre daté : opps portant dateCreation, càd issues d'Odoo). Population
    // `active` (toutes 1-5, comme byStage) : l'âge est une propriété de l'opp, indépendante du carnet.
    aging: asOf ? agingAnalysis(active, asOf) : null,
  };
}

// CONFIDENTIALITÉ record-level (audit P1-a, ADR summaries record-scopés) : le summary pipeline est un doc
// GLOBAL lu par tout rôle habilité « pipeline ». Sous OWD `opportunities === "private"` (isolement attendu),
// il ne doit PAS divulguer le DÉTAIL NOMINATIF — affaires nommées et conversion d'AUTRES commerciaux : on
// retire `topOpps` (deals nommés projetés), `byAmConv` (conversion par commercial) et `closing.staleTop`
// (deals nommés en retard). Les AGRÉGATS anonymes (tot/byStage/byAM/byBU/byMonth…) restent — vue d'équipe.
// Le détail PROPRE à l'utilisateur passe par les callables record-scopés (forecastRollup/scoreOpportunities).
// PUR (aucune I/O) → l'appelant (aggregate) fournit `isPrivate` lu depuis config/recordAccess.
function scopePrivateSummary(s, isPrivate) {
  if (!isPrivate || !s) return s;
  return {
    ...s,
    topOpps: [],
    byAmConv: [],
    closing: s.closing ? { ...s.closing, staleTop: [] } : s.closing,
    scopedPrivate: true, // le front explique « détail masqué (mode privé) » au lieu de « aucune donnée »
  };
}

module.exports = { pipeline, scopePrivateSummary, closingAnalysis, agingAnalysis, dormantSummary, isActive, isEligible, isoWeek, classifyPhase0, CONFIANCE_MIN };
