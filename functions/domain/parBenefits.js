// Domain PUR — Avantages programme constructeur (par_, PAR-L3) : MDF (fonds marketing), rebates
// (remises arrière) et deal registrations (enregistrement d'affaires). Aucun I/O → testable.
//
// Trois objets, trois collections (mêmes profils que par_certifications/par_assignments) :
//  • par_dealregs — enregistrement d'une affaire auprès du constructeur (protection de remise). Porte des
//    montants d'OPPS → lisible au droit `partenariats` (précédent ADR-059 : par_pipeline).
//  • par_mdf     — fonds marketing accordés par le constructeur (budget à consommer avant expiration).
//    Budget marketing, pas une marge → lisible au droit `partenariats`.
//  • par_rebates — remises ARRIÈRE (marge constructeur sur le CA réalisé) : donnée de MARGE → second
//    verrou `rentabilite` (comme par_ca, ADR-P07), côté rules ET côté summary (préfixe par_ca).
//
// Statuts en slug FR (codes applicatifs, libellés FR au front — règle de l'ERP). Les statuts sensibles
// au TEMPS (expiration) sont DÉRIVÉS au recompute (sweep, comme computeCertStatus) — le champ persisté
// n'est qu'un cache réécrit quand le temps l'a changé. Montants ENTIERS XOF (le FCFA n'a pas de subdivision).
const { slug } = require("./parPartner");
const { fpKey, plausibleYear } = require("../lib/ids");

const DEALREG_STATUSES = ["soumis", "approuve", "rejete", "expire"];
const MDF_STATUSES = ["accorde", "consomme", "rembourse", "expire"];
const REBATE_STATUSES = ["attendu", "reclame", "recu", "abandonne"];

function str(v, max) { const s = String(v == null ? "" : v).trim(); return max ? s.slice(0, max) : s; }
function isoDate(v) { const s = str(v); return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null; }
// Date ISO PLAUSIBLE (discipline plausibleYear — CLAUDE.md : tout millésime passe par elle) : une date
// aberrante (1900, 20226) fausserait fenêtres d'expiration et alertes — refusée, jamais devinée.
function plausibleIso(v) { const d = isoDate(v); return d && plausibleYear(d.slice(0, 4)) ? d : null; }
function amountXof(v) { if (v == null || v === "") return null; const n = Number(v); return Number.isFinite(n) && n >= 0 ? Math.round(n) : null; }
function pct100(v) { if (v == null || v === "") return null; const n = Number(v); return Number.isFinite(n) && n >= 0 && n <= 100 ? n : null; }
const daysBetween = (a, b) => Math.ceil((new Date(a) - new Date(b)) / 86400000);
// Palier d'expiration J-90/60/30 (même mécanique que partnerRenewalWatch — un avantage programme se
// pilote en amont, pas de palier J-7).
const expiryBucket = (daysLeft) => (daysLeft <= 0 ? "expired" : daysLeft <= 30 ? "j30" : daysLeft <= 60 ? "j60" : daysLeft <= 90 ? "j90" : null);

// ── Validation ───────────────────────────────────────────────────────────────

/** Deal registration : { ok, error?, value? }. partnerId + client requis ; FP optionnel CANONICALISÉ
 *  (fpKey — invariant ERP : rapprocher deux FP passe toujours par fpKey) ; dates plausibles. */
function validateDealReg(d) {
  const o = d || {};
  const partnerId = slug(o.partnerId);
  if (!partnerId) return { ok: false, error: "partenaire (partnerId) requis" };
  const client = str(o.client, 120);
  if (!client) return { ok: false, error: "client requis" };
  const statut = str(o.statut || "soumis").toLowerCase();
  if (!DEALREG_STATUSES.includes(statut)) return { ok: false, error: "statut de deal registration invalide" };
  const value = { partnerId, client, statut };
  const designation = str(o.designation, 200);
  if (designation) value.designation = designation;
  const refConstructeur = str(o.refConstructeur, 80);
  if (refConstructeur) value.refConstructeur = refConstructeur;
  if (str(o.fp)) {
    const fp = fpKey(o.fp);
    if (!fp) return { ok: false, error: "N° FP invalide (format FP/AAAA/N attendu)" };
    value.fp = fp;
  }
  if (o.amountXof != null && o.amountXof !== "") {
    const n = amountXof(o.amountXof);
    if (n == null) return { ok: false, error: "montant invalide (XOF ≥ 0)" };
    value.amountXof = n;
  }
  if (o.remisePct != null && o.remisePct !== "") {
    const p = pct100(o.remisePct);
    if (p == null) return { ok: false, error: "remise invalide (% entre 0 et 100)" };
    value.remisePct = p;
  }
  if (str(o.dateSoumission)) {
    const ds = plausibleIso(o.dateSoumission);
    if (!ds) return { ok: false, error: "date de soumission invalide (AAAA-MM-JJ plausible)" };
    value.dateSoumission = ds;
  }
  if (str(o.dateExpiration)) {
    const de = plausibleIso(o.dateExpiration);
    if (!de) return { ok: false, error: "date d'expiration invalide (AAAA-MM-JJ plausible)" };
    value.dateExpiration = de;
  }
  const note = str(o.note, 500);
  if (note) value.note = note;
  return { ok: true, value };
}

