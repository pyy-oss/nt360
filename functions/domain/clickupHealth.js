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
 */
function clickupHealth(orders, tasks, links, syncMap, fpKey, safeId) {
  const L = links || {}, S = syncMap || {};
  const cmdFpSet = new Set();
  // Index tâche par FP (Opp ID) → { id, caf }.
  const taskByFp = {};
  let tasksWithFp = 0;
  for (const t of tasks || []) {
    const raw = taskFp(t);
    if (raw) { tasksWithFp++; const k = fpKey(raw); if (k && !(k in taskByFp)) taskByFp[k] = { id: t.id, caf: taskNumField(t, "CA Facturé") }; }
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
      unlinked.push({ fp: o.fp, client: o.client || "", matchable: !!taskByFp[fp] });
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

  const unlinkedMatchable = unlinked.filter((u) => u.matchable).length;
  return {
    commandesTotal,
    linked,
    unlinked: unlinked.length,
    unlinkedMatchable,          // non liées MAIS une tâche existe (Opp ID) → à rattacher
    synced,                     // commandes ayant reçu la synchro inverse (statut/dates)
    tasksTotal: (tasks || []).length,
    tasksWithFp,
    orphanTasks,                // tâches sans commande correspondante
    cafGapCount,                // commandes liées dont le CAF diffère de la tâche
    cafGapTotal,
    coverage: commandesTotal ? Math.round((linked / commandesTotal) * 100) : 0,
    unlinkedSample: unlinked.slice(0, 12),
    orphanSample,
  };
}

module.exports = { clickupHealth, taskNumField };
