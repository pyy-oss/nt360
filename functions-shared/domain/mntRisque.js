// Domain PUR — Moteur de risque des contrats de maintenance (mnt_), Lot 5. Aucun I/O.
// Agrège, PAR CONTRAT ACTIF, cinq signaux décidés par la direction et en dérive un score [0..100]
// et un niveau à quatre paliers (Vert/Ambre/Rouge/Critique = emerald/gold/clay/plum, ADR-008/014).
// Matérialisé dans summaries/mnt_risque par le recompute (ADR-003). Les horodatages arrivent DÉJÀ
// convertis en millisecondes par l'appelant (frontière I/O) → le calcul reste pur et testable.
//
// Les 5 signaux (décision direction, Lot 5 + DO Lot 5) :
//   1. SLA rompus       — tickets du contrat dont un engagement SLA est en état « rompu » (slaState).
//   2. Échéance proche  — dateFin du contrat à ≤ 90 jours (ou déjà dépassée) → renouvellement à traiter.
//   3. Quota dépassé    — tickets ouverts ce mois-ci au-delà du quota d'un engagement.
//   4. Sous-facturation — engagé (échéancier) > facturé (factures de l'affaire par fpKey), écart > 0.
//   5. Rentabilité      — marge prudente (revenu engagé − coût total affaire) sous son palier sain (ADR-034).
//                         L'appelant fournit un PALIER (negative/faible), JAMAIS le montant : le coût est
//                         confidentiel et ne doit pas transiter par le summary lu sous droit `maintenance`.
const { fpKey, cleanName, cleanBu, cleanPerson } = require("../lib/ids");
const { slaState } = require("./mntSla");
const { echeancier } = require("./mntEcheancier");
const { monthOf } = require("./mntTicket");

// Seuls les contrats VIVANTS portent un risque : un brouillon n'est pas encore engagé ; un contrat
// échu/résilié est terminal (plus de pilotage). On score donc `actif` et `suspendu`.
const RISK_STATUTS = new Set(["actif", "suspendu"]);
// ADR-041 (décision décideur, remplace la décision Lot 5 à 60 j) : fenêtre d'alerte d'échéance UNIFIÉE à
// 90 j, alignée sur le rappel de renouvellement (buckets renouvellement 30/60/90). Autorité unique du seuil ;
// le miroir front (web/src/lib/mntDashboard.ts) DOIT porter la même valeur (invariant « même métrique »).
const ECHEANCE_PROCHE_JOURS = 90; // fenêtre d'alerte de renouvellement (ADR-041)

const parseDay = (iso) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || "")); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : null; };
const round2 = (x) => Math.round((Number(x) || 0) * 100) / 100;

/**
 * Score de risque par contrat. Entrées (déjà normalisées côté appelant) :
 *  - contrats: [{ id, fp, client, am, bu, statut, dateDebut, dateFin, echeanceType, montantEngage, engagements[] }]
 *  - tickets:  [{ id, contratId, ouvertMs, priseEnCompteMs|null, resoluMs|null, dateJour('AAAA-MM-JJ') }]
 *  - invoices: [{ fp, amountHt }]  (source unique de facturation, rapprochée par fpKey — ADR-005)
 *  - margeByContrat: { [contratId]: "negative"|"faible" }  PALIER de marge (jamais le montant — ADR-034),
 *      dérivé côté appelant par margeRisqueNiveau(computeContratPnl). Absent = marge saine/inconnue.
 *  - asOf: 'AAAA-MM-JJ' (aujourd'hui) ; nowMs: millisecondes (horloge SLA « maintenant »)
 *  - calendar: { offMin, holidays:Set, b2b } optionnel (fuseau/fériés/fenêtre B2B — ADR-P23). Absent =
 *      horloge historique (UTC, Lun–Ven pleins, pas de férié) → aucun changement du score.
 * → { items[], counts{vert,ambre,rouge,critique}, total, atRisk, asOf }
 */
