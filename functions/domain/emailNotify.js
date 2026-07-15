// Logique PURE des notifications email (aucune I/O) : validation de la config, résolution des
// destinataires, et construction des emails (sujet + HTML) pour chaque déclencheur. Testable (vitest).
// L'envoi effectif (Graph API) et les lectures Firestore sont à l'appelant (index.js).

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const isEmail = (s) => EMAIL_RE.test(String(s || "").trim());
const cleanEmails = (arr) => Array.from(new Set((Array.isArray(arr) ? arr : []).map((x) => String(x || "").trim().toLowerCase()).filter(isEmail)));

// Les déclencheurs pris en charge. `maintenance` (Lot 5) est ADDITIF : les configs existantes n'ont
// pas la clé → défaut `true` (comme les autres), mais le cron mntSlaSweep est de toute façon verrouillé
// par le drapeau config/mntFeature → aucun email tant que le module est éteint.
const TRIGGERS = ["approvals", "relances", "alerts", "codir", "maintenance"];

/** Normalise/valide la config email (config/emailNotify). Ne stocke JAMAIS le secret client (Secret Manager). */
function normalizeEmailConfig(raw) {
  const d = raw || {};
  const trig = d.triggers || {};
  return {
    enabled: !!d.enabled,
    tenantId: String(d.tenantId || "").trim(),
    clientId: String(d.clientId || "").trim(),
    sender: String(d.sender || "").trim(),
    recipients: {
      alerts: cleanEmails(d.recipients && d.recipients.alerts),
      codir: cleanEmails(d.recipients && d.recipients.codir),
    },
    triggers: TRIGGERS.reduce((acc, k) => { acc[k] = trig[k] !== false; return acc; }, {}),
  };
}

/** Config prête à envoyer ? (activée + app Azure renseignée + émetteur). Le secret est vérifié à l'appel. */
function canSend(cfg) {
  return !!(cfg && cfg.enabled && cfg.tenantId && cfg.clientId && cfg.sender);
}

// Résout des NOMS (commercial/manager) en emails via l'annuaire users (name normalisé → email).
function emailForName(name, usersByName) {
  if (!name) return null;
  const k = String(name).trim().toLowerCase();
  const u = usersByName && (usersByName[k] || null);
  return u && isEmail(u.email) ? u.email.toLowerCase() : null;
}

// --- Gabarit HTML premium sobre (inline, compatible clients email) ---
const esc = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
function shell(title, introHtml, rowsHtml, footer) {
  return `<div style="font-family:Segoe UI,Arial,sans-serif;max-width:640px;margin:0 auto;color:#1f2937">
<div style="background:#0f3d2e;color:#e9d8a6;padding:16px 20px;border-radius:8px 8px 0 0;font-size:16px;font-weight:600">nt360 · ${esc(title)}</div>
<div style="border:1px solid #e5e7eb;border-top:0;border-radius:0 0 8px 8px;padding:18px 20px;font-size:14px;line-height:1.5">
${introHtml || ""}
${rowsHtml || ""}
<div style="margin-top:18px;color:#9ca3af;font-size:12px">${footer || "Cockpit nt360 — notification automatique."}</div>
</div></div>`;
}
const listRows = (items) => `<ul style="margin:8px 0;padding-left:18px">${items.map((t) => `<li style="margin:4px 0">${t}</li>`).join("")}</ul>`;

/** Email « alertes critiques » (digest direction). `alerts` : [{message, severity, count}]. */
function buildAlertsEmail(alerts, fy) {
  const items = (alerts || []).map((a) => `<b>${esc(a.message)}</b>${a.count ? ` <span style="color:#9ca3af">(${a.count})</span>` : ""}`);
  return {
    subject: `nt360 — ${alerts.length} alerte(s) critique(s)${fy ? ` · exercice ${fy}` : ""}`,
    html: shell("Alertes critiques", `<p>Alertes détectées au dernier recalcul${fy ? ` (exercice ${esc(fy)})` : ""} :</p>`, listRows(items), "Ouvrez le Centre d'alertes pour agir."),
  };
}

/** Email « demande d'approbation » (au manager décideur). `req` : {type,label,amount,requester}. */
function buildApprovalEmail(reqObj) {
  const r = reqObj || {};
  const amount = r.amount != null ? ` · ${Number(r.amount).toLocaleString("fr-FR")} FCFA` : "";
  return {
    subject: `nt360 — Demande d'approbation : ${r.label || r.type || "à décider"}`,
    html: shell("Demande d'approbation", `<p><b>${esc(r.requester || "Un collaborateur")}</b> a soumis une demande à votre décision :</p>`,
      listRows([`Type : <b>${esc(r.typeLabel || r.type || "—")}</b>`, `Objet : ${esc(r.label || "—")}${esc(amount)}`, r.note ? `Note : ${esc(r.note)}` : ""].filter(Boolean)),
      "Ouvrez « Approbations » dans nt360 pour décider (approuver / refuser)."),
  };
}

