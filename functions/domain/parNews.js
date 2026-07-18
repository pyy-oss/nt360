// Domain PUR — bulletins d'Actualité du module Partenariats (summaries/par_news). Aucun I/O → testable.
// Miroir de la FORME des bulletins de domain/news.js : id stable PAR TYPE (pour la curation), severity
// high|medium|info, domain/module "partenariats". AUCUN montant confidentiel (uniquement certifs/quotas/
// relances) → par_news se lit sous le seul droit `partenariats` (jamais `rentabilite`). ADR-P09 :
// contrairement au module sœur maintenance, Partenariats CONTRIBUE au fil Actualité partagé.

// Construit le fil de bulletins partenariats à partir des états dérivés (quotas de couverture, alertes de
// renouvellement, relances d'assignation) déjà calculés au recompute. Ids fixes = curables par type.
function parNews({ quotas, renouvellements, relances } = {}) {
  const B = [];
  const qp = (quotas && quotas.partners) || (Array.isArray(quotas) ? quotas : []);
  const nonConf = qp.filter((p) => p && p.status === "non_compliant");
  const atRisk = qp.filter((p) => p && p.status === "at_risk");
  const rc = (renouvellements && renouvellements.counts) || {};
  const total = Number((renouvellements && renouvellements.total) || 0);
  const expired = Number(rc.expired || 0);
  const late = Number(((relances && relances.counts) || {}).late || 0);
  const names = (arr) => arr.slice(0, 4).map((p) => p.name || p.partnerId).join(", ") + (arr.length > 4 ? "…" : "");

  if (nonConf.length) B.push({ id: "par_partenaires_non_conformes", domain: "partenariats", module: "partenariats", severity: "high",
    title: `${nonConf.length} partenariat(s) non conforme(s)`, detail: `Quotas de certification non atteints : ${names(nonConf)}. Risque sur le niveau de partenariat constructeur.` });
  if (atRisk.length) B.push({ id: "par_partenaires_a_risque", domain: "partenariats", module: "partenariats", severity: "medium",
    title: `${atRisk.length} partenariat(s) à risque`, detail: `Couverture de quota juste au seuil : ${names(atRisk)}. À sécuriser avant audit constructeur.` });
  if (expired) B.push({ id: "par_certifs_expirees", domain: "partenariats", module: "partenariats", severity: "high",
    title: `${expired} certification(s) expirée(s)`, detail: "Des certifications d'ingénieurs sont expirées — elles ne comptent plus dans les quotas partenaires." });
  if (total) B.push({ id: "par_certifs_a_renouveler", domain: "partenariats", module: "partenariats", severity: "medium",
    title: `${total} certification(s) à renouveler (≤ 90 j)`, detail: "Anticipez les renouvellements pour maintenir la couverture des quotas constructeurs." });
  if (late) B.push({ id: "par_assignations_retard", domain: "partenariats", module: "partenariats", severity: "medium",
    title: `${late} assignation(s) de certification en retard`, detail: "Des parcours de certification ont dépassé leur échéance cible — relancez les managers concernés." });

  return { bulletins: B, recommendations: [], counts: { total: B.length, high: B.filter((b) => b.severity === "high").length } };
}

module.exports = { parNews };
