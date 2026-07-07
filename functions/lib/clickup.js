// Client ClickUp (API v2) — appels REST authentifiés par le token (secret CLICKUP_TOKEN, Secret
// Manager). Les helpers PURS (résolution d'assigné, construction du payload) sont testables sans
// réseau ; les appels HTTP sont fins et remontent une erreur claire sur statut non 2xx.
const BASE = "https://api.clickup.com/api/v2";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Délai de back-off PUR (ms) avant un ré-essai. Priorité à l'en-tête Retry-After (secondes) renvoyé
// par ClickUp sur un 429 ; sinon exponentiel (500 ms × 2^tentative) borné à 8 s. Le Retry-After
// serveur est honoré jusqu'à 120 s (la fenêtre de throttle ClickUp, par minute, peut atteindre ~60 s ;
// un cap 30 s expirait le budget de retries DANS la même fenêtre → 429 en cascade, cf. audit intégral C2).
function retryDelay(attempt, retryAfterSec) {
  const ra = Number(retryAfterSec);
  if (Number.isFinite(ra) && ra > 0) return Math.min(ra * 1000, 120000);
  return Math.min(500 * Math.pow(2, attempt), 8000);
}

// Ré-essaie sur 429 (throttling), 5xx transitoires ET erreurs de TRANSPORT (ECONNRESET/ETIMEDOUT/DNS
// — fréquentes en push massif) ; les erreurs 4xx (hors 429) échouent tout de suite.
async function api(token, method, path, body, opts) {
  const maxRetries = opts && Number.isFinite(opts.retries) ? opts.retries : 3;
  const maxThrottleWaits = opts && Number.isFinite(opts.throttleWaits) ? opts.throttleWaits : 6;
  let attempt = 0, throttleWaits = 0;
  for (;;) {
    let res;
    try {
      res = await fetch(`${BASE}${path}`, {
        method,
        headers: { Authorization: token, "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (e) {
      // Coupure réseau : re-tenter avec back-off, sinon propager.
      if (attempt < maxRetries) { await sleep(retryDelay(attempt)); attempt++; continue; }
      const err = new Error(`ClickUp réseau: ${(e && e.message) || e}`);
      err.status = 0;
      throw err;
    }
    if (res.ok) {
      const text = await res.text();
      try { return text ? JSON.parse(text) : {}; } catch { return { raw: text }; }
    }
    // 429 AVEC Retry-After serveur : on OBÉIT au délai indiqué sans consommer le budget de retries
    // (sinon les 3 essais s'épuisent dans la même fenêtre de throttle) ; borné par `maxThrottleWaits`
    // pour éviter une boucle si le serveur reste saturé (cf. audit intégral C2).
    const ra = res.status === 429 && res.headers ? Number(res.headers.get("retry-after")) : NaN;
    if (Number.isFinite(ra) && ra > 0 && throttleWaits < maxThrottleWaits) {
      await res.text().catch(() => {});
      await sleep(retryDelay(attempt, ra));
      throttleWaits++;
      continue;
    }
    if ((res.status === 429 || res.status >= 500) && attempt < maxRetries) {
      await res.text().catch(() => {}); // draine le corps (évite une fuite de socket undici) avant retry
      await sleep(retryDelay(attempt, res.headers && res.headers.get("retry-after")));
      attempt++;
      continue;
    }
    const text = await res.text();
    let data; try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
    const err = new Error(`ClickUp ${res.status}: ${(data && (data.err || data.error)) || text || res.statusText}`);
    err.status = res.status;
    throw err;
  }
}

/** Membres du workspace (team) → [{id, username, email}] (aplati depuis /team). */
async function listMembers(token, teamId) {
  const d = await api(token, "GET", "/team");
  const team = (d.teams || []).find((t) => String(t.id) === String(teamId)) || (d.teams || [])[0];
  return (team && team.members ? team.members : [])
    .map((m) => ({ id: m.user && m.user.id, username: (m.user && m.user.username) || "", email: (m.user && m.user.email) || "" }))
    .filter((m) => m.id);
}

/** Résolution PURE d'un PM (chaîne libre) → id de membre ClickUp : email exact > nom exact > inclusion.
 *  L'inclusion n'est acceptée que si elle est NON AMBIGUË (un seul candidat) — sinon on n'assigne pas,
 *  plutôt que d'assigner silencieusement la mauvaise personne (même garde que resolveOptionId). */
function resolveAssignee(members, pm) {
  const q = String(pm || "").trim().toLowerCase();
  if (!q) return null;
  const byEmail = members.find((m) => (m.email || "").toLowerCase() === q);
  if (byEmail) return byEmail.id;
  const byName = members.find((m) => (m.username || "").toLowerCase() === q);
  if (byName) return byName.id;
  const cands = members.filter((m) => {
    const u = (m.username || "").toLowerCase();
    return u && (u.includes(q) || q.includes(u));
  });
  return cands.length === 1 ? cands[0].id : null; // ambigu (0 ou ≥2) → pas d'assignation
}

async function createTask(token, listId, payload) { return api(token, "POST", `/list/${listId}/task`, payload); }
// PUT /task attend les assignés au format { add:[...], rem:[...] } (et non un simple tableau). `remove`
// permet de RETIRER les anciens assignés (sinon l'assigné s'accumulerait à chaque changement de PM).
async function updateTask(token, taskId, payload, remove) {
  const { assignees, ...rest } = payload;
  const rem = Array.isArray(remove) ? remove.filter((id) => !(assignees || []).includes(id)) : [];
  const assignPatch = assignees || rem.length ? { assignees: { ...(assignees ? { add: assignees } : {}), ...(rem.length ? { rem } : {}) } } : {};
  return api(token, "PUT", `/task/${taskId}`, { ...rest, ...assignPatch });
}

/** Définitions des champs personnalisés d'une liste (id, name, type, options). */
async function listFields(token, listId) {
  const d = await api(token, "GET", `/list/${listId}/field`);
  return d.fields || [];
}

/** Statuts configurés d'une liste (GET /list/{id}) → [{ status, type, ... }]. Sert à valider le statut
 *  initial posé à la création (omission propre si renommé) plutôt que de faire échouer createTask. */
async function getListStatuses(token, listId) {
  const d = await api(token, "GET", `/list/${listId}`);
  return (d && d.statuses) || [];
}

/** Pose une valeur de champ personnalisé (uniforme pour tous les types). value déjà normalisée. */
async function setField(token, taskId, fieldId, value) {
  return api(token, "POST", `/task/${taskId}/field/${fieldId}`, { value });
}

/** Récupère une tâche (champs personnalisés inclus) — pour la synchro inverse (Lot C). */
async function getTask(token, taskId) {
  return api(token, "GET", `/task/${taskId}?include_subtasks=false`);
}

/** Toutes les tâches d'une liste (paginé, champs personnalisés inclus) — pour la réconciliation.
 *  include_closed par défaut (une tâche terminée/facturée existe toujours et ne doit pas être dupliquée). */
async function listTasks(token, listId, opts) {
  const includeClosed = !opts || opts.includeClosed !== false;
  const tasks = [];
  for (let page = 0; page < 50; page++) { // garde-fou : 50 pages × 100 = 5000 tâches max
    const d = await api(token, "GET", `/list/${listId}/task?page=${page}&subtasks=false&include_closed=${includeClosed}`);
    const batch = (d && d.tasks) || [];
    tasks.push(...batch);
    if (batch.length < 100 || d.last_page) break;
  }
  return tasks;
}

/** Récupère une tâche AVEC ses sous-tâches (et checklists) — pour la réconciliation des jalons/BC. */
async function getTaskDetail(token, taskId) {
  return api(token, "GET", `/task/${taskId}?include_subtasks=true`);
}

// --- Sous-tâches (jalons de facturation) & checklists (BC liés) : Lot 3+ ---
/** Crée une sous-tâche sous `parentId` dans la liste `listId`. */
async function createSubtask(token, listId, parentId, payload) {
  return api(token, "POST", `/list/${listId}/task`, { ...payload, parent: parentId });
}
/** Supprime une tâche (utilisé pour purger les sous-tâches « Jalon i » devenues orphelines). */
async function deleteTask(token, taskId) {
  return api(token, "DELETE", `/task/${taskId}`);
}
/** Crée une checklist nommée sur une tâche → { checklist: { id, ... } }. */
async function createChecklist(token, taskId, name) {
  return api(token, "POST", `/task/${taskId}/checklist`, { name });
}
async function deleteChecklist(token, checklistId) {
  return api(token, "DELETE", `/checklist/${checklistId}`);
}
async function createChecklistItem(token, checklistId, name) {
  return api(token, "POST", `/checklist/${checklistId}/checklist_item`, { name });
}

// --- Commentaires & tags (Lot 3 : enrichissements app → ClickUp) ---
/** Commentaires d'une tâche (du PLUS RÉCENT au plus ancien) → [{id, comment_text, date, ...}].
 *  PAGINÉ : GET /task/{id}/comment ne renvoie que les ~25 plus récents ; on remonte via start/start_id
 *  jusqu'à épuisement — sinon notre commentaire de synthèse marqué sort de la fenêtre sur une tâche très
 *  commentée et se retrouve dupliqué (non-idempotence). Garde-fou : 40 pages (~1000 commentaires). */
async function listComments(token, taskId) {
  const all = [];
  let start, startId;
  for (let page = 0; page < 40; page++) {
    const qs = start ? `?start=${start}&start_id=${encodeURIComponent(startId)}` : "";
    const d = await api(token, "GET", `/task/${taskId}/comment${qs}`);
    const batch = (d && d.comments) || [];
    all.push(...batch);
    if (batch.length < 25) break; // dernière page
    const last = batch[batch.length - 1];
    if (!last || last.date == null) break;
    start = last.date; startId = last.id;
  }
  return all;
}
async function createComment(token, taskId, text) {
  return api(token, "POST", `/task/${taskId}/comment`, { comment_text: text, notify_all: false });
}
async function updateComment(token, commentId, text) {
  return api(token, "PUT", `/comment/${commentId}`, { comment_text: text });
}
/** Pose / retire un tag nommé sur une tâche (le tag doit exister dans l'espace ; ClickUp le crée sinon). */
async function addTag(token, taskId, tagName) {
  return api(token, "POST", `/task/${taskId}/tag/${encodeURIComponent(tagName)}`);
}
async function removeTag(token, taskId, tagName) {
  return api(token, "DELETE", `/task/${taskId}/tag/${encodeURIComponent(tagName)}`);
}

// --- Webhooks (Lot 2 : temps réel) ---
/** Liste les webhooks du workspace (pour éviter les doublons). */
async function listWebhooks(token, teamId) {
  const d = await api(token, "GET", `/team/${teamId}/webhook`);
  return (d && d.webhooks) || [];
}
/** Crée un webhook au niveau workspace. ClickUp renvoie { id, webhook: { id, secret, ... } }. Le
 *  secret HMAC n'est renvoyé QU'À la création (à persister immédiatement). */
async function createWebhook(token, teamId, endpoint, events) {
  return api(token, "POST", `/team/${teamId}/webhook`, { endpoint, events });
}
/** Met à jour un webhook (endpoint / événements / statut). Le secret n'est PAS renvoyé ici. */
async function updateWebhook(token, webhookId, payload) {
  return api(token, "PUT", `/webhook/${webhookId}`, payload);
}
async function deleteWebhook(token, webhookId) {
  return api(token, "DELETE", `/webhook/${webhookId}`);
}

module.exports = { api, retryDelay, listMembers, resolveAssignee, createTask, updateTask, listFields, getListStatuses, setField, getTask, getTaskDetail, listTasks, createSubtask, deleteTask, createChecklist, deleteChecklist, createChecklistItem, listComments, createComment, updateComment, addTag, removeTag, listWebhooks, createWebhook, updateWebhook, deleteWebhook };
