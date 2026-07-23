// Résolution PURE du niveau d'accès depuis la matrice opposable (config/permissions), côté serveur.
// MIROIR de web/src/lib/perm.ts (garder aligné) : direction = write partout ; sinon valeur de la
// matrice, `none` par défaut. Rend l'autorisation des callables gouvernée par la MÊME source que les
// Security Rules et le front (matrice éditable via Habilitations), au lieu de listes de rôles figées.
// Rôles nommés par persona (audit P2-5) : + finance (DF), directeur_contrats, data_steward — retire le
// réflexe « direction » sur-privilégié. Additif : un rôle absent de la matrice résout à « none » partout
// (aucun accès accidentel ; `direction` inchangé). Les permissions se posent via Habilitations (matrice).
const ROLES = ["direction", "commercial_dir", "commercial", "pmo", "achats", "assistante", "lecture", "finance", "directeur_contrats", "data_steward"];
const LEVELS = ["none", "read", "write"];

function resolveLevel(matrix, role, module) {
  if (!role) return "none";
  if (role === "direction") return "write";
  const lvl = matrix && matrix[role] && matrix[role][module];
  return LEVELS.includes(lvl) ? lvl : "none";
}
const canRead = (matrix, role, module) => resolveLevel(matrix, role, module) !== "none";
const canWrite = (matrix, role, module) => resolveLevel(matrix, role, module) === "write";

/** Valide une matrice avant écriture (anti-DoS RBAC : une matrice malformée casserait `level()` pour
 *  tout le monde). Renvoie { ok, error }. Rôles ∈ ROLES, valeurs ∈ LEVELS, structure objet d'objets. */
function validateMatrix(matrix) {
  if (!matrix || typeof matrix !== "object" || Array.isArray(matrix)) return { ok: false, error: "matrice absente ou invalide" };
  const roles = Object.keys(matrix);
  if (!roles.length) return { ok: false, error: "matrice vide" };
  for (const role of roles) {
    if (!ROLES.includes(role)) return { ok: false, error: `rôle inconnu : ${role}` };
    const row = matrix[role];
    if (!row || typeof row !== "object" || Array.isArray(row)) return { ok: false, error: `ligne invalide pour ${role}` };
    for (const [mod, lvl] of Object.entries(row)) {
      if (!mod || typeof mod !== "string") return { ok: false, error: `module invalide pour ${role}` };
      if (!LEVELS.includes(lvl)) return { ok: false, error: `niveau invalide (${lvl}) pour ${role}/${mod}` };
    }
  }
  return { ok: true };
}

module.exports = { ROLES, LEVELS, resolveLevel, canRead, canWrite, validateMatrix };