/** Fonds marketing (MDF) : montant accordé > 0 requis ; consommé ≥ 0 (peut dépasser l'accordé — un
 *  dépassement se VOIT au restant 0, jamais bloqué en saisie). */
function validateMdf(d) {
  const o = d || {};
  const partnerId = slug(o.partnerId);
  if (!partnerId) return { ok: false, error: "partenaire (partnerId) requis" };
  const label = str(o.label, 160);
  if (!label) return { ok: false, error: "libellé du fonds requis" };
  const alloue = amountXof(o.amountXof);
  if (alloue == null || alloue <= 0) return { ok: false, error: "montant accordé requis (XOF > 0)" };
  const used = o.usedXof == null || o.usedXof === "" ? 0 : amountXof(o.usedXof);
  if (used == null) return { ok: false, error: "montant consommé invalide (XOF ≥ 0)" };
  const statut = str(o.statut || "accorde").toLowerCase();
  if (!MDF_STATUSES.includes(statut)) return { ok: false, error: "statut de fonds invalide" };
  const value = { partnerId, label, amountXof: alloue, usedXof: used, statut };
  if (str(o.dateExpiration)) {
    const de = plausibleIso(o.dateExpiration);
    if (!de) return { ok: false, error: "date d'expiration invalide (AAAA-MM-JJ plausible)" };
    value.dateExpiration = de;
  }
  const note = str(o.note, 500);
  if (note) value.note = note;
  return { ok: true, value };
}

/** Rebate (remise arrière) : période requise ; l'ATTENDU est saisi, sinon DÉRIVÉ assiette × taux (jamais
 *  les deux vérités : la saisie prime). Montants CONFIDENTIELS (rentabilite) — jamais dans l'auditLog. */
function validateRebate(d) {
  const o = d || {};
  const partnerId = slug(o.partnerId);
  if (!partnerId) return { ok: false, error: "partenaire (partnerId) requis" };
  const periode = str(o.periode, 40);
  if (!periode) return { ok: false, error: "période requise (ex. 2026-T1)" };
  const statut = str(o.statut || "attendu").toLowerCase();
  if (!REBATE_STATUSES.includes(statut)) return { ok: false, error: "statut de rebate invalide" };
  const value = { partnerId, periode, statut };
  if (o.assietteXof != null && o.assietteXof !== "") {
    const n = amountXof(o.assietteXof);
    if (n == null) return { ok: false, error: "assiette invalide (XOF ≥ 0)" };
    value.assietteXof = n;
  }
  if (o.tauxPct != null && o.tauxPct !== "") {
    const p = pct100(o.tauxPct);
    if (p == null) return { ok: false, error: "taux invalide (% entre 0 et 100)" };
    value.tauxPct = p;
  }
  const attenduIn = o.attenduXof == null || o.attenduXof === "" ? null : amountXof(o.attenduXof);
  if (o.attenduXof != null && o.attenduXof !== "" && attenduIn == null) return { ok: false, error: "montant attendu invalide (XOF ≥ 0)" };
  // Attendu = saisi > dérivé assiette × taux > 0 (une seule source affichée, la saisie prime).
  value.attenduXof = attenduIn != null ? attenduIn
    : value.assietteXof != null && value.tauxPct != null ? Math.round(value.assietteXof * value.tauxPct / 100) : 0;
  const recu = o.recuXof == null || o.recuXof === "" ? 0 : amountXof(o.recuXof);
  if (recu == null) return { ok: false, error: "montant reçu invalide (XOF ≥ 0)" };
  value.recuXof = recu;
  if (str(o.dateEcheance)) {
    const de = plausibleIso(o.dateEcheance);
    if (!de) return { ok: false, error: "date d'échéance invalide (AAAA-MM-JJ plausible)" };
    value.dateEcheance = de;
  }
  const note = str(o.note, 500);
  if (note) value.note = note;
  return { ok: true, value };
}

