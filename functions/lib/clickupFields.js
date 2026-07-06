// Mapping PUR commande Neurone360 ↔ champs ClickUp (espace « Gestion de Projets », partagé par les
// listes CI/BF/Guinée). Aucune I/O réseau ici : on résout les valeurs contre les DÉFINITIONS de
// champs récupérées en direct (donc pas d'UUID d'option codé en dur, qui dériverait si l'admin
// ClickUp modifie les listes). Les champs personnalisés sont posés via l'endpoint Set-Field
// (POST /task/{id}/field/{id}), uniforme et fiable pour tous les types (texte, devise, date, liste).

// Clé logique → nom EXACT du champ personnalisé côté ClickUp (les noms sont stables).
const FIELD_NAMES = {
  caSigne: "CA Signé",
  caFacture: "CA Facturé",
  oppId: "Opp ID",
  compteClient: "Compte Client",
  am: "AM",
  bu: "BU",
  pays: "Pays",
  nature: "Nature",
  domaine: "Domaine",
  secteur: "Secteur",
  circuit: "Circuit",
  catRecurrent: "Cat Recurrent",
  delaiPrev: "Délai Prévisonnel",
  commentaire: "Commentaire",
};

// Types de champ que l'on sait POSER (les autres — formule Backlog, baselines — sont ignorés).
const DROPDOWN = "drop_down";
const CURRENCY = "currency";
const DATE = "date";
const norm = (s) => String(s == null ? "" : s).trim().toLowerCase();

/** Trouve la définition d'un champ par nom (insensible casse/espaces) dans la liste des champs. */
function findField(fieldDefs, name) {
  const q = norm(name);
  return (fieldDefs || []).find((f) => norm(f.name) === q) || null;
}

/** Résout un libellé d'option de liste déroulante → UUID de l'option (ou null si introuvable). */
function resolveOptionId(fieldDef, label) {
  const q = norm(label);
  if (!q || !fieldDef || !fieldDef.type_config) return null;
  const opts = fieldDef.type_config.options || [];
  const exact = opts.find((o) => norm(o.name) === q);
  if (exact) return exact.id;
  // Tolérance : inclusion (ex. « Maintenance » vs « Maintenance  » ou variantes).
  const incl = opts.find((o) => norm(o.name) && (norm(o.name).includes(q) || q.includes(norm(o.name))));
  return incl ? incl.id : null;
}

// Convertit une valeur logique en valeur ClickUp selon le type du champ.
// Retourne { value } ou null si la valeur est vide / le champ non posable / l'option introuvable.
function toFieldValue(fieldDef, raw) {
  if (fieldDef == null) return null;
  const type = fieldDef.type;
  if (type === DROPDOWN) {
    const id = resolveOptionId(fieldDef, raw);
    return id ? { value: id } : null;
  }
  if (type === CURRENCY) {
    if (raw == null || raw === "") return null;
    const n = Number(raw);
    return Number.isFinite(n) ? { value: n } : null;
  }
  if (type === DATE) {
    if (raw == null || raw === "") return null;
    const n = Number(raw);
    return Number.isFinite(n) ? { value: n } : null;
  }
  // short_text / text
  const s = raw == null ? "" : String(raw).trim();
  return s ? { value: s } : null;
}

/**
 * Construit la liste des écritures de champs personnalisés [{ id, value }] à partir des valeurs
 * logiques et des définitions de champs de la liste cible. Ignore silencieusement les valeurs vides,
 * les champs absents de la liste et les options non résolues (mieux vaut poser le reste que tout
 * échouer). PUR.
 */
function buildFieldWrites(fieldDefs, logical) {
  const out = [];
  for (const [key, name] of Object.entries(FIELD_NAMES)) {
    if (!(key in (logical || {}))) continue;
    const raw = logical[key];
    const def = findField(fieldDefs, name);
    if (!def) continue;
    const v = toFieldValue(def, raw);
    if (v) out.push({ id: def.id, value: v.value });
  }
  return out;
}

// Priorité ClickUp : 1 urgent / 2 haute / 3 normale / 4 basse.
const PRIORITY = { urgente: 1, urgent: 1, haute: 2, high: 2, normale: 3, normal: 3, basse: 4, low: 4 };
function toPriority(p) {
  if (p == null || p === "") return null;
  if (typeof p === "number" && p >= 1 && p <= 4) return p;
  return PRIORITY[norm(p)] || null;
}

/**
 * Payload « cœur » de la tâche (hors champs personnalisés, posés ensuite via Set-Field). PUR.
 * order : { fp, client, affaire/designation, bu, cas, pm } ; extra : { status, dateCommande,
 * dateContractuelle, priority, commentaire } ; assigneeId : id membre ClickUp ou null.
 */
