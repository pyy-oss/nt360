// Diagnostic de QUALITÉ de l'intégration ClickUp (PUR, testable) : croise les commandes de l'app, les
// tâches de la liste ClickUp, et les overlays (liens / synchro inverse / CAF poussé) pour mesurer la
// couverture et les écarts. Aucune I/O ici — les tâches et overlays sont fournis par l'appelant.
const { taskFp } = require("../lib/clickupFields");

// Lit un champ personnalisé numérique (ex. « CA Facturé ») d'une tâche.
function taskNumField(task, name) {
  const cfs = (task && task.custom_fields) || [];
  const q = String(name || "").trim().toLowerCase();
  const f = cfs.find((c) => String(c.name || "").trim().toLowerCase() === q);
  const n = f && f.value != null ? Number(f.value) : NaN;
  return Number.isFinite(n) ? n : 0;
}

/**
 * @param {object[]} orders   commandes (fp, client, facture)
 * @param {object[]} tasks    tâches ClickUp de la liste (id, name, custom_fields)
 * @param {object} links      config/clickupLinks.map { safeId(fp): taskId }
 * @param {object} syncMap    config/clickupSync.map  { safeId(fp): {...} }
 * @param {(fp)=>string} fpKey  ; safeId(fp)
 * @param {(canonicalFp)=>boolean} [hasDc]  ÉLIGIBILITÉ ClickUp (ADR-079) : le N° FP a-t-il un DC lié ?
 *   Défaut `() => true` (rétro-compatible : sans info DC, toutes les commandes restent éligibles).
 */
function clickupHealth(orders, tasks, links, syncMap, fpKey, safeId, hasDc = () => true) {
  const L = links || {}, S = syncMap || {};
  const cmdFpSet = new Set();
  // Index tâche par FP (Opp ID) → { id, caf }. On COMPTE aussi les tâches par FP pour rendre VISIBLES les
  // doublons (plusieurs tâches ClickUp pour un même N° FP) — l'ancien index silencieux (« garde la 1re »)
  // masquait totalement les doublons créés avant le verrou anti-concurrence (« zéro visibilité »).
  const taskByFp = {};
  const countByFp = {};        // FP canonique → nb de tâches ClickUp portant ce FP
  let tasksWithFp = 0;
  for (const t of tasks || []) {
    const raw = taskFp(t);
    if (raw) {
      tasksWithFp++;
      const k = fpKey(raw);
      if (k) {
        countByFp[k] = (countByFp[k] || 0) + 1;
        if (!(k in taskByFp)) taskByFp[k] = { id: t.id, caf: taskNumField(t, "CA Facturé") };
      }
    }
  }
  // Doublons : pour chaque FP porté par ≥ 2 tâches, les tâches SURNUMÉRAIRES (count − 1) sont des doublons.
  let duplicateTasks = 0, duplicateFps = 0; const duplicateSample = [];
  for (const k of Object.keys(countByFp)) {
    if (countByFp[k] > 1) {
      duplicateFps++;
      duplicateTasks += countByFp[k] - 1;
      if (duplicateSample.length < 12) duplicateSample.push({ fp: k, count: countByFp[k] });
    }
  }

  let commandesTotal = 0, linked = 0, synced = 0, cafGapCount = 0, cafGapTotal = 0;
  const unlinked = [];
  for (const o of orders || []) {
    const fp = fpKey(o.fp); if (!fp) continue;
    commandesTotal++; cmdFpSet.add(fp);
    const id = safeId(fp);
    if (L[id]) {
      linked++;
      // Écart CAF : CA Facturé app vs tâche (à l'arrondi près).
      const t = taskByFp[fp];
      if (t) { const gap = Math.round(Number(o.facture || 0)) - Math.round(Number(t.caf || 0)); if (gap !== 0) { cafGapCount++; cafGapTotal += Math.abs(gap); } }
    } else {
      // hasDc : éligibilité ClickUp (un DC doit être lié au N° FP). Non éligible → ni créable ici, ni comptée créable.
      unlinked.push({ fp: o.fp, client: o.client || "", matchable: !!taskByFp[fp], hasDc: !!hasDc(fp) });
    }
    if (S[id]) synced++;
  }

  // Tâches ClickUp orphelines : sans Opp ID, ou dont le FP ne correspond à aucune commande.
  let orphanTasks = 0; const orphanSample = [];
  for (const t of tasks || []) {
    const raw = taskFp(t);
    const fp = raw ? fpKey(raw) : null;
    if (!fp || !cmdFpSet.has(fp)) { orphanTasks++; if (orphanSample.length < 12) orphanSample.push({ id: t.id, name: (t.name || "").slice(0, 80), fp: raw || null }); }
  }

  // LIENS FANTÔMES (dérive) : un lien app→tâche (config/clickupLinks) dont la tâche N'EST PLUS dans le scan
  // = tâche supprimée/déplacée côté ClickUp. Le pull inverse GARDE alors silencieusement le dernier état
  // (état fantôme). On les rend VISIBLES pour rattachement/purge. NB : sur un scan tronqué (> 5000 tâches)
  // ce compte peut sur-estimer — l'appelant signale la troncature.
  const taskIds = new Set((tasks || []).map((t) => t && t.id != null ? String(t.id) : "").filter(Boolean));
  let phantomLinks = 0; const phantomSample = [];
  for (const ref of Object.keys(L)) {
    const taskId = L[ref];
    if (taskId && !taskIds.has(String(taskId))) { phantomLinks++; if (phantomSample.length < 12) phantomSample.push({ ref, taskId: String(taskId) }); }
  }

  const unlinkedMatchable = unlinked.filter((u) => u.matchable).length;
  // Éligibilité ClickUp : parmi les non liées, combien n'ont PAS de DC lié (donc non synchronisables, ADR-079).
  const unlinkedNoDc = unlinked.filter((u) => !u.hasDc).length;
  const unlinkedEligible = unlinked.length - unlinkedNoDc;
  return {
    commandesTotal,
    linked,
    unlinked: unlinked.length,
    unlinkedMatchable,          // non liées MAIS une tâche existe (Opp ID) → à rattacher
    unlinkedNoDc,               // non liées SANS DC lié → non éligibles à la synchro ClickUp (ADR-079)
    unlinkedEligible,           // non liées AVEC un DC lié → créables
    synced,                     // commandes ayant reçu la synchro inverse (statut/dates)
    tasksTotal: (tasks || []).length,
    tasksWithFp,
    orphanTasks,                // tâches sans commande correspondante
    duplicateTasks,             // tâches EN TROP (surnuméraires) partageant un FP déjà porté par une autre
    duplicateFps,               // nb de N° FP portés par ≥ 2 tâches
    cafGapCount,                // commandes liées dont le CAF diffère de la tâche
    cafGapTotal,
    phantomLinks,               // liens vers une tâche ClickUp introuvable (supprimée/déplacée) — dérive
    coverage: commandesTotal ? Math.round((linked / commandesTotal) * 100) : 0,
    unlinkedSample: unlinked.slice(0, 12),
    orphanSample,
    duplicateSample,            // échantillon [{ fp, count }] pour la carte de monitoring
    phantomSample,              // échantillon [{ ref, taskId }] des liens fantômes
  };
}

module.exports = { clickupHealth, taskNumField };
