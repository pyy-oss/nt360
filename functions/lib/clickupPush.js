// Cœur RÉUTILISABLE du push d'une commande → tâche ClickUp (partagé par le push unitaire et le push en
// masse), EXTRAIT en module pour être testable en injectant un faux client `clickup`. members +
// fieldDefs sont résolus UNE fois par l'appelant. L'écriture du lien config/clickupLinks est laissée à
// l'appelant (batch en masse). Statut initial « 0-affecte » posé UNIQUEMENT à la création (jamais
// réinitialisé sur une tâche existante). Sur une mise à jour, les anciens assignés sont retirés.
const { logger } = require("firebase-functions/v2");

async function pushOrderCore({ token, clickup, cf, safeId, fpKey, listId, members, fieldDefs, statuses, links, order, extra }) {
  const fp = fpKey(order.fp);
  const id = safeId(fp);
  const existing = links[id];
  const assignee = clickup.resolveAssignee(members, order.pm);
  const corePayload = cf.buildCorePayload({ ...order, fp }, extra || {}, assignee);
  // Statut initial « 0-affecte » posé à la création UNIQUEMENT s'il existe dans la liste (validé contre
  // ses statuts si fournis) — sinon omis (ClickUp applique son statut par défaut) plutôt que d'échouer.
  if (!existing && !corePayload.status) {
    const s = statuses && statuses.length ? cf.matchStatus(statuses, "0-affecte") : "0-affecte";
    if (s) corePayload.status = s;
  }
  const fieldWrites = cf.buildFieldWrites(fieldDefs, cf.buildLogical({ ...order, fp }, extra || {}));
  let task, created = false;
  if (existing) {
    // Réaffectation propre : retire les anciens assignés (≠ nouveau) sinon ils s'accumuleraient.
    let remove = [];
    if (assignee) {
      try { const cur = await clickup.getTask(token, existing); remove = (cur.assignees || []).map((a) => a.id).filter((idA) => idA && idA !== assignee); }
      catch (e) { logger.warn("ClickUp: assignés courants illisibles", { msg: e && e.message }); }
    }
    task = await clickup.updateTask(token, existing, corePayload, remove); task.id = existing;
  } else { task = await clickup.createTask(token, listId, corePayload); created = true; }
  for (const w of fieldWrites) {
    try { await clickup.setField(token, task.id, w.id, w.value); }
    catch (e) { logger.warn("ClickUp: champ non posé", { field: w.id, msg: e && e.message }); }
  }
  return { id, taskId: task.id, url: task.url || `https://app.clickup.com/t/${task.id}`, created, assigned: !!assignee, fields: fieldWrites.length };
}

module.exports = { pushOrderCore };
