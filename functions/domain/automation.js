// AUTOMATISATION DÉCLARATIVE (Lot 4b « niveau Salesforce ») — règles configurables (sans code) qui
// génèrent des TÂCHES automatiquement quand une opportunité entre dans un état à traiter. Complète le
// workflow d'approbation (Lot 4) : ensemble ils comblent l'écart #4 (aucun processus gouvernable /
// automatisation déclarative). Les tâches créées réutilisent l'objet Activité (Lot 3).
//
// Fonction PURE (aucun I/O, aucune horloge) → testable. La date d'échéance et l'écriture sont gérées
// par le callable (runAutomations).

// Types de règles reconnus + libellé de la tâche générée.
const AUTOMATION_TYPES = {
  opp_no_nextstep: { label: "Opportunité ouverte sans prochaine action", subject: "Définir la prochaine action commerciale" },
  opp_stale: { label: "Opportunité dormante (fantôme)", subject: "Requalifier l'opportunité dormante" },
};

// Prédicat d'éligibilité d'une opportunité pour un type de règle.
function matches(type, o) {
  const stage = Number(o.stage) || 0;
  if (type === "opp_no_nextstep") return stage >= 1 && stage <= 5 && !String(o.nextStep || "").trim() && o.stale !== true;
  if (type === "opp_stale") return o.stale === true;
  return false;
}

// Évalue les règles ACTIVES sur les opportunités et renvoie les tâches à créer — en excluant celles
// dont la clé d'idempotence (`type:oppId`) existe DÉJÀ (existingKeys) : une règle ne recrée jamais une
// tâche déjà générée pour la même opportunité. Renvoie des descripteurs neutres (sans date ni visibleTo,
// posés par le callable).
function evaluateAutomations(rules, opps, existingKeys) {
  const keys = existingKeys instanceof Set ? existingKeys : new Set(existingKeys || []);
  const active = (rules || []).filter((r) => r && r.enabled && AUTOMATION_TYPES[r.type]);
  const out = [];
  for (const r of active) {
    const meta = AUTOMATION_TYPES[r.type];
    for (const o of opps || []) {
      const oppId = o.id || o.oppId;
      if (!oppId || !matches(r.type, o)) continue;
      const autoKey = `${r.type}:${oppId}`;
      if (keys.has(autoKey)) continue;
      keys.add(autoKey); // évite les doublons intra-lot (deux règles ne peuvent pas partager une clé de toute façon)
      out.push({
        type: r.type, autoKey, oppId,
        ownerUid: o.ownerUid || null,
        subject: meta.subject,
        relatedName: o.client || null,
        dueInDays: Number.isFinite(Number(r.dueInDays)) && Number(r.dueInDays) > 0 ? Math.trunc(Number(r.dueInDays)) : 7,
      });
    }
  }
  return out;
}

module.exports = { AUTOMATION_TYPES, matches, evaluateAutomations };