function buildCorePayload(order, extra, assigneeId) {
  const e = extra || {};
  const fp = String(order.fp || "").trim();
  const desig = order.affaire || order.designation || "";
  const title = [order.client, desig].filter(Boolean).join(" - ") || fp;
  const descLines = [
    desig ? `**Désignation :** ${desig}` : "",
    order.client ? `**Client :** ${order.client}` : "",
    order.bu ? `**BU :** ${order.bu}` : "",
    order.cas != null && order.cas !== "" ? `**CA Signé :** ${Number(order.cas).toLocaleString("fr-FR")} XOF` : "",
    order.pm ? `**PM :** ${order.pm}` : "",
    e.commentaire ? `\n${e.commentaire}` : "",
    `\n_Synchronisé depuis Neurone360 — clé ${fp}_`,
  ].filter(Boolean);
  const payload = {
    name: title.slice(0, 250),
    description: descLines.join("\n"),
  };
  // Statut posé UNIQUEMENT s'il est fourni : sur une mise à jour, ne pas réinitialiser le statut réel
  // de la tâche (que la synchro inverse relit). Le défaut « 0-affecte » est appliqué à la CRÉATION
  // par l'appelant (pushOrderCore).
  if (e.status) payload.status = e.status;
  if (assigneeId) payload.assignees = [assigneeId];
  const start = Number(e.dateCommande);
  if (Number.isFinite(start) && start > 0) { payload.start_date = start; payload.start_date_time = false; }
  const due = Number(e.dateContractuelle);
  if (Number.isFinite(due) && due > 0) { payload.due_date = due; payload.due_date_time = false; }
  const prio = toPriority(e.priority);
  if (prio) payload.priority = prio;
  return payload;
}

/**
 * Assemble les valeurs logiques des champs personnalisés à partir de la commande + des champs
 * complémentaires du modal. PUR. `only` (optionnel) restreint aux clés listées (ex. ['caFacture']
 * pour la synchro CAF du Lot B).
 */
function buildLogical(order, extra, only) {
  const e = extra || {};
  const all = {
    caSigne: order.cas,
    caFacture: order.facture,
    oppId: order.fp,
    compteClient: order.client,
    am: order.am,
    bu: order.bu,
    pays: e.pays,
    nature: e.nature,
    domaine: e.domaine,
    secteur: e.secteur,
    circuit: e.circuit,
    catRecurrent: e.catRecurrent,
    delaiPrev: e.dateFinPrev,
    commentaire: e.commentaire,
  };
  // On ne conserve que les clés effectivement fournies (non undefined) pour ne pas écraser à vide.
  const logical = {};
  for (const [k, v] of Object.entries(all)) {
    if (only && !only.includes(k)) continue;
    if (v !== undefined && v !== null && v !== "") logical[k] = v;
  }
  return logical;
}

/**
 * Lecture PURE des champs remontés de ClickUp → app (sens inverse). Extrait de l'objet tâche :
 *  - status            → statut projet (chaîne)
 *  - dateCommande      ← start_date natif
 *  - dateContractuelle ← due_date natif
 *  - dateFinPrev       ← champ personnalisé « Délai Prévisonnel »
 * Renvoie des epoch ms (ou null). Tolère task.status objet {status} ou chaîne.
 */
function readTaskSync(task) {
  const t = task || {};
  const cfs = t.custom_fields || [];
  const byName = (name) => { const f = cfs.find((c) => norm(c.name) === norm(name)); return f ? f.value : undefined; };
  const num = (v) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : null; };
  const status = t.status && typeof t.status === "object" ? (t.status.status || null) : (t.status || null);
  const a = Array.isArray(t.assignees) && t.assignees[0] ? t.assignees[0] : null;
  return {
    status: status || null,
    dateCommande: num(t.start_date),
    dateContractuelle: num(t.due_date),
    dateFinPrev: num(byName(FIELD_NAMES.delaiPrev)),
    pm: a ? (a.username || null) : null, // assigné ClickUp → PM courant de l'app
  };
}

// N° FP porté par une tâche ClickUp : champ personnalisé « Opp ID » (repli : rien). PUR.
function taskFp(task) {
  const cfs = (task && task.custom_fields) || [];
  const f = cfs.find((c) => norm(c.name) === norm(FIELD_NAMES.oppId));
  const v = f && f.value != null ? String(f.value).trim() : "";
  return v || null;
}

/**
 * Index des tâches existantes par N° FP normalisé → taskId (première tâche gagne). Sert à la
 * réconciliation anti-doublons : rattacher une commande à une tâche déjà créée (ex-formulaire) au
 * lieu d'en créer une seconde. `normalize` (ex. fpKey) rend la comparaison robuste. PUR.
 */
function buildTaskFpIndex(tasks, normalize) {
  const idx = {};
  for (const t of tasks || []) {
    const raw = taskFp(t);
    if (!raw) continue;
    const k = normalize ? normalize(raw) : raw;
    if (k && !(k in idx)) idx[k] = t.id;
  }
  return idx;
}

module.exports = { FIELD_NAMES, findField, resolveOptionId, toFieldValue, buildFieldWrites, buildCorePayload, buildLogical, toPriority, readTaskSync, taskFp, buildTaskFpIndex };
