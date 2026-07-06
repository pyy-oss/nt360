// Enrichissements app → ClickUp (Lot 3) — construction PURE des artefacts posés sur la tâche commande :
//   • un commentaire de SYNTHÈSE idempotent (marqueur en 1re ligne → retrouvé et mis à jour, jamais
//     empilé) : CA/RAF, qualité, retard, + pointeurs vers les jalons/BC ;
//   • les JALONS de facturation éclatés en vraies SOUS-TÂCHES (réconciliées par clé stable `Jalon i`) ;
//   • les BC fournisseurs liés éclatés en une CHECKLIST (recréée à l'identique = idempotente).
// Tout est PUR ici (planification) ; l'orchestration réseau (create/update/delete) vit dans index.js.

const MARKER = "🔄 Synthèse Neurone360"; // 1re ligne du commentaire — clé de reconnaissance (upsert)
const RISK_TAG = "à risque (n360)";      // tag posé/retiré selon la qualité + le retard
const MS_PREFIX = "Jalon";               // préfixe des sous-tâches jalons (clé de réconciliation par index)
const BC_CHECKLIST = "Bons de commande (n360)"; // nom de la checklist des BC liés (recréée à chaque passage)

const money = (n) => Number(n || 0).toLocaleString("fr-FR");
const day = (d) => (d ? String(d).slice(0, 10) : null);

/**
 * Commentaire de synthèse (marqueur inclus). Les jalons/BC ne sont plus détaillés ici (ils vivent en
 * sous-tâches / checklist) : on ne garde que des POINTEURS de comptage.
 * @param d { cas, facture, raf, milestones:[{label,amount,dueDate}], bcRefs:[..], qualityFlags:[..], overdue:bool }
 */
function buildSyncComment(d) {
  const o = d || {};
  const cas = Number(o.cas || 0), fac = Number(o.facture || 0);
  const pctFac = cas > 0 ? Math.round((fac / cas) * 100) : 0;
  const lines = [MARKER + " (mise à jour automatique)"];
  lines.push(`• CA signé : ${money(cas)} · Facturé : ${money(fac)} (${pctFac}%) · RAF : ${money(o.raf)}`);
  const ms = Array.isArray(o.milestones) ? o.milestones.filter((m) => m && (m.amount || m.dueDate || m.date)) : [];
  if (ms.length) lines.push(`• Jalons de facturation : ${ms.length} (détaillés en sous-tâches)`);
  const bc = [...new Set((Array.isArray(o.bcRefs) ? o.bcRefs : []).filter(Boolean))];
  if (bc.length) lines.push(`• BC fournisseurs liés : ${bc.length} (détaillés en checklist « ${BC_CHECKLIST} »)`);
  const flags = Array.isArray(o.qualityFlags) ? o.qualityFlags.filter(Boolean) : [];
  lines.push(flags.length ? `• ⚠️ Qualité : ${flags.slice(0, 6).join(", ")}` : "• ✅ Qualité : RAS");
  if (o.overdue) lines.push("• ⏰ Livraison en retard (date contractuelle dépassée, projet actif)");
  return lines.join("\n");
}

/** Vrai si la tâche mérite le tag « à risque » (anomalies qualité OU retard de livraison). */
function needsRiskTag(d) {
  const o = d || {};
  return (Array.isArray(o.qualityFlags) && o.qualityFlags.length > 0) || !!o.overdue;
}

/** Retrouve notre commentaire marqué parmi les commentaires d'une tâche (le plus récent gagne). PUR. */
function findMarkedComment(comments, marker) {
  const m = marker || MARKER;
  const mine = (comments || []).filter((c) => String((c && c.comment_text) || "").startsWith(m));
  return mine.length ? mine[mine.length - 1] : null;
}

// --- Jalons → sous-tâches (clé stable = index `Jalon i`) ---
/** Sous-tâches attendues à partir des jalons. Nom déterministe `Jalon i · <label> · <date> — <montant> XOF`.
 *  Chaque entrée porte sa clé (`Jalon i`), son échéance (ms) et son montant. PUR. */
function buildMilestoneSubtasks(milestones) {
  const out = [];
  (Array.isArray(milestones) ? milestones : []).forEach((m, i) => {
    if (!m) return;
    const amount = Number(m.amount || 0);
    const due = day(m.dueDate || m.date);
    if (!amount && !due) return; // jalon vide → ignoré
    const key = `${MS_PREFIX} ${i + 1}`;
    const parts = [key];
    if (m.label) parts.push(String(m.label));
    parts.push(due || "sans date");
    const name = `${parts.join(" · ")} — ${money(amount)} XOF`;
    const dueMs = due ? Date.parse(due + "T00:00:00Z") : null;
    out.push({ key, name, dueMs: Number.isFinite(dueMs) ? dueMs : null, amount });
  });
  return out;
}

/** Clé de réconciliation portée par le nom d'une sous-tâche (`Jalon 3 · …` → `Jalon 3`). PUR. */
function subtaskKey(name) {
  const m = new RegExp("^" + MS_PREFIX + "\\s+(\\d+)\\b").exec(String(name || ""));
  return m ? `${MS_PREFIX} ${m[1]}` : null;
}

/** Planifie la réconciliation des sous-tâches jalons. existing = [{id, name, due_date}] (sous-tâches
 *  ClickUp). Renvoie { toCreate:[expected], toUpdate:[{id, expected}] }. NE SUPPRIME rien (préserve un
 *  éventuel suivi manuel) — seul l'écart nom/échéance déclenche une mise à jour. PUR & idempotent. */
function planMilestoneSubtasks(existing, expected) {
  const byKey = {};
  for (const t of (Array.isArray(existing) ? existing : [])) {
    const k = subtaskKey(t && t.name);
    if (k && !(k in byKey)) byKey[k] = t;
  }
  const toCreate = [], toUpdate = [];
  for (const e of (expected || [])) {
    const cur = byKey[e.key];
    if (!cur) { toCreate.push(e); continue; }
    const dueCur = cur.due_date != null ? String(cur.due_date) : "";
    const dueExp = e.dueMs != null ? String(e.dueMs) : "";
    if (String(cur.name || "") !== e.name || dueCur !== dueExp) toUpdate.push({ id: cur.id, expected: e });
  }
  return { toCreate, toUpdate };
}

// --- BC liés → checklist ---
/** Éléments de checklist attendus pour les BC liés (dédupliqués, ordonnés). PUR. */
function buildBcChecklistItems(bcRefs) {
  return [...new Set((Array.isArray(bcRefs) ? bcRefs : []).filter(Boolean).map((s) => String(s).trim()).filter(Boolean))];
}
/** Retrouve NOTRE checklist (par nom) parmi les checklists d'une tâche. PUR. */
function findBcChecklist(checklists, name) {
  const n = name || BC_CHECKLIST;
  return (Array.isArray(checklists) ? checklists : []).find((c) => c && c.name === n) || null;
}

module.exports = {
  MARKER, RISK_TAG, MS_PREFIX, BC_CHECKLIST,
  buildSyncComment, needsRiskTag, findMarkedComment,
  buildMilestoneSubtasks, subtaskKey, planMilestoneSubtasks,
  buildBcChecklistItems, findBcChecklist,
};
