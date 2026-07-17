// Centre d'alertes (BUILD_KIT §2 bonifications) : backlog dormant, marge négative,
// ligne fournisseur saturée, concentration client, BC en attente. Fonction pure.
const { sum } = require("./chaine");
const { groupSum } = require("./backlog");
const { fpKey, plausibleYear } = require("../lib/ids");
// Seuils d'alerte PAR DÉFAUT (source unique domain/thresholds ; surchargés par config/alerts).
const { ALERT_DEFAULTS } = require("./thresholds");

/**
 * @param {object[]} orders
 * @param {object[]} invoices
 * @param {object} suppliersSummary résultat de domain/fournisseurs.suppliers()
 * @param {object[]} bcLines
 * @param {number} fy année fiscale courante
 * @param {string} [asOf] date du jour (YYYY-MM-DD), pour les retards ETA des BC
 * @param {object[]} [opps] opportunités (pour l'alerte « opportunités dormantes »)
 * @param {object} [thr] seuils configurables (config/alerts) : concentration, surfacturationPct, rafEcartPct, dormantYears
 */
function alerts(orders, invoices, suppliersSummary, bcLines, fy, asOf, opps, thr) {
  const out = [];
  opps = opps || [];
  const T = { ...ALERT_DEFAULTS, ...(thr || {}) };

  // `margin: true` = alerte DÉRIVÉE DE LA MARGE : le signe de marge par affaire nommée (refs=FP) est
  // confidentiel → l'agrégation isole ces items dans summaries/alertsMargin (gaté « rentabilite »),
  // jamais dans summaries/alerts (lisible à « overview »).
  const neg = orders.filter((o) => (o.mb || 0) < 0);
  if (neg.length) out.push({ type: "marge_negative", severity: "high", margin: true, count: neg.length, message: `${neg.length} commande(s) à marge négative`, refs: neg.slice(0, 10).map((o) => o.fp) });

  // Achats fournisseurs > vente (Σsuppliers > CAS).
  const achatSup = orders.filter((o) => (o.suppliers || []).reduce((s, x) => s + (x.amount || 0), 0) > (o.cas || 0) && o.cas > 0);
  if (achatSup.length) out.push({ type: "achat_sup_vente", severity: "high", margin: true, count: achatSup.length, message: `${achatSup.length} commande(s) où les achats dépassent la vente`, refs: achatSup.slice(0, 10).map((o) => o.fp) });

  // --- Cohérence financière (identité CAS = Facturé + RAF) ---
  // Σ facturé par FP CANONIQUE (fpKey) : un même FP formaté différemment côté facture/commande
  // (zéros de tête, espaces) doit s'agréger sur la même clé, sinon surfacturation/RAF faussés.
  const invByFp = {};
  for (const i of invoices || []) { const k = fpKey(i.fp); if (k) invByFp[k] = (invByFp[k] || 0) + (i.amountHt || 0); }
  // Non rattachée = FP CANONIQUE de la facture absent des commandes (appartenance FRAÎCHE à orderFps,
  // et non le drapeau `linked` qui pouvait rester périmé à false quand le FP était formaté
  // différemment côté facture/commande → fausses « non rattachées ». Cf. rapport terrain.
  const orderFps = new Set((orders || []).map((o) => fpKey(o.fp)).filter(Boolean));
  const orphan = (invoices || []).filter((i) => { const k = fpKey(i.fp); return !k || !orderFps.has(k); });
  const orphanAmt = orphan.reduce((s, i) => s + (i.amountHt || 0), 0);
  if (orphan.length) out.push({ type: "factures_non_rattachees", severity: "high", count: orphan.length, message: `${orphan.length} facture(s) non rattachées à une commande (${(orphanAmt / 1e9).toFixed(2)} Md)` });

  // Facture rattachée mais antérieure à l'année du PO (anomalie chronologique, cf. enrichLinks.prePo).
  const prePo = (invoices || []).filter((i) => i.prePo);
  if (prePo.length) out.push({ type: "facture_pre_po", severity: "medium", count: prePo.length, message: `${prePo.length} facture(s) antérieure(s) à l'année du PO` });

  const surfac = orders.filter((o) => o.cas > 0 && (invByFp[fpKey(o.fp)] || 0) > o.cas * (1 + T.surfacturationPct));
  if (surfac.length) out.push({ type: "surfacturation", severity: "high", count: surfac.length, message: `${surfac.length} commande(s) surfacturées (Σfactures > CAS)`, refs: surfac.slice(0, 10).map((o) => o.fp) });

  // --- Cohérence AMONT (opportunité ↔ commande) ---
  // Écart de valorisation : le CAS RETENU (écrasé par une opp gagnée / fiche) s'écarte fortement de la valeur
  // P&L d'origine (casPnl, conservé par mergeCommandes). Miroir EXACT du prédicat dataQuality.ecart_valorisation
  // (même population → mêmes comptes, verrouillé par consistencyAlertsDq.test.js).
  const ecartVal = orders.filter((o) => (o.source === "opp_won" || o.source === "fiche") && (o.casPnl || 0) > 0 && (o.cas || 0) > 0 && Math.abs((o.cas || 0) - (o.casPnl || 0)) / Math.max(o.cas || 0, o.casPnl || 0) > T.valorisationEcartPct);
  if (ecartVal.length) out.push({ type: "ecart_valorisation", severity: "medium", count: ecartVal.length, message: `${ecartVal.length} commande(s) dont le CAS retenu s'écarte de >${(T.valorisationEcartPct * 100).toFixed(0)} % de la valeur P&L d'origine`, refs: ecartVal.slice(0, 10).map((o) => o.fp) });

  // Opportunité encore ACTIVE (stage 1-5) sur un FP DÉJÀ au carnet : commande existante → l'opp fait double
  // emploi (exclue du pipeline projeté, jamais signalée). Miroir de dataQuality.opp_active_carnet.
  const activeBooked = opps.filter((o) => { const k = fpKey(o.fp); return o.stage >= 1 && o.stage <= 5 && k && orderFps.has(k); });
  if (activeBooked.length) out.push({ type: "opp_active_carnet", severity: "low", count: activeBooked.length, message: `${activeBooked.length} opportunité(s) active(s) sur un FP déjà au carnet — à requalifier/clôturer`, refs: activeBooked.slice(0, 10).map((o) => o.fp || o.client) });

  const rafIncoh = orders.filter((o) => {
    if (!(o.cas > 0)) return false;
    const attendu = Math.max(o.cas - (invByFp[fpKey(o.fp)] || 0), 0);
    return Math.abs((o.raf || 0) - attendu) > T.rafEcartPct * o.cas;
  });
  if (rafIncoh.length) out.push({ type: "raf_incoherent", severity: "medium", count: rafIncoh.length, message: `${rafIncoh.length} commande(s) où le RAF s'écarte de >${(T.rafEcartPct * 100).toFixed(0)} % de (CAS − Facturé)`, refs: rafIncoh.slice(0, 10).map((o) => o.fp) });

  // Millésime BORNÉ (plausibleYear) : un yearPo aberrant (sentinelle 1900, faute 20226) ne doit ni
  // déclencher un faux « dormant » ni échapper au test — même bornage que l'atterrissage/le sélecteur.
  const dormant = orders.filter((o) => { const py = plausibleYear(o.yearPo); return (o.raf || 0) > 0 && py > 0 && py <= fy - T.dormantYears; });
  if (dormant.length) out.push({ type: "backlog_dormant", severity: "medium", count: dormant.length, message: `${dormant.length} commande(s) ouverte(s) d'un millésime ≤ ${fy - T.dormantYears}`, refs: dormant.slice(0, 10).map((o) => o.fp) });

  // Listes COMPLÈTES (non tronquées au top 50 affiché) : un fournisseur saturé à faible exposition
  // ne doit pas échapper à l'alerte. Repli sur bySupplier si le champ complet est absent (rétro-compat).
  const saturated = suppliersSummary.saturated || (suppliersSummary.bySupplier || []).filter((s) => s.state === "saturation").map((s) => s.name);
  if (saturated.length) out.push({ type: "ligne_saturee", severity: "high", count: saturated.length, message: `${saturated.length} ligne(s) fournisseur en saturation`, refs: saturated.slice(0, 10) });

  const tension = suppliersSummary.tension || (suppliersSummary.bySupplier || []).filter((s) => s.state === "tension").map((s) => s.name);
  if (tension.length) out.push({ type: "ligne_tension", severity: "medium", count: tension.length, message: `${tension.length} ligne(s) fournisseur en tension (util ≥ 90 %)`, refs: tension.slice(0, 10) });

  const casByClient = groupSum(orders, (o) => o.client, (o) => o.cas);
  const totalCas = sum(orders, (o) => o.cas);
  const top = Object.entries(casByClient).sort((a, b) => b[1] - a[1])[0];
  if (top && totalCas > 0 && top[1] / totalCas >= T.concentration)
    out.push({ type: "concentration_client", severity: "medium", count: 1, message: `Concentration : ${top[0]} = ${((top[1] / totalCas) * 100).toFixed(0)} % du CAS`, refs: [top[0]] });

  // Alertes BC = EXÉCUTION : uniquement les lignes issues de l'import BC (source ≠ "fiche"). Les
  // lignes de fiche affaire sont des achats PLANIFIÉS (P&L Projet / FP 360°), jamais du suivi
  // d'exécution — les compter ici surévaluerait l'alerte et contredirait la vue Exécution BC
  // (qui les exclut), rendant le compte de l'alerte ≠ du compte de la vue au drill-through.
  const execBc = (bcLines || []).filter((b) => b.source !== "fiche");
  // Statut ABSENT traité comme « a_emettre » (donc non soldé) — MÊME convention que la vue Exécution BC
  // (operations.tsx : `(r.status || "a_emettre") !== "solde"`). Exiger un statut renseigné sous-comptait
  // ici les lignes importées sans statut mappé → compte de l'alerte ≠ compte du segment « Non soldés ».
  const pending = execBc.filter((b) => (b.status || "a_emettre") !== "solde").length;
  if (pending) out.push({ type: "bc_en_attente", severity: "low", count: pending, message: `${pending} ligne(s) BC non soldée(s)` });

  // BC en retard : ETA (réelle sinon contractuelle) dépassée alors que non encore livré.
  // On EXIGE asOf : sans date réelle, retomber sur la fin d'exercice (fy-12-31) déclarerait en
  // retard quasiment tous les BC ouverts de l'année (faux positifs massifs en début/milieu d'année).
  const DELIVERED = new Set(["livre", "facture", "solde"]);
  const lateBc = asOf ? execBc.filter((b) => {
    const eta = b.etaReel || b.etaContrat;
    return eta && String(eta).slice(0, 10) < asOf && !DELIVERED.has(b.status);
  }) : [];
  if (lateBc.length) out.push({ type: "bc_en_retard", severity: "high", count: lateBc.length, message: `${lateBc.length} BC en retard (ETA dépassée, non livré)`, refs: lateBc.slice(0, 10).map((b) => b.bcNumber || b.supplier || b.fp) });

  // Opportunités DORMANTES : encore actives (stage 1-5) mais dont la D Prev est déjà dépassée →
  // prévision faussée, à requalifier/reprogrammer. Ancienneté = jours écoulés depuis la D Prev.
  if (asOf) {
    const dormantOpps = opps.filter((o) => o.stage >= 1 && o.stage <= 5 && o.closingDate && String(o.closingDate).slice(0, 10) < asOf);
    if (dormantOpps.length) {
      const oldest = dormantOpps.reduce((mx, o) => Math.max(mx, Math.floor((Date.parse(asOf) - Date.parse(String(o.closingDate).slice(0, 10))) / 86400000)), 0);
      out.push({ type: "opp_dormante", severity: "medium", count: dormantOpps.length, message: `${dormantOpps.length} opportunité(s) active(s) à D Prev dépassée (la plus ancienne de ${oldest} j) — à requalifier`, refs: dormantOpps.slice(0, 10).map((o) => o.fp || o.client) });
    }
  }

  return out;
}

module.exports = { alerts, ALERT_DEFAULTS };
