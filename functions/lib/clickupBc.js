// Mapping PUR bons de commande fournisseurs (bcLines) ↔ liste ClickUp « Commandes Fournisseurs »
// (901215953602). Une tâche = UN bon de commande (N° BC) : les lignes de l'app partageant le même
// N° BC sont AGRÉGÉES (montant sommé). La synchro inverse remonte le STATUT (avancement achat) et
// l'ETA, en ADDITIF (n'écrase pas le statut financier SOA de l'app). Réutilise les helpers bas niveau
// de clickupFields (findField / toFieldValue).
const cf = require("./clickupFields");
const norm = (s) => String(s == null ? "" : s).normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim().toLowerCase();

// Champs ClickUp de la liste BC (résolus par NOM contre les définitions en direct).
const BC_FIELD = {
  fournisseur: "Fournisseur",
  numero: "Numéro de Commande",
  montant: "Montant Total de la Commande",
  currency: "Currency",
  eta: "Livraison Estimée (ETA)",
  client: "Client",
  oppId: "Opp ID",
  pays: "Pays",
  commentaires: "Commentaires",
};
const PAYS = { CI: "CI", BF: "BF", GN: "GN", "COTE D'IVOIRE": "CI", "BURKINA FASO": "BF", "GUINEE": "GN" };

/** Regroupe les lignes BC par N° BC → un groupe (une tâche) par bon de commande. PUR.
 *  key = safeId(numéro de commande). Montant = Σ amount (devise d'origine) sinon Σ amountXof. */
function groupBcByNumber(bcLines, safeId) {
  const groups = new Map();
  for (const b of bcLines || []) {
    const num = String(b.bcNumber || "").trim();
    if (!num) continue; // sans N° BC → non poussable (pas de clé stable)
    const key = safeId(num);
    const g = groups.get(key) || { key, bcNumber: num, supplier: b.supplier || "", customer: b.customer || "", fp: b.fp || "", country: b.country || "", currency: b.currency || "", amount: 0, amountXof: 0, eta: b.etaReel || b.etaContrat || null, ids: [] };
    g.amount += Number(b.amount || 0);
    g.amountXof += Number(b.amountXof || 0);
    if (!g.supplier && b.supplier) g.supplier = b.supplier;
    if (!g.customer && b.customer) g.customer = b.customer;
    if (!g.fp && b.fp) g.fp = b.fp;
    if (!g.country && b.country) g.country = b.country;
    if (!g.currency && b.currency) g.currency = b.currency;
    if (!g.eta && (b.etaReel || b.etaContrat)) g.eta = b.etaReel || b.etaContrat;
    g.ids.push(b.id);
    groups.set(key, g);
  }
  return [...groups.values()];
}

// Valeurs logiques (clé = nom de champ ClickUp) pour un groupe BC.
function bcLogical(group) {
  const paysCode = PAYS[norm(group.country).toUpperCase()] || (group.country || "").toUpperCase() || undefined;
  const etaMs = group.eta ? Date.parse(String(group.eta).slice(0, 10) + "T00:00:00Z") : NaN;
  const out = {
    [BC_FIELD.fournisseur]: group.supplier || undefined,
    [BC_FIELD.numero]: group.bcNumber || undefined,
    [BC_FIELD.montant]: (group.amount || group.amountXof) || undefined,
    [BC_FIELD.currency]: group.currency ? (norm(group.currency) === "xof" ? "FCFA" : group.currency.toUpperCase()) : undefined,
    [BC_FIELD.client]: group.customer || undefined,
    [BC_FIELD.oppId]: group.fp || undefined,
    [BC_FIELD.pays]: paysCode,
    [BC_FIELD.eta]: Number.isFinite(etaMs) && etaMs > 0 ? etaMs : undefined,
  };
  const logical = {};
  for (const [k, v] of Object.entries(out)) if (v !== undefined && v !== "") logical[k] = v;
  return logical;
}

// Écritures de champs personnalisés (résolution par nom + type contre les défs de liste). PUR.
function buildBcFieldWrites(fieldDefs, logical) {
  const out = [];
  for (const [name, raw] of Object.entries(logical || {})) {
    const def = cf.findField(fieldDefs, name);
    if (!def) continue;
    const v = cf.toFieldValue(def, raw);
    if (v) out.push({ id: def.id, value: v.value });
  }
  return out;
}

// Cœur de la tâche BC. Statut initial « placee distributeur » posé À LA CRÉATION seulement.
function bcCorePayload(group, extra) {
  const e = extra || {};
  const title = [group.supplier, group.bcNumber].filter(Boolean).join(" — ") || group.bcNumber || "BC";
  const desc = [
    group.supplier ? `**Fournisseur :** ${group.supplier}` : "",
    group.bcNumber ? `**N° BC :** ${group.bcNumber}` : "",
    group.customer ? `**Client :** ${group.customer}` : "",
    group.fp ? `**Commande (FP) :** ${group.fp}` : "",
    `\n_Synchronisé depuis Neurone360 — BC ${group.bcNumber}_`,
  ].filter(Boolean);
  const payload = { name: title.slice(0, 250), description: desc.join("\n") };
  if (e.status) payload.status = e.status;
  return payload;
}

// Statut ClickUp (avancement achat) → statut simplifié app. Livré / annulé / en cours.
function mapBcStatus(clickupStatus) {
  const s = norm(clickupStatus);
  if (!s) return null;
  if (s === "livre") return "livre";
  if (s === "annulee") return "annule";
  return "en_cours";
}

// Lecture inverse : statut + ETA (champ « Livraison Estimée ») d'une tâche BC. PUR.
function readBcSync(task) {
  const t = task || {};
  const rawStatus = t.status && typeof t.status === "object" ? (t.status.status || null) : (t.status || null);
  const cfs = t.custom_fields || [];
  const etaF = cfs.find((c) => norm(c.name) === norm(BC_FIELD.eta));
  const etaMs = etaF && etaF.value != null ? Number(etaF.value) : NaN;
  return {
    statusRaw: rawStatus || null,
    status: mapBcStatus(rawStatus),
    eta: Number.isFinite(etaMs) && etaMs > 0 ? etaMs : null,
  };
}

// N° BC porté par une tâche (champ « Numéro de Commande ») → réconciliation anti-doublon. PUR.
function taskBcNumber(task) {
  const cfs = (task && task.custom_fields) || [];
  const f = cfs.find((c) => norm(c.name) === norm(BC_FIELD.numero));
  const v = f && f.value != null ? String(f.value).trim() : "";
  return v || null;
}
function buildBcIndex(tasks, safeId) {
  const idx = {};
  for (const t of tasks || []) { const n = taskBcNumber(t); if (n && !(safeId(n) in idx)) idx[safeId(n)] = t.id; }
  return idx;
}

module.exports = { BC_FIELD, groupBcByNumber, bcLogical, buildBcFieldWrites, bcCorePayload, mapBcStatus, readBcSync, taskBcNumber, buildBcIndex };
