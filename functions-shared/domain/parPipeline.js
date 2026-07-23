// Domain PUR — pipeline commercial SOURCÉ PARTENAIRE (par_). Aucun I/O → testable.
// Une opportunité peut être TAGUÉE d'un constructeur (champ additif `parPartnerId`, slug du référentiel
// par_partners) : affaires co-vendues / sourcées via le programme partenaire. Cet agrégat matérialise,
// PAR CONSTRUCTEUR, le pipeline ouvert, son pondéré de projection (MÊME autorité projectionWeight que la
// prévision — jamais le champ linéaire `weighted`) et le gagné de l'année — la contrepartie MESURÉE du
// `pipelineYtd` déclaré du plan d'affaires (bpAchievement), qui reste saisi à la main.
// Montants en XOF ENTIER (le FCFA n'a pas de subdivision — règle de l'ERP).

const { projectionWeight } = require("./projection");
const { plausibleYear } = require("../lib/ids");

// Millésime civil d'une opp GAGNÉE : année de la D Prev (closingDate), passée par plausibleYear (une
// année aberrante ne classe pas l'opp dans un « gagné YTD » fantôme — elle tombe en 0 = non datée).
function wonYear(o) {
  const y = String((o && o.closingDate) || "").slice(0, 4);
  return /^\d{4}$/.test(y) ? plausibleYear(y) : 0;
}

/**
 * Agrège le pipeline sourcé partenaire. Opps SANS parPartnerId : ignorées (le pipeline général reste
 * l'affaire de summaries/pipeline — ici, seule la part rattachée à un constructeur compte).
 * - ouvert  : étapes 1-5 (ni gagné 6, ni perdu 7) — montant + pondéré projectionWeight(tiers).
 * - gagné   : étape 6 dont le millésime (closingDate) est l'année de `year` ; opp gagnée NON datée
 *   (millésime 0) : comptée dans l'année courante (l'écarter sous-compterait le sourcé — même règle
 *   que le CA constructeur pour un BC non daté).
 * @param opps  opportunités DÉDUPLIQUÉES (sortie liveOpps d'aggregate — pas de re-dédup ici)
 * @param opts.year  année civile de l'exercice (ex. 2026) pour le « gagné YTD »
 * @param opts.tiers  paliers normalisés de config/projection (normalizeTiers) — pondéré cohérent prévision
 * @returns { partners: [{ partnerId, openXof, openWeightedXof, openCount, wonXof, wonCount }], totalOpenXof, totalWonXof }
 */
function pipelineByPartner(opps, opts = {}) {
  const year = Number(opts.year) || 0;
  const tiers = opts.tiers || null;
  const byPartner = {};
  for (const o of opps || []) {
    const pid = String((o && o.parPartnerId) || "").trim();
    if (!pid) continue;
    const stage = Number(o.stage) || 0;
    if (stage === 7) continue; // perdue : hors pipeline sourcé (l'analytique win/loss vit ailleurs)
    const amt = Math.max(0, Number(o.amount) || 0);
    const g = byPartner[pid] || { partnerId: pid, openXof: 0, openWeightedXof: 0, openCount: 0, wonXof: 0, wonCount: 0 };
    if (stage === 6) {
      const y = wonYear(o);
      if (!year || y === 0 || y === year) { g.wonXof += amt; g.wonCount += 1; }
    } else {
      g.openXof += amt;
      g.openWeightedXof += projectionWeight(o, tiers);
      g.openCount += 1;
    }
    byPartner[pid] = g;
  }
  const round = (g) => ({ ...g, openXof: Math.round(g.openXof), openWeightedXof: Math.round(g.openWeightedXof), wonXof: Math.round(g.wonXof) });
  const partners = Object.values(byPartner).map(round)
    .sort((a, b) => (b.openXof + b.wonXof) - (a.openXof + a.wonXof));
  return {
    partners,
    totalOpenXof: partners.reduce((s, g) => s + g.openXof, 0),
    totalWonXof: partners.reduce((s, g) => s + g.wonXof, 0),
  };
}

module.exports = { pipelineByPartner, wonYear };
