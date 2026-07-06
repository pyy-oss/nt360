// Moteur d'ACTUALITÉ (module PUR, testable) : à partir des agrégats déjà calculés (atterrissage,
// pipeline, backlog, facturation/créances, fournisseurs, BC, qualité), détecte les ÉVÉNEMENTS CLÉS
// et produit un fil de BULLETINS priorisés + des RECOMMANDATIONS majeures. Aide à la décision :
// performance, anticipation du risque, correction de trajectoire.
//
// Fondé sur l'ÉTAT courant (seuils sur agrégats) — pas de détection de changement (v1). AUCUNE donnée
// marge (revenu/pipeline/backlog uniquement) → lisible au niveau « overview », sans fuite.
//
// Bulletin : { id, domain, severity 'high'|'medium'|'info', title, detail, refs[], module?, segment?, action? }
// domain ∈ commandes | facturation | pipeline | backlog | fournisseurs | bc | qualite

const PCT = (n, d) => (d > 0 ? n / d : 0);
const num = (v) => (Number.isFinite(v) ? v : 0);

// Seuils par défaut (surchageables via `thr`, ex. config/alerts).
const DEFAULT_THR = {
  ecartObjectifPct: 0.05,      // écart négatif significatif si > 5 % de l'objectif
  coverageMin: 1,              // couverture pipeline de l'écart-à-l'objectif
  convFaible: 0.25,            // taux de conversion faible
  concentrationAm: 0.5,        // un AM > 50 % du pipeline pondéré = concentration
  suspenduPct: 0.3,            // pipeline suspendu > 30 % du brut
  deriveBacklogPct: 0.5,       // > 50 % du backlog dérivé (CAS−facturé) = fiabilité à revoir
  reportN1Pct: 0.3,            // report N+1 > 30 % du backlog projetable
  dsoEleve: 90,                // DSO (jours) élevé
  overdueArPct: 0.25,          // créances échues > 25 % de l'AR total
  factRetardTol: 0.15,         // facturation en retard si réalisé < plan échu × (1 − tol)
  qualiteMin: 0.85,            // score qualité de données plancher
  concentrationClient: 0.4,    // un client > 40 % du backlog = concentration
  dormantBacklogPct: 0.15,     // > 15 % du backlog sur des millésimes anciens = dormant
  clientErrors24h: 5,          // ≥ N erreurs JS clientes sur 24 h = régression à investiguer
};

function pushIf(list, cond, b) { if (cond) list.push(b); }

/**
 * @param {object} x { att, pipeline, backlog, receivables, suppliers, billingTrend, dataQuality,
 *                      opps, bcLines, milestonesByFp, fy, asOf, thr }
 * @returns {{ generatedFor:number, bulletins:object[], recommendations:object[], counts:object }}
 */
