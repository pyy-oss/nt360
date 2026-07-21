// Atterrissage annuel (BUILD_KIT §7) : projeté = Réalisé CAS(FY) + pipeline de PROJECTION
// (pondération tiérée par certitude, fenêtrée sur D Prev) → vs objectifs, écart, probabilité.
// Le backlog est exposé séparément (informatif) mais N'ENTRE PAS dans le projeté CAS (déjà
// couvert par le CAS réalisé). + comparaison N vs N-1 sur la facturation.
const { sum } = require("./chaine");
const { marginRate } = require("./reporting");
const { projectionWeight, normalizeTiers } = require("./projection");
const { reportedFromMilestones } = require("./milestones");
const { fpKey, plausibleYear } = require("../lib/ids");

const yearOf = (d) => (d ? String(d).slice(0, 4) : "");

// RAF PROJETABLE d'une commande cette année (neutralisation M2 du double compte facturé + RAF) :
// borné à ce qui RESTE réellement à facturer = max(min(RAF, CAS − facturé), 0). Source unique de la
// base facturable, partagée par l'atterrissage ET la tendance de facturation (zéro dérive entre eux).
const projetableBacklog = (o) => Math.max(Math.min(o.raf || 0, (o.cas || 0) - (o.facture || 0)), 0);

// Pondération de PROJECTION unifiée (domain/projection, niveaux configurables) :
// Certitudes ≥90 · Forecast 70-90 · Pipe 50-70, chacun activable/pondérable (défaut 100/20/5).

/**
 * @param {object[]} orders
 * @param {object[]} invoices
 * @param {object[]} opps
 * @param {object[]} objectives
 * @param {number} fy année fiscale courante
 * @param {string} [asOf] date du jour (YYYY-MM-DD) : borne basse de la fenêtre D Prev
 */
