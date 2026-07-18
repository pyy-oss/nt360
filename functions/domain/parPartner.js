// Domain PUR — Référentiel Partenaire constructeur (par_) : validation + énumérations. Aucun I/O → testable.
// Un document par_partners/{id} porte le référentiel COMPLET d'un partenaire, structures EMBARQUÉES
// (mêmes idiomes que les engagements SLA embarqués du module maintenance, ADR-012) : niveaux (tiers),
// compétences, catalogue de certifications, exigences de quota par niveau. Données de RÉFÉRENCE
// (éditées par la direction/steward, rarement) → lecture en un doc, pas de sous-collection.
//
// Règles de l'ERP : identifiants en slug stable ([a-z0-9-]) comme les codes applicatifs ; libellés FR à
// l'affichage seulement (côté front). La VALIDITÉ d'une certification (mois) est portée PAR l'entrée de
// catalogue (`validityMonths`), JAMAIS codée en dur ailleurs (point d'attention kit : Fortinet 24 mois).

// Niveaux de certification (code applicatif ; libellés FR à l'affichage). Source : spec kit.
const LEVELS = ["associate", "professional", "expert"];
const DEFAULT_VALIDITY_MONTHS = 24; // repli SI une entrée de catalogue n'en fournit pas (jamais imposé)

// Slug stable : minuscules, chiffres, tirets. Rejette le vide. Sert d'identifiant de tier/compétence/
// certif/partenaire — jointure universelle du module (partnerId, certificationCatalogId, tierId…).
function slug(v) {
  const s = String(v == null ? "" : v).trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return s || null;
}
function str(v, max) { const s = String(v == null ? "" : v).trim(); return max ? s.slice(0, max) : s; }
function intNonNeg(v) { const n = Math.round(Number(v)); return Number.isFinite(n) && n >= 0 ? n : null; }

// Un niveau de partenariat : id slug, libellé, rang entier ≥ 0 (ordonne Authorized < Gold < Platinum…).
function validateTier(t) {
  const o = t || {};
  const id = slug(o.id);
  if (!id) return { ok: false, error: "id de niveau invalide" };
  const name = str(o.name, 80);
  if (!name) return { ok: false, error: `libellé requis pour le niveau ${id}` };
  const rank = intNonNeg(o.rank);
  if (rank == null) return { ok: false, error: `rang invalide pour le niveau ${id}` };
  return { ok: true, value: { id, name, rank } };
}

// Une compétence (axe de certification, ex. Server / Security) : id slug + libellé.
function validateCompetency(c) {
  const o = c || {};
  const id = slug(o.id);
  if (!id) return { ok: false, error: "id de compétence invalide" };
  const name = str(o.name, 80);
  if (!name) return { ok: false, error: `libellé requis pour la compétence ${id}` };
  return { ok: true, value: { id, name } };
}

// Une entrée de catalogue de certification : id, compétence rattachée, code/libellé, niveau, VALIDITÉ en
// mois (portée ici, jamais en dur), fournisseur d'examen (optionnel), prérequis (optionnel).
function validateCatalogEntry(e) {
  const o = e || {};
  const id = slug(o.id);
  if (!id) return { ok: false, error: "id de certification invalide" };
  const competencyId = slug(o.competencyId);
  if (!competencyId) return { ok: false, error: `compétence requise pour la certification ${id}` };
  const code = str(o.code, 40);
  const name = str(o.name, 120);
  if (!name) return { ok: false, error: `libellé requis pour la certification ${id}` };
  const level = str(o.level).toLowerCase();
  if (!LEVELS.includes(level)) return { ok: false, error: `niveau invalide pour la certification ${id}` };
  const vm = o.validityMonths == null || o.validityMonths === "" ? DEFAULT_VALIDITY_MONTHS : intNonNeg(o.validityMonths);
  if (vm == null || vm <= 0) return { ok: false, error: `validité (mois) invalide pour la certification ${id}` };
  const value = { id, competencyId, code, name, level, validityMonths: vm };
  const examProvider = str(o.examProvider, 80);
  if (examProvider) value.examProvider = examProvider;
  const prerequisiteCertId = slug(o.prerequisiteCertId);
  if (prerequisiteCertId) value.prerequisiteCertId = prerequisiteCertId;
  return { ok: true, value };
}

