// Domain PUR — Tickets & interventions de maintenance (mnt_), Lot 2. Aucun I/O → testable.
// Un ticket est une demande/incident sous contrat ; une intervention est du temps consultant passé
// dessus. Le temps est saisi en HEURES (grain naturel du support) ; il ALIMENTE le CRA existant
// (timesheets) converti en jours (ADR-013 : 8 h ouvrées = 1 jour), pour une seule vérité du temps.
const { fpKey, num, cleanName } = require("../lib/ids");
const { TYPES_MAINTENANCE } = require("./mntContrat");

// Type de maintenance (ADR-025) — OPTIONNEL sur ticket et intervention. Vide → null (pas de classement) ;
// une valeur renseignée hors énumération est rejetée (pas de coercion silencieuse d'une faute de saisie).
function normTypeMaintenance(v) {
  const s = String(v == null ? "" : v).trim();
  if (!s) return { ok: true, value: null };
  if (!TYPES_MAINTENANCE.includes(s)) return { ok: false, error: "type de maintenance invalide" };
  return { ok: true, value: s };
}

const TICKET_STATUTS = ["ouvert", "en_cours", "resolu", "clos"];
const PRIORITES = ["basse", "moyenne", "haute", "critique"]; // 4 niveaux (palette risque, ADR-014)
const HOURS_PER_DAY = 8; // conversion heures d'intervention → jours CRA (ADR-013)

const isoDate = (v) => { const s = String(v == null ? "" : v).slice(0, 10); return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null; };
// Mois « AAAA-MM » d'une date ISO — clé de rattachement au CRA mensuel (timesheets).
const monthOf = (isoOrNull) => { const s = isoDate(isoOrNull); return s ? s.slice(0, 7) : null; };
// Conversion heures → jours CRA (arrondi 2 décimales : le CRA porte des jours fractionnaires).
const craDaysFromHours = (hours) => Math.round(((Number(hours) || 0) / HOURS_PER_DAY) * 100) / 100;

// Valide un ticket. contratId = id du document mnt_contrats (rattachement). fp CANONIQUE (traçabilité).
function validateTicket(d) {
  const o = d || {};
  const contratId = String(o.contratId || "").trim();
  if (!contratId || contratId.includes("/")) return { ok: false, error: "contrat requis" };
  const fp = fpKey(o.fp);
  if (!fp) return { ok: false, error: "N° FP invalide" };
  const titre = String(o.titre || "").trim().slice(0, 200);
  if (!titre) return { ok: false, error: "titre requis" };
  const statut = String(o.statut || "").trim();
  if (!TICKET_STATUTS.includes(statut)) return { ok: false, error: "statut de ticket invalide" };
  const priorite = String(o.priorite || "").trim();
  if (!PRIORITES.includes(priorite)) return { ok: false, error: "priorité invalide" };
  const tm = normTypeMaintenance(o.typeMaintenance);
  if (!tm.ok) return { ok: false, error: tm.error };
  return { ok: true, value: { contratId, fp, client: cleanName(o.client) || "", titre, statut, priorite, typeMaintenance: tm.value } };
}

// Valide une intervention. consultantId = id du document consultants (rattachement CRA). heures > 0.
function validateIntervention(d) {
  const o = d || {};
  const ticketId = String(o.ticketId || "").trim();
  if (!ticketId || ticketId.includes("/")) return { ok: false, error: "ticket requis" };
  const contratId = String(o.contratId || "").trim();
  if (!contratId || contratId.includes("/")) return { ok: false, error: "contrat requis" };
  const fp = fpKey(o.fp);
  if (!fp) return { ok: false, error: "N° FP invalide" };
  const consultantId = String(o.consultantId || "").trim();
  if (!consultantId || consultantId.includes("/")) return { ok: false, error: "consultant requis" };
  const date = isoDate(o.date);
  if (!date) return { ok: false, error: "date d'intervention invalide (AAAA-MM-JJ)" };
  const heures = num(o.heures);
  if (!(heures > 0)) return { ok: false, error: "heures invalides (> 0 requis)" };
  const tm = normTypeMaintenance(o.typeMaintenance);
  if (!tm.ok) return { ok: false, error: tm.error };
  return { ok: true, value: { ticketId, contratId, fp, consultantId, date, heures: Math.round(heures * 100) / 100, commentaire: String(o.commentaire || "").trim().slice(0, 1000), typeMaintenance: tm.value } };
}

module.exports = { TICKET_STATUTS, PRIORITES, HOURS_PER_DAY, monthOf, craDaysFromHours, validateTicket, validateIntervention };