/** Email « relances » (au responsable). `groups` : {creances:[], bc:[], jalons:[]} (montants agrégés). */
// `g` = agrégats COMPLETS par responsable : { creances:{count,total}, bc:{count,total}, jalons:{count,total} }.
// Basé sur `byResp` (couvre TOUS les responsables, y compris ceux dont le détail dépasse le plafond
// d'items du summary — sinon un responsable très chargé ne recevait aucun email / des totaux tronqués).
function buildRelancesEmail(who, g) {
  const sections = [];
  const fmt = (n) => Math.round(n).toLocaleString("fr-FR");
  const c = g.creances || {}, b = g.bc || {}, j = g.jalons || {};
  if (c.count) sections.push(`<b>${c.count}</b> créance(s) échue(s) · ${fmt(c.total || 0)} FCFA à relancer`);
  if (b.count) sections.push(`<b>${b.count}</b> BC fournisseur(s) en retard`);
  if (j.count) sections.push(`<b>${j.count}</b> jalon(s) échu(s) non facturé(s) · ${fmt(j.total || 0)} FCFA à émettre`);
  return {
    subject: `nt360 — Relances à traiter (${who})`,
    html: shell("Relances à traiter", `<p>Bonjour ${esc(who)}, éléments à relancer aujourd'hui :</p>`, listRows(sections), "Ouvrez « Relances » dans nt360 pour le détail et les actions."),
  };
}

/** Email « bulletin CODIR hebdo ». `bulletins` : [{severity,title,detail}], `kpis` : texte libre. */
function buildCodirEmail(bulletins, headline) {
  const items = (bulletins || []).slice(0, 20).map((b) => `<b>${esc(b.title)}</b>${b.detail ? ` — <span style="color:#4b5563">${esc(b.detail)}</span>` : ""}`);
  return {
    subject: `nt360 — Bulletin CODIR hebdomadaire`,
    html: shell("Bulletin CODIR", headline ? `<p>${esc(headline)}</p>` : "<p>Synthèse hebdomadaire des faits marquants :</p>", items.length ? listRows(items) : "<p style=\"color:#9ca3af\">Aucun fait marquant cette semaine.</p>", "Ouvrez le Bilan CODIR dans nt360 pour la vue complète."),
  };
}

// Libellés FR des paliers/signaux de risque (le domaine mntRisque ne porte que des codes). Utilisés
// pour l'email de digest ; le front a son propre miroir de libellés (web/src/lib/mntRisque.ts).
const MNT_NIVEAU_LABEL = { critique: "Critique", rouge: "Rouge", ambre: "Ambre", vert: "Vert" };
const MNT_SIGNAL_LABEL = { sla_rompu: "SLA rompu", echeance_proche: "Échéance proche", quota_depasse: "Quota dépassé", sous_facturation: "Sous-facturation" };

/**
 * Email « digest de risque des contrats de maintenance » (Lot 5). `items` = contrats à risque
 * (niveau ≠ vert), déjà filtrés/triés. `audience` = "direction" (digest global) ou un nom d'AM
 * (ses contrats). Best-effort côté appelant (mntSlaSweep). Rien d'envoyé si `items` est vide.
 */
function buildMntRisqueEmail(items, audience) {
  const list = Array.isArray(items) ? items : [];
  const rows = list.slice(0, 30).map((it) => {
    const sig = (it.signals || []).map((s) => MNT_SIGNAL_LABEL[s.type] || s.type).join(", ");
    const niv = MNT_NIVEAU_LABEL[it.niveau] || it.niveau;
    return `<b>${esc(it.client || "—")}</b> <span style="color:#9ca3af">${esc(it.fp || "")}</span> — ${esc(niv)} (${Number(it.score) || 0}/100)${sig ? ` · <span style="color:#4b5563">${esc(sig)}</span>` : ""}`;
  });
  const isDir = audience === "direction";
  const intro = isDir
    ? `<p>${list.length} contrat(s) de maintenance à surveiller (risque Ambre ou plus) :</p>`
    : `<p>Bonjour ${esc(audience || "")}, vos contrats de maintenance à surveiller :</p>`;
  return {
    subject: `nt360 — Risque contrats de maintenance : ${list.length} à surveiller${isDir ? "" : ` (${esc(audience || "")})`}`,
    html: shell("Risque · Contrats de maintenance", intro, rows.length ? listRows(rows) : "<p style=\"color:#9ca3af\">Aucun contrat à risque.</p>", "Ouvrez « Contrats de maintenance » dans nt360 pour le détail et les décisions."),
  };
}

module.exports = {
  TRIGGERS, isEmail, cleanEmails, normalizeEmailConfig, canSend, emailForName,
  buildAlertsEmail, buildApprovalEmail, buildRelancesEmail, buildCodirEmail, buildMntRisqueEmail,
  MNT_NIVEAU_LABEL, MNT_SIGNAL_LABEL,
};
