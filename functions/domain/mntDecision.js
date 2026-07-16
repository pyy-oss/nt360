// Domain PUR — Application de l'EFFET d'une décision d'approbation de contrat (ADR-022). Aucun I/O.
// Une décision APPROUVÉE doit MUTER le contrat, sinon la validation humaine reste sans effet (audit m4) :
//   - resiliation_contrat    → statut = "resilie" (sort du carnet de risque ET de la rentabilité, assiette vivante)
//   - renouvellement_contrat → dateFin repoussée d'une DURÉE = terme initial (dateFin d'origine + terme en mois)
// Rend { applied, patch, reason }. N'ÉCRIT rien : l'appelant (trigger onMntApprovalDecided) applique le patch.
const { monthsBetween, addMonthsIso } = require("./mntEcheancier");

function applyMntDecision(kind, contrat) {
  const c = contrat || {};
  if (kind === "resiliation_contrat") {
    if (c.statut === "resilie") return { applied: false, patch: null, reason: "déjà résilié" };
    return { applied: true, patch: { statut: "resilie" }, reason: "résiliation approuvée → statut resilie" };
  }
  if (kind === "renouvellement_contrat") {
    if (!c.dateDebut || !c.dateFin) return { applied: false, patch: null, reason: "renouvellement impossible sans date de fin" };
    const terme = monthsBetween(c.dateDebut, c.dateFin); // durée initiale en mois entiers = période de reconduction
    if (!(terme > 0)) return { applied: false, patch: null, reason: "durée de contrat nulle" };
    const nouvelleFin = addMonthsIso(c.dateFin, terme); // dateFin (borne de renouvellement) repoussée d'un terme
    if (!nouvelleFin) return { applied: false, patch: null, reason: "date de fin illisible" };
    // Un contrat échu/résilié RENAÎT actif au renouvellement ; un actif/suspendu garde son statut courant.
    const patch = { dateFin: nouvelleFin };
    if (c.statut === "resilie" || c.statut === "echu") patch.statut = "actif";
    return { applied: true, patch, reason: `renouvelé jusqu'au ${nouvelleFin}` };
  }
  return { applied: false, patch: null, reason: "nature de décision non applicable" };
}

module.exports = { applyMntDecision };