// Une exigence de quota d'un niveau : le niveau (tierId), la certif OU compétence requise, le minimum
// d'ingénieurs certifiés (entier ≥ 1), un rôle requis optionnel (ex. "SE"). PLAT (tierId embarqué) —
// contrairement au kit qui imbrique par tier (structure divergente, aplatie ici pour un scan simple).
function validateRequirement(r) {
  const o = r || {};
  const tierId = slug(o.tierId);
  if (!tierId) return { ok: false, error: "niveau (tierId) requis pour une exigence" };
  const certIdOrCompetencyId = slug(o.certIdOrCompetencyId);
  if (!certIdOrCompetencyId) return { ok: false, error: `cible (certif/compétence) requise pour l'exigence du niveau ${tierId}` };
  const minCount = intNonNeg(o.minCount);
  if (minCount == null || minCount < 1) return { ok: false, error: `minimum invalide (≥ 1) pour l'exigence ${tierId}/${certIdOrCompetencyId}` };
  const value = { tierId, certIdOrCompetencyId, minCount };
  const requiredRole = str(o.requiredRole, 40);
  if (requiredRole) value.requiredRole = requiredRole;
  return { ok: true, value };
}

// Valide une liste, dédoublonne par `id` (dernier gagne), remonte la première erreur.
function validateList(arr, fn, key) {
  if (arr == null) return { ok: true, value: [] };
  if (!Array.isArray(arr)) return { ok: false, error: "liste attendue" };
  const byKey = new Map();
  for (const item of arr) {
    const v = fn(item);
    if (!v.ok) return v;
    byKey.set(key(v.value), v.value);
  }
  return { ok: true, value: [...byKey.values()] };
}

/**
 * Normalise + valide un référentiel partenaire complet. { ok, error?, value? }.
 * value.id est un slug ; tiers/competencies/certificationCatalog/requirements sont validés et
 * intègres référentiellement (une exigence pointe un niveau connu ; une certif pointe une compétence
 * connue) — sinon la couverture (Lot 2/4) lirait des cibles fantômes.
 */
function validatePartner(d) {
  const o = d || {};
  const id = slug(o.id);
  if (!id) return { ok: false, error: "id de partenaire invalide (slug requis)" };
  const name = str(o.name, 120);
  if (!name) return { ok: false, error: "nom de partenaire requis" };

  const tiers = validateList(o.tiers, validateTier, (t) => t.id);
  if (!tiers.ok) return tiers;
  const competencies = validateList(o.competencies, validateCompetency, (c) => c.id);
  if (!competencies.ok) return competencies;
  const catalog = validateList(o.certificationCatalog, validateCatalogEntry, (e) => e.id);
  if (!catalog.ok) return catalog;
  const requirements = validateList(o.requirements, validateRequirement, (r) => `${r.tierId}|${r.certIdOrCompetencyId}`);
  if (!requirements.ok) return requirements;

  // Intégrité référentielle : chaque certif rattache une compétence connue ; chaque exigence vise un
  // niveau connu et une cible (certif OU compétence) connue. On tolère une cible d'exigence qui est une
  // compétence (couverture agrégée) OU une certif précise.
  const tierIds = new Set(tiers.value.map((t) => t.id));
  const compIds = new Set(competencies.value.map((c) => c.id));
  const certIds = new Set(catalog.value.map((e) => e.id));
  for (const e of catalog.value) {
    if (!compIds.has(e.competencyId)) return { ok: false, error: `certification ${e.id} : compétence inconnue ${e.competencyId}` };
  }
  for (const r of requirements.value) {
    if (!tierIds.has(r.tierId)) return { ok: false, error: `exigence : niveau inconnu ${r.tierId}` };
    if (!compIds.has(r.certIdOrCompetencyId) && !certIds.has(r.certIdOrCompetencyId)) {
      return { ok: false, error: `exigence ${r.tierId} : cible inconnue ${r.certIdOrCompetencyId} (ni compétence ni certification)` };
    }
  }

  const value = {
    id, name,
    tiers: tiers.value, competencies: competencies.value,
    certificationCatalog: catalog.value, requirements: requirements.value,
  };
  const programName = str(o.programName, 160);
  if (programName) value.programName = programName;
  const portalUrl = str(o.portalUrl, 300);
  if (portalUrl) value.portalUrl = portalUrl;
  const accountManagerName = str(o.accountManagerName, 120);
  if (accountManagerName) value.accountManagerName = accountManagerName;
  const accountManagerEmail = str(o.accountManagerEmail, 160);
  if (accountManagerEmail) value.accountManagerEmail = accountManagerEmail;
  return { ok: true, value };
}

// Validité d'une certif à partir de sa date d'obtention et du catalogue (mois). Pur ; réutilisé par la
// conformité (Lot 2). Repli DEFAULT_VALIDITY_MONTHS si le catalogue ne fournit rien.
function computeExpiry(obtainedDateIso, validityMonths) {
  const m = intNonNeg(validityMonths) || DEFAULT_VALIDITY_MONTHS;
  const d = new Date(obtainedDateIso);
  if (Number.isNaN(d.getTime())) return null;
  d.setMonth(d.getMonth() + m);
  return d.toISOString().slice(0, 10);
}

module.exports = {
  LEVELS, DEFAULT_VALIDITY_MONTHS, slug,
  validateTier, validateCompetency, validateCatalogEntry, validateRequirement, validatePartner,
  computeExpiry,
};
