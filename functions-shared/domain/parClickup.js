// Domain PUR — construction du payload ClickUp d'une assignation de certification (Lot P4, ADR-P10).
// Aucun I/O (l'appel REST + les secrets vivent dans le handler). La tâche va dans une liste ClickUp DÉDIÉE
// (config/clickup.parListId) : jamais dans le board commandes. Aucun montant (donnée non confidentielle).

// due_date ClickUp = epoch ms. On dérive de targetDate (AAAA-MM-JJ) à minuit UTC (Abidjan = UTC+0).
function parAssignmentTaskPayload(a) {
  const o = a || {};
  const cert = String(o.cert || o.certificationCatalogId || "certification").trim();
  const who = String(o.consultantName || o.consultantId || "").trim();
  const name = `Certification ${cert}${who ? ` — ${who}` : ""}`.trim().slice(0, 250);
  const lines = [];
  if (o.partnerId) lines.push(`Constructeur : ${o.partnerId}`);
  if (who) lines.push(`Ingénieur : ${who}`);
  if (o.targetDate) lines.push(`Échéance cible : ${o.targetDate}`);
  if (o.status) lines.push(`Statut : ${o.status}`);
  const payload = { name, description: lines.join("\n") };
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(String(o.targetDate || "")) ? `${o.targetDate}T00:00:00Z` : null;
  const due = iso ? Date.parse(iso) : NaN;
  if (Number.isFinite(due)) { payload.due_date = due; payload.due_date_time = false; }
  return payload;
}

module.exports = { parAssignmentTaskPayload };
