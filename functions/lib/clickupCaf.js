// Synchro du CAF (CA Facturé) commande → tâche ClickUp. La décision « quoi pousser » est PURE et
// testable : on ne pousse que les tâches dont le CAF a CHANGÉ depuis le dernier envoi (overlay
// config/clickupCaf), sauf en mode forcé (bouton « Forcer la synchro »). Évite de marteler l'API
// ClickUp à chaque recompute alors que la plupart des CAF sont inchangés.

/**
 * @param {Object<string,string>} links   clé safeId(fp) → id de tâche ClickUp (config/clickupLinks)
 * @param {Object<string,number>} lastMap  clé → dernier CAF poussé (config/clickupCaf)
 * @param {Object<string,number>} cafByFp  clé → CAF courant (commandes matérialisées)
 * @param {boolean} force  pousse tout, même inchangé
 * @returns {{ toPush: {key,taskId,caf}[], nextMap: Object<string,number>, skipped: number }}
 *   nextMap pré-remplit les clés INCHANGÉES ; les clés à pousser sont ajoutées par l'appelant après
 *   succès (pour qu'un échec soit re-tenté au prochain passage).
 */
function diffCaf(links, lastMap, cafByFp, force) {
  const last = lastMap || {};
  const caf = cafByFp || {};
  const toPush = [];
  const nextMap = {};
  let skipped = 0;
  for (const [key, taskId] of Object.entries(links || {})) {
    const cur = Number(caf[key] || 0);
    if (!force && last[key] === cur) { nextMap[key] = cur; skipped++; continue; }
    toPush.push({ key, taskId, caf: cur });
  }
  return { toPush, nextMap, skipped };
}

module.exports = { diffCaf };
