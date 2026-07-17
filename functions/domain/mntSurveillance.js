// Domain PUR — Centre de surveillance des contrats de maintenance (mnt_), Lot 5 (ADR-026). Aucun I/O.
// PROJETTE les items du moteur de risque (domain/mntRisque.js) en un FLUX d'événements clés ordonnés
// par sévérité : chaque `signal` porté par un contrat (SLA rompu, échéance proche, quota dépassé,
// sous-facturation) devient un événement diffusable. AUCUN recalcul de risque ici — la surveillance est
// une VUE du risque, garantissant « même métrique = même nombre » avec le centre de risque (summaries/
// mnt_risque). Matérialisé dans summaries/mnt_surveillance par le recompute (même bloc gaté que le risque).

// Sévérités = vocabulaire de domain/alerts.js (high/medium/low) pour rester indiscernable des autres
// alertes de l'ERP. Poids servant uniquement au TRI du flux (le plus grave d'abord).
const SEVERITY_RANK = { high: 0, medium: 1, low: 2 };

// Abrège un montant FCFA comme l'ERP (miroir de web/src/design/tokens.ts fmt et des messages de
// domain/alerts.js) : k / M / Md, JAMAIS l'entier brut — un « 12000000 » dans une alerte trahit le module.
function fmtXof(n) {
  const v = Number(n) || 0, abs = Math.abs(v);
  if (abs >= 1e9) return (v / 1e9).toFixed(2) + " Md";
  if (abs >= 1e6) return (v / 1e6).toFixed(1) + " M";
  if (abs >= 1e3) return (v / 1e3).toFixed(0) + " k";
  return String(Math.round(v));
}

// Libellé FR d'un événement à partir de son signal (métier en français — 02-REGLES.md).
function eventFromSignal(item, sig) {
  const base = { contratId: item.id, fp: item.fp || null, client: item.client || "", am: item.am || "", bu: item.bu || "", niveau: item.niveau };
  switch (sig.type) {
    case "sla_rompu":
      return { ...base, type: "sla_rompu", severity: "high", count: sig.count, message: `${sig.count} ticket${sig.count > 1 ? "s" : ""} en rupture de SLA` };
    case "echeance_proche": {
      // Échéance dépassée = high (à traiter tout de suite) ; ≤ 30 j = medium ; sinon low (anticipation).
      const j = Number(sig.jours);
      const severity = j <= 0 ? "high" : j <= 30 ? "medium" : "low";
      const message = j <= 0 ? `Contrat échu depuis ${-j} j — renouvellement à traiter` : `Échéance dans ${j} j — renouvellement à anticiper`;
      return { ...base, type: "echeance_proche", severity, jours: j, message };
    }
    case "quota_depasse":
      return { ...base, type: "quota_depasse", severity: "medium", depassement: sig.depassement, quota: sig.quota, message: `Quota de tickets dépassé (+${sig.depassement} ce mois, quota ${sig.quota})` };
    case "sous_facturation": {
      // Sous-facturation marquée (> 25 % de l'engagé) = high, sinon medium.
      const severity = Number(sig.pct) > 0.25 ? "high" : "medium";
      return { ...base, type: "sous_facturation", severity, ecart: sig.ecart, pct: sig.pct, message: `Sous-facturation de ${fmtXof(sig.ecart)} FCFA (${Math.round(Number(sig.pct) * 100)} % de l'engagé)` };
    }
    default:
      return null;
  }
}

/**
 * Projette le résultat du moteur de risque en flux d'événements de surveillance. PUR.
 * @param {object} risque résultat de mntRisque : { items:[{ id, fp, client, am, bu, niveau, signals[] }], ... }
 * @param {string} [asOf] date du jour (AAAA-MM-JJ) — repris pour horodater le flux.
 * @returns {{ events: object[], counts: {high:number,medium:number,low:number}, total:number, asOf:string|null }}
 */
function mntSurveillance(risque, asOf) {
  const items = risque && Array.isArray(risque.items) ? risque.items : [];
  const events = [];
  const counts = { high: 0, medium: 0, low: 0 };
  for (const item of items) {
    for (const sig of item.signals || []) {
      const ev = eventFromSignal(item, sig);
      if (!ev) continue;
      // id stable (contrat + type de signal) → dédoublonnage/diffing côté front sans horodatage volatil.
      ev.id = `${item.id}:${ev.type}`;
      events.push(ev);
      counts[ev.severity] = (counts[ev.severity] || 0) + 1;
    }
  }
  // Le plus grave d'abord ; à sévérité égale, l'échéance la plus proche/dépassée prime (jours croissants),
  // puis par client pour un ordre stable.
  events.sort((a, b) =>
    (SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]) ||
    ((a.jours ?? 1e9) - (b.jours ?? 1e9)) ||
    String(a.client).localeCompare(String(b.client)));
  return { events, counts, total: events.length, asOf: asOf || (risque && risque.asOf) || null };
}

// Abonnements de surveillance PAR UTILISATEUR (ADR-026) — normalisation PURE avant écriture dans
// mnt_watches/{uid}. `global` = tout le parc ; sinon ciblé par contrat (id), client (nom) ou AM (nom).
// Chaînes nettoyées (trim), dédoublonnées, bornées (garde-fou anti-doc géant). Champs absents → vides.
const WATCH_CAP = 200; // borne par liste (un utilisateur ne suit pas 200 contrats à la main ; garde-fou)
const cleanList = (v) => {
  if (!Array.isArray(v)) return [];
  const seen = new Set();
  for (const x of v) { const s = String(x == null ? "" : x).trim(); if (s && !seen.has(s)) seen.add(s); if (seen.size >= WATCH_CAP) break; }
  return [...seen];
};

/** Normalise un abonnement de surveillance. PUR. → { global, contrats[], clients[], ams[] } */
function normalizeWatch(data) {
  const d = data || {};
  return { global: !!d.global, contrats: cleanList(d.contrats), clients: cleanList(d.clients), ams: cleanList(d.ams) };
}

/** Un événement est-il couvert par un abonnement ? (global, ou contrat/client/AM ciblé). PUR. */
function watchMatchesEvent(watch, ev) {
  const w = watch || {};
  if (w.global) return true;
  if (!ev) return false;
  return (Array.isArray(w.contrats) && w.contrats.includes(ev.contratId)) ||
    (Array.isArray(w.clients) && ev.client && w.clients.includes(ev.client)) ||
    (Array.isArray(w.ams) && ev.am && w.ams.includes(ev.am));
}

module.exports = { SEVERITY_RANK, eventFromSignal, mntSurveillance, WATCH_CAP, normalizeWatch, watchMatchesEvent };
