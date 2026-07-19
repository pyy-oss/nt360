// Agrégation → documents summaries/* (BUILD_KIT §6, §10).
// Lit les collections sources, calcule via domain/*, écrit les agrégats (écriture
// interdite au client par les rules). Le front s'abonne en temps réel (onSnapshot).
const { FieldValue } = require("firebase-admin/firestore");
const { overview } = require("../domain/chaine");
const { normalizeTiers } = require("../domain/projection");
const { billingTrend } = require("../domain/billing");
const { backlogFy } = require("../domain/backlog");
const { pipeline, dormantSummary } = require("../domain/pipeline");
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
const { oppFunnel, stageConversion, stageDwell } = require("../domain/oppFunnel");
const { slippageFromHistory } = require("../domain/oppSlippage");
const { dataQuality } = require("../domain/dataQuality");
const { isAgedLost, isDormantClosing } = require("../domain/oppLifecycle");
const { relances } = require("../domain/relances");
const { mergeCommandes } = require("../domain/commandes");
const { enrichBu, enrichLinks } = require("./enrich");
const { fpKey, plausibleYear, num, buildFpAliasResolver } = require("./ids");
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

async function recomputeCore(db, only) {
  try { await ensureImportPermission(db); } catch (e) { /* migration best-effort, ne bloque pas le recompute */ }
  // Recompute PARTIEL : orders/invoices/opps/projectSheets alimentent toujours mergeCommandes ;
  // bcLines/creditLines/objectives ne sont lus QUE si un summary demandé en a besoin. Un recompute
  // ciblé (ex. après un changement de statut BC → ["suppliers","alerts"]) évite ainsi des lectures.
  const need = (keys) => !only || keys.some((k) => only.includes(k));
  // NB : ces ensembles DOIVENT couvrir tous les summaries qui utilisent la collection — y compris
  // les co-déclenchements (cashflow s'écrit aussi sur want("facturation") ; ams sur want("pipeline")).
  // 'news' inclus : buildNews consomme bcLines (bulletin BC en retard) + l'overlay BC (bc_achat_retard)
  // + suppliers(…, creditLines) → sinon un recompute only=['…','news'] (ex. setBillingMilestones)
  // reconstruirait l'Actualité avec bcLines/creditLines VIDES et effacerait ces bulletins.
  // 'overview' inclus : le bloc `relances` (→ summaries/relancesBc) tourne aussi sur want("overview") et
  // consomme bcLines ; sans 'overview' ici, un recompute only=['overview'] chargeait bcLines=[] et
  // ÉCRASAIT relancesBc à vide (plan de relances fournisseurs effacé). Même piège que 'news'/'relances'.
  // 'partenariats' inclus : le CA partenaire (summaries/par_ca) est DÉRIVÉ des bcLines (ADR-P02). Sans ça,
  // un recompute scopé only=['partenariats'] chargerait bcLines=[] et écraserait par_ca à vide.
  const needBc = need(["suppliers", "cashflow", "alerts", "dataQuality", "facturation", "relances", "news", "overview", "partenariats"]);
  const needCredit = need(["suppliers", "alerts", "news"]);
  // 'news'/'alerts' inclus : buildNews ET alerts consomment les objectifs (écart à la cible). Sinon un
  // recompute partiel only=['…','news'|'alerts'] (pull ClickUp, webhook, seuils) reconstruirait ces
  // agrégats avec objectives=[] → alertes d'écart réelles effacées + faux « objectif absent ». Même
  // classe de piège que needBc/needCredit. Cf. audit P0-D.
  const needObj = need(["atterrissage", "ams", "pipeline", "news", "alerts"]);
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
  coerceNums(oppsRaw, ["amount", "probability", "weighted", "stage", "ageDays"]);
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

  // RÉCONCILIATION DE N° FP (overlay config/fpAliases) : parfois une même commande est au P&L sous un
  // N° FP différent de celui saisi sur l'opportunité. Le FP P&L FAIT FOI (il porte la facturation). On
  // redirige donc, EN MÉMOIRE, tout FP « source » (opp) vers le FP « cible » (P&L) avant la fusion du
  // carnet → l'opp gagnée réconcilie alors la bonne ligne P&L (son CAS compte), et factures/BC/fiches
  // saisis sous l'ancien FP se rattachent à la commande. NON DESTRUCTIF (les docs gardent leur FP ; seul
  // le recompute canonise) et SURVIT aux ré-imports LIVE (overlay, comme l'annulation/le PM). Cf. clientAliases.
  const fpAliasMap = ((await db.doc("config/fpAliases").get()).data() || {}).map || {};
  if (Object.keys(fpAliasMap).length) {
    const canonFp = buildFpAliasResolver(fpAliasMap);
    for (const rows of [pnlOrders, invoices, oppsRaw, sheetsBase, bcLines]) {
      for (const r of rows) if (r && r.fp != null && r.fp !== "") r.fp = canonFp(r.fp);
    }
  }

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
  // SURCHARGE DU MONTANT (CAS) par commande : overlay config/orderCasOverride { map: { <safeId(fp)>: cas } },
  // posé via syncOrderAmount (sens opp → commande). PRIME sur P&L/opp/fiche et SURVIT aux ré-imports.
  const orderCasOverrideMap = ((await db.doc("config/orderCasOverride").get()).data() || {}).map || {};
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
  const { bcKey } = require("./clickupBc");
  // PRIORITÉ SOURCE : un BC importé depuis ClickUp (source 'clickup') n'est qu'un AMORÇAGE ; dès que le
  // même N° BC existe via l'import Logistics/PDF/fiche (données comptables curées), on ÉCARTE la ligne
  // ClickUp → jamais de double compte d'exposition/décaissement, quel que soit l'ordre d'arrivée.
  const nonCuBcKeys = new Set();
  for (const b of bcLines) { if (b && b.source !== "clickup" && b.bcNumber) nonCuBcKeys.add(bcKey(b.bcNumber, safeId)); }
  for (let i = bcLines.length - 1; i >= 0; i--) { const b = bcLines[i]; if (b && b.source === "clickup" && b.bcNumber && nonCuBcKeys.has(bcKey(b.bcNumber, safeId))) bcLines.splice(i, 1); }
  for (const b of bcLines) {
    const raw = String(b.bcNumber || "").trim();
    const k = raw ? bcKey(raw, safeId) : ""; // clé casse-insensible (cohérente avec push/pull BC)
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

  // Dédup INTRA-source 'salesData' par FP (cf. audit cycle de vie) : si l'oppId a dérivé sur d'anciens
  // imports (formule héritée incluant D Prev/AM/client), plusieurs docs 'salesData' de MÊME FP coexistent
  // → double-compte du pipeline pondéré. On ne garde que le PLUS RÉCENT (updatedAt) par FP. Filet
  // complémentaire à l'id désormais dérivé du seul FP : neutralise aussi les orphelins historiques SANS
  // attendre un passage `dedupe`. (Les opps 'salesData' sans FP ne sont pas dédupliquées — pas de clé.)
  const _ts = (o) => { const u = o.updatedAt; return u && typeof u.toMillis === "function" ? u.toMillis() : (Number(u) || 0); };
  const bestSalesByFp = new Map();
  for (const o of oppsRaw) {
    if (o.source !== "salesData") continue;
    const k = fpKey(o.fp); if (!k) continue;
    const prev = bestSalesByFp.get(k);
    if (!prev || _ts(o) >= _ts(prev)) bestSalesByFp.set(k, o);
  }
  const oppsDedup = oppsRaw.filter((o) => {
    if (o.source !== "salesData") return true;
    const k = fpKey(o.fp); if (!k) return true;
    return bestSalesByFp.get(k) === o; // ne garde que le représentant le plus récent du FP
  });
  // Opportunités FANTÔMES (cf. audit intégral I2) : une opp 'salesData' RETIRÉE de la feuille LIVE
  // (sans clôture 7/9) est marquée `stale:true` NON-DESTRUCTIVEMENT à l'import (lib/apply.js). On
  // l'EXCLUT ici des agrégats pipeline actifs (pondéré, funnel, conversion, commandes) — elle reste en
  // base, ré-activable par un import ultérieur. Réversible : aucune donnée supprimée.
  // Auto-perte par ÂGE (règle source LIVE : Âge ≥ 366 j ET IdC ≤ 90 % ⇒ perdue) : une opp ACTIVE mais
  // périmée est exclue du pipeline actif (comme la source) — calcul pur, non écrit (le ré-import corrige
  // à la source si l'âge/IdC évoluent). Signalée en Qualité (opps_agees).
  const oppsActive = oppsDedup.filter((o) => o.stale !== true && !isAgedLost(o));
  const staleOpps = oppsDedup.filter((o) => o.stale === true); // fantômes (I2) : signalés en Qualité, hors agrégats
  const agedOpps = oppsDedup.filter((o) => o.stale !== true && isAgedLost(o)); // périmées par âge (règle source)
  // Dédup inter-source : une affaire SAISIE manuellement (source 'saisie') puis ré-importée en LIVE
  // (source 'salesData', avec FP) existerait en double → double compte du pipeline. Quand un FP est
  // couvert par une opp 'salesData', on écarte la/les opps 'saisie' de MÊME FP (la version importée fait foi).
  // salesFps calculé sur oppsDedup (AVANT exclusion stale/aged), sinon un FP 'salesData' devenu fantôme
  // (stale) ou périmé (aged) cesserait de masquer son jumeau 'saisie' → l'opp manuelle RESSUSCITERAIT au
  // pipeline (cf. vérification). La suppression inter-source doit rester stable quel que soit l'état.
  const salesFps = new Set(oppsDedup.filter((o) => o.source === "salesData" && fpKey(o.fp)).map((o) => fpKey(o.fp)));
  const opps = oppsActive.filter((o) => !(o.source === "saisie" && fpKey(o.fp) && salesFps.has(fpKey(o.fp))));

  // COMMANDES = source de vérité fusionnée (fiche affaire > opp gagnée > P&L). Sert de base à
  // « Commandes », « Rentabilité », realiseCas, byEntity, backlog, exposition fournisseurs.
  const orders = mergeCommandes(pnlOrders, opps, projectSheets, invoices);
  // SURCHARGE DU MONTANT (CAS) : la valeur synchronisée depuis l'opportunité PRIME sur P&L/opp/fiche.
  // Le RAF DÉRIVÉ (rafSource='derive' = CAS − facturé) est recalculé sur le nouveau CAS ; le RAF curaté
  // (Excel) est conservé tel quel (source de vérité métier). `casSource='override'` trace la surcharge.
  if (Object.keys(orderCasOverrideMap).length) {
    for (const o of orders) {
      const ov = Number(orderCasOverrideMap[safeId(o.fp)]);
      if (Number.isFinite(ov) && ov >= 0) {
        o.cas = ov; o.casSource = "override";
        if (o.rafSource === "derive") o.raf = Math.max(ov - (o.facture || 0), 0);
      }
    }
  }
  // Commandes annulées : écartées de la source de vérité fusionnée → exclues de TOUS les agrégats
  // en aval (carnet, CAS, backlog, byEntity, exposition fournisseurs, rentabilité, qualité).
  if (cancelledOrders.size) for (let i = orders.length - 1; i >= 0; i--) if (cancelledOrders.has(safeId(orders[i].fp))) orders.splice(i, 1);

  const fiscal = (await db.doc("config/fiscal").get()).data() || {};
  const alertThr = (await db.doc("config/alerts").get()).data() || {}; // seuils d'alerte configurables
  const projCfg = (await db.doc("config/projection").get()).data() || {}; // niveaux de projection configurables
  const tiers = normalizeTiers(projCfg); // Certitudes/Forecast/Pipe : poids + activation (défauts si absent)
  const geleMonths = Number(projCfg.geleMonths) > 0 ? Number(projCfg.geleMonths) : 6; // seuil « Gelé » (mois), défaut 6
  // Jalons de facturation par projet (≤ 15) : SOURCE UNIQUE du report N+1 (Σ des jalons après le 31/12
  // de l'exercice). Aucun mécanisme manuel concurrent. Keyé par le fpKey STOCKÉ (champ `fp`).
  // Jalons RATTACHÉS À UNE COMMANDE ACTIVE uniquement : on écarte ceux dont le FP n'est plus dans `orders`
  // (commande SUPPRIMÉE ou ANNULÉE — orders exclut déjà les annulées, cf. supra). Sans ce filtre, le doc
  // billingMilestones survivait à l'annulation/suppression et gonflait le « planifié », le projeté N+1 et
  // le plan de relances avec des jalons fantômes (cf. audit intégrité P1-6). Réversible : le doc n'est pas
  // supprimé, il redevient actif si la commande est rétablie.
  const orderFps = new Set(orders.map((o) => o.fp));
  const milestonesByFp = {};
  (await db.collection("billingMilestones").get()).forEach((doc) => { const v = doc.data() || {}; if (v.fp && orderFps.has(v.fp) && Array.isArray(v.milestones) && v.milestones.length) milestonesByFp[v.fp] = v.milestones.map((m) => ({ ...m, amount: num(m && m.amount) })); });
  // currentFy = max des années de PO, BORNÉ à la fenêtre plausible (un yearPo aberrant ne doit pas
  // ancrer tout l'exercice sur une année fantôme).
  const currentFy = fiscal.currentFy || orders.reduce((mx, o) => Math.max(mx, plausibleYear(o.yearPo) || 0), 0);

  // Rafraîchit l'enrichissement (BU par jointure FP/client, rattachement facture↔commande)
  // sur les données lues, pour que les agrégats/alertes ne dépendent pas de drapeaux
  // pré-persistés potentiellement obsolètes (recompute sans réingestion).
  enrichBu({ orders, invoices, opportunities: opps });
  // Snapshot du drapeau `linked` PERSISTÉ avant recalcul : le frontal (liste Factures) lit ce champ
  // stocké, pas l'agrégat serveur — s'il n'est jamais réécrit, le KPI « Factures non rattachées »
  // reste figé sur une valeur d'import obsolète (divergence observée : 364 côté liste vs 72 côté
  // Qualité/Alertes, qui calculent frais). On réconcilie en réécrivant `linked` (diff seulement).
  const priorLinked = new Map(invoices.map((i) => [i.id, i.linked === true]));
  enrichLinks({ orders, invoices });

  const want = (k) => !only || only.includes(k);
  const stamp = { updatedAt: FieldValue.serverTimestamp() };
  const asOf = new Date().toISOString().slice(0, 10); // aujourd'hui : borne basse fenêtre D Prev (atterrissage)
  const yearOf = (d) => (d ? String(d).slice(0, 4) : "");
  // OPPORTUNITÉS DORMANTES (D Prev d'un millésime révolu, année < exercice courant). Le drapeau
  // `config/projection.excludeDormant` (ACTIVÉ par défaut : absent ⇒ true) les retire de la prévision
  // CUMULÉE (« Tout ») — les onglets d'année les écartent déjà par le filtre de millésime. Le volume/
  // valeur/ancienneté est calculé une fois sur l'assiette active GLOBALE et surfacé en tuile dédiée
  // (transparence : exclu du pondéré mais visible). Miroir front : overviewCalc.ts + pipeline.tsx.
  const excludeDormant = projCfg.excludeDormant !== false;
  const dormant = dormantSummary(opps, currentFy, asOf);
  const w = []; // écritures {path, data}

  // Réconciliation du drapeau `linked` persisté sur les factures (source du KPI « non rattachées »
  // côté liste). On ne réécrit QUE les factures dont l'état a changé depuis le dernier calcul (diff),
  // pour éviter des milliers d'écritures inutiles à chaque recalcul. Après le 1er auto-rattrapage,
  // le volume retombe à ~0 (seules les nouvelles factures ou les rattachements récents bougent).
  for (const inv of invoices) {
    if (!inv.id) continue;
    const now = inv.linked === true;
    if (now !== priorLinked.get(inv.id)) w.push({ path: `invoices/${inv.id}`, data: { linked: now } });
  }

  // Migration DOUCE : d'anciennes fiches (importées avant l'isolation) portent la marge INLINE dans
  // projectSheets → on la déplace vers projectSheetsMargin et on purge les champs de base au 1er
  // recompute. Auto-résorbant (plus rien à migrer ensuite) → confidentialité effective sur un Recalculer.
  for (const s of sheetsBase) {
    if (s._id && (s.costTotal != null || s.saleTotal != null || s.margin != null || s.marginPct != null) && !smBy.has(s._id)) {
      // ORDRE IMPORTANT (intégrité, audit F3) : ÉCRIRE la marge isolée AVANT de purger la base. Les
      // deux writes visent des docs différents et sont commités par lots (non atomiques) ; si l'on
      // supprimait d'abord, un crash entre les deux perdrait définitivement la marge (plus de source).
      // Dans l'autre sens, une interruption laisse au pire la marge dupliquée (base + isolée) — sans
      // perte ; un recompute ultérieur ne re-migre pas (smBy la contient) mais la valeur est sauve.
      w.push({ path: `projectSheetsMargin/${s._id}`, data: { _id: s._id, fp: s.fp, costTotal: s.costTotal ?? null, saleTotal: s.saleTotal ?? null, margin: s.margin ?? null, marginPct: s.marginPct ?? null } });
      w.push({ path: `projectSheets/${s._id}`, data: { costTotal: FieldValue.delete(), saleTotal: FieldValue.delete(), margin: FieldValue.delete(), marginPct: FieldValue.delete() } });
    }
  }

  const sup = suppliers(orders, bcLines, creditLines);
  const bf = backlogFy(orders, currentFy); // backlog GLISSANT global (RAF de toutes les commandes ouvertes)
  if (want("backlog")) w.push({ path: "summaries/backlog_fy", data: { ...bf, ...stamp } });
  // Doc GLOBAL = pipeline « Tout » (rétro-compat ; Actualité + export CODIR). MÊME assiette que
  // summaries/pipeline_all : dormantes exclues si le drapeau est actif, sinon le « Pipeline actif pondéré »
  // de l'export CODIR divergerait du Cockpit « Tout » (violation « même métrique = même nombre »).
  const plOpps = excludeDormant ? opps.filter((o) => !isDormantClosing(o, currentFy)) : opps;
  const plSummary = pipeline(plOpps, asOf, tiers, orders, geleMonths); // réutilisé par l'Actualité ; `orders` → pondéré NET du carnet (parité overview)
  if (want("pipeline")) w.push({ path: "summaries/pipeline", data: { ...plSummary, dormant, excludeDormant, ...stamp } }); // global (rétro-compat)
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
  // ISOLATION par confidentialité (cf. audit RBAC) :
  //  • marge reportée → doc gaté « rentabilite » (donnée marge, jamais overview) ;
  //  • OBJECTIFS annuels (cible CAS/CAF, écart, proba d'atteinte) → doc gaté « objectifs » : un rôle sans
  //    droit « objectifs » (ex. commercial) ne doit PAS lire les cibles de l'entreprise via le summary
  //    atterrissage (lu au niveau « overview »). Le doc public ne garde que l'OPÉRATIONNEL (réalisé/projeté).
  const { reporteMarge, objectif, ecart, probaAtteinte, objectifCaf, ecartCaf, probaAtteinteCaf, next, ...attOps } = att;
  const { objectif: nObj, ecart: nEcart, objectifCaf: nObjCaf, ecartCaf: nEcartCaf, ...nextOps } = next || {};
  const attPublic = { ...attOps, next: nextOps };                                      // opérationnel (overview)
  const attObjectifs = { fy: currentFy, objectif, ecart, probaAtteinte, objectifCaf, ecartCaf, probaAtteinteCaf,
    next: { objectif: nObj, ecart: nEcart, objectifCaf: nObjCaf, ecartCaf: nEcartCaf } }; // cibles (objectifs)
  if (want("atterrissage")) {
    w.push({ path: `summaries/atterrissage_${currentFy}`, data: { ...attPublic, ...stamp } });
    w.push({ path: `summaries/atterrissageObjectifs_${currentFy}`, data: { ...attObjectifs, ...stamp } });
    w.push({ path: `summaries/atterrissageMargin_${currentFy}`, data: { fy: currentFy, reporteMarge, ...stamp } });
  }
  // Tendance de facturation (réalisé vs planifié par les jalons, trajectoire au 31/12) — revenu, non marge.
  // Jalons EFFECTIFS = jalons saisis (une fois par FP) + échéancier AUTO-GÉNÉRÉ pour les projets SANS
  // jalons. L'auto-généré est PILOTÉ PAR LA DATE DE CLÔTURE RÉELLE de la tâche ClickUp (date fin prév. →
  // à défaut contractuelle) : RAF placé sur ce mois de clôture s'il est dans l'exercice et à venir ;
  // sinon (date absente/passée) repli sur une courbe pondérée croissante du mois courant au 31/12. Ainsi
  // la tendance suit les vraies échéances (relief), couvre tout le backlog sans trou, reste corrigeable
  // manuellement (jalons saisis prioritaires) et n'a aucun effet de bord sur l'atterrissage (in-year → report N+1 = 0).
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
      // Date de clôture réelle (synchro inverse ClickUp) : fin prévisionnelle en priorité, sinon contractuelle.
      const cu = clickupSyncMap[safeId(o.fp)] || {};
      const closeMs = cu.dateFinPrev || cu.dateContractuelle || 0;
      trendMilestones.push(...defaultMilestones(bp, asOf, currentFy, { closeMs }));
    }
    const trend = billingTrend(invoices, trendMilestones, currentFy, asOf);
    trendForNews = trend;
    if (want("atterrissage")) w.push({ path: `summaries/billingTrend_${currentFy}`, data: { ...trend, ...stamp } });
  }
  // AM 360° : pilotage par commercial (CAS/CAF/backlog/pipeline/conversion/R-O), sans marge.
  if (want("pipeline") || want("ams")) w.push({ path: "summaries/ams", data: { ...am360(orders, invoices, opps, objectives, currentFy, tiers, excludeDormant), ...stamp } });
  // Funnel de conversion (Lot C) : dérivé de l'historique des transitions d'étape (oppHistory), construit
  // à partir de MAINTENANT (la source n'a pas d'historique). Lu uniquement sur want("pipeline").
  // Lecture BORNÉE de oppHistory (append-only, non purgé) : on ne relit que les N transitions les plus
  // récentes → coût de recompute borné dans le temps. Au-delà de N, le funnel devient une FENÊTRE
  // GLISSANTE (les plus anciennes sortent) — on l'expose HONNÊTEMENT via `truncated`/`windowSize` pour
  // que l'UI ne le présente plus comme « cumulatif » quand la borne est atteinte (cf. audit intégral A1).
  if (want("pipeline")) {
    const OPP_HISTORY_WINDOW = 5000;
    const histSnap = await db.collection("oppHistory").orderBy("at", "desc").limit(OPP_HISTORY_WINDOW).get();
    const truncated = histSnap.size >= OPP_HISTORY_WINDOW; // borne atteinte → funnel = fenêtre glissante
    const hist = histSnap.docs.map((d) => d.data());
    // Temps par étape : reconstitue les séjours par opp → besoin de l'horodatage résolu (ms), comme slippage.
    const histTs = hist.map((x) => ({ ...x, atMs: x.at && typeof x.at.toMillis === "function" ? x.at.toMillis() : 0 }));
    w.push({ path: "summaries/oppFunnel", data: { ...oppFunnel(hist), byStage: stageConversion(hist), dwell: stageDwell(histTs), truncated, windowSize: histSnap.size, ...stamp } });
    // Glissement des deals : journal des changements de D Prev (oppDateHistory), même fenêtre glissante.
    const slipSnap = await db.collection("oppDateHistory").orderBy("at", "desc").limit(OPP_HISTORY_WINDOW).get();
    const slipEvents = slipSnap.docs.map((d) => { const x = d.data() || {}; return { ...x, atMs: x.at && typeof x.at.toMillis === "function" ? x.at.toMillis() : 0 }; });
    w.push({ path: "summaries/oppSlippage", data: { ...slippageFromHistory(slipEvents), truncated: slipSnap.size >= OPP_HISTORY_WINDOW, windowSize: slipSnap.size, ...stamp } });
  }
  // Gate ALIGNÉ sur l'écriture de summaries/dataQuality (`want("alerts") || want("dataQuality")`) :
  // les alertes et le cockpit Qualité partagent des métriques identiques (surfacturation, factures non
  // rattachées) sur les MÊMES entrées. Des gates divergents laissaient un recalcul partiel rafraîchir
  // l'un sans l'autre → comptes incohérents entre les deux panneaux (ex. 61 vs 65 surfacturées).
  // Signaux ClickUp (retard de LIVRAISON + incohérences statut↔données) — calculés AVANT les alertes pour
  // alimenter le Centre d'alertes (retard de livraison → pilotage par exception, DO Lot 3) ; réutilisés
  // ensuite par Qualité (issues), Actualité (buildNews) et l'analytique délais.
  const { clickupSignals, clickupDelays } = require("../domain/clickupSignals");
  const cuSignals = clickupSignals(orders, clickupSyncMap, safeId, asOf);
  if (want("alerts") || want("dataQuality")) {
    // CLOISONNEMENT PAR MODULE (confidentialité opposable côté serveur, cf. audit P0-C) : une alerte
    // porte des données du module dont elle relève (noms fournisseurs saturés, montant de créances
    // orphelines, réfs BC en retard…). Chaque alerte est routée vers le summary gaté au bon niveau par
    // les règles Firestore — un rôle « overview » seul ne lit plus que les alertes overview. Modèle déjà
    // appliqué à la marge (alertsMargin). Le type d'alerte → module (défaut overview).
    const ALERT_MOD = {
      factures_non_rattachees: "facturation", facture_pre_po: "facturation", surfacturation: "facturation",
      facture_avant_commande: "facturation", commande_non_facturee: "facturation",
      raf_incoherent: "backlog", backlog_dormant: "backlog",
      ligne_saturee: "fournisseurs", ligne_tension: "fournisseurs",
      bc_en_attente: "bc", bc_en_retard: "bc",
      opp_dormante: "pipeline", opp_active_carnet: "pipeline",
      // Écart de valorisation amont : concerne les Commandes (droit `overview`) — défaut explicite.
      ecart_valorisation: "overview",
      // Retard de LIVRAISON → module backlog (comme clickupDelays) : signal d'exécution du carnet.
      livraison_en_retard: "backlog",
    };
    const allAlerts = alerts(orders, invoices, sup, bcLines, currentFy, asOf, opps, alertThr, cuSignals.overdue);
    const bucket = { overview: [], facturation: [], backlog: [], fournisseurs: [], bc: [], pipeline: [] };
    for (const a of allAlerts) { if (a.margin) continue; (bucket[ALERT_MOD[a.type] || "overview"]).push(a); }
    const meta = { fy: currentFy, ...stamp };
    w.push({ path: "summaries/alerts", data: { items: bucket.overview, ...meta } });           // overview
    w.push({ path: "summaries/alertsMargin", data: { items: allAlerts.filter((a) => a.margin), ...meta } }); // rentabilite
    w.push({ path: "summaries/alertsFacturation", data: { items: bucket.facturation, ...meta } });
    w.push({ path: "summaries/alertsBacklog", data: { items: bucket.backlog, ...meta } });
    w.push({ path: "summaries/alertsFournisseurs", data: { items: bucket.fournisseurs, ...meta } });
    w.push({ path: "summaries/alertsBc", data: { items: bucket.bc, ...meta } });
    w.push({ path: "summaries/alertsPipeline", data: { items: bucket.pipeline, ...meta } });
  }
  // Cockpit qualité des données : hygiène d'ingestion (champs manquants, rattachements, incohérences).
  const dqSummary = dataQuality(orders, invoices, opps, bcLines, projectSheets, alertThr, staleOpps, agedOpps, pnlOrders);
  // Incohérences statut↔données ClickUp → enrichissent le cockpit Qualité (cuSignals calculé plus haut,
  // avant les alertes, pour aussi alimenter le retard de livraison au Centre d'alertes — DO Lot 3).
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
    const news = buildNews({ att, pipeline: plSummary, backlog: bf, receivables: rec, suppliers: sup, billingTrend: trendForNews, dataQuality: dqSummary, opps, bcLines, clientErrors24h, clickupOverdue: cuSignals.overdueCount, clickupOverdueRefs: cuSignals.overdueRefs, bcClickupOverdue: bcCu.overdueCount, bcClickupOverdueRefs: bcCu.overdueRefs, clickupBlocked: cuBlockedRefs.length, clickupBlockedRefs: cuBlockedRefs, fy: currentFy, asOf, thr: alertThr });
    // CLOISONNEMENT PAR MODULE (cf. audit P0-C) : l'Actualité fuyait créances/DSO (facturation), noms de
    // fournisseurs saturés, concentration backlog vers tout rôle « overview ». Bulletins ET recommandations
    // sont routés par leur `domain` (donnée) vers des summaries gatés au bon niveau ; summaries/news ne
    // garde que l'overview. Le front recompose selon les droits.
    const NEWS_MOD = { facturation: "facturation", fournisseurs: "fournisseurs", suppliers: "fournisseurs", backlog: "backlog", bc: "bc", pipeline: "pipeline", commandes: "overview", qualite: "overview" };
    const nm = (o) => NEWS_MOD[o && o.domain] || "overview";
    const part = (arr) => { const p = { overview: [], facturation: [], fournisseurs: [], backlog: [], bc: [], pipeline: [] }; for (const x of arr || []) p[nm(x)].push(x); return p; };
    const cnt = (bs) => ({ high: bs.filter((b) => b.severity === "high").length, medium: bs.filter((b) => b.severity === "medium").length, info: bs.filter((b) => b.severity === "info").length });
    const pb = part(news.bulletins), pr = part(news.recommendations);
    const mkNews = (mod) => ({ generatedFor: news.generatedFor, bulletins: pb[mod], recommendations: pr[mod], counts: cnt(pb[mod]), ...stamp });
    w.push({ path: "summaries/news", data: mkNews("overview") });
    w.push({ path: "summaries/newsFacturation", data: mkNews("facturation") });
    w.push({ path: "summaries/newsFournisseurs", data: mkNews("fournisseurs") });
    w.push({ path: "summaries/newsBacklog", data: mkNews("backlog") });
    w.push({ path: "summaries/newsBc", data: mkNews("bc") });
    w.push({ path: "summaries/newsPipeline", data: mkNews("pipeline") });
  }
  // Commandes fusionnées matérialisées (lues par « Commandes » & le filtre de la Vue d'ensemble).
  // Découpées en CHUNKS (commandesRows/{i}) pour ne PAS dépasser la limite Firestore ~1 Mio/doc :
  // le doc unique summaries/commandes ne porte plus que la MÉTA (count + nombre de chunks).
  let commandeChunks = null;
  // Découplé de "overview" : les lignes de commande matérialisées (commandesRows*) dérivent des ORDERS,
  // pas de la chaîne overview. Un recompute ciblé d'opp NON gagnée (OPP_RECOMPUTE, qui inclut "overview"
  // pour rafraîchir certitudes/conversion mais PAS "commandes") ne réécrit donc pas les chunks (inchangés :
  // seule une opp GAGNÉE réconcilie un order via mergeCommandes). Ce cas-là passe OPP_RECOMPUTE_WON, qui
  // inclut "commandes" → les chunks sont régénérés. Un recompute COMPLET (only falsy) les régénère toujours.
  if (want("commandes")) {
    // La MARGE par ligne (mb / costTotal / marginPct) est ISOLÉE dans commandesRowsMargin/{i}
    // (lecture réservée à « Rentabilité ») ; les chunks de base ne portent que des grandeurs non
    // sensibles → confidentialité opposable côté serveur (pas seulement masquage UI).
    const isoDay = (ms) => (Number.isFinite(Number(ms)) && Number(ms) > 0 ? new Date(Number(ms)).toISOString().slice(0, 10) : null);
    const base = orders.map((o) => {
      const cu = clickupSyncMap[safeId(o.fp)] || null; // synchro inverse ClickUp (statut projet + dates)
      return {
        fp: o.fp, client: o.client || "", bu: o.bu || "AUTRE", am: o.am || "", affaire: o.affaire || null,
        cas: o.cas || 0, raf: o.raf || 0, facture: o.facture || 0, yearPo: o.yearPo || 0, source: o.source || null, pnlSource: o.pnlSource || null,
        casSource: o.casSource || null, // 'override' = CAS surchargé depuis l'opp (syncOrderAmount)
        pm: orderPmMap[safeId(o.fp)] || null, // Project Manager affecté (overlay config/orderPm)
        clickupStatus: cu ? (cu.status || null) : null,
        // Date de commande : l'overlay ClickUp PRIME (source ops temps réel) ; à défaut, on retombe sur la
        // date portée par la commande elle-même (import P&L ou synchro Odoo `date_order`) — sinon une date
        // synchronisée depuis Odoo serait perdue ici. `cu.dateCommande` = epoch ms, `o.dateCommande` = ISO.
        dateCommande: (cu && cu.dateCommande) ? isoDay(cu.dateCommande) : (o.dateCommande || null),
        dateCreation: o.dateCreation || null, // date de création côté source (Odoo create_date), passe-plat
        dateContractuelle: cu ? isoDay(cu.dateContractuelle) : null,
        dateFinPrev: cu ? isoDay(cu.dateFinPrev) : null,
        clickupTaskId: clickupLinksMap[safeId(o.fp)] || null,
        // Enrichissements ClickUp → app (Lot 4) : priorité, blocage, avancement checklists, temps passé.
        clickupPriority: cu ? (cu.priority || null) : null,
        clickupBlocked: cu ? !!cu.blocked : false,
        clickupProgress: cu && cu.progress != null ? cu.progress : null,
        clickupTimeSpentH: cu && cu.timeSpentMs ? Math.round(Number(cu.timeSpentMs) / 360000) / 10 : null,
        clickupLastComment: cu && cu.lastComment ? cu.lastComment : null, // dernière note ops ClickUp (webhook)
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
      // AR/DSO (encours créances / délai de paiement) RETIRÉS du point de tendance : `summaries/trends`
      // est lu au niveau « overview », or ce sont des données de facturation → un rôle sans droit
      // « facturation » ne doit pas reconstituer l'historique d'encours/DSO. Non affichés (cf. audit RBAC).
      fy: currentFy,
    };
    const prev = (await db.doc("summaries/trends").get()).data();
    const points = (prev?.points || []).filter((p) => p.date !== asOf);
    points.push(point);
    points.sort((a, b) => String(a.date).localeCompare(String(b.date)));
    w.push({ path: "summaries/trends", data: { points: points.slice(-180), ...stamp } }); // ~6 mois d'historique
  }

  // Attribution à un exercice via l'année BORNÉE (plausibleYear) — MÊME règle que l'atterrissage : une
  // commande à yearPo aberrant (1900, 20226) n'apparaît que dans « all », jamais dans un onglet d'année
  // fantôme (sinon divergence vue périodique ⇄ réalisé/atterrissage).
  const filterOrders = (arr, p) => (p === "all" ? arr : arr.filter((o) => String(plausibleYear(o.yearPo)) === p));

  // Périodes disponibles = "Tout" + chaque année de commande (yearPo), la plus récente d'abord.
  const years = [...new Set(orders.map((o) => plausibleYear(o.yearPo)).filter((y) => y > 0))].sort((a, b) => b - a).map(String);
  const periods = ["all", ...years];
  for (const period of periods) {
    const inv = filterInvoices(invoices, period); // factures DATÉES dans la période = CAF figé sur l'exercice
    const ord = filterOrders(orders, period); // commandes signées dans la période (yearPo)
    // Opportunités de la période = D Prev (closingDate) dans l'année sélectionnée. Les certitudes
    // GLISSENT sur l'exercice : une D Prev déjà passée DANS l'année compte toujours (cohérent avec
    // l'atterrissage). On écarte l'obsolète HORS année (N-1) et le prévu en N+1+. "Tout" = tout.
    // « Tout » : on retire les DORMANTES (année de closing < exercice courant) si le drapeau est actif —
    // sinon un espoir périmé (D Prev d'un millésime révolu, jamais reclassé) gonfle la prévision cumulée.
    // Les onglets d'année filtrent déjà par millésime (== period), donc l'exclusion n'y change rien.
    // Filtre de POPULATION (avant overview/pipeline/clients) ⇒ pondéré cohérent partout (invariant miroir).
    const oppP = period === "all"
      ? (excludeDormant ? opps.filter((o) => !isDormantClosing(o, currentFy)) : opps)
      : opps.filter((o) => yearOf(o.closingDate) === period);
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
    // `ord` (commandes de la période) → exclusion « déjà au carnet » IDENTIQUE à overview_${period} (parité Certitudes/Commit).
    // `dormant` (global, indépendant de la période) embarqué dans CHAQUE summary pipeline → la tuile
    // « Opportunité dormante » s'affiche quelle que soit la période choisie. `excludeDormant` tracé pour
    // que le front libelle correctement (exclu du pondéré vs simple signal).
    if (want("pipeline")) w.push({ path: `summaries/pipeline_${period}`, data: { period, ...pipeline(oppP, asOf, tiers, ord, geleMonths), dormant, excludeDormant, ...stamp } });
    if (want("facturation")) w.push({ path: `summaries/facturation_${period}`, data: { period, ...facturation(inv), ...stamp } });
    if (want("rentabilite")) w.push({ path: `summaries/rentabilite_${period}`, data: { period, ...rentabilite(ord, inv, orders), ...stamp } });
    // Clients/Domaines : la MARGE (mb/pmb) est isolée dans un doc *Margin_* lisible seulement avec
    // l'accès « Rentabilité » (confidentialité côté serveur) ; le doc de base ne porte que CAS/facturé/backlog.
    if (want("clients")) {
      const cl = byEntity(ord, inv, (x) => x.client, oppP, tiers); // oppP → forecast/projeté par client (Bilan CODIR)
      w.push({ path: `summaries/clients_${period}`, data: { period, rows: cl.map(({ mb, pmb, ...r }) => r), ...stamp } });
      w.push({ path: `summaries/clientsMargin_${period}`, data: { period, rows: cl.map(({ key, mb, pmb }) => ({ key, mb, pmb })), ...stamp } });
    }
    if (want("domaines")) {
      const dm = byEntity(ord, inv, (x) => x.bu, undefined, tiers);
      w.push({ path: `summaries/domaines_${period}`, data: { period, rows: dm.map(({ mb, pmb, ...r }) => r), ...stamp } });
      w.push({ path: `summaries/domainesMargin_${period}`, data: { period, rows: dm.map(({ key, mb, pmb }) => ({ key, mb, pmb })), ...stamp } });
    }
  }

  // ── PRÉ-FACTURATION CONSOLIDÉE (DO Lot 4) — matérialise la proposition de facturation (jours FACTURÉS au
  // CRA × TJM, Lot 21) dans summaries/preBilling, au lieu du seul callable à la demande preBillingFromCra :
  // le pilotage (DO/CODIR) dispose d'une pré-facturation VIVANTE + une alerte « à facturer en attente ».
  // Gaté rentabilite via les rules (préfixe preBilling → rentabilite : expose TJM/CA par ressource). Bloc
  // ADDITIF : lit consultants/timesheets(3 derniers mois)/assignments et ne pousse qu'un chemin NOUVEAU.
  // Réutilise la fonction PURE computePreBilling — aucune 2e vérité avec le callable (mêmes entrées). Gate
  // want("prebilling") : recompute complet le régénère ; un recompute ciblé ne l'écrase pas à vide.
  if (want("prebilling")) {
    const { excludeMaintenance } = require("../domain/timesheet");
    const { monthsRange } = require("../domain/assignment");
    const { computePreBilling } = require("../domain/preBilling");
    // Fenêtre : 3 derniers mois (cadrage du passé proche à transmettre à la compta), depuis asOf.
    const [ay, am] = asOf.slice(0, 7).split("-").map(Number);
    let sm = am - 2, sy = ay; while (sm < 1) { sm += 12; sy -= 1; }
    const fromYm = `${sy}-${String(sm).padStart(2, "0")}`;
    const pbMonths = monthsRange(fromYm, asOf.slice(0, 7));
    // Lecture BORNÉE à la fenêtre (month ≥ fromYm) — pas de scan de tout l'historique CRA à chaque recompute.
    const [cSnap, tSnap, aSnap] = await Promise.all([
      db.collection("consultants").select("name", "bu", "tjmTarget").get(),
      db.collection("timesheets").where("month", ">=", fromYm).get(),
      db.collection("assignments").select("consultantId", "startMonth", "endMonth", "tjmBilled", "projectFp", "label", "status").get(),
    ]);
    const pbConsultants = cSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    // Contribution mnt ÉCARTÉE (forfait, ADR-005) — cohérent avec le callable preBillingFromCra.
    const pbTimesheets = excludeMaintenance(tSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
    const pbAssignments = aSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const pb = computePreBilling(pbConsultants, pbTimesheets, pbAssignments, pbMonths);
    // Sans `lines` (détail réservé au callable) : summary consolidé compact (cap 1 Mio). `global.missingTjm`
    // = alerte « lignes à facturer sans TJM » (donnée d'annuaire manquante), lisible côté front.
    w.push({ path: "summaries/preBilling", data: { asOf, months: pbMonths, global: pb.global, byMonth: pb.byMonth, byBu: pb.byBu, byConsultant: pb.byConsultant, ...stamp } });
  }

  // ── RECONNAISSANCE DE REVENU (DO Lot 4b) — deux taux d'avancement par affaire (fpKey), MATÉRIALISÉS dans
  // summaries/recognition. FINANCIER = facturé/montant (jalon de facturation) ; OPÉRATIONNEL = avancement
  // ClickUp (progression checklist réelle, sinon statut ordinal, sinon null). Écart → FAE/PCA. Bloc ADDITIF
  // gaté want("recognition") : recompute complet le régénère, un recompute ciblé ne l'écrase pas. Ne lit que
  // `orders` (déjà en mémoire) + l'overlay clickupSync (déjà lu) + les fpKey des contrats de maintenance
  // (UNIQUEMENT si le module mnt est allumé — sinon aucune collision possible ET on préserve l'invariant
  // « éteint = aucune lecture mnt_* »). ANTI DOUBLE-COMPTE : les affaires sous contrat de maintenance sont
  // exclues (leur facturation est déjà pilotée par l'échéancier mnt — ADR-005).
  if (want("recognition")) {
    const { recognitionByFp } = require("../domain/recognition");
    const mntFpSet = new Set();
    const { isMntEnabled } = require("../domain/mntFeature");
    const recMntCfg = (await db.doc("config/mntFeature").get()).data();
    if (isMntEnabled(recMntCfg)) {
      const cs = await db.collection("mnt_contrats").select("fp").get();
      cs.forEach((d) => { const k = fpKey((d.data() || {}).fp); if (k) mntFpSet.add(k); });
    }
    const recRows = orders.map((o) => {
      const cu = clickupSyncMap[safeId(o.fp)] || null; // même source que les chunks du carnet (base)
      return { fp: o.fp, client: o.client || "", bu: o.bu || "AUTRE", am: o.am || "", cas: o.cas || 0, facture: o.facture || 0, clickupStatus: cu ? (cu.status || null) : null, clickupProgress: cu && cu.progress != null ? cu.progress : null };
    });
    const rec = recognitionByFp(recRows, mntFpSet);
    // rows plafonnées (top 200 par exposition FAE/PCA) pour rester loin de la limite 1 Mio ; global sur TOUT.
    w.push({ path: "summaries/recognition", data: { asOf, global: rec.global, rows: rec.rows.slice(0, 200), ...stamp } });
  }

  // ── CONTRATS DE MAINTENANCE (module gaté) — scores de risque MATÉRIALISÉS dans summaries/mnt_risque
  // (ADR-003, point de contact C3). DOUBLEMENT gaté : want("maintenance") ET drapeau config/mntFeature
  // ALLUMÉ. Éteint (défaut) ⇒ aucune lecture mnt_*, aucun summary mnt_risque écrit → le recompute est
  // STRICTEMENT identique à avant (invariant « éteint = ERP d'avant », C10). Bloc ENTIÈREMENT ADDITIF :
  // il ne lit que des collections mnt_* + invoices (déjà en mémoire) et ne pousse qu'un seul chemin
  // NOUVEAU (summaries/mnt_risque) — jamais un summary existant. Cf. functions/test/mntRisque* + garde
  // de caractérisation (recompute drapeau off ⇒ zéro écriture mnt_*).
  if (want("maintenance")) {
    const { isMntEnabled } = require("../domain/mntFeature");
    const mntCfg = (await db.doc("config/mntFeature").get()).data();
    if (isMntEnabled(mntCfg)) {
      const { mntRisque } = require("../domain/mntRisque");
      const { computeContratPnl, margeRisqueNiveau } = require("../domain/mntContratPnl");
      const { astreinteCostByFp: aggAstreinte } = require("../domain/mntAstreinte");
      const tsMs = (t) => (t && typeof t.toMillis === "function" ? t.toMillis() : (Number(t) || 0));
      const [mntContrats, mntTickets, mntInterv, mntAstreintes, consultantsSnap] = await Promise.all([
        readAll(db, "mnt_contrats", true), readAll(db, "mnt_tickets", true),
        readAll(db, "mnt_interventions", true), readAll(db, "mnt_astreintes", true), db.collection("consultants").select("cjm").get(),
      ]);
      // Horodatages Firestore → millisecondes à la FRONTIÈRE I/O (le domaine reste pur). Le mois
      // d'ouverture (quota) se dérive de ouvertLe.
      const ticks = mntTickets.map((t) => { const openMs = tsMs(t.ouvertLe); return { id: t.id, contratId: t.contratId, ouvertMs: openMs, priseEnCompteMs: t.priseEnCompteLe ? tsMs(t.priseEnCompteLe) : null, resoluMs: t.resoluLe ? tsMs(t.resoluLe) : null, dateJour: openMs ? new Date(openMs).toISOString().slice(0, 10) : null }; });
      // Rentabilité → PALIER de risque (ADR-034). On calcule la marge PRUDENTE côté serveur (hasCost=true,
      // le calcul est de confiance) via computeContratPnl — SOURCE UNIQUE de la marge, donc même nombre que
      // la vue Rentabilité — puis on ne matérialise QUE le palier (negative/faible), jamais le montant
      // confidentiel, dans summaries/mnt_risque (lu sous droit `maintenance`). coutTotal affaire = costTotal
      // du carnet (orders) rapproché par fpKey ; CJM des consultants pour la main-d'œuvre TMA.
      const cjmById = {};
      consultantsSnap.forEach((d) => { const x = d.data() || {}; if (x.cjm != null) cjmById[d.id] = Number(x.cjm); });
      const pnlCostByFp = {};
      for (const o of orders) { const k = fpKey(o.fp); if (k && o.costTotal != null) pnlCostByFp[k] = (pnlCostByFp[k] || 0) + (Number(o.costTotal) || 0); }
      const astreinteByFp = aggAstreinte(mntAstreintes); // charge des astreintes VALIDÉES par FP (ADR-035)
      const margeByContrat = {};
      for (const row of computeContratPnl(mntContrats, mntInterv, cjmById, asOf, true, pnlCostByFp, astreinteByFp)) {
        const lvl = margeRisqueNiveau(row); if (lvl) margeByContrat[row.id] = lvl;
      }
      const risque = mntRisque({ contrats: mntContrats, tickets: ticks, invoices, asOf, nowMs: Date.now(), margeByContrat });
      w.push({ path: "summaries/mnt_risque", data: { ...risque, ...stamp } });
      // Centre de surveillance (ADR-026) : flux d'événements PROJETÉ du risque (aucun recalcul) → cohérence
      // garantie avec summaries/mnt_risque. Même bloc gaté, même stamp. Lu sous droit `maintenance` + drapeau.
      const { mntSurveillance } = require("../domain/mntSurveillance");
      w.push({ path: "summaries/mnt_surveillance", data: { ...mntSurveillance(risque, asOf), ...stamp } });
    }
  }

  // ── PARTENARIATS & CERTIFICATIONS (module gaté) — CA par constructeur MATÉRIALISÉ dans summaries/par_ca
  // (ADR-P02/P04). DOUBLEMENT gaté : want("partenariats") ET drapeau config/parFeature ALLUMÉ. Éteint
  // (défaut) ⇒ aucune lecture par_*, aucun summary écrit → recompute STRICTEMENT identique à avant. Bloc
  // ADDITIF : ne lit que par_partners + l'overlay config/parPartnerMap + bcLines (déjà en mémoire) et ne
  // pousse qu'un chemin NOUVEAU (summaries/par_ca). Le CA est DÉRIVÉ des BC fournisseurs (aucune saisie) :
  // même source que le module Fournisseurs → pas de deuxième vérité.
  if (want("partenariats")) {
    const { isParEnabled } = require("../domain/parFeature");
    const parCfg = (await db.doc("config/parFeature").get()).data();
    if (isParEnabled(parCfg)) {
      const { revenueByPartner, blendRevenue } = require("../domain/parRevenue");
      const { coverageAll } = require("../domain/parQuota");
      const { certRenewalWatch, watchCounts } = require("../domain/parAlert");
      const { assignmentWatch, watchCounts: assignCounts } = require("../domain/parAssignment");
      const [parPartners, parCertifs, parAssigns] = await Promise.all([
        readAll(db, "par_partners", true), readAll(db, "par_certifications", true), readAll(db, "par_assignments", true),
      ]);
      const partnerMap = ((await db.doc("config/parPartnerMap").get()).data() || {}).map || {};
      const nameById = {}; for (const p of parPartners) nameById[p.id] = p.name;

      // Le statut d'une certif est FIGÉ à l'écriture (handler upsertParCertification) ; on le RE-DÉRIVE
      // ici à chaque recompute (asOf = aujourd'hui) pour que quotas/couverture reflètent le temps écoulé :
      // une certif écrite « active » il y a deux ans peut être expirée aujourd'hui. C'est le sweep quotidien
      // annoncé par domain/parCertification — source UNIQUE du statut « à date » (jamais le champ persisté).
      const { computeCertStatus } = require("../domain/parCertification");
      for (const c of parCertifs) c.status = computeCertStatus(c.expiryDate, asOf);

      // CA par constructeur : MÉLANGE BC dérivé + déclaratif (ADR-P02/P10). Le déclaratif d'un partenaire =
      // caDeclaredXof s'il est renseigné, sinon le réalisé booking YTD du plan d'affaires (repli sur la donnée
      // déjà saisie/importée). blendRevenue tranche : BC prime, déclaratif en repli — jamais additif (anti-double-compte).
      const { partners: caPartners, unmapped } = revenueByPartner(bcLines, partnerMap);
      const declaredByPartner = {};
      for (const p of parPartners) {
        const d = p.caDeclaredXof != null ? p.caDeclaredXof : (p.businessPlan && p.businessPlan.bookingYtd);
        const n = Number(d);
        if (Number.isFinite(n) && n > 0) declaredByPartner[p.id] = n;
      }
      const byPartner = blendRevenue(caPartners, declaredByPartner).map((g) => ({ ...g, name: nameById[g.partnerId] || g.partnerId }));
      const totalXof = byPartner.reduce((s, g) => s + g.revenueXof, 0);
      const bcXof = byPartner.reduce((s, g) => s + (g.source === "bc" ? g.revenueXof : 0), 0); // part réellement dérivée des BC
      const declaredXof = totalXof - bcXof; // le reste vient du déclaratif (repli)
      w.push({ path: "summaries/par_ca", data: { asOf, byPartner, unmapped: unmapped.slice(0, 20), totalXof, bcXof, declaredXof, ...stamp } });

      // Historisation quotidienne du CA (PA+ Lot 2, patron par_quotasHistory) : total + ventilation BC/déclaré,
      // pour la tendance. CONFIDENTIEL (préfixe par_ca ⇒ verrou `rentabilite` par les rules, comme par_ca).
      const prevCaHist = (await db.doc("summaries/par_caHistory").get()).data() || {};
      const caDays = (Array.isArray(prevCaHist.days) ? prevCaHist.days : []).filter((d) => d && d.date !== asOf);
      caDays.push({ date: asOf, totalXof, bcXof, declaredXof });
      caDays.sort((a, b) => (a.date < b.date ? -1 : 1));
      w.push({ path: "summaries/par_caHistory", data: { days: caDays.slice(-90), ...stamp } });

      // Quotas de certification (couverture par exigence) + statut de conformité par partenaire (ADR-P04).
      const certsByPartner = {}; for (const c of parCertifs) { (certsByPartner[c.partnerId] = certsByPartner[c.partnerId] || []).push(c); }
      const quotas = coverageAll(parPartners, certsByPartner);
      w.push({ path: "summaries/par_quotas", data: { asOf, partners: quotas, ...stamp } });

      // Alertes cycle de vie : liste de renouvellement des certifs ≤ 90 j / expirées (J-90/60/30/7/0).
      const watch = certRenewalWatch(parCertifs, asOf);
      w.push({ path: "summaries/par_alerts", data: { asOf, items: watch.slice(0, 200), counts: watchCounts(watch), total: watch.length, ...stamp } });

      // Relances d'assignation : assignations en retard ou dans une fenêtre de relance (J-30/14/7).
      const relances = assignmentWatch(parAssigns, asOf);
      const relanceCounts = assignCounts(relances);
      w.push({ path: "summaries/par_relances", data: { asOf, items: relances.slice(0, 200), counts: relanceCounts, ...stamp } });

      // Actualité partenariats (ADR-P09) : bulletins DÉRIVÉS des états ci-dessus (conformité, renouvellements,
      // retards) — PUR, sans toucher l'autorité buildNews. Écrit summaries/par_news (préfixe par_ ⇒ gaté
      // drapeau + droit `partenariats` par les mêmes rules ; aucun montant confidentiel). Le front l'agrège
      // au fil Actualité (comme newsFacturation/…). Contrairement à maintenance, le module CONTRIBUE au fil.
      const { parNews } = require("../domain/parNews");
      const renouv = { counts: watchCounts(watch), total: watch.length };
      const news = parNews({ quotas: { partners: quotas }, renouvellements: renouv, relances: { counts: relanceCounts } });
      w.push({ path: "summaries/par_news", data: { asOf, ...news, ...stamp } });

      // Historisation quotidienne de la couverture des quotas (tendance, Lot P3) — patron qualityHistory :
      // un point par jour (clé = asOf), idempotent (remplace le point du jour), fenêtre glissante 90 j.
      const { parQuotaHistoryPoint } = require("../domain/parQuota");
      const point = parQuotaHistoryPoint({ quotas, renouvellements: renouv });
      const prevHist = (await db.doc("summaries/par_quotasHistory").get()).data() || {};
      const histDays = (Array.isArray(prevHist.days) ? prevHist.days : []).filter((d) => d && d.date !== asOf);
      histDays.push({ date: asOf, ...point });
      histDays.sort((a, b) => (a.date < b.date ? -1 : 1));
      w.push({ path: "summaries/par_quotasHistory", data: { days: histDays.slice(-90), ...stamp } });
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

// ─────────────────────────────────────────────────────────────────────────────────────────────
// SÉRIALISATION DES RECOMPUTES (verrou + coalescing) — audit résilience.
// Problème : plusieurs recomputes peuvent se chevaucher (planifié 05:00 + recompute manuel + trigger
// d'ingestion + rafales de webhooks ClickUp). Chacun lit-puis-écrit summaries/* SANS exclusion → un
// recompute PLUS LENT (démarré avec des sources plus anciennes) peut TERMINER APRÈS un plus récent et
// ÉCRASER ses agrégats frais (stale-overwrites-fresh), ou produire un état incohérent (torn snapshot).
//
// Solution : un verrou de bail (config/recomputeLock, Admin SDK → hors rules) rend les recomputes
// MUTUELLEMENT EXCLUSIFs. Un appelant qui trouve le verrou tenu ne bloque pas : il MET EN FILE sa portée
// (`only`) — union des clés, `full` domine — et rend la main ; le détenteur, à la fin de sa passe, ABSORBE
// la file et rejoue jusqu'à l'épuiser (coalescing). Bail = filet anti-blocage : un détenteur mort (crash/
// timeout) voit son bail expirer et un autre appel le récupère. Le front s'abonnant en temps réel aux
// summaries, la cohérence est éventuelle (l'absorption converge en une passe supplémentaire par rafale).
const RECOMPUTE_LOCK_PATH = "config/recomputeLock";
// Bail > durée max d'une fonction (540 s) : un détenteur VIVANT ne dépasse jamais son bail (la plateforme
// le tuerait avant) → aucun vol en cours de passe ; seul un détenteur MORT est récupéré (après ≤ bail).
const RECOMPUTE_LEASE_MS = 600_000;

/** Fusionne une portée `only` entrante dans l'état de file. `only` falsy = recompute COMPLET (domine).
 *  Pur & testable. state: {queuedFull:boolean, queuedKeys:string[]}. */
function mergeQueued(state, only) {
  const full = !!(state && state.queuedFull) || !only;
  const prev = (state && Array.isArray(state.queuedKeys)) ? state.queuedKeys : [];
  const keys = full ? [] : Array.from(new Set([...prev, ...only]));
  return { queuedFull: full, queuedKeys: keys };
}

async function acquireOrEnqueue(db, only) {
  const ref = db.doc(RECOMPUTE_LOCK_PATH);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const d = snap.exists ? (snap.data() || {}) : {};
    const now = Date.now();
    const held = d.holder && typeof d.expiresAtMs === "number" && d.expiresAtMs > now;
    if (held) {
      const q = mergeQueued({ queuedFull: d.queuedFull, queuedKeys: d.queuedKeys }, only);
      tx.set(ref, { queued: true, queuedFull: q.queuedFull, queuedKeys: q.queuedKeys, queuedAtMs: now }, { merge: true });
      return { role: "enqueued" };
    }
    const holder = `${now}_${Math.floor(Math.random() * 1e9)}`;
    // Reprise de bail : une demande laissée EN FILE par un holder MORT (timeout/OOM avant de la drainer)
    // est ABSORBÉE dans la portée de ce nouvel holder — sinon le reset l'effacerait et l'agrégat concerné
    // resterait périmé jusqu'au recompute complet nocturne (cf. audit intégrité P1-3).
    const merged = d.queued ? mergeQueued({ queuedFull: d.queuedFull, queuedKeys: d.queuedKeys }, only) : null;
    const runOnly = merged ? (merged.queuedFull ? null : merged.queuedKeys) : only;
    tx.set(ref, { holder, acquiredAtMs: now, expiresAtMs: now + RECOMPUTE_LEASE_MS, queued: false, queuedFull: false, queuedKeys: [] }, { merge: true });
    return { role: "holder", holder, only: runOnly };
  });
}

/**
 * Point d'entrée SÉRIALISÉ (remplace l'ancien recomputeAll direct). Tous les appelants (callables,
 * triggers, planifiés) passent par ici → un seul recompute effectif à la fois, les autres coalescés.
 * @returns {Promise<{written:string[], currentFy?:number, periods?:object, coalesced?:boolean}>}
 */
/**
 * Enveloppe sérialisée générique : acquiert le verrou (ou coalesce), puis exécute `core(db, only)`
 * sous exclusion mutuelle, en absorbant les demandes accumulées. `core` est INJECTABLE pour permettre
 * un test d'intégration de la concurrence sous émulateur (sans dérouler tout le recompute réel).
 * recomputeAll délègue ici avec core = recomputeCore.
 */
async function runSerialized(db, only, core) {
  let acq;
  try {
    acq = await acquireOrEnqueue(db, only);
  } catch (e) {
    // Verrou indisponible (Firestore en erreur) : on NE bloque PAS le recompute — mieux vaut un
    // chevauchement possible qu'un agrégat jamais rafraîchi. Repli sur l'exécution directe.
    return core(db, only);
  }
  if (acq.role === "enqueued") return { written: [], coalesced: true };

  const ref = db.doc(RECOMPUTE_LOCK_PATH);
  // Libération CONDITIONNELLE : ne supprime le verrou QUE si on le détient encore (holder inchangé). Si le
  // bail avait expiré et qu'un autre holder a repris, on ne lui vole pas son verrou (cohérent avec la boucle
  // de drain, qui teste déjà d.holder===acq.holder). Couvre le chemin d'échec du core (catch).
  const release = () => db.runTransaction(async (tx) => {
    const d = (await tx.get(ref)).data() || {};
    if (d.holder && d.holder !== acq.holder) return; // repris par un autre → ne pas toucher
    tx.set(ref, { holder: FieldValue.delete(), acquiredAtMs: FieldValue.delete(), expiresAtMs: FieldValue.delete() }, { merge: true });
  });
  // Portée initiale = celle renvoyée par l'acquisition (peut inclure une file résiduelle absorbée à la
  // reprise d'un bail expiré, cf. acquireOrEnqueue) ; repli sur `only` pour toute forme ancienne.
  let runOnly = acq.only !== undefined ? acq.only : only;
  let result = { written: [] };
  try {
    // Boucle d'absorption : rejoue tant que des demandes se sont accumulées pendant la passe.
    for (;;) {
      result = await core(db, runOnly);
      const next = await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const d = snap.exists ? (snap.data() || {}) : {};
        if (d.holder !== acq.holder) return { action: "lost" }; // bail volé (expiré) → un autre a repris
        if (d.queued) {
          const pendingOnly = d.queuedFull ? null : (Array.isArray(d.queuedKeys) ? d.queuedKeys : []);
          tx.set(ref, { queued: false, queuedFull: false, queuedKeys: [], expiresAtMs: Date.now() + RECOMPUTE_LEASE_MS }, { merge: true });
          return { action: "drain", pendingOnly };
        }
        tx.set(ref, { holder: FieldValue.delete(), acquiredAtMs: FieldValue.delete(), expiresAtMs: FieldValue.delete() }, { merge: true });
        return { action: "release" };
      });
      if (next.action === "drain") { runOnly = next.pendingOnly; continue; }
      break; // release | lost
    }
  } catch (e) {
    // Échec du core : libérer le verrou pour ne pas immobiliser les recomputes jusqu'à l'expiration.
    try { await release(); } catch (_) { /* le bail expirera de toute façon */ }
    throw e;
  }
  return result;
}

async function recomputeAll(db, only) {
  return runSerialized(db, only, recomputeCore);
}

module.exports = { recomputeAll, recomputeCore, runSerialized, mergeQueued, acquireOrEnqueue, filterInvoices, sanitizeForFirestore, coerceNums };
