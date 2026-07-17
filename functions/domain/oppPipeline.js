// Déduplication des opportunités par N° FP canonique — SOURCE UNIQUE de la dédup « famille pipeline »
// (cockpit/forecastRollup/scoring/vélocité/capacité). MÊME règle qu'aggregate.js : sinon des doublons de FP
// salesData (ids hérités ré-importés) ou une opp 'saisie' ré-importée en LIVE gonflent le pipeline et
// rompent l'invariant fort « même métrique = même nombre ».
//   - intra-source salesData : garder le PLUS RÉCENT (updatedAt) par FP ;
//   - inter-source : une 'saisie' dont le FP est couvert par une 'salesData' est écartée.
// PUR (aucune I/O) → testable. Les opps sans FP canonique passent telles quelles (rien à rapprocher).
const { fpKey } = require("../lib/ids");

// Millis d'un `updatedAt` (Timestamp Firestore ou nombre) — 0 si absent. Départage les doublons salesData.
function tsMillis(o) {
  const u = o && o.updatedAt;
  return u && typeof u.toMillis === "function" ? u.toMillis() : (Number(u) || 0);
}

/** Déduplique une liste d'opportunités par FP canonique (règle aggregate.js). PUR. */
function dedupOppsByFp(opps) {
  const bestSalesByFp = new Map();
  for (const o of opps || []) {
    if (o.source === "salesData") {
      const k = fpKey(o.fp);
      if (k && (!bestSalesByFp.has(k) || tsMillis(o) >= tsMillis(bestSalesByFp.get(k)))) bestSalesByFp.set(k, o);
    }
  }
  const salesFps = new Set(bestSalesByFp.keys());
  return (opps || []).filter((o) => {
    if (o.source === "salesData") { const k = fpKey(o.fp); if (k && bestSalesByFp.get(k) !== o) return false; }
    else if (o.source === "saisie") { const k = fpKey(o.fp); if (k && salesFps.has(k)) return false; }
    return true;
  });
}

module.exports = { dedupOppsByFp, tsMillis };
