// Client ClickUp (API v2) — appels REST authentifiés par le token (secret CLICKUP_TOKEN, Secret
// Manager). Les helpers PURS (résolution d'assigné, construction du payload) sont testables sans
// réseau ; les appels HTTP sont fins et remontent une erreur claire sur statut non 2xx.
const BASE = "https://api.clickup.com/api/v2";

async function api(token, method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { Authorization: token, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data; try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!res.ok) {
    const err = new Error(`ClickUp ${res.status}: ${(data && (data.err || data.error)) || text || res.statusText}`);
    err.status = res.status;
    throw err;
  }
  return data;
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

module.exports = { api, listMembers, resolveAssignee, taskPayload, createTask, updateTask };
