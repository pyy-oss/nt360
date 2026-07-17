// AM 360° — rcollationne, par commercial (Account Manager), les indicateurs de pilotage
// individuel : prise de commande (CAS), facturé (CAF, relié via la clé FP→AM des commandes),
// backlog (RAF), pipeline pondéré + conversion, et R/O vs objectif CAS de l'exercice.
// VOLONTAIREMENT SANS MARGE (confidentialité — la marge par AM reste dans « Rentabilité »).
// Module PUR (testable).
const { sum } = require("./chaine");
const { projectionWeight, normalizeTiers } = require("./projection");
const { fpKey, plausibleYear } = require("../lib/ids");
const { isDormantClosing } = require("./oppLifecycle");

// AM normalisé en MAJUSCULES : les parseurs uppercasent l'AM et l'appariement aux objectifs se fait
// en majuscules — sans ceci, une saisie « Datcha » et un import « DATCHA » scindent le commercial.
const normAm = (a) => (a && String(a).trim().toUpperCase()) || "—";

/**
 * @param {object[]} orders commandes fusionnées (am, cas, raf, yearPo, fp)
 * @param {object[]} invoices factures (fp, amountHt)
 * @param {object[]} opps opportunités (am, stage, probability, weighted)
 * @param {object[]} objectives objectifs (scope, scopeValue, fiscalYear, targetCas)
 * @param {number|string} fy exercice courant (pour le R/O)
 * @param {object[]} tiers niveaux de projection (poids/activation)
 * @param {boolean} excludeDormant retirer du pondéré les opps DORMANTES (année de closing < exercice) —
 *   MÊME assiette que le Cockpit « Tout » (pipeline_all) : sinon le pondéré par AM inclut des espoirs
 *   périmés que le Cockpit masque (violation « même métrique = même nombre »). Défaut : activé.
 */
function am360(orders, invoices, opps, objectives, fy, tiers, excludeDormant = true) {
  const pw = (o) => projectionWeight(o, tiers || normalizeTiers());
  // FP → AM (depuis les commandes) pour rattacher les factures à un commercial. Clé CANONIQUE (fpKey) :
  // orders.fp est canonisé (mergeCommandes), invoices.fp reste au format source → sans fpKey, une facture
  // au FP formaté autrement n'est pas rattachée à son AM → CAF par commercial sous-comptée.
  const amOfFp = {};
  const bookedFps = new Set();
  for (const o of orders || []) { const k = fpKey(o.fp); if (k) { amOfFp[k] = normAm(o.am); bookedFps.add(k); } }

  const objByAm = {};
  for (const ob of objectives || []) {
    if (ob.scope === "commercial" && String(ob.fiscalYear) === String(fy)) {
      objByAm[normAm(ob.scopeValue).toUpperCase()] = ob;
    }
  }

  const ams = new Set();
  (orders || []).forEach((o) => ams.add(normAm(o.am)));
  (opps || []).forEach((o) => ams.add(normAm(o.am)));

  // TENDANCE mensuelle par commercial (« performance dans le temps ») — DÉRIVÉE rétroactivement : CAS booké
  // par mois de commande (dateCommande), facturé par mois de facture (date), rattaché à l'AM via FP→AM.
  // Valeur immédiate (pas de snapshot à accumuler). Mois = AAAA-MM.
  const monthOf = (d) => { const m = /^(\d{4})-(\d{2})/.exec(String(d || "")); return m ? `${m[1]}-${m[2]}` : ""; };
  const monthByAm = new Map();
  const bumpM = (am, month, key, val) => { if (!am || am === "—" || !month || !val) return; let mm = monthByAm.get(am); if (!mm) { mm = new Map(); monthByAm.set(am, mm); } const e = mm.get(month) || { cas: 0, facture: 0 }; e[key] += val; mm.set(month, e); };
  for (const o of orders || []) bumpM(normAm(o.am), monthOf(o.dateCommande), "cas", Number(o.cas) || 0);
  for (const i of invoices || []) bumpM(normAm(amOfFp[fpKey(i.fp)]), monthOf(i.date), "facture", Number(i.amountHt) || 0);
  const trendOf = (am) => [...(monthByAm.get(am) || new Map()).entries()]
    .map(([month, v]) => ({ month, cas: Math.round(v.cas), facture: Math.round(v.facture) }))
    .sort((a, b) => a.month.localeCompare(b.month)).slice(-12); // 12 derniers mois renseignés

  const rows = [...ams]
    .filter((am) => am && am !== "—")
    .map((am) => {
      const os = (orders || []).filter((o) => normAm(o.am) === am);
      const cas = sum(os, (o) => o.cas);
      const casFy = sum(os.filter((o) => plausibleYear(o.yearPo) === fy), (o) => o.cas);
      const backlog = sum(os, (o) => Math.max(o.raf || 0, 0));
      const facture = sum((invoices || []).filter((i) => normAm(amOfFp[fpKey(i.fp)]) === am), (i) => i.amountHt);

      const myOpps = (opps || []).filter((o) => normAm(o.am) === am);
      const active = myOpps.filter((o) => o.stage >= 1 && o.stage <= 5);
      const won = myOpps.filter((o) => o.stage === 6).length;
      const lost = myOpps.filter((o) => o.stage === 7).length;
      // « Pondéré » = PROJECTION tiérée (défauts 100/20/5, configurables en Habilitations), cohérent avec pipeline/
      // atterrissage : NET du carnet — une opp active dont le FP porte déjà une commande est déjà dans le CAS,
      // l'inclure ici la double-compterait (parité chaine/atterrissage.alreadyBooked). activeCount reste brut.
      const projActive = active.filter((o) => {
        const k = fpKey(o.fp); if (k && bookedFps.has(k)) return false; // déjà au carnet (parité chaine/atterrissage)
        if (excludeDormant && isDormantClosing(o, fy)) return false;      // dormante (parité Cockpit « Tout »)
        return true;
      });
      const pipelinePondere = sum(projActive, pw);

      const ob = objByAm[am.toUpperCase()];
      const targetCas = ob ? ob.targetCas || 0 : 0;
      return {
        am, cas, casFy, backlog, facture,
        pipelinePondere, activeCount: active.length, won, lost,
        conv: won + lost > 0 ? won / (won + lost) : 0,
        targetCas, roCas: targetCas > 0 ? casFy / targetCas : null,
        // Couverture du reste-à-faire (miroir PAR COMMERCIAL de la « Couverture reste-à-faire » du cockpit) :
        // pipeline pondéré / (objectif CAS − réalisé exercice). < 1× = objectif non couvert par le pipe.
        // null si pas d'objectif ou objectif déjà atteint (rien à couvrir).
        couverture: targetCas > casFy ? pipelinePondere / (targetCas - casFy) : null,
        trend: trendOf(am), // 12 derniers mois : CAS booké + facturé (tendance individuelle)
        orderCount: os.length,
      };
    })
    .filter((r) => r.cas > 0 || r.facture > 0 || r.pipelinePondere > 0 || r.activeCount > 0 || r.won + r.lost > 0)
    .sort((a, b) => b.cas - a.cas);

  return { rows, fy: Number(fy) || null };
}

module.exports = { am360 };
