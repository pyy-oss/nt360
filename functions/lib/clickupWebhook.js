// Webhooks ClickUp temps réel (Lot 2) — helpers PURS (vérification de signature, parsing d'événement,
// index inverse taskId → clé d'overlay). La logique d'orchestration (getTask + recompute) vit dans
// index.js ; ici tout est testable sans réseau ni Firestore.
const crypto = require("crypto");

// Événements souscrits : statut, mise à jour (inclut les champs personnalisés), suppression, déplacement.
// Un seul webhook workspace suffit — le handler discrimine commande vs BC par index inverse du task_id.
const WEBHOOK_EVENTS = ["taskStatusUpdated", "taskUpdated", "taskDeleted", "taskMoved", "taskCreated"];

/** Vérifie la signature HMAC-SHA256 (hex) du corps BRUT avec le secret du webhook. Comparaison à temps
 *  constant. rawBody : Buffer|string reçu tel quel (NON reparsé). Renvoie false si secret/signature absents. */
function verifySignature(rawBody, signature, secret) {
  if (!secret || !signature) return false;
  const body = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody == null ? "" : rawBody), "utf8");
  const expected = crypto.createHmac("sha256", secret).update(body).digest("hex");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(String(signature), "utf8");
  if (a.length !== b.length) return false;
  try { return crypto.timingSafeEqual(a, b); } catch { return false; }
}

/** Extrait { event, taskId } d'un corps de webhook ClickUp (déjà parsé en objet). */
function parseWebhook(body) {
  const b = body || {};
  return { event: b.event || null, taskId: b.task_id || (b.payload && b.payload.id) || null };
}

/** Index inverse taskId → clé d'overlay (safeId), à partir d'une map { clé: taskId }. Première clé
 *  gagne en cas de collision (une tâche liée à plusieurs clés est anormale). PUR. */
function reverseLinks(map) {
  const out = {};
  for (const [key, taskId] of Object.entries(map || {})) { if (taskId && !(taskId in out)) out[String(taskId)] = key; }
  return out;
}

/** Décision PURE du routage d'un événement webhook : à quelle entité (commande / BC / aucune) se
 *  rattache la tâche, et s'agit-il d'une suppression. links/bcLinks = maps { clé: taskId }. Le wrapper
 *  I/O n'a plus qu'à appliquer les écritures Firestore selon {kind, key, deleted}. PUR & testable. */
function planTaskEvent(links, bcLinks, taskId, event) {
  const deleted = event === "taskDeleted";
  const cmdKey = reverseLinks(links)[String(taskId)];
  if (cmdKey) return { kind: "commande", key: cmdKey, deleted };
  const bcKey = reverseLinks(bcLinks)[String(taskId)];
  if (bcKey) return { kind: "bc", key: bcKey, deleted };
  return { kind: "ignored", key: null, deleted };
}

module.exports = { WEBHOOK_EVENTS, verifySignature, parseWebhook, reverseLinks, planTaskEvent };
