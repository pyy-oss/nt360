// Dédup des opportunités LIVE — SOURCE UNIQUE partagée par le recompute (lib/aggregate.js) ET le
// Centre de correction (correctionQueue, index.js). Avant cette extraction, correctionQueue ré-implémentait
// la règle en ignorant Odoo et sans dédup intra-live → buckets sur-comptés vs cockpit Qualité dès
// qu'Odoo était actif (violation « même métrique = même nombre »). Module PUR (testable).
//
// Règles (ADR-050 — Odoo et l'import Excel sont deux sources LIVE de même autorité) :
//   1. INTRA-live : plusieurs docs LIVE ('salesData' | 'odoo') de MÊME FP → on ne garde que le PLUS
//      RÉCENT (updatedAt), toutes sources live confondues. Sans FP → pas de clé, pas de dédup.
//   2. INTER-source : une opp 'saisie' dont le FP est couvert par une opp LIVE est écartée (la version
//      live fait foi). liveFps se calcule AVANT toute exclusion stale/aged — sinon un FP live devenu
//      fantôme cesserait de masquer son jumeau saisie (résurrection au pipeline).
// MIROIR front : web/src/modules/overviewCalc.ts (mêmes règles, mêmes commentaires).
const { fpKey } = require("../lib/ids");

const isLiveSource = (o) => o && (o.source === "salesData" || o.source === "odoo");
// updatedAt peut être un Timestamp Firestore (recompute) ou un nombre (tests / données brutes).
const tsOf = (o) => { const u = o && o.updatedAt; return u && typeof u.toMillis === "function" ? u.toMillis() : (Number(u) || 0); };

/** Dédup intra-live par FP (le plus récent gagne, `>=` : à égalité le dernier lu l'emporte — comme
 *  le recompute historique). Renvoie { oppsDedup, liveFps } ; le masquage saisie est séparé
 *  (maskSaisieCovered) car les appelants splittent stale/aged sur oppsDedup AVANT de masquer. */
function dedupeLiveOpps(oppsRaw) {
  const bestLiveByFp = new Map();
  for (const o of oppsRaw || []) {
    if (!isLiveSource(o)) continue;
    const k = fpKey(o.fp); if (!k) continue;
    const prev = bestLiveByFp.get(k);
    if (!prev || tsOf(o) >= tsOf(prev)) bestLiveByFp.set(k, o);
  }
  const oppsDedup = (oppsRaw || []).filter((o) => {
    if (!isLiveSource(o)) return true;
    const k = fpKey(o.fp); if (!k) return true;
    return bestLiveByFp.get(k) === o;
  });
  const liveFps = new Set(oppsDedup.filter((o) => isLiveSource(o) && fpKey(o.fp)).map((o) => fpKey(o.fp)));
  return { oppsDedup, liveFps };
}

/** Écarte les opps 'saisie' dont le FP est couvert par une opp LIVE (liveFps de dedupeLiveOpps). */
function maskSaisieCovered(opps, liveFps) {
  return (opps || []).filter((o) => !(o && o.source === "saisie" && fpKey(o.fp) && liveFps.has(fpKey(o.fp))));
}

module.exports = { dedupeLiveOpps, maskSaisieCovered, isLiveSource };