function mntRisque({ contrats, tickets, invoices, asOf, nowMs, margeByContrat, calendar } = {}) {
  const conts = Array.isArray(contrats) ? contrats : [];
  const ticks = Array.isArray(tickets) ? tickets : [];
  const invs = Array.isArray(invoices) ? invoices : [];
  const margeBy = (margeByContrat && typeof margeByContrat === "object") ? margeByContrat : {};
  const today = parseDay(asOf);
  const now = Number(nowMs) || 0;
  const mois = String(asOf || "").slice(0, 7); // 'AAAA-MM' du mois courant (quota)

  // Facturé réel par affaire, rapproché par fpKey (jamais le FP brut — CLAUDE.md/ADR-001).
  const factureByFp = new Map();
  for (const inv of invs) { const k = fpKey(inv && inv.fp); if (!k) continue; factureByFp.set(k, (factureByFp.get(k) || 0) + (Number(inv.amountHt) || 0)); }

  // Tickets regroupés par contrat.
  const ticksByContrat = new Map();
  for (const t of ticks) { const c = t && t.contratId; if (!c) continue; if (!ticksByContrat.has(c)) ticksByContrat.set(c, []); ticksByContrat.get(c).push(t); }

  const items = [];
  const counts = { vert: 0, ambre: 0, rouge: 0, critique: 0, incomplet: 0 };
  for (const c of conts) {
    if (!c || !RISK_STATUTS.has(String(c.statut))) continue;
    const fpk = fpKey(c.fp);
    const engagements = Array.isArray(c.engagements) ? c.engagements : [];
    const myTickets = ticksByContrat.get(c.id) || [];
    const signals = [];
    let score = 0;

    // 1. SLA rompus — un ticket compte une fois s'il rompt AU MOINS UN de ses engagements. L'engagement
    // « resolution » se mesure sur resoluLe, « prise_en_compte » sur priseEnCompteLe.
    let slaRompus = 0;
    for (const t of myTickets) {
      const openMs = Number(t.ouvertMs) || 0;
      if (!openMs) continue;
      // OPPOSABILITÉ (ADR-P24) : le SLA se mesure sur les engagements FIGÉS à l'ouverture du ticket
      // (engagementsSnapshot), avec REPLI sur les engagements COURANTS du contrat si le snapshot est absent
      // (tickets antérieurs au versionnement). Snapshot absent ⇒ engs === engagements ⇒ sortie byte-identique.
      const engs = Array.isArray(t.engagementsSnapshot) ? t.engagementsSnapshot : engagements;
      let rompu = false;
      for (const e of engs) {
        // Horodatage de l'atteinte selon le type d'engagement. Pour « prise en compte », un ticket
        // résolu DIRECTEMENT (ouvert→resolu, sans passer par en_cours) n'a jamais de priseEnCompteLe :
        // il a pourtant été pris en compte AU PLUS TARD à sa résolution → on retombe sur resoluMs
        // (sinon markMs=null ferait basculer tout premier-contact ancien en « rompu » à tort).
        const markMs = e && e.type === "prise_en_compte"
          ? (t.priseEnCompteMs != null ? Number(t.priseEnCompteMs) : (t.resoluMs != null ? Number(t.resoluMs) : null))
          : (t.resoluMs != null ? Number(t.resoluMs) : null);
        if (slaState(e, openMs, markMs, now, calendar).state === "rompu") { rompu = true; break; }
      }
      if (rompu) slaRompus += 1;
    }
    if (slaRompus > 0) { signals.push({ type: "sla_rompu", count: slaRompus }); score += Math.min(40, slaRompus * 20); }

    // 2. Échéance proche — dateFin à ≤ 90 j (ou passée, ADR-041). Plus c'est proche/dépassé, plus le poids monte.
    let joursAvantFin = null;
    const finMs = parseDay(c.dateFin);
    if (finMs != null && today != null) {
      joursAvantFin = Math.round((finMs - today) / 86400000);
      if (joursAvantFin <= ECHEANCE_PROCHE_JOURS) {
        signals.push({ type: "echeance_proche", jours: joursAvantFin });
        score += joursAvantFin <= 0 ? 30 : joursAvantFin <= 30 ? 25 : 15;
      } // sinon joursAvantFin reste renseigné (affichage informatif), sans signal ni score
    }

    // 3. Quota dépassé — quota = nb de tickets/mois par engagement ; le plus contraignant (min) fait foi.
    let quotaDepasse = 0;
    const quotas = engagements.map((e) => e && e.quota).filter((q) => q != null && q >= 0);
    if (quotas.length) {
      const quotaMin = Math.min(...quotas);
      const ouvertsCeMois = myTickets.reduce((n, t) => n + (monthOf(t.dateJour) === mois ? 1 : 0), 0);
      if (ouvertsCeMois > quotaMin) { quotaDepasse = ouvertsCeMois - quotaMin; signals.push({ type: "quota_depasse", depassement: quotaDepasse, quota: quotaMin }); score += 20; }
    }

    // 4. Sous-facturation — engagé (échéancier) > facturé réel (ERP). Écart pondéré par sa proportion.
    const ech = echeancier(c, fpk ? (factureByFp.get(fpk) || 0) : 0, asOf);
    let sousFactPct = 0;
    if (ech.engage > 0 && ech.ecart > 0) {
      sousFactPct = ech.ecart / ech.engage;
      signals.push({ type: "sous_facturation", ecart: ech.ecart, engage: ech.engage, facture: ech.facture, pct: round2(sousFactPct) });
      score += Math.min(25, Math.round(sousFactPct * 50));
    }

    // 5. Rentabilité — palier de marge FOURNI par l'appelant (jamais recalculé ici : le coût est
    // confidentiel et ne transite pas par le domaine du risque). « negative » (le contrat ne couvre pas
    // son coût) pèse plus que « faible » (marge trop mince). Le montant reste dans le callable gaté.
    const margeNiveau = margeBy[c.id] === "negative" || margeBy[c.id] === "faible" ? margeBy[c.id] : null;
    if (margeNiveau) { signals.push({ type: "marge_faible", severite: margeNiveau }); score += margeNiveau === "negative" ? 30 : 15; }

    score = Math.min(100, Math.round(score));
    // COMPLÉTUDE (R6 — « ne pas mentir par autorité ») : un contrat SANS aucune donnée de pilotage — ni
    // engagement SLA/quota, ni montant engagé — n'a RIEN à scorer → il paraîtrait « Vert » (sain) à tort. On
    // distingue « incomplet » (données à compléter) du « vert » (sain, données présentes). Un engagement OU un
    // montant suffit à rendre le contrat scorable (une dateFin absente = tacite reconduction, pas une lacune).
    // Un contrat AVEC signaux garde de toute façon son niveau réel (ce garde-fou ne concerne que le score 0).
    const complet = engagements.length > 0 || (Number(c.montantEngage) || 0) > 0;
    const niveau = score === 0 ? (complet ? "vert" : "incomplet") : score < 30 ? "ambre" : score < 60 ? "rouge" : "critique";
    counts[niveau] += 1;
    items.push({
      id: c.id, fp: c.fp || null, client: cleanName(c.client) || "", am: cleanPerson(c.am) || "", bu: cleanBu(c.bu) || "",
      statut: String(c.statut), score, niveau, signals,
      slaRompus, joursAvantFin, quotaDepasse, margeNiveau,
      sousFacturation: { engage: ech.engage, facture: ech.facture, ecart: ech.ecart },
    });
  }

  // Tri : le plus à risque d'abord (score décroissant, puis échéance la plus proche).
  items.sort((a, b) => (b.score - a.score) || ((a.joursAvantFin ?? 1e9) - (b.joursAvantFin ?? 1e9)));
  // « À risque » = ni sain (vert) NI non scoré (incomplet) — un contrat incomplet est une dette de saisie,
  // pas un risque avéré ; il ne doit pas gonfler l'indicateur de risque.
  const atRisk = items.length - counts.vert - counts.incomplet;
  return { items, counts, total: items.length, atRisk, asOf: asOf || null };
}

module.exports = { RISK_STATUTS, ECHEANCE_PROCHE_JOURS, mntRisque };
