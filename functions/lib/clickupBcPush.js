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
  } else {
    task = await clickup.createTask(token, listId, corePayload); created = true;
  }
  for (const w of fieldWrites) {
    try { await clickup.setField(token, task.id, w.id, w.value); }
    catch (e) { logger.warn("ClickUp BC: champ non posé", { field: w.id, msg: e && e.message }); }
  }
  return { key, taskId: task.id, url: task.url || `https://app.clickup.com/t/${task.id}`, created, fields: fieldWrites.length };
}

module.exports = { pushBcCore };
