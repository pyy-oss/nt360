// Client ClickUp (API v2) — appels REST authentifiés par le token (secret CLICKUP_TOKEN, Secret
// Manager). Les helpers PURS (résolution d'assigné, construction du payload) sont testables sans
// réseau ; les appels HTTP sont fins et remontent une erreur claire sur statut non 2xx.
const BASE = "https://api.clickup.com/api/v2";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Délai de back-off PUR (ms) avant un ré-essai. Priorité à l'en-tête Retry-After (secondes) renvoyé
// par ClickUp sur un 429 ; sinon exponentiel (500 ms × 2^tentative) borné à 8 s.
function retryDelay(attempt, retryAfterSec) {
  const ra = Number(retryAfterSec);
  if (Number.isFinite(ra) && ra > 0) return Math.min(ra * 1000, 30000);
  return Math.min(500 * Math.pow(2, attempt), 8000);
}

// Ré-essaie sur 429 (throttling) et 5xx transitoires ; les erreurs 4xx (hors 429) échouent tout de suite.
async function api(token, method, path, body, opts) {
  const maxRetries = opts && Number.isFinite(opts.retries) ? opts.retries : 3;
  let attempt = 0;
  for (;;) {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: { Authorization: token, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.ok) {
      const text = await res.text();
      try { return text ? JSON.parse(text) : {}; } catch { return { raw: text }; }
    }
    if ((res.status === 429 || res.status >= 500) && attempt < maxRetries) {
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

/** Résolution PURE d'un PM (chaîne libre) → id de membre ClickUp : email exact > nom exact > inclusion. */
function resolveAssignee(members, pm) {
  const q = String(pm || "").trim().toLowerCase();
  if (!q) return null;
  const byEmail = members.find((m) => (m.email || "").toLowerCase() === q);
  if (byEmail) return byEmail.id;
  const byName = members.find((m) => (m.username || "").toLowerCase() === q);
  if (byName) return byName.id;
  const byIncl = members.find((m) => {
    const u = (m.username || "").toLowerCase();
    return u && (u.includes(q) || q.includes(u));
  });
  return byIncl ? byIncl.id : null;
}

/** Payload PUR d'une tâche à partir d'une commande (fp/client/désignation/bu/cas/pm). */
function taskPayload(order, assigneeId) {
  const fp = String(order.fp || "").trim();
  const lines = [
    order.designation ? `**Désignation :** ${order.designation}` : "",
    order.client ? `**Client :** ${order.client}` : "",
    order.bu ? `**BU :** ${order.bu}` : "",
    order.cas != null && order.cas !== "" ? `**CAS :** ${Number(order.cas).toLocaleString("fr-FR")} XOF` : "",
    order.pm ? `**PM :** ${order.pm}` : "",
    `\n_Synchronisé depuis Neurone360 — clé ${fp}_`,
  ].filter(Boolean);
  return {
    name: `${fp}${order.client ? ` — ${order.client}` : ""}`.slice(0, 250),
    description: lines.join("\n"),
    ...(assigneeId ? { assignees: [assigneeId] } : {}),
  };
}

async function createTask(token, listId, payload) { return api(token, "POST", `/list/${listId}/task`, payload); }
// PUT /task attend les assignés au format { add: [...] } (et non un simple tableau).
async function updateTask(token, taskId, payload) {
  const { assignees, ...rest } = payload;
  return api(token, "PUT", `/task/${taskId}`, { ...rest, ...(assignees ? { assignees: { add: assignees } } : {}) });
}

/** Définitions des champs personnalisés d'une liste (id, name, type, options). */
async function listFields(token, listId) {
  const d = await api(token, "GET", `/list/${listId}/field`);
  return d.fields || [];
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

module.exports = { api, retryDelay, listMembers, resolveAssignee, taskPayload, createTask, updateTask, listFields, setField, getTask, listTasks };
