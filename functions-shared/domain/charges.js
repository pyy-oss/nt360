// SUPPRESSION DE CHARGE (ADR-069) — module PUR. Une ligne d'achat PLANIFIÉ de fiche « supprimée »
// par arbitrage humain (overlay config/cancelCharges, non destructif, rétablissable) est EXCLUE des
// lignes BC ET son montant est RETIRÉ du coût planifié de l'affaire (costTotal ↓, marge ↑, %MB
// recalculé sur la vente) — retrait TOTAL y compris du P&L, sans toucher aux docs (l'overlay survit
// aux ré-imports de fiche). Seules les lignes source « fiche » sont concernées : les BC RÉELS
// s'annulent par statut (ADR-068), jamais par cet overlay. MUTE bcLines et sheets EN PLACE (même
// contrat que les autres réconciliations du recompute — alias, éviction ClickUp).
const { fpKey } = require("../lib/ids");

/**
 * @param {object[]} bcLines lignes BC (avec id/_id, source, fp, amountXof) — mutées en place
 * @param {object[]} sheets fiches fusionnées (fp, costTotal, margin, marginPct, saleTotal) — mutées en place
 * @param {Set<string>} cancelledIds ids bcLines des charges supprimées (config/cancelCharges)
 * @returns {number} nombre de lignes exclues
 */
function applyChargeDrops(bcLines, sheets, cancelledIds) {
  if (!cancelledIds || !cancelledIds.size) return 0;
  const adjByFp = {};
  let dropped = 0;
  for (let i = bcLines.length - 1; i >= 0; i--) {
    const b = bcLines[i];
    if (!b || b.source !== "fiche" || !cancelledIds.has(b.id || b._id)) continue;
    const k = fpKey(b.fp);
    if (k) adjByFp[k] = (adjByFp[k] || 0) + (Number(b.amountXof) || 0);
    bcLines.splice(i, 1);
    dropped++;
  }
  for (const s of sheets || []) {
    const adj = adjByFp[fpKey(s.fp)];
    if (!(adj > 0)) continue;
    // marge = vente − coût : retirer une charge remonte la marge d'autant ; %MB recalculé sur la vente.
    if (typeof s.costTotal === "number") s.costTotal = Math.max(0, s.costTotal - adj);
    if (typeof s.margin === "number") s.margin += adj;
    if (typeof s.margin === "number" && Number(s.saleTotal) > 0) s.marginPct = s.margin / Number(s.saleTotal);
  }
  return dropped;
}

module.exports = { applyChargeDrops };