function atterrissage(orders, invoices, opps, objectives, fy, asOf, tiers, milestonesByFp) {
  const pw = (o) => projectionWeight(o, tiers || normalizeTiers());
  // ASSIETTE OPPOSABLE du Réalisé CAS : année de PO BORNÉE (plausibleYear écarte une année aberrante,
  // ex. 20226). Les commandes annulées sont déjà exclues en amont (overlay). Le CAS signé dont l'année
  // de PO est MANQUANTE/INVALIDE n'est attribuable à aucun exercice → exclu du réalisé, mais EXPOSÉ
  // (montant + nb) pour fiabiliser le R/O : ce sont des commandes « à dater » (via « Corriger »).
  const orderYear = (o) => plausibleYear(o.yearPo) || 0;
  const realiseCas = sum(orders.filter((o) => orderYear(o) === fy), (o) => o.cas);
  const undatedOrders = orders.filter((o) => (o.cas || 0) > 0 && !orderYear(o));
  const realiseCasUndated = sum(undatedOrders, (o) => o.cas);
  const realiseCasUndatedCount = undatedOrders.length;
  const backlog = sum(orders.filter((o) => (o.raf || 0) > 0), (o) => Math.max(o.raf || 0, 0));
  // Fenêtre D Prev = l'EXERCICE (D Prev dans l'année {fy}). Les certitudes GLISSENT jusqu'à
  // l'année en cours : une D Prev déjà PASSÉE dans l'exercice compte toujours (elle n'est pas
  // obsolète — elle est en retard mais sur l'année). On exclut seulement l'obsolète hors année :
  // D Prev en N-1 (année révolue) ou en N+1 et au-delà (non encore dans l'exercice).
  const inYear = (o) => yearOf(o.closingDate) === String(fy);
  const isActive = (o) => o.stage >= 1 && o.stage <= 5; // ni gagné (6), ni perdu (7), ni suspendu (8)
  // M1 — NEUTRALISATION du double compte : une opp encore « ouverte » dont le FP a DÉJÀ une ligne
  // commande (P&L) est déjà comptée dans le CAS réalisé → on l'EXCLUT du pipeline projeté, sinon
  // elle serait comptée deux fois dans projete (CAS + pipeline) et dans cafProjete. Le N° FP est
  // l'identifiant du deal : même FP = même affaire (pipeline LIVE non repassé « gagné »).
  // Aligné sur le COCKPIT (chaine/pipeline/overviewCalc) : seules les commandes de l'EXERCICE {fy} excluent
  // une opp ouverte du pipeline projeté. Une opp de l'exercice dont le FP n'est booké que sur une AUTRE année
  // n'est PAS réalisée cette année → elle reste projetée (parité stricte avec « Pondéré projeté » du cockpit,
  // qui borne l'exclusion « déjà au carnet » aux commandes de la période).
  const orderFps = new Set((orders || []).filter((o) => orderYear(o) === fy).map((o) => fpKey(o.fp)).filter(Boolean));
  const alreadyBooked = (o) => { const k = o.fp ? fpKey(o.fp) : ""; return !!k && orderFps.has(k); };
  // Pipeline de projection : opps actives de l'exercice, pondérées 100 %/20 % par certitude, hors
  // affaires déjà en commande (M1).
  const projOpps = opps.filter((o) => isActive(o) && inYear(o) && !alreadyBooked(o));
  const pipelinePondere = sum(projOpps, pw);
  // COHÉRENCE avec la vue Pipeline (closingAnalysis) : une D Prev déjà passée (au jour) est « en
  // retard de closing / à requalifier » là-bas. Ici elle compte TOUJOURS (design glissant : elle
  // n'est pas obsolète tant qu'elle est dans l'exercice), mais on EXPOSE la part de la projection
  // qui repose sur ces opps à requalifier — pour que l'atterrissage ne présente pas ce pipeline
  // comme entièrement « à jour » alors que Pipeline le signale en retard sur le même objet.
  const today = asOf ? String(asOf) : "";
  const retardOpps = today ? projOpps.filter((o) => o.closingDate && String(o.closingDate).slice(0, 10) < today) : [];
  const pipelineRetard = sum(retardOpps, pw);
  const pipelineRetardCount = retardOpps.length;
  const objGlobal = objectives.filter((o) => Number(o.fiscalYear) === fy && (!o.scope || o.scope === "global"));
  const objectif = sum(objGlobal, (o) => o.targetCas);       // cible CAS (prise de commande)
  const objectifCaf = sum(objGlobal, (o) => o.targetInvoiced); // cible CAF (facturation)
  const projete = realiseCas + pipelinePondere;

  const factureN = sum(invoices.filter((i) => yearOf(i.date) === String(fy)), (i) => i.amountHt);
  const factureN1 = sum(invoices.filter((i) => yearOf(i.date) === String(fy - 1)), (i) => i.amountHt);
  // Assiette opposable du Réalisé CAF : factures sans DATE → non attribuables à un exercice, exclues
  // du réalisé, exposées (à dater via « Factures »).
  const undatedInv = invoices.filter((i) => (i.amountHt || 0) > 0 && !yearOf(i.date));
  const factureNUndated = sum(undatedInv, (i) => i.amountHt);
  const factureNUndatedCount = undatedInv.length;

  // Projection CAF (facturation) : ce qui sera in fine facturé = déjà facturé (CAF réalisé)
  // + backlog écoulable (RAF des commandes signées, reste à facturer) + pipeline pondéré
  // (futures commandes facturables). Le backlog Y ENTRE (contrairement au projeté CAS, où
  // le CAS inclut déjà le RAF). Pas de double compte : facturé, RAF et futur sont disjoints.
  // M2 — NEUTRALISATION du double compte facturé + RAF : pour la projection CAF, le RAF de chaque
  // commande est borné à ce qui RESTE réellement à facturer (CAS − déjà facturé). Sans ce plafond,
  // un RAF curaté non décrémenté par la facturation, ou une facture mal rattachée, ferait compter
  // « facturé + RAF » au-delà du CAS de l'affaire. CONFINÉ à la projection : le Suivi Backlog
  // conserve le RAF curaté tel quel (fiable par construction, avec son propre diagnostic).
  //
  // REPORT DE CA sur N+1 (par projet) : SOURCE UNIQUE = les jalons de facturation. La part du RAF
  // échéancée APRÈS le 31/12 (Σ jalons post-exercice, bornée au RAF projetable) est reportée à
  // l'exercice SUIVANT → elle NE COMPTE PLUS dans le Projeté CAF courant. Aucun mécanisme manuel
  // concurrent : sans jalons post-31/12, le report est nul. `reporteCaf` est exposé (« reporté N+1 »).
  const msBy = milestonesByFp || {};
  let backlogProjete = 0, reporteCaf = 0, reporteMarge = 0;
  for (const o of orders || []) {
    const bp = projetableBacklog(o); // RAF projetable cette année (M2)
    const k = fpKey(o.fp);
    const rep = msBy[k] ? reportedFromMilestones(msBy[k], fy, bp) : 0;
    backlogProjete += bp - rep;
    reporteCaf += rep;
    // Marge reportée AU PRORATA : taux P&L de la commande × montant reporté (la marge suit le CA).
    // AUTORITÉ marginRate (audit rentabilité M1) : la réimplémentation locale sautait la normalisation
    // p>1 ⇒ /100 (piège P2-1) — latente ici (rep=0 quand CAS=0) mais armée au moindre assouplissement
    // du plafond. Une SEULE dérivation de taux de marge dans le dépôt.
    const rate = marginRate(o);
    reporteMarge += rate * rep;
  }
  const cafProjete = factureN + backlogProjete + pipelinePondere;

  // AMORCE D'ATTERRISSAGE N+1 : le CA reporté (backlog explicitement décalé) devient la base facturable
  // de l'exercice SUIVANT ; s'y ajoutent le pipeline dont la D Prev tombe en N+1 (hors affaires déjà
  // en commande) et le réalisé / facturé DÉJÀ enregistrés pour N+1. Le RAF glissant N'y entre PAS
  // (il est facturé en N) : seule la part reportée constitue le backlog entrant en N+1.
  const fyNext = fy + 1;
  // Anti double-compte N+1 (symétrie de M1) : une opp de closing N+1 dont le FP est DÉJÀ commandé en N+1
  // est réalisée → exclue du pipeline N+1. Sans cette borne (l'ancien code réutilisait `alreadyBooked`,
  // scopé à {fy}), elle comptait à la fois dans realiseCasNext ET pipelineNext → projeteNext sur-compté.
  const orderFpsNext = new Set((orders || []).filter((o) => orderYear(o) === fyNext).map((o) => fpKey(o.fp)).filter(Boolean));
  const alreadyBookedNext = (o) => { const k = o.fp ? fpKey(o.fp) : ""; return !!k && orderFpsNext.has(k); };
  const realiseCasNext = sum(orders.filter((o) => orderYear(o) === fyNext), (o) => o.cas);
  const factureNext = sum(invoices.filter((i) => yearOf(i.date) === String(fyNext)), (i) => i.amountHt);
  const pipelineNext = sum(opps.filter((o) => isActive(o) && yearOf(o.closingDate) === String(fyNext) && !alreadyBookedNext(o)), pw);
  const objGlobalNext = objectives.filter((o) => Number(o.fiscalYear) === fyNext && (!o.scope || o.scope === "global"));
  const objectifNext = sum(objGlobalNext, (o) => o.targetCas);
  const objectifCafNext = sum(objGlobalNext, (o) => o.targetInvoiced);
  const projeteNext = realiseCasNext + pipelineNext;
  const cafProjeteNext = factureNext + reporteCaf + pipelineNext; // reporté = backlog entrant en N+1
  const next = {
    fy: fyNext,
    realiseCas: realiseCasNext, factureN: factureNext,
    reporteEntrant: reporteCaf,          // CA reporté depuis N (amorce du CAF N+1)
    pipelinePondere: pipelineNext,
    projete: projeteNext, cafProjete: cafProjeteNext,
    objectif: objectifNext, ecart: projeteNext - objectifNext,
    objectifCaf: objectifCafNext, ecartCaf: cafProjeteNext - objectifCafNext,
  };

  return {
    fy,
    next,                  // amorce de projection de l'exercice suivant (alimentée par le reporté)
    realiseCas,
    // Assiette opposable : part du signé/facturé NON attribuable à l'exercice (année/date manquante),
    // exclue du réalisé et donc du R/O. À dater pour fiabiliser le ratio.
    realiseCasUndated, realiseCasUndatedCount,
    factureNUndated, factureNUndatedCount,
    backlog,
    backlogProjete,        // RAF plafonné à (CAS − facturé), NET du report N+1, utilisé dans cafProjete
    reporteCaf,            // CA reporté sur l'exercice suivant (exclu du cafProjete courant)
    reporteMarge,          // marge (P&L) reportée au prorata du CA reporté — DONNÉE MARGE (à isoler côté écriture)
    pipelinePondere,
    pipelineRetard,        // part (pondérée) du pipeline projeté dont la D Prev est dépassée (à requalifier)
    pipelineRetardCount,   // nombre d'opps concernées
    projete,
    cafProjete,
    objectif,
    ecart: projete - objectif,
    probaAtteinte: objectif > 0 ? Math.min(1, projete / objectif) : 0,
    // Atterrissage CAF (facturation) vs cible de facturation (targetInvoiced).
    objectifCaf,
    ecartCaf: cafProjete - objectifCaf,
    probaAtteinteCaf: objectifCaf > 0 ? Math.min(1, cafProjete / objectifCaf) : 0,
    factureN,
    factureN1,
    croissanceFacture: factureN1 > 0 ? (factureN - factureN1) / factureN1 : 0,
  };
}

module.exports = { atterrissage, projetableBacklog };
