// Agrégation → documents summaries/* (BUILD_KIT §6, §10).
// Lit les collections sources, calcule via domain/*, écrit les agrégats (écriture
// interdite au client par les rules). Le front s'abonne en temps réel (onSnapshot).
const { FieldValue } = require("firebase-admin/firestore");
const { overview } = require("../domain/chaine");
const { normalizeTiers } = require("../domain/projection");
const { billingTrend } = require("../domain/billing");
const { backlogFy } = require("../domain/backlog");
const { pipeline } = require("../domain/pipeline");
const { suppliers } = require("../domain/fournisseurs");
const { facturation, rentabilite, byEntity } = require("../domain/reporting");
const { atterrissage, projetableBacklog } = require("../domain/atterrissage");
const { defaultMilestones } = require("../domain/milestones");
const { buildNews } = require("../domain/news");
const { alerts } = require("../domain/alerts");
const { receivables } = require("../domain/receivables");
const { cashflow, decaissements } = require("../domain/cashflow");
const { cashScenario } = require("../domain/cashScenario");
const { am360 } = require("../domain/am360");
const { dataQuality } = require("../domain/dataQuality");
const { relances } = require("../domain/relances");
const { mergeCommandes } = require("../domain/commandes");
const { enrichBu, enrichLinks } = require("./enrich");
const { fpKey, plausibleYear, num } = require("./ids");
const { safeId } = require("./sheets");

// Coercition numérique DÉFENSIVE : un import brut peut stocker un montant en CHAÎNE ("1 000 000",
// "(1 000)", "12,5") ou une valeur non finie. Laissé tel quel, il propage NaN dans les agrégats —
// que l'émulateur tolère mais que PRODUCTION Firestore REFUSE (l'écriture échoue en « internal »).
// On ne touche QUE les champs PRÉSENTS et non déjà numériques finis (les absents restent absents,
// pour ne pas changer la sémantique d'un `!= null`).
function coerceNums(rows, keys) {
  for (const r of rows) {
    if (!r) continue;
    for (const k of keys) {
      const v = r[k];
      if (v != null && (typeof v !== "number" || !Number.isFinite(v))) r[k] = num(v);
    }
  }
}

// Filet de sécurité à l'ÉCRITURE : remplace tout nombre non fini (NaN/±Infinity) par 0 et retire les
// undefined, en PRÉSERVANT les sentinelles FieldValue (serverTimestamp/delete). Garantit qu'aucun
// agrégat ne peut faire échouer le recompute en production, quelle que soit la saleté des sources.
function sanitizeForFirestore(v) {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (Array.isArray(v)) return v.map(sanitizeForFirestore);
  if (v && typeof v === "object") {
    if (v.constructor && v.constructor.name !== "Object") return v; // FieldValue & co. → intacts
    const o = {};
    for (const k of Object.keys(v)) { const s = sanitizeForFirestore(v[k]); if (s !== undefined) o[k] = s; }
    return o;
  }
  return v; // string / boolean / null / undefined
}

async function readAll(db, name, withId = false) {
  const snap = await db.collection(name).get();
  return snap.docs.map((d) => (withId ? { id: d.id, ...d.data() } : d.data()));
}

const filterInvoices = (invoices, period) =>
  period === "all" ? invoices : invoices.filter((i) => i.date && String(i.date).slice(0, 4) === String(period));

/**
 * Recalcule tous les agrégats impactés et les écrit dans summaries/*.
 * @param {FirebaseFirestore.Firestore} db
 * @param {string[]} [only] sous-ensemble d'agrégats (optionnel, sinon tout)
 */
// Migration RBAC de la matrice opposable (config/permissions), SANS jamais restreindre un accès.
//  • Module « import » (importDelta/setInvoiceFp/patchOrder → requireWrite('import')) : ajouté UNIQUEMENT
//    s'il est absent pour un rôle (write pour les rôles d'import historiques, none sinon).
//  • pmo/backlog : setBillingMilestones passe sous requireWrite('backlog') ; pmo éditait déjà les jalons
//    → on PRÉSERVE cette capacité en montant son niveau backlog `read`→`write`. On RESPECTE un `none`
//    explicite (choix d'admin de masquer le backlog à pmo) — on ne remonte que depuis `read`.
// Jamais d'écrasement d'un choix restrictif ; idempotent (no-op une fois posé).
const IMPORT_CAPABLE = ["direction", "commercial_dir", "pmo", "achats"];
async function ensureImportPermission(db) {
  const ref = db.doc("config/permissions");
  const matrix = ((await ref.get()).data() || {}).matrix;
  if (!matrix || typeof matrix !== "object") return;
  const patch = {};
  for (const [role, row] of Object.entries(matrix)) {
    if (row && typeof row === "object" && !("import" in row)) {
      patch[`matrix.${role}.import`] = IMPORT_CAPABLE.includes(role) ? "write" : "none";
    }
  }
  // Préservation de la capacité d'édition des jalons pour pmo (read→write uniquement).
  if (matrix.pmo && typeof matrix.pmo === "object" && matrix.pmo.backlog === "read") {
    patch["matrix.pmo.backlog"] = "write";
  }
  if (Object.keys(patch).length) await ref.update(patch);
}

