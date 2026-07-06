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
    status: e.status || "0-affecte",
  };
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

module.exports = { FIELD_NAMES, findField, resolveOptionId, toFieldValue, buildFieldWrites, buildCorePayload, buildLogical, toPriority };
