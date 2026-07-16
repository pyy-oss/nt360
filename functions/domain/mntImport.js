// Plan d'import EN MASSE des contrats de maintenance (mnt_ — Lot 8). PUR : valide chaque ligne parsée
// (domain/mntContrat.validateMntContrat) et la classe en CRÉATION vs MISE À JOUR (par id = safeId(fp),
// 1 contrat = 1 affaire, ADR-001) ou en ERREUR. Le callable (handlers/maintenance.importMntContrats)
// garde l'I/O (lecture du classeur, écritures batch, audit). Testable sans Admin SDK.
const { validateMntContrat } = require("./mntContrat");
const { fpKey } = require("../lib/ids");
const { safeId } = require("../lib/sheets");

// Une cellule est « renseignée » si elle porte une valeur non vide. Sert à la MISE À JOUR NON EFFAÇANTE :
// une colonne absente/vide ne doit JAMAIS écraser la valeur stockée (montant, devise, BU, AM, date fin).
const provided = (v) => v != null && String(v).trim() !== "";
// Montant : présent seulement s'il contient un chiffre (« N/A »/« à revoir » ⇒ non fourni, pas 0).
const providedNum = (v) => provided(v) && /[0-9]/.test(String(v));

// Patch de MISE À JOUR d'un contrat existant : les champs REQUIS (toujours validés donc toujours présents)
// sont écrits ; les champs optionnels/dérivés ne le sont QUE si la cellule était renseignée. Les
// ENGAGEMENTS SLA ne sont JAMAIS touchés par l'import (ils restent saisis en fiche, ADR-012) — sans quoi
// un `set(merge:true)` avec `engagements:[]` remplacerait le tableau stocké (Firestore ne fusionne pas les
// arrays) et effacerait les engagements. Miroir de la garantie « cellule vide = champ non touché » (oppImport).
function updatePatch(value, raw) {
  const p = { client: value.client, statut: value.statut, echeanceType: value.echeanceType, dateDebut: value.dateDebut };
  if (provided(raw.bu)) p.bu = value.bu;
  if (provided(raw.am)) p.am = value.am;
  if (provided(raw.dateFin)) p.dateFin = value.dateFin;
  if (providedNum(raw.montantEngage)) p.montantEngage = value.montantEngage;
  if (provided(raw.deviseEngage)) p.deviseEngage = value.deviseEngage;
  return p;
}

/**
 * @param {{raw:object, line:number}[]} rows lignes parsées (parsers/mntImport)
 * @param {Set<string>|string[]} existingIds ids des contrats déjà en base (mnt_contrats)
 * @returns {{toCreate:{line,id,value}[], toUpdate:{line,id,value,patch}[], errors:{line,error,fp}[]}}
 */
function planMntContratsImport(rows, existingIds) {
  const existing = existingIds instanceof Set ? existingIds : new Set(existingIds || []);
  const errors = [];
  const list = Array.isArray(rows) ? rows : [];
  // DÉDUP intra-fichier par FP AVANT validation (fpKey canonique — jamais le FP brut) : la DERNIÈRE
  // occurrence d'une même affaire gagne, MÊME si elle est invalide. Sinon une re-saisie fautive (dernière
  // ligne) partirait en erreur tandis qu'une version ANTÉRIEURE valide s'importerait en silence — l'inverse
  // de la sémantique « ré-saisie » (audit m2). On repère l'index de la dernière occurrence de chaque FP et on
  // ignore les précédentes ; l'ordre des lignes (erreurs comme plan) est préservé. Un FP illisible ne peut
  // pas être regroupé : traité individuellement (il partira en erreur « N° FP invalide » à la validation).
  const lastIdxByFp = new Map();
  list.forEach((row, i) => { const k = fpKey(row && row.raw && row.raw.fp); if (k) lastIdxByFp.set(k, i); });
  const byId = new Map();
  for (let i = 0; i < list.length; i++) {
    const row = list[i];
    const k = fpKey(row && row.raw && row.raw.fp);
    if (k && lastIdxByFp.get(k) !== i) continue; // occurrence antérieure supersédée par une plus récente
    const v = validateMntContrat(row.raw);
    if (!v.ok) { errors.push({ line: row.line, error: v.error, fp: (row.raw && row.raw.fp) || null }); continue; }
    byId.set(safeId(v.value.fp), { line: row.line, id: safeId(v.value.fp), value: v.value, raw: row.raw });
  }
  const toCreate = [], toUpdate = [];
  for (const rec of byId.values()) {
    if (existing.has(rec.id)) toUpdate.push({ line: rec.line, id: rec.id, value: rec.value, patch: updatePatch(rec.value, rec.raw) });
    else toCreate.push({ line: rec.line, id: rec.id, value: rec.value }); // création : doc complet (engagements:[] neuf)
  }
  return { toCreate, toUpdate, errors };
}

module.exports = { planMntContratsImport, updatePatch };
