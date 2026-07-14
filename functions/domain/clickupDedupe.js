// Planification PURE du dédoublonnage des tâches ClickUp (aucune I/O). Regroupe les tâches par N° FP
// canonique ; pour chaque FP portant PLUSIEURS tâches, désigne LA tâche à conserver et celles à
// supprimer. Sert au nettoyage des doublons créés par des push concurrents (cf. verrou clickupLock).
//
// Règle de conservation (sûre) :
//   - on GARDE la tâche LIÉE dans l'app (config/clickupLinks) si elle est dans le groupe ;
//   - sinon la PLUS ANCIENNE (date de création croissante ; à égalité, id le plus petit — stable).
//   - on ne SUPPRIME que les tâches créées DANS la fenêtre `sinceMs` (ex. les 24 h → « doublons du
//     jour ») ; les tâches antérieures ne sont jamais touchées (elles peuvent être légitimes/référencées).
//   - la tâche conservée n'est JAMAIS supprimée. Une seule tâche liée par FP → aucun lien cassé.

/**
 * @param {{id:string, fp:string, dateCreatedMs:number}[]} tasks tâches indexées (fp = N° FP canonique)
 * @param {Set<string>|string[]} linkedTaskIds ids de tâches liées dans l'app (à préserver)
 * @param {number} sinceMs ne supprimer que les doublons créés à partir de cet instant (0 = pas de borne)
 * @returns {{groups:{fp:string, keepId:string, deleteIds:string[], total:number}[], duplicates:number, deletable:number}}
 */
function planDedupe(tasks, linkedTaskIds, sinceMs) {
  const linked = linkedTaskIds instanceof Set ? linkedTaskIds : new Set(linkedTaskIds || []);
  const byFp = new Map();
  for (const t of tasks || []) {
    if (!t || !t.fp) continue;
    if (!byFp.has(t.fp)) byFp.set(t.fp, []);
    byFp.get(t.fp).push(t);
  }
  const groups = [];
  let duplicates = 0, deletable = 0;
  for (const [fp, arr] of byFp) {
    if (arr.length < 2) continue;
    duplicates += arr.length - 1;
    const sorted = [...arr].sort((a, b) => ((a.dateCreatedMs || 0) - (b.dateCreatedMs || 0)) || String(a.id).localeCompare(String(b.id)));
    const keep = sorted.find((t) => linked.has(t.id)) || sorted[0];
    const del = sorted.filter((t) => t.id !== keep.id && (!sinceMs || (t.dateCreatedMs || 0) >= sinceMs));
    if (!del.length) continue; // groupe dupliqué mais hors fenêtre → rien à supprimer
    deletable += del.length;
    groups.push({ fp, keepId: keep.id, deleteIds: del.map((t) => t.id), total: arr.length });
  }
  return { groups, duplicates, deletable };
}

module.exports = { planDedupe };
