// Domain PUR — Couverture des quotas de certification par partenaire (par_). Aucun I/O → testable.
// Croise les EXIGENCES d'un partenaire (par_partners.requirements : tierId, cible certif/compétence,
// minCount) avec les CERTIFICATIONS ACTIVES des ingénieurs (par_certifications). Une exigence est
// couverte si le nombre d'ingénieurs DISTINCTS détenant la cible (certif précise OU compétence) au statut
// « active » atteint le minimum. Source unique du « statut de conformité » du partenariat (ADR-P04).

// Statut de conformité quota d'un partenaire (code applicatif ; libellés FR à l'affichage).
const PARTNERSHIP_STATUSES = ["on_track", "at_risk", "non_compliant", "non_evalue"];

// Un détenteur compte pour une exigence si sa certif ACTIVE vise la même certif précise
// (certificationCatalogId) OU la même compétence (competencyId) que la cible de l'exigence.
function matchesTarget(cert, targetId) {
  return cert.certificationCatalogId === targetId || cert.competencyId === targetId;
}

/**
 * Couverture des exigences d'UN partenaire. certs = certifications de ce partenaire (toutes ; on filtre
 * le statut ici). Renvoie une ligne par exigence : { tierId, target, minCount, holders (distincts), ok }.
 * requiredRole est conservé pour l'affichage mais N'EST PAS filtrant (les rôles ESN — grade — ne mappent
 * pas 1-1 sur les rôles constructeur type « SE » ; à raffiner si l'ERP introduit ce mapping).
 */
function coverageForPartner(partner, certs) {
  const active = (certs || []).filter((c) => c && c.status === "active");
  return ((partner && partner.requirements) || []).map((r) => {
    const holders = new Set(active.filter((c) => matchesTarget(c, r.certIdOrCompetencyId)).map((c) => c.consultantId));
    const count = holders.size;
    return { tierId: r.tierId, target: r.certIdOrCompetencyId, minCount: r.minCount, holders: count, ok: count >= r.minCount, requiredRole: r.requiredRole || null };
  });
}

// Statut de conformité quota à partir de la couverture : toutes couvertes ⇒ on_track ; aucune ⇒
// non_compliant ; partiel ⇒ at_risk ; pas d'exigence ⇒ non_evalue.
function partnershipQuotaStatus(coverage) {
  if (!coverage || !coverage.length) return "non_evalue";
  const ok = coverage.filter((c) => c.ok).length;
  if (ok === coverage.length) return "on_track";
  if (ok === 0) return "non_compliant";
  return "at_risk";
}

/**
 * Agrège la couverture de TOUS les partenaires. certsByPartner = { [partnerId]: cert[] }.
 * @returns [{ partnerId, name, status, coverage: [...], gaps: [{tierId,target,minCount,holders}] }]
 */
function coverageAll(partners, certsByPartner) {
  return (partners || []).map((p) => {
    const coverage = coverageForPartner(p, (certsByPartner && certsByPartner[p.id]) || []);
    const gaps = coverage.filter((c) => !c.ok).map((c) => ({ tierId: c.tierId, target: c.target, minCount: c.minCount, holders: c.holders }));
    return { partnerId: p.id, name: p.name || p.id, status: partnershipQuotaStatus(coverage), coverage, gaps };
  });
}

/**
 * Point d'historisation quotidienne de la couverture des quotas (tendance, Lot P3). PUR.
 * quotas = sortie de coverageAll ; renouvellements = { counts:{expired}, total }.
 * @returns { conformes, aRisque, nonConformes, nonEvalue, total, aRenouveler, expirees }
 */
function parQuotaHistoryPoint({ quotas, renouvellements } = {}) {
  const qp = Array.isArray(quotas) ? quotas : (quotas && quotas.partners) || [];
  const by = (s) => qp.filter((p) => p && p.status === s).length;
  const rc = (renouvellements && renouvellements.counts) || {};
  return {
    conformes: by("on_track"), aRisque: by("at_risk"), nonConformes: by("non_compliant"), nonEvalue: by("non_evalue"),
    total: qp.length, aRenouveler: Number((renouvellements && renouvellements.total) || 0), expirees: Number(rc.expired || 0),
  };
}

module.exports = { PARTNERSHIP_STATUSES, coverageForPartner, partnershipQuotaStatus, coverageAll, matchesTarget, parQuotaHistoryPoint };
