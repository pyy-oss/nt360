// Cœur RÉUTILISABLE du push d'un bon de commande fournisseur (groupe de lignes bcLines agrégées par
// N° BC) → tâche ClickUp de la liste « Commandes Fournisseurs ». Partagé par le push unitaire et le
// push en masse ; EXTRAIT pour être testable en injectant un faux client `clickup`. fieldDefs est
// résolu UNE fois par l'appelant. L'écriture du lien config/clickupBcLinks est laissée à l'appelant.
// Statut initial « placee distributeur » posé UNIQUEMENT à la création (jamais réinitialisé ensuite :
// l'avancement achat vit dans ClickUp, source de vérité).
const { logger } = require("firebase-functions/v2");
const bc = require("./clickupBc");

async function pushBcCore({ token, clickup, listId, fieldDefs, statuses, links, group, extra }) {
  const cf = require("./clickupFields");
  const key = group.key;
  const existing = links[key];
  const corePayload = bc.bcCorePayload(group, extra || {});
  // Statut initial « placee distributeur » à la création seulement s'il existe dans la liste — sinon omis.
  if (!existing && !corePayload.status) {
    const s = statuses && statuses.length ? cf.matchStatus(statuses, "placee distributeur") : "placee distributeur";
    if (s) corePayload.status = s;
  }
  const fieldWrites = bc.buildBcFieldWrites(fieldDefs, bc.bcLogical(group));
  let task, created = false;
  if (existing) {
    task = await clickup.updateTask(token, existing, corePayload); task.id = existing;
    // Champs d'une tâche EXISTANTE : Set-Field best-effort (le lien/la clé existent déjà).
    for (const w of fieldWrites) {
      try { await clickup.setField(token, task.id, w.id, w.value); }
      catch (e) { logger.warn("ClickUp BC: champ non posé", { field: w.id, msg: e && e.message }); }
    }
  } else {
    // C3 (audit intégral) : champs personnalisés (dont la clé de réconciliation) posés DANS le payload
    // de CRÉATION → la tâche naît identifiable ; pas de fenêtre où un Set-Field en échec laisserait un
    // orphelin non réconciliable (doublon au passage suivant).
    if (fieldWrites.length) corePayload.custom_fields = fieldWrites.map((w) => ({ id: w.id, value: w.value }));
    task = await clickup.createTask(token, listId, corePayload); created = true;
  }
  return { key, taskId: task.id, url: task.url || `https://app.clickup.com/t/${task.id}`, created, fields: fieldWrites.length };
}

module.exports = { pushBcCore };