// ── Statuts dérivés (sweep du recompute, comme computeCertStatus) ────────────
// Un deal reg SOUMIS/APPROUVÉ dont la fenêtre est passée est EXPIRÉ ; un fonds ACCORDÉ échu aussi.
// Les états terminaux (rejete, consomme, rembourse…) ne bougent jamais avec le temps.
function deriveDealRegStatus(d, todayIso) {
  const o = d || {};
  if ((o.statut === "soumis" || o.statut === "approuve") && o.dateExpiration && o.dateExpiration < todayIso) return "expire";
  return o.statut;
}
function deriveMdfStatus(m, todayIso) {
  const o = m || {};
  if (o.statut === "accorde" && o.dateExpiration && o.dateExpiration < todayIso) return "expire";
  return o.statut;
}

// ── Agrégats (summaries) ─────────────────────────────────────────────────────

/**
 * Synthèse des avantages NON confidentiels → summaries/par_benefits (droit `partenariats`).
 *  - dealregs : compteurs + montants par partenaire, expirations ≤ 30 j (fenêtre d'action courte : une
 *    protection de remise se prolonge auprès du constructeur), COUVERTURE du pipeline sourcé (opps
 *    ouvertes taguées parPartnerId vs regs actives) — mesure « enregistre-t-on nos affaires ? ».
 *  - mdf : accordé / consommé / restant par partenaire + expirations J-90/60/30 du budget NON consommé.
 * Les statuts sont supposés DÉJÀ dérivés (sweep amont). PUR.
 * @param {object[]} dealregs  par_dealregs
 * @param {object[]} mdfs      par_mdf
 * @param {object[]} opps      opportunités (stage, parPartnerId, fp) — même population que par_pipeline
 * @param {string} todayIso
 */
function benefitsSummary({ dealregs, mdfs, opps, todayIso }) {
  const drBy = new Map();
  const drEnsure = (pid) => { let e = drBy.get(pid); if (!e) { e = { partnerId: pid, total: 0, soumis: 0, approuves: 0, rejetes: 0, expires: 0, approvedXof: 0 }; drBy.set(pid, e); } return e; };
  const drExpiring = [];
  for (const d of dealregs || []) {
    if (!d || !d.partnerId) continue;
    const e = drEnsure(d.partnerId);
    e.total += 1;
    if (d.statut === "soumis") e.soumis += 1;
    else if (d.statut === "approuve") { e.approuves += 1; e.approvedXof += Math.round(Number(d.amountXof) || 0); }
    else if (d.statut === "rejete") e.rejetes += 1;
    else if (d.statut === "expire") e.expires += 1;
    if ((d.statut === "soumis" || d.statut === "approuve") && d.dateExpiration) {
      const daysLeft = daysBetween(d.dateExpiration, todayIso);
      if (daysLeft <= 30) drExpiring.push({ id: d.id, partnerId: d.partnerId, client: d.client || "", designation: d.designation || "", refConstructeur: d.refConstructeur || "", dateExpiration: d.dateExpiration, daysLeft });
    }
  }
  drExpiring.sort((a, b) => a.daysLeft - b.daysLeft);

  // Couverture du pipeline sourcé : opps OUVERTES (étapes 1-5) taguées partenaire vs regs ACTIVES
  // (soumis + approuvé) — un ratio > 1 (plus de regs que d'opps taguées) est plafonné à l'affichage front.
  const openByPartner = new Map();
  for (const o of opps || []) {
    const s = Number(o && o.stage) || 0;
    const pid = slug(o && o.parPartnerId);
    if (pid && s >= 1 && s <= 5) openByPartner.set(pid, (openByPartner.get(pid) || 0) + 1);
  }
  for (const [pid, openCount] of openByPartner) drEnsure(pid).openOppCount = openCount;
  const drPartners = [...drBy.values()].map((e) => ({ openOppCount: 0, ...e, activeRegs: e.soumis + e.approuves }))
    .sort((a, b) => b.total - a.total || a.partnerId.localeCompare(b.partnerId));

  const mdfBy = new Map();
  const mdfEnsure = (pid) => { let e = mdfBy.get(pid); if (!e) { e = { partnerId: pid, allocatedXof: 0, usedXof: 0, remainingXof: 0, funds: 0 }; mdfBy.set(pid, e); } return e; };
  const mdfExpiring = [];
  for (const m of mdfs || []) {
    if (!m || !m.partnerId) continue;
    // Un fonds EXPIRÉ ne compte plus dans le disponible (budget perdu) mais reste dans le consommé.
    const alloc = Math.round(Number(m.amountXof) || 0);
    const used = Math.round(Number(m.usedXof) || 0);
    const e = mdfEnsure(m.partnerId);
    e.funds += 1;
    e.usedXof += used;
    if (m.statut === "accorde") {
      e.allocatedXof += alloc;
      e.remainingXof += Math.max(0, alloc - used);
      if (m.dateExpiration) {
        const daysLeft = daysBetween(m.dateExpiration, todayIso);
        const bucket = expiryBucket(daysLeft);
        if (bucket && Math.max(0, alloc - used) > 0) mdfExpiring.push({ id: m.id, partnerId: m.partnerId, label: m.label || "", remainingXof: Math.max(0, alloc - used), dateExpiration: m.dateExpiration, daysLeft, bucket });
      }
    } else if (m.statut === "consomme" || m.statut === "rembourse") {
      e.allocatedXof += alloc;
    }
    // « expire » : accordé PERDU — ni dans allocated (budget encore ouvert) ni dans remaining.
  }
  mdfExpiring.sort((a, b) => a.daysLeft - b.daysLeft);
  const mdfPartners = [...mdfBy.values()].sort((a, b) => b.remainingXof - a.remainingXof || a.partnerId.localeCompare(b.partnerId));

  return {
    dealregs: {
      partners: drPartners,
      total: drPartners.reduce((s, e) => s + e.total, 0),
      activeRegs: drPartners.reduce((s, e) => s + e.activeRegs, 0),
      approvedXof: drPartners.reduce((s, e) => s + e.approvedXof, 0),
      expiring: drExpiring.slice(0, 50), expiringTotal: drExpiring.length,
    },
    mdf: {
      partners: mdfPartners,
      allocatedXof: mdfPartners.reduce((s, e) => s + e.allocatedXof, 0),
      usedXof: mdfPartners.reduce((s, e) => s + e.usedXof, 0),
      remainingXof: mdfPartners.reduce((s, e) => s + e.remainingXof, 0),
      expiring: mdfExpiring.slice(0, 50), expiringTotal: mdfExpiring.length,
    },
  };
}