async function recomputeAll(db, only) {
  try { await ensureImportPermission(db); } catch (e) { /* migration best-effort, ne bloque pas le recompute */ }
  // Recompute PARTIEL : orders/invoices/opps/projectSheets alimentent toujours mergeCommandes ;
  // bcLines/creditLines/objectives ne sont lus QUE si un summary demandé en a besoin. Un recompute
  // ciblé (ex. après un changement de statut BC → ["suppliers","alerts"]) évite ainsi des lectures.
  const need = (keys) => !only || keys.some((k) => only.includes(k));
  // NB : ces ensembles DOIVENT couvrir tous les summaries qui utilisent la collection — y compris
  // les co-déclenchements (cashflow s'écrit aussi sur want("facturation") ; ams sur want("pipeline")).
  const needBc = need(["suppliers", "cashflow", "alerts", "dataQuality", "facturation", "relances"]);
  const needCredit = need(["suppliers", "alerts"]);
  const needObj = need(["atterrissage", "ams", "pipeline"]);
  const [pnlOrders, invoices, oppsRaw, bcLines, creditLines, objectives, sheetsBase, sheetsMargin] = await Promise.all([
    readAll(db, "orders"),
    readAll(db, "invoices", true), // id nécessaire pour l'exclusion des factures annulées (overlay)
    readAll(db, "opportunities"),
    needBc ? readAll(db, "bcLines") : Promise.resolve([]),
    needCredit ? readAll(db, "creditLines", true) : Promise.resolve([]),
    needObj ? readAll(db, "objectives") : Promise.resolve([]),
    readAll(db, "projectSheets"),
    readAll(db, "projectSheetsMargin"), // marge isolée (rules) — le serveur (Admin SDK) la re-fusionne
  ]);
  // Coercition numérique des champs monétaires/quantitatifs (contre les montants en chaîne des
  // imports bruts) — AVANT tout calcul, pour ne pas propager de NaN dans les agrégats.
  coerceNums(pnlOrders, ["cas", "raf", "mb", "facture", "costTotal", "marginPct", "yearPo"]);
  for (const o of pnlOrders) if (Array.isArray(o.suppliers)) for (const s of o.suppliers) { if (s && s.amount != null && (typeof s.amount !== "number" || !Number.isFinite(s.amount))) s.amount = num(s.amount); }
  coerceNums(invoices, ["amountHt"]);
  coerceNums(oppsRaw, ["amount", "probability", "weighted", "stage"]);
  coerceNums(bcLines, ["amountXof", "amount"]);
  coerceNums(sheetsBase, ["cas", "raf", "costTotal", "saleTotal", "margin", "marginPct"]);
  coerceNums(sheetsMargin, ["costTotal", "saleTotal", "margin", "marginPct"]);
  coerceNums(objectives, ["targetCas", "targetInvoiced", "targetMargin", "targetMarginPct", "fiscalYear"]);
  coerceNums(creditLines, ["authorized", "openingBalance", "outstanding"]);

  // NORMALISATION des noms de clients (règles déterministes + table d'alias config/clientAliases),
  // appliquée EN MÉMOIRE avant tout calcul : tous les regroupements (byClient, concentration,
  // EntityView, atterrissage) utilisent le nom CANONIQUE. NON DESTRUCTIF — les documents bruts
  // conservent leur nom d'origine ; seul le recompute canonise.
  const { buildClientResolver } = require("../domain/clientName");
  const aliasPairs = ((await db.doc("config/clientAliases").get()).data() || {}).pairs || [];
  const normClient = buildClientResolver(aliasPairs);
  for (const rows of [pnlOrders, invoices, oppsRaw, sheetsBase]) {
    for (const r of rows) if (r && r.client != null && r.client !== "") r.client = normClient(r.client);
  }
  for (const b of bcLines) if (b && b.customer != null && b.customer !== "") b.customer = normClient(b.customer);

  // OVERLAY D'ANNULATION (statut « Annulée » persistant, hors delta) : les commandes/factures dont
  // l'id figure ici sont EXCLUES de tous les agrégats (carnet, CAS, backlog, facturation, cash,
  // rentabilité, qualité). Stocké en overlay config/cancellations (et non sur le doc) → l'exclusion
  // SURVIT à un ré-import delta. Les docs sources restent (historique) ; seul le recompute les écarte.
  const [cxlO, cxlI] = await Promise.all([db.doc("config/cancelOrders").get(), db.doc("config/cancelInvoices").get()]);
  const itemsOf = (snap) => { const v = (snap.data() || {}).items; return new Set((Array.isArray(v) ? v : []).map((e) => e && e.id).filter(Boolean)); };
  const cancelledOrders = itemsOf(cxlO);
  const cancelledInvoices = itemsOf(cxlI);
  // AFFECTATION PMO (Project Manager par commande) : overlay config/orderPm { map: { <safeId(fp)>: pm } },
  // stocké hors des docs commandes → SURVIT au recompute et à un ré-import delta (comme l'annulation).
  const orderPmMap = ((await db.doc("config/orderPm").get()).data() || {}).map || {};
  // SYNCHRO INVERSE ClickUp : overlay config/clickupSync { map: { <safeId(fp)>: { status, dateCommande,
  // dateContractuelle, dateFinPrev } } } — statut projet + dates remontés de ClickUp, hors docs commandes
  // → SURVIT au recompute (comme l'affectation PMO). Fusionné dans les rows commandes ci-dessous.
  const clickupSyncMap = ((await db.doc("config/clickupSync").get()).data() || {}).map || {};
  // Lien FP↔tâche ClickUp (config/clickupLinks) → expose clickupTaskId sur les rows pour le badge « lié ↗ ».
  const clickupLinksMap = ((await db.doc("config/clickupLinks").get()).data() || {}).map || {};
  // SYNCHRO INVERSE BC ClickUp : overlay config/clickupBcSync { map: { <safeId(N°BC)>: { status,
  // statusRaw, eta, taskId } } } — avancement achat + ETA remontés de la liste « Commandes
  // Fournisseurs ». ADDITIF : n'écrase JAMAIS le statut financier SOA des lignes BC (a_emettre… solde),
  // seulement des champs clickupBc* parallèles. Fusionné sur les lignes bcLines ci-dessous.
  const clickupBcSyncMap = ((await db.doc("config/clickupBcSync").get()).data() || {}).map || {};
  const clickupBcLinksMap = ((await db.doc("config/clickupBcLinks").get()).data() || {}).map || {};
  for (const b of bcLines) {
    const k = safeId(String(b.bcNumber || "").trim());
    if (!k) continue;
    const cu = clickupBcSyncMap[k];
    if (cu) { b.clickupBcStatus = cu.status || null; b.clickupBcStatusRaw = cu.statusRaw || null; b.clickupBcEta = cu.eta || null; }
    if (clickupBcLinksMap[k]) b.clickupBcTaskId = clickupBcLinksMap[k];
  }
  // Factures annulées : écartées AVANT la fusion (n'alimentent pas le facturé d'une commande).
  for (let i = invoices.length - 1; i >= 0; i--) if (cancelledInvoices.has(invoices[i].id)) invoices.splice(i, 1);

  // Fiches complètes reconstituées pour les calculs serveur (mergeCommandes, dataQuality).
  const smBy = new Map(sheetsMargin.map((m) => [m._id, m]));
  const projectSheets = sheetsBase.map((s) => ({ ...s, ...(smBy.get(s._id) || {}) }));

  // Dédup inter-source : une affaire SAISIE manuellement (source 'saisie') puis ré-importée en LIVE
  // (source 'salesData', avec FP) existerait en double → double compte du pipeline. Quand un FP est
  // couvert par une opp 'salesData', on écarte la/les opps 'saisie' de MÊME FP (la version importée fait foi).
  const salesFps = new Set(oppsRaw.filter((o) => o.source === "salesData" && fpKey(o.fp)).map((o) => fpKey(o.fp)));
  const opps = oppsRaw.filter((o) => !(o.source === "saisie" && fpKey(o.fp) && salesFps.has(fpKey(o.fp))));

  // COMMANDES = source de vérité fusionnée (fiche affaire > opp gagnée > P&L). Sert de base à
  // « Commandes », « Rentabilité », realiseCas, byEntity, backlog, exposition fournisseurs.
  const orders = mergeCommandes(pnlOrders, opps, projectSheets, invoices);
  // Commandes annulées : écartées de la source de vérité fusionnée → exclues de TOUS les agrégats
  // en aval (carnet, CAS, backlog, byEntity, exposition fournisseurs, rentabilité, qualité).
  if (cancelledOrders.size) for (let i = orders.length - 1; i >= 0; i--) if (cancelledOrders.has(safeId(orders[i].fp))) orders.splice(i, 1);

  const fiscal = (await db.doc("config/fiscal").get()).data() || {};
  const alertThr = (await db.doc("config/alerts").get()).data() || {}; // seuils d'alerte configurables
  const projCfg = (await db.doc("config/projection").get()).data() || {}; // niveaux de projection configurables
  const tiers = normalizeTiers(projCfg); // Certitudes/Forecast/Pipe : poids + activation (défauts si absent)
  // Jalons de facturation par projet (≤ 15) : SOURCE UNIQUE du report N+1 (Σ des jalons après le 31/12
  // de l'exercice). Aucun mécanisme manuel concurrent. Keyé par le fpKey STOCKÉ (champ `fp`).
  const milestonesByFp = {};
  (await db.collection("billingMilestones").get()).forEach((doc) => { const v = doc.data() || {}; if (v.fp && Array.isArray(v.milestones) && v.milestones.length) milestonesByFp[v.fp] = v.milestones.map((m) => ({ ...m, amount: num(m && m.amount) })); });
  // currentFy = max des années de PO, BORNÉ à la fenêtre plausible (un yearPo aberrant ne doit pas
  // ancrer tout l'exercice sur une année fantôme).
  const currentFy = fiscal.currentFy || orders.reduce((mx, o) => Math.max(mx, plausibleYear(o.yearPo) || 0), 0);

  // Rafraîchit l'enrichissement (BU par jointure FP/client, rattachement facture↔commande)
  // sur les données lues, pour que les agrégats/alertes ne dépendent pas de drapeaux
  // pré-persistés potentiellement obsolètes (recompute sans réingestion).
  enrichBu({ orders, invoices, opportunities: opps });
  enrichLinks({ orders, invoices });

  const want = (k) => !only || only.includes(k);
  const stamp = { updatedAt: FieldValue.serverTimestamp() };
  const asOf = new Date().toISOString().slice(0, 10); // aujourd'hui : borne basse fenêtre D Prev (atterrissage)
  const yearOf = (d) => (d ? String(d).slice(0, 4) : "");
  const w = []; // écritures {path, data}

  // Migration DOUCE : d'anciennes fiches (importées avant l'isolation) portent la marge INLINE dans
  // projectSheets → on la déplace vers projectSheetsMargin et on purge les champs de base au 1er
  // recompute. Auto-résorbant (plus rien à migrer ensuite) → confidentialité effective sur un Recalculer.
  for (const s of sheetsBase) {
    if (s._id && (s.costTotal != null || s.saleTotal != null || s.margin != null || s.marginPct != null) && !smBy.has(s._id)) {
      w.push({ path: `projectSheets/${s._id}`, data: { costTotal: FieldValue.delete(), saleTotal: FieldValue.delete(), margin: FieldValue.delete(), marginPct: FieldValue.delete() } });
      w.push({ path: `projectSheetsMargin/${s._id}`, data: { _id: s._id, fp: s.fp, costTotal: s.costTotal ?? null, saleTotal: s.saleTotal ?? null, margin: s.margin ?? null, marginPct: s.marginPct ?? null } });
    }
  }

  const sup = suppliers(orders, bcLines, creditLines);
  const bf = backlogFy(orders, currentFy); // backlog GLISSANT global (RAF de toutes les commandes ouvertes)
  if (want("backlog")) w.push({ path: "summaries/backlog_fy", data: { ...bf, ...stamp } });
  const plSummary = pipeline(opps, asOf, tiers); // réutilisé par l'Actualité (couverture, closing, conversion…)
  if (want("pipeline")) w.push({ path: "summaries/pipeline", data: { ...plSummary, ...stamp } }); // global (rétro-compat)
  let trendForNews = null; // tendance de facturation capturée pour l'Actualité (défini dans le bloc atterrissage)
  if (want("suppliers")) w.push({ path: "summaries/suppliers", data: { ...sup, ...stamp } });
  // Suivi BC ⇄ ClickUp : avancement achat + retards remontés de la liste « Commandes Fournisseurs »
  // (overlay clickupBcSync fusionné sur bcLines plus haut). Alimente la carte de suivi + l'Actualité.
  const { clickupBcSignals } = require("../domain/clickupBc");
  const bcCu = clickupBcSignals(bcLines, Date.parse(asOf + "T00:00:00Z"));
  if (want("suppliers")) w.push({ path: "summaries/clickupBc", data: { ...bcCu, ...stamp } });
  // Créances clients (Cash / DSO) : instantané global (l'AR est un état à date, non périodé).
  const rec = receivables(invoices, asOf);
  if (want("facturation") || want("receivables")) w.push({ path: "summaries/receivables", data: { ...rec, ...stamp } });
  // Prévision de trésorerie NETTE : position mensuelle = encaissements AR attendus (échéancier)
  // − décaissements fournisseurs attendus (échéancier). SYMÉTRIQUE : de part et d'autre, les échus
  // sont isolés (cf.overdue / dec.overdue), donc le net mensuel ne compare que du FUTUR contre du
  // FUTUR (plus de biais pessimiste). Le backlog reste INDICATIF, hors du net (jamais mêlé à l'AR).
  if (want("facturation") || want("cashflow")) {
    const cf = cashflow(invoices, orders, asOf);
    const dec = decaissements(bcLines, asOf);
    const decBy = Object.fromEntries(dec.months.map((m) => [m.month, m.out]));
    let cumNet = 0;
    const monthsNet = cf.months.map((m) => {
      const decais = decBy[m.month] || 0;
      const net = m.ar - decais;
      cumNet += net;
      return { ...m, decaissement: decais, net, cumulNet: cumNet };
    });
    w.push({ path: "summaries/cashflow", data: {
      ...cf, months: monthsNet,
      totalDecaissement: dec.total, decaissementBeyond: dec.beyond,
      decaissementOverdue: dec.overdue, decaissementOverdueCount: dec.overdueCount, bcOpenCount: dec.openCount,
      decaissementEtaCompleteness: dec.etaCompleteness, decaissementNoEtaCount: dec.noEtaCount,
      // Engagement (BC non facturés) : sortie POTENTIELLE, hors position nette de base (règle SOA).
      decaissementEngaged: dec.engagedTotal, decaissementEngagedCount: dec.engagedCount, decaissementEngagedBeyond: dec.engagedBeyond,
      ...stamp,
    } });
    // Prévision cash AVANCÉE : scénarios best/base/worst + tension, à partir du MÊME échéancier (AR
    // par mois + payables facturés + échus). L'ENGAGEMENT alimente le seul scénario prudent (worst).
    // Cloisonné « facturation » comme cashflow.
    const scen = cashScenario(
      { asOf, months: cf.months.map((m) => ({ month: m.month, ar: m.ar, out: decBy[m.month] || 0 })), overdueAr: cf.overdue, overduePay: dec.overdue, engagement: dec.engagedTotal },
      { opening: Number(projCfg.cashOpening) || 0 },
    );
    w.push({ path: "summaries/cashScenario", data: { ...scen, ...stamp } });
  }
  const att = atterrissage(orders, invoices, opps, objectives, currentFy, asOf, tiers, milestonesByFp);
  // La marge reportée est de la DONNÉE MARGE → isolée dans un doc gaté « rentabilite » (jamais dans
  // le summary atterrissage public, lu au niveau « overview »).
  const { reporteMarge, ...attPublic } = att;
  if (want("atterrissage")) {
    w.push({ path: `summaries/atterrissage_${currentFy}`, data: { ...attPublic, ...stamp } });
    w.push({ path: `summaries/atterrissageMargin_${currentFy}`, data: { fy: currentFy, reporteMarge, ...stamp } });
  }
  // Tendance de facturation (réalisé vs planifié par les jalons, trajectoire au 31/12) — revenu, non marge.
  // Jalons EFFECTIFS = jalons saisis (une fois par FP) + échéancier PAR DÉFAUT pour les projets SANS
  // jalons (RAF projetable restant en N réparti uniformément sur 3 jalons jusqu'au 31/12). Ainsi la
  // tendance couvre TOUT le backlog, pas seulement les projets manuellement échéancés. Aucun effet de
  // bord sur l'atterrissage (les défauts sont in-year → report N+1 = 0).
  // Calculée dès qu'atterrissage / news / alertes sont (re)construits : l'Actualité (bulletins de
  // facturation) dépend de `trendForNews` — sinon un recompute partiel « alerts »-only reconstruisait
  // l'Actualité SANS ces bulletins (trendForNews resté null).
  if (want("atterrissage") || want("news") || want("alerts")) {
    const trendMilestones = Object.values(milestonesByFp).flat();
    for (const o of orders) {
      const k = fpKey(o.fp);
      if (k && milestonesByFp[k]) continue; // FP à jalons saisis → déjà pris en compte
      const bp = projetableBacklog(o);
      if (bp <= 0) continue;
      trendMilestones.push(...defaultMilestones(bp, asOf, currentFy));
    }
    const trend = billingTrend(invoices, trendMilestones, currentFy, asOf);
    trendForNews = trend;
    if (want("atterrissage")) w.push({ path: `summaries/billingTrend_${currentFy}`, data: { ...trend, ...stamp } });
  }
  // AM 360° : pilotage par commercial (CAS/CAF/backlog/pipeline/conversion/R-O), sans marge.
  if (want("pipeline") || want("ams")) w.push({ path: "summaries/ams", data: { ...am360(orders, invoices, opps, objectives, currentFy, tiers), ...stamp } });
  if (want("alerts")) {
    // Isolation marge : les alertes dérivées de la marge (marge négative / achats > vente) exposent le
    // SIGNE de la marge par affaire nommée → écrites dans summaries/alertsMargin (gaté « rentabilite »),
    // jamais dans summaries/alerts (lisible à « overview »).
    const allAlerts = alerts(orders, invoices, sup, bcLines, currentFy, asOf, opps, alertThr);
    w.push({ path: "summaries/alerts", data: { items: allAlerts.filter((a) => !a.margin), fy: currentFy, ...stamp } });
    w.push({ path: "summaries/alertsMargin", data: { items: allAlerts.filter((a) => a.margin), fy: currentFy, ...stamp } });
  }
  // Cockpit qualité des données : hygiène d'ingestion (champs manquants, rattachements, incohérences).
  const dqSummary = dataQuality(orders, invoices, opps, bcLines, projectSheets, alertThr);
  // Signaux ClickUp (retard de LIVRAISON + incohérences statut↔données) : les incohérences enrichissent
  // le cockpit Qualité ; le retard de livraison alimente un bulletin d'Actualité (voir buildNews).
  const { clickupSignals, clickupDelays } = require("../domain/clickupSignals");
  const cuSignals = clickupSignals(orders, clickupSyncMap, safeId, asOf);
  if (cuSignals.issues.length) dqSummary.issues = [...(dqSummary.issues || []), ...cuSignals.issues];
  // Enrichissement inverse (Lot 4) : commandes BLOQUÉES ou en priorité URGENTE côté ClickUp → bulletin
  // d'Actualité (projets à débloquer / à traiter en priorité). Priorité/blocage remontés par readTaskSync.
  const urgentPrio = new Set(["urgent", "urgente"]);
  const cuBlockedRefs = orders.filter((o) => { const cu = clickupSyncMap[safeId(o.fp)] || {}; return cu.blocked || (cu.priority && urgentPrio.has(String(cu.priority).toLowerCase())); }).map((o) => o.fp).filter(Boolean);
  // Analytique délais/échéances ClickUp (par PM, par statut, RAF échéancé) → summaries/clickupDelays.
  if (want("commandes") || want("overview") || want("dataQuality")) {
    const delays = clickupDelays(orders, clickupSyncMap, orderPmMap, safeId, asOf);
    w.push({ path: "summaries/clickupDelays", data: { ...delays, ...stamp } });
  }
  if (want("alerts") || want("dataQuality")) {
    w.push({ path: "summaries/dataQuality", data: { ...dqSummary, ...stamp } });
    // Snapshot QUOTIDIEN de la qualité (tendance d'assainissement) : un point par jour (clé = asOf),
    // écrase le point du jour, borné à 90 jours. Non sensible (score + compteurs), lisible à overview.
    const day = String(asOf || "").slice(0, 10);
    if (day) {
      const prev = (await db.doc("summaries/qualityHistory").get()).data() || {};
      const days = (Array.isArray(prev.days) ? prev.days : []).filter((d) => d && d.date !== day);
      days.push({ date: day, score: dqSummary.score, anomalies: (dqSummary.issues || []).reduce((s, i) => s + (i.count || 0), 0), types: (dqSummary.issues || []).length });
      days.sort((a, b) => (a.date < b.date ? -1 : 1));
      w.push({ path: "summaries/qualityHistory", data: { days: days.slice(-90), ...stamp } });
    }
  }
  // RELANCE & anticipation : trois familles d'actions datées par responsable. Écrites dans TROIS
  // summaries CLOISONNÉS par module (facturation / fournisseurs / backlog) — le montant d'une créance
  // (facturation) ne fuite pas vers un rôle sans droit facturation, etc. Recalculé avec les alertes.
  if (want("relances") || want("overview") || want("alerts")) {
    const rel = relances(invoices, orders, bcLines, milestonesByFp, asOf);
    w.push({ path: "summaries/relancesCreances", data: { ...rel.creances, ...stamp } });
    w.push({ path: "summaries/relancesBc", data: { ...rel.bc, ...stamp } });
    w.push({ path: "summaries/relancesJalons", data: { ...rel.jalons, ...stamp } });
  }
  // ACTUALITÉ : bulletins d'événements clés (opportunités/commandes/facturation/backlog/fournisseurs)
  // + recommandations majeures, à partir des agrégats calculés. Revenu/pipeline uniquement (SANS marge)
  // → lisible au niveau « overview ». Recalculé avec les alertes.
  if (want("alerts") || want("news")) {
    // Pic d'erreurs applicatives sur 24 h (crash de rendu / rejets non gérés remontés par les
    // navigateurs) → déclencheur Actualité. Count agrégé (bon marché) ; jamais bloquant pour le recompute.
    let clientErrors24h = 0;
    try {
      const since = new Date(Date.now() - 24 * 3600 * 1000);
      clientErrors24h = (await db.collection("errorLog").where("ts", ">=", since).count().get()).data().count || 0;
    } catch (e) { /* index/permission absent → pas de déclencheur, sans casser le recompute */ }
    const news = buildNews({ att: attPublic, pipeline: plSummary, backlog: bf, receivables: rec, suppliers: sup, billingTrend: trendForNews, dataQuality: dqSummary, opps, bcLines, clientErrors24h, clickupOverdue: cuSignals.overdueCount, clickupOverdueRefs: cuSignals.overdueRefs, bcClickupOverdue: bcCu.overdueCount, bcClickupOverdueRefs: bcCu.overdueRefs, clickupBlocked: cuBlockedRefs.length, clickupBlockedRefs: cuBlockedRefs, fy: currentFy, asOf, thr: alertThr });
    w.push({ path: "summaries/news", data: { ...news, ...stamp } });
  }
  // Commandes fusionnées matérialisées (lues par « Commandes » & le filtre de la Vue d'ensemble).
  // Découpées en CHUNKS (commandesRows/{i}) pour ne PAS dépasser la limite Firestore ~1 Mio/doc :
  // le doc unique summaries/commandes ne porte plus que la MÉTA (count + nombre de chunks).
  let commandeChunks = null;
  if (want("commandes") || want("overview")) {
    // La MARGE par ligne (mb / costTotal / marginPct) est ISOLÉE dans commandesRowsMargin/{i}
    // (lecture réservée à « Rentabilité ») ; les chunks de base ne portent que des grandeurs non
    // sensibles → confidentialité opposable côté serveur (pas seulement masquage UI).
    const isoDay = (ms) => (Number.isFinite(Number(ms)) && Number(ms) > 0 ? new Date(Number(ms)).toISOString().slice(0, 10) : null);
    const base = orders.map((o) => {
      const cu = clickupSyncMap[safeId(o.fp)] || null; // synchro inverse ClickUp (statut projet + dates)
      return {
        fp: o.fp, client: o.client || "", bu: o.bu || "AUTRE", am: o.am || "", affaire: o.affaire || null,
        cas: o.cas || 0, raf: o.raf || 0, facture: o.facture || 0, yearPo: o.yearPo || 0, source: o.source || null, pnlSource: o.pnlSource || null,
        pm: orderPmMap[safeId(o.fp)] || null, // Project Manager affecté (overlay config/orderPm)
        clickupStatus: cu ? (cu.status || null) : null,
        dateCommande: cu ? isoDay(cu.dateCommande) : null,
        dateContractuelle: cu ? isoDay(cu.dateContractuelle) : null,
        dateFinPrev: cu ? isoDay(cu.dateFinPrev) : null,
        clickupTaskId: clickupLinksMap[safeId(o.fp)] || null,
        // Enrichissements ClickUp → app (Lot 4) : priorité, blocage, avancement checklists, temps passé.
        clickupPriority: cu ? (cu.priority || null) : null,
        clickupBlocked: cu ? !!cu.blocked : false,
        clickupProgress: cu && cu.progress != null ? cu.progress : null,
        clickupTimeSpentH: cu && cu.timeSpentMs ? Math.round(Number(cu.timeSpentMs) / 360000) / 10 : null,
      };
    });
    const margin = orders.map((o) => ({ fp: o.fp, mb: o.mb || 0, costTotal: o.costTotal ?? null, marginPct: o.marginPct ?? null }));
    const CHUNK = 800; // ~800 lignes/doc reste très en deçà de la limite 1 Mio
    commandeChunks = Math.max(1, Math.ceil(base.length / CHUNK));
    // rows: delete() purge l'ancien champ inline (écritures merge) — sinon la méta resterait ~1 Mio.
    w.push({ path: "summaries/commandes", data: { count: orders.length, chunks: commandeChunks, rows: FieldValue.delete(), ...stamp } });
    for (let i = 0; i < commandeChunks; i++) {
      w.push({ path: `commandesRows/${i}`, data: { i, rows: base.slice(i * CHUNK, (i + 1) * CHUNK), ...stamp } });
      w.push({ path: `commandesRowsMargin/${i}`, data: { i, rows: margin.slice(i * CHUNK, (i + 1) * CHUNK), ...stamp } });
    }
    // CHARGE PAR PROJECT MANAGER : agrégat léger des commandes affectées (count / CAS / RAF), sans
    // marge (grandeurs non sensibles) → alimente la vue « par PM » et les options du filtre PM.
    const byPm = new Map();
    for (const o of orders) {
      const pm = orderPmMap[safeId(o.fp)];
      if (!pm) continue;
      const e = byPm.get(pm) || { pm, count: 0, cas: 0, raf: 0 };
      e.count += 1; e.cas += o.cas || 0; e.raf += o.raf || 0;
      byPm.set(pm, e);
    }
    const pmRows = [...byPm.values()].sort((a, b) => b.cas - a.cas);
    w.push({ path: "summaries/pms", data: { rows: pmRows, count: pmRows.length, ...stamp } });
  }

  // Historisation : un INSTANTANÉ daté des grandeurs clés à chaque recompute (1 point/jour,
  // ré-écrit si déjà présent). Fonde les tendances / burn-down du backlog / forecast-vs-réel.
  if (want("overview") || want("trends")) {
    const point = {
      date: asOf,
      casReel: att.realiseCas || 0, caf: att.factureN || 0, backlog: bf.total || 0,
      pipeline: att.pipelinePondere || 0, projeteCas: att.projete || 0, projeteCaf: att.cafProjete || 0,
      ar: rec.totalAR || 0, dso: rec.dso || 0, fy: currentFy,
    };
    const prev = (await db.doc("summaries/trends").get()).data();
    const points = (prev?.points || []).filter((p) => p.date !== asOf);
    points.push(point);
    points.sort((a, b) => String(a.date).localeCompare(String(b.date)));
    w.push({ path: "summaries/trends", data: { points: points.slice(-180), ...stamp } }); // ~6 mois d'historique
  }

  const filterOrders = (arr, p) => (p === "all" ? arr : arr.filter((o) => String(o.yearPo) === p));

  // Périodes disponibles = "Tout" + chaque année de commande (yearPo), la plus récente d'abord.
  const years = [...new Set(orders.map((o) => o.yearPo).filter((y) => y > 0))].sort((a, b) => b - a).map(String);
  const periods = ["all", ...years];
  for (const period of periods) {
    const inv = filterInvoices(invoices, period); // factures DATÉES dans la période = CAF figé sur l'exercice
    const ord = filterOrders(orders, period); // commandes signées dans la période (yearPo)
    // Opportunités de la période = D Prev (closingDate) dans l'année sélectionnée. Les certitudes
    // GLISSENT sur l'exercice : une D Prev déjà passée DANS l'année compte toujours (cohérent avec
    // l'atterrissage). On écarte l'obsolète HORS année (N-1) et le prévu en N+1+. "Tout" = tout.
    const oppP = period === "all" ? opps : opps.filter((o) => yearOf(o.closingDate) === period);
    // Chaîne NON additive : CAS(période, figé) · Facturé=CAF(inv datées, figé) · Backlog GLISSANT
    // (bf global, indépendant de la période) · Certitudes = pondéré des opps de la période (D Prev).
    if (want("overview")) {
      // Marge agrégée (mb + ratios.pmb) isolée dans overviewMargin_* (accès « Rentabilité ») ;
      // overview_* ne garde que la chaîne non-additive et les taux non sensibles.
      const ov = overview(ord, inv, oppP, { backlog: bf.total, backlogCount: bf.count, tiers });
      const { mb: ovMb, ratios: ovR, ...ovRest } = ov;
      w.push({ path: `summaries/overview_${period}`, data: { period, ...ovRest, ratios: { tauxFacturation: ovR.tauxFacturation, tauxConversionVente: ovR.tauxConversionVente }, ...stamp } });
      w.push({ path: `summaries/overviewMargin_${period}`, data: { period, mb: ovMb, pmb: ovR.pmb, ...stamp } });
    }
    if (want("pipeline")) w.push({ path: `summaries/pipeline_${period}`, data: { period, ...pipeline(oppP, asOf, tiers), ...stamp } });
    if (want("facturation")) w.push({ path: `summaries/facturation_${period}`, data: { period, ...facturation(inv), ...stamp } });
    if (want("rentabilite")) w.push({ path: `summaries/rentabilite_${period}`, data: { period, ...rentabilite(ord, inv, orders), ...stamp } });
    // Clients/Domaines : la MARGE (mb/pmb) est isolée dans un doc *Margin_* lisible seulement avec
    // l'accès « Rentabilité » (confidentialité côté serveur) ; le doc de base ne porte que CAS/facturé/backlog.
    if (want("clients")) {
      const cl = byEntity(ord, inv, (x) => x.client);
      w.push({ path: `summaries/clients_${period}`, data: { period, rows: cl.map(({ mb, pmb, ...r }) => r), ...stamp } });
      w.push({ path: `summaries/clientsMargin_${period}`, data: { period, rows: cl.map(({ key, mb, pmb }) => ({ key, mb, pmb })), ...stamp } });
    }
    if (want("domaines")) {
      const dm = byEntity(ord, inv, (x) => x.bu);
      w.push({ path: `summaries/domaines_${period}`, data: { period, rows: dm.map(({ mb, pmb, ...r }) => r), ...stamp } });
      w.push({ path: `summaries/domainesMargin_${period}`, data: { period, rows: dm.map(({ key, mb, pmb }) => ({ key, mb, pmb })), ...stamp } });
    }
  }

  // Enregistre la liste des périodes disponibles (sélecteur front) + l'horodatage du dernier
  // recompute (bandeau de fraîcheur « données à jour au… »).
  w.push({ path: "config/periods", data: { available: periods, currentFy, lastRecomputeAt: FieldValue.serverTimestamp() } });

  // Garde-fou limite Firestore (~1 Mio/doc) : summaries/commandes embarque TOUTES les lignes de
  // commande dans un seul document — au-delà d'un certain volume il dépasse la limite et le
  // batch.commit() échoue avec une erreur opaque (« internal »). On détecte le doc fautif AVANT
  // l'écriture et on lève un message explicite (path + taille) plutôt qu'une erreur illisible.
  // Filet de sécurité : neutralise tout résidu non fini (NaN/Infinity) et undefined avant écriture,
  // pour qu'aucune valeur illégale ne fasse échouer le batch en production (erreur « internal »).
  for (const it of w) it.data = sanitizeForFirestore(it.data);

  const DOC_LIMIT = 1_000_000; // marge sous la limite dure de 1 048 576 octets
  for (const it of w) {
    const bytes = Buffer.byteLength(JSON.stringify(it.data ?? {}), "utf8");
    if (bytes > DOC_LIMIT) {
      throw new Error(`summary trop volumineux: ${it.path} ≈ ${bytes} octets (> limite Firestore ~1 Mio) — trop de lignes pour un seul document`);
    }
  }

  let batch = db.batch(), n = 0;
  for (const it of w) {
    batch.set(db.doc(it.path), it.data, { merge: true });
    if (++n % 400 === 0) { await batch.commit(); batch = db.batch(); }
  }
  await batch.commit();

  // Purge des chunks de commandes ORPHELINS (base ET marge) si le nombre de chunks a diminué depuis
  // le dernier recompute, sinon d'anciennes lignes resteraient lues par le front.
  if (commandeChunks != null) {
    for (const coll of ["commandesRows", "commandesRowsMargin"]) {
      const snap = await db.collection(coll).get();
      let del = db.batch(), d = 0;
      for (const doc of snap.docs) {
        if (Number(doc.id) >= commandeChunks) { del.delete(doc.ref); if (++d % 400 === 0) { await del.commit(); del = db.batch(); } }
      }
      if (d % 400 !== 0) await del.commit();
    }
  }
  return { written: w.map((x) => x.path), currentFy, periods };
}

module.exports = { recomputeAll, filterInvoices, sanitizeForFirestore, coerceNums };
