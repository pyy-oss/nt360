// Plan d'import EN MASSE des contrats de maintenance (mnt_ — Lot 8). PUR : valide chaque ligne parsée
// (domain/mntContrat.validateMntContrat) et la classe en CRÉATION vs MISE À JOUR (par id = safeId(fp),
// 1 contrat = 1 affaire, ADR-001) ou en ERREUR. Le callable (handlers/maintenance.importMntContrats)
// garde l'I/O (lecture du classeur, écritures batch, audit). Testable sans Admin SDK.
const { validateMntContrat } = require("./mntContrat");
const { safeId } = require("../lib/sheets");

/**
 * @param {{raw:object, line:number}[]} rows lignes parsées (parsers/mntImport)
 * @param {Set<string>|string[]} existingIds ids des contrats déjà en base (mnt_contrats)
 * @returns {{toCreate:{line,id,value}[], toUpdate:{line,id,value}[], errors:{line,error,fp}[]}}
 */
function planMntContratsImport(rows, existingIds) {
  const existing = existingIds instanceof Set ? existingIds : new Set(existingIds || []);
  const errors = [];
  // DÉDUP intra-fichier par id (même FP répété) : la DERNIÈRE occurrence gagne (comme une ré-saisie),
  // pour ne pas écrire deux fois la même affaire ni gonfler les compteurs.
  const byId = new Map();
  for (const row of rows || []) {
    const v = validateMntContrat(row.raw);
    if (!v.ok) { errors.push({ line: row.line, error: v.error, fp: (row.raw && row.raw.fp) || null }); continue; }
    byId.set(safeId(v.value.fp), { line: row.line, id: safeId(v.value.fp), value: v.value });
  }
  const toCreate = [], toUpdate = [];
  for (const rec of byId.values()) (existing.has(rec.id) ? toUpdate : toCreate).push(rec);
  return { toCreate, toUpdate, errors };
}

module.exports = { planMntContratsImport };