function buildNews(x) {
  const thr = { ...DEFAULT_THR, ...(x.thr || {}) };
  const att = x.att || {};
  const pl = x.pipeline || {};
  const bk = x.backlog || {};
  const rec = x.receivables || {};
  const sup = x.suppliers || {};
  const trend = x.billingTrend || {};
  const dq = x.dataQuality || {};
  const opps = x.opps || [];
  const bcLines = x.bcLines || [];
  const fy = x.fy;
  const B = [];

  // — COMMANDES / ATTERRISSAGE —
  const objCas = num(att.objectif);
  pushIf(B, objCas > 0 && num(att.ecart) < -thr.ecartObjectifPct * objCas, {
    id: "cas_sous_objectif", domain: "commandes", severity: "high", module: "prevision",
    title: "Atterrissage CAS sous l'objectif",
    detail: `Projeté ${fmt(att.projete)} vs objectif ${fmt(objCas)} — écart ${fmt(att.ecart)} (${pctTxt(PCT(att.projete, objCas))} de l'objectif).`,
    action: "Prioriser les affaires du pipeline qui comblent l'écart à l'objectif CAS.",
  });
  // Objectif annuel non défini : l'atterrissage ne peut être mesuré contre une cible.
  pushIf(B, !(objCas > 0) && num(att.projete) > 0, {
    id: "objectif_absent", domain: "commandes", severity: "info", module: "objectifs",
    title: "Objectif annuel CAS non défini",
    detail: `Aucun objectif CAS pour l'exercice ${fy || ""} — l'atterrissage (${fmt(att.projete)} projeté) ne peut pas être mesuré contre une cible.`,
    action: "Définir l'objectif annuel de CAS (écran Objectifs).",
  });
  // Opportunités GAGNÉES non transformées en commande (sans N° FP ou sans ligne P&L) : CAS/backlog
  // absents. Désormais corrigeable en 1 clic (corriger l'opp / inscrire au P&L).
  const wonNoFp = (dq.issues || []).find((i) => i.type === "opps_gagnees_sans_fp");
  const wonNoPnl = (dq.issues || []).find((i) => i.type === "opps_gagnees_sans_pnl");
  const reconCount = num(wonNoFp && wonNoFp.count) + num(wonNoPnl && wonNoPnl.count);
  pushIf(B, reconCount > 0, {
    id: "opps_a_reconcilier", domain: "commandes", severity: "high",
    module: wonNoFp && wonNoFp.count ? "opplist" : "orderlist",
    title: `${reconCount} affaire(s) gagnée(s) à transformer en commande`,
    detail: "Des opportunités gagnées n'ont pas de N° FP ou de ligne P&L — leur CAS et leur backlog n'existent pas encore.",
    action: "Corriger le N° FP de l'opp (Pipeline) ou l'inscrire au P&L (Commandes).",
    refs: [...((wonNoFp && wonNoFp.refs) || []), ...((wonNoPnl && wonNoPnl.refs) || [])].slice(0, 8),
  });
  const objCaf = num(att.objectifCaf);
  pushIf(B, objCaf > 0 && num(att.ecartCaf) < -thr.ecartObjectifPct * objCaf, {
    id: "caf_sous_objectif", domain: "facturation", severity: "high", module: "prevision",
    title: "Atterrissage CAF (facturation) sous l'objectif",
    detail: `Projeté ${fmt(att.cafProjete)} vs objectif ${fmt(objCaf)} — écart ${fmt(att.ecartCaf)}.`,
    action: "Accélérer la facturation du backlog et sécuriser le pipeline facturable.",
  });
  pushIf(B, num(att.factureN1) > 0 && num(att.croissanceFacture) < 0, {
    id: "facturation_recul", domain: "facturation", severity: "medium", module: "prevision",
    title: "Facturation en recul vs N-1",
    detail: `Facturé ${fmt(att.factureN)} vs ${fmt(att.factureN1)} l'an dernier (${pctTxt(att.croissanceFacture)}).`,
  });

  // — PIPELINE —
  const gap = Math.max(objCas - num(att.realiseCas), 0);
  const weighted = num(pl.tot && pl.tot.weighted);
  const coverage = gap > 0 ? weighted / gap : null;
  pushIf(B, objCas > 0 && gap > 0 && coverage != null && coverage < thr.coverageMin, {
    id: "pipeline_couverture", domain: "pipeline", severity: "high", module: "pipeline",
    title: "Pipeline insuffisant pour couvrir l'écart à l'objectif",
    detail: `Le pipeline pondéré (${fmt(weighted)}) ne couvre que ${Number(coverage || 0).toFixed(2)}× l'écart restant (${fmt(gap)}).`,
    action: "Renforcer la génération d'opportunités ou requalifier le pipeline existant.",
  });
  const closing = pl.closing || {};
  pushIf(B, num(closing.staleCount) > 0, {
    id: "closing_retard", domain: "pipeline", severity: "medium", module: "pipeline",
    title: `${closing.staleCount} opportunité(s) en retard de closing`,
    detail: `${fmt(closing.staleBrut)} de pipeline dont la date de clôture prévue est dépassée${closing.avgOverdueDays ? ` (~${closing.avgOverdueDays} j de retard moyen)` : ""}.`,
    action: "Requalifier ou re-dater les opportunités en retard (ou passer en perdu).",
  });
  const byAm = pl.byAM || {};
  // « AUTRE » = seau des opps sans AM (groupSum) : ce n'est pas un commercial → exclu du candidat de
  // concentration (sinon fausse alerte de dépendance attribuée à « AUTRE »). Dénominateur inchangé.
  const amTop = Object.entries(byAm).filter(([k]) => k && k !== "AUTRE").sort((a, b) => num(b[1]) - num(a[1]))[0];
  const amTotal = Object.values(byAm).reduce((s, v) => s + num(v), 0);
  pushIf(B, amTop && amTotal > 0 && PCT(amTop[1], amTotal) > thr.concentrationAm, {
    id: "pipeline_concentration", domain: "pipeline", severity: "medium", module: "am360",
    title: "Pipeline concentré sur un commercial",
    detail: `${amTop && amTop[0]} porte ${pctTxt(PCT(amTop ? amTop[1] : 0, amTotal))} du pipeline pondéré — risque de dépendance.`,
    refs: amTop ? [amTop[0]] : [],
  });
  pushIf(B, num(pl.conv) > 0 && num(pl.conv) < thr.convFaible, {
    id: "conversion_faible", domain: "pipeline", severity: "medium", module: "pipeline",
    title: "Taux de conversion faible",
    detail: `Conversion vente ${pctTxt(pl.conv)} — sous le seuil de vigilance (${pctTxt(thr.convFaible)}).`,
  });
  const brut = num(pl.tot && pl.tot.brut), susp = num(pl.susp && pl.susp.brut);
  pushIf(B, brut > 0 && PCT(susp, brut) > thr.suspenduPct, {
    id: "pipeline_suspendu", domain: "pipeline", severity: "info", module: "pipeline",
    title: "Part importante de pipeline suspendu",
    detail: `${fmt(susp)} suspendu, soit ${pctTxt(PCT(susp, brut))} du pipeline actif — à réactiver ou clôturer.`,
  });
  // Événement positif : plus grosse opportunité active (montant).
  const topOpp = [...opps].filter((o) => (o.stage || 0) >= 1 && (o.stage || 0) <= 5).sort((a, b) => num(b.amount) - num(a.amount))[0];
  pushIf(B, topOpp && num(topOpp.amount) > 0, {
    id: "top_opportunite", domain: "pipeline", severity: "info", module: "opplist",
    title: "Opportunité majeure en cours",
    detail: `${topOpp ? (topOpp.client || "—") : ""} — ${fmt(topOpp && topOpp.amount)}${topOpp && topOpp.closingDate ? ` · closing ${topOpp.closingDate}` : ""}.`,
    refs: topOpp && topOpp.fp ? [topOpp.fp] : [],
  });

  // — BACKLOG —
  const bkTotal = num(bk.total), bkDerive = num(bk.totalDerive);
  pushIf(B, bkTotal > 0 && PCT(bkDerive, bkTotal) > thr.deriveBacklogPct, {
    id: "backlog_derive", domain: "backlog", severity: "medium", module: "backlog",
    title: "Backlog majoritairement dérivé (fiabilité à revoir)",
    detail: `${pctTxt(PCT(bkDerive, bkTotal))} du backlog est dérivé (CAS − facturé), non curaté — potentiellement surévalué.`,
    action: "Fiabiliser le RAF des commandes dérivées (soldes, rattachements de factures).",
  });
  const projetable = num(att.backlogProjete) + num(att.reporteCaf);
  pushIf(B, projetable > 0 && PCT(att.reporteCaf, projetable) > thr.reportN1Pct, {
    id: "report_n1_eleve", domain: "backlog", severity: "info", module: "backlog",
    title: "Part importante reportée sur N+1",
    detail: `${fmt(att.reporteCaf)} de CA reporté sur l'exercice suivant, soit ${pctTxt(PCT(att.reporteCaf, projetable))} du backlog projetable.`,
  });
  // Concentration client du backlog : un client pèse une part majeure → risque de dépendance.
  const byClient = bk.byClient || {};
  // « AUTRE » = commandes sans client → exclu du candidat de concentration (pas un vrai client).
  const clTop = Object.entries(byClient).filter(([k]) => k && k !== "AUTRE").sort((a, b) => num(b[1]) - num(a[1]))[0];
  const clTotal = Object.values(byClient).reduce((s, v) => s + num(v), 0);
  pushIf(B, clTop && clTotal > 0 && PCT(num(clTop[1]), clTotal) > thr.concentrationClient, {
    id: "backlog_concentration_client", domain: "backlog", severity: "medium", module: "overview",
    title: "Backlog concentré sur un client",
    detail: `${clTop ? clTop[0] : ""} représente ${pctTxt(PCT(clTop ? num(clTop[1]) : 0, clTotal))} du backlog (${fmt(clTop ? clTop[1] : 0)}) — risque de dépendance commerciale.`,
    refs: clTop ? [clTop[0]] : [],
    action: "Diversifier le carnet : sécuriser d'autres comptes pour réduire la dépendance.",
  });
  // Backlog dormant : RAF porté par des commandes de millésimes anciens (≤ exercice − 2).
  const byVintage = bk.byVintage || {};
  const dormant = Object.entries(byVintage)
    .filter(([y]) => Number(y) > 0 && Number(y) <= (Number(fy) || 0) - 2)
    .reduce((s, [, v]) => s + num(v), 0);
  pushIf(B, bkTotal > 0 && dormant > 0 && PCT(dormant, bkTotal) > thr.dormantBacklogPct, {
    id: "backlog_dormant", domain: "backlog", severity: "medium", module: "backlog",
    title: "Backlog dormant (millésimes anciens)",
    detail: `${fmt(dormant)} de backlog sur des commandes d'un millésime ≤ ${(Number(fy) || 0) - 2} — soit ${pctTxt(PCT(dormant, bkTotal))} du carnet, à solder ou clôturer.`,
    action: "Revoir les commandes anciennes : soldées ? factures manquantes ? à clôturer ?",
  });

  // Retard de LIVRAISON (synchro ClickUp) : date contractuelle dépassée, projet encore actif. Distinct
  // du retard de FACTURATION — c'est un retard d'EXÉCUTION projet.
  const cuOverdue = num(x.clickupOverdue);
  pushIf(B, cuOverdue > 0, {
    id: "livraison_retard", domain: "backlog", severity: "high", module: "orderlist",
    title: `${cuOverdue} projet(s) en retard de livraison`,
    detail: "Des commandes ont dépassé leur date contractuelle (ClickUp) sans être livrées ni clôturées.",
    action: "Traiter les projets en retard de livraison : re-planifier ou solder (Commandes / ClickUp).",
    refs: (x.clickupOverdueRefs || []).slice(0, 8),
  });

  // Retard d'ACHAT fournisseur (synchro ClickUp BC) : ETA de livraison dépassée, BC non livré ni annulé.
  // Distinct du retard projet ci-dessus — c'est un retard côté APPROVISIONNEMENT (bon de commande).
  const bcOverdue = num(x.bcClickupOverdue);
  pushIf(B, bcOverdue > 0, {
    id: "bc_achat_retard", domain: "suppliers", severity: "high", module: "operations",
    title: `${bcOverdue} bon(s) de commande en retard de livraison`,
    detail: "Des BC ont dépassé leur ETA (ClickUp) sans être livrés ni annulés — risque sur les délais projet.",
    action: "Relancer les fournisseurs / distributeurs concernés (Exécution BC / ClickUp).",
    refs: (x.bcClickupOverdueRefs || []).slice(0, 8),
  });

  // Projets BLOQUÉS / priorité URGENTE (synchro ClickUp) : à débloquer ou traiter en priorité. Signal
  // d'exécution remonté des tâches (tag « bloqué » ou priorité urgente).
  const cuBlocked = num(x.clickupBlocked);
  pushIf(B, cuBlocked > 0, {
    id: "projet_bloque", domain: "backlog", severity: "high", module: "orderlist",
    title: `${cuBlocked} projet(s) bloqué(s) ou en priorité urgente`,
    detail: "Des tâches ClickUp liées sont marquées bloquées ou en priorité urgente — risque d'exécution.",
    action: "Lever les blocages / arbitrer les priorités avec les PM (Commandes / ClickUp).",
    refs: (x.clickupBlockedRefs || []).slice(0, 8),
  });

  // — FACTURATION / CASH —
  const realiseYtd = num(trend.realiseYtd);
  const curMonth = String(x.asOf || "").slice(0, 7);
  const planEchu = (trend.months || []).filter((m) => m.month <= curMonth).reduce((s, m) => s + num(m.planifie), 0);
  pushIf(B, planEchu > 0 && realiseYtd < planEchu * (1 - thr.factRetardTol), {
    id: "facturation_retard_plan", domain: "facturation", severity: "high", module: "prevision",
    title: "Facturation en retard sur le plan (jalons)",
    detail: `Facturé à date ${fmt(realiseYtd)} vs plan échu ${fmt(planEchu)} — retard de ${fmt(planEchu - realiseYtd)}.`,
    action: "Relancer la facturation des jalons échus non facturés.",
  });
  pushIf(B, num(trend.projeteDec) > 0 && objCaf > 0 && num(trend.projeteDec) < objCaf * (1 - thr.ecartObjectifPct), {
    id: "trajectoire_dec_sous_objectif", domain: "facturation", severity: "medium", module: "prevision",
    title: "Trajectoire de facturation au 31/12 sous l'objectif",
    detail: `Projeté au 31/12 ${fmt(trend.projeteDec)} vs objectif CAF ${fmt(objCaf)}.`,
  });
  const totalAR = num(rec.totalAR), overdue = num(rec.overdue);
  pushIf(B, totalAR > 0 && PCT(overdue, totalAR) > thr.overdueArPct, {
    id: "creances_echues", domain: "facturation", severity: "high", module: "invoicelist",
    title: "Créances échues élevées",
    detail: `${fmt(overdue)} échu (${rec.overdueCount || 0} facture(s)), soit ${pctTxt(PCT(overdue, totalAR))} de l'encours client.`,
    action: "Lancer les relances sur les créances les plus anciennes.",
  });
  pushIf(B, num(rec.dso) > thr.dsoEleve, {
    id: "dso_eleve", domain: "facturation", severity: "medium", module: "invoicelist",
    title: "DSO élevé",
    detail: `Délai moyen d'encaissement ${Math.round(num(rec.dso))} j — au-dessus du seuil (${thr.dsoEleve} j).`,
  });
  // Factures non rattachées (depuis la qualité de données).
  const orphan = (dq.issues || []).find((i) => i.type === "factures_orphelines");
  pushIf(B, orphan && num(orphan.count) > 0, {
    id: "factures_orphelines", domain: "facturation", severity: "medium", module: "invoicelist", segment: "orphan",
    title: `${orphan && orphan.count} facture(s) non rattachée(s)`,
    detail: "Des factures ne sont rattachées à aucune commande (N° FP) — CAF et taux de facturation faussés.",
    action: "Rattacher les factures orphelines à leur commande.",
    refs: (orphan && orphan.refs || []).slice(0, 8),
  });

  // — FOURNISSEURS / BC —
  // Liste COMPLÈTE des fournisseurs saturés (noms) — `sup.saturated` n'est pas tronqué, contrairement
  // à `sup.bySupplier` (top 50 par exposition) qui manquerait les saturations à faible exposition.
  const saturated = sup.saturated || [];
  pushIf(B, saturated.length > 0, {
    id: "fournisseur_sature", domain: "fournisseurs", severity: "medium", module: "fournisseurs",
    title: `${saturated.length} fournisseur(s) en saturation de crédit`,
    detail: "L'encours atteint ou dépasse la ligne de crédit autorisée — risque de blocage d'approvisionnement.",
    refs: saturated.slice(0, 8),
    action: "Renégocier la ligne de crédit ou solder les encours des fournisseurs saturés.",
  });
  const today = String(x.asOf || "").slice(0, 10);
  const delivered = new Set(["livre", "facture", "solde"]);
  const lateBc = bcLines.filter((r) => { const eta = r.etaReel || r.etaContrat; return r.source !== "fiche" && eta && String(eta).slice(0, 10) < today && !delivered.has(r.status || "a_emettre"); });
  pushIf(B, lateBc.length > 0, {
    id: "bc_en_retard", domain: "bc", severity: "medium", module: "bc", segment: "late",
    title: `${lateBc.length} bon(s) de commande en retard`,
    detail: "Des BC ont une ETA dépassée sans livraison — impact sur l'exécution et les délais projet.",
    action: "Relancer les fournisseurs sur les BC en retard de livraison.",
  });

  // — QUALITÉ —
  pushIf(B, dq.score != null && num(dq.score) < thr.qualiteMin, {
    id: "qualite_donnees", domain: "qualite", severity: "medium", module: "dataquality",
    title: "Qualité des données dégradée",
    detail: `Score de complétude ${pctTxt(dq.score)} — sous le plancher (${pctTxt(thr.qualiteMin)}). Fiabilise les imports.`,
    action: "Corriger les anomalies du cockpit Qualité des données puis ré-importer.",
  });

  // — TECHNIQUE : pic d'erreurs client (crash de rendu / rejets non gérés) sur 24 h. Un pic signale
  // une régression front à investiguer (le journal détaillé est en Habilitations). Sans ce déclencheur,
  // un crash n'était visible que par hasard.
  const errs24h = num(x.clientErrors24h);
  pushIf(B, errs24h >= thr.clientErrors24h, {
    id: "pic_erreurs_client", domain: "qualite", severity: "high", module: "habilitations",
    title: `${errs24h} erreur(s) applicative(s) sur 24 h`,
    detail: `Des erreurs JavaScript non gérées / crashs de rendu ont été remontés par les navigateurs sur les dernières 24 h (seuil ${thr.clientErrors24h}). Signale une régression à investiguer.`,
    action: "Ouvrir « Erreurs client récentes » (Habilitations) pour identifier le message et le module en cause.",
  });

  // Tri : sévérité (high > medium > info) puis ordre d'insertion.
  const rank = { high: 0, medium: 1, info: 2 };
  B.sort((a, b) => rank[a.severity] - rank[b.severity]);

  // Recommandations = actions des bulletins high/medium actionnables, dans l'ordre de priorité (max 5).
  const recommendations = B.filter((b) => b.action && b.severity !== "info").slice(0, 5)
    .map((b, i) => ({ priority: i + 1, text: b.action, domain: b.domain, module: b.module, severity: b.severity }));

  const counts = { high: B.filter((b) => b.severity === "high").length, medium: B.filter((b) => b.severity === "medium").length, info: B.filter((b) => b.severity === "info").length };
  return { generatedFor: Number(fy) || fy, bulletins: B, recommendations, counts };
}

// Formatage local (le back n'importe pas les helpers front). Compact FCFA.
function fmt(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n === 0) return "0";
  const a = Math.abs(n);
  if (a >= 1e9) return (n / 1e9).toFixed(2) + " Md";
  if (a >= 1e6) return (n / 1e6).toFixed(1) + " M";
  if (a >= 1e3) return (n / 1e3).toFixed(0) + " k";
  return String(Math.round(n));
}
function pctTxt(v) { const n = Number(v); return Number.isFinite(n) ? (n * 100).toFixed(0) + " %" : "—"; }

module.exports = { buildNews, DEFAULT_THR };