/**
 * Synthèse des REBATES → summaries/par_ca_rebates (préfixe par_ca ⇒ verrou `rentabilite` par les rules,
 * comme par_ca — la remise arrière est une donnée de MARGE). Attendu / reçu / écart par partenaire +
 * échus non reçus (statut attendu|reclame à échéance passée). PUR.
 */
function rebatesSummary({ rebates, todayIso }) {
  const by = new Map();
  const ensure = (pid) => { let e = by.get(pid); if (!e) { e = { partnerId: pid, attenduXof: 0, recuXof: 0, count: 0 }; by.set(pid, e); } return e; };
  const overdue = [];
  for (const r of rebates || []) {
    if (!r || !r.partnerId) continue;
    if (r.statut === "abandonne") continue; // renoncé — hors attendu/écart (reste lisible dans la table)
    const e = ensure(r.partnerId);
    e.count += 1;
    e.attenduXof += Math.round(Number(r.attenduXof) || 0);
    e.recuXof += Math.round(Number(r.recuXof) || 0);
    if ((r.statut === "attendu" || r.statut === "reclame") && r.dateEcheance && r.dateEcheance < todayIso) {
      overdue.push({ id: r.id, partnerId: r.partnerId, periode: r.periode || "", attenduXof: Math.round(Number(r.attenduXof) || 0), recuXof: Math.round(Number(r.recuXof) || 0), dateEcheance: r.dateEcheance, daysLate: daysBetween(todayIso, r.dateEcheance) });
    }
  }
  overdue.sort((a, b) => b.daysLate - a.daysLate);
  const partners = [...by.values()].map((e) => ({ ...e, ecartXof: e.attenduXof - e.recuXof }))
    .sort((a, b) => b.attenduXof - a.attenduXof || a.partnerId.localeCompare(b.partnerId));
  return {
    partners,
    attenduXof: partners.reduce((s, e) => s + e.attenduXof, 0),
    recuXof: partners.reduce((s, e) => s + e.recuXof, 0),
    ecartXof: partners.reduce((s, e) => s + e.ecartXof, 0),
    overdue: overdue.slice(0, 50), overdueTotal: overdue.length,
  };
}

module.exports = {
  DEALREG_STATUSES, MDF_STATUSES, REBATE_STATUSES,
  validateDealReg, validateMdf, validateRebate,
  deriveDealRegStatus, deriveMdfStatus,
  benefitsSummary, rebatesSummary,
};
