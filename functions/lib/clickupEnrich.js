// Enrichissements app → ClickUp (Lot 3) — construction PURE d'un commentaire de SYNTHÈSE idempotent
// posé sur la tâche commande, et décision du tag « à risque ». Idempotent : le commentaire porte un
// MARQUEUR stable en 1re ligne ; l'appelant le retrouve pour le METTRE À JOUR au lieu d'en empiler.
// Consolider la synthèse (créances/jalons/BC/qualité) dans UN commentaire marqué évite la duplication
// que produiraient des sous-tâches / checklists recréées à chaque passage.

const MARKER = "🔄 Synthèse Neurone360"; // 1re ligne — sert de clé de reconnaissance (upsert)
const RISK_TAG = "à risque (n360)";      // tag posé/retiré selon la qualité + le retard

const money = (n) => Number(n || 0).toLocaleString("fr-FR");

/**
 * @param d { fp, cas, facture, raf, milestones:[{label,amount,dueDate}], bcRefs:[..], qualityFlags:[..],
 *            overdue:bool }
 * @returns string  commentaire complet (marqueur inclus)
 */
function buildSyncComment(d) {
  const o = d || {};
  const cas = Number(o.cas || 0), fac = Number(o.facture || 0);
  const pctFac = cas > 0 ? Math.round((fac / cas) * 100) : 0;
  const lines = [MARKER + " (mise à jour automatique)"];
  lines.push(`• CA signé : ${money(cas)} · Facturé : ${money(fac)} (${pctFac}%) · RAF : ${money(o.raf)}`);
  const ms = Array.isArray(o.milestones) ? o.milestones.filter((m) => m && (m.amount || m.dueDate)) : [];
  if (ms.length) {
    const next = ms.slice().sort((a, b) => String(a.dueDate || "").localeCompare(String(b.dueDate || "")))[0];
    const nx = next ? `${next.dueDate || "date ?"} — ${money(next.amount)}${next.label ? ` (${next.label})` : ""}` : "";
    lines.push(`• Jalons de facturation : ${ms.length}${nx ? ` · prochain ${nx}` : ""}`);
  }
  const bc = Array.isArray(o.bcRefs) ? o.bcRefs.filter(Boolean) : [];
  if (bc.length) lines.push(`• BC fournisseurs liés : ${bc.length} (${bc.slice(0, 8).join(", ")}${bc.length > 8 ? "…" : ""})`);
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

module.exports = { MARKER, RISK_TAG, buildSyncComment, needsRiskTag, findMarkedComment };
