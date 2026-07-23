// Garde-fou des SCANS pleins de collection (R1 scalabilité) — borne mémoire/latence des callables
// d'administration (export, réconciliation, centre de correction, index d'import) qui lisent une
// collection entière. Au-delà du plafond, on TRONQUE en le SIGNALANT (jamais silencieusement) :
// l'appelant reçoit `capped:true` et journalise l'événement, plutôt que de charger un volume non borné.
//
// Fonctions PURES (aucun I/O) → testables. Le plafond est dimensionné très au-dessus des volumes métier
// réels (une ESN gère des milliers d'opportunités, pas des centaines de milliers).

const MAX_SCAN = 100_000;

// Décide si un lot lu dépasse le plafond et renvoie la tranche conservée + le drapeau `capped`.
// `docs` : tableau lu avec .limit(cap+1) (une lecture de plus que le plafond pour DÉTECTER le dépassement).
function sliceCapped(docs, cap = MAX_SCAN) {
  const arr = Array.isArray(docs) ? docs : [];
  const capped = arr.length > cap;
  return { docs: capped ? arr.slice(0, cap) : arr, capped };
}

module.exports = { MAX_SCAN, sliceCapped };
