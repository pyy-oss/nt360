// Plan de formation PUR — transforme le CONSTAT (écarts de quota) en ACTION (assignations à créer). Pour
// chaque partenaire NON conforme, chaque exigence non couverte devient une proposition : combien d'ingénieurs
// manquent (minCount − holders) et QUELS candidats les combler — des ingénieurs DÉJÀ engagés chez ce
// partenaire (détiennent ≥1 certif OU ont ≥1 assignation) mais ne couvrant pas encore la cible. On résout
// aussi la certif de catalogue à viser (une exigence peut cibler une COMPÉTENCE : on prend la 1re certif de
// cette compétence). Aucun I/O, aucune horloge → testable ; l'appelant fournit la date cible à la création.

export type CovRow = { tierId?: string; target: string; minCount: number; holders: number; ok: boolean };
export type QuotaP = { partnerId: string; name: string; status: string; coverage?: CovRow[] };
export type CatEntry = { id: string; name?: string; competencyId?: string };
export type PartnerLite = { id: string; certificationCatalog?: CatEntry[] };
export type CertLite = { consultantId: string; consultantName?: string; partnerId: string; certificationCatalogId?: string; competencyId?: string; status?: string };
export type AssignLite = { consultantId: string; consultantName?: string; partnerId: string; certificationCatalogId?: string; competencyId?: string };

export type TrainCandidate = { consultantId: string; name: string };
export type TrainGap = {
  target: string; targetLabel: string; minCount: number; holders: number; need: number;
  assignCertId: string | null; assignCertName: string; // certif de catalogue à assigner (null si non résoluble)
  candidates: TrainCandidate[];
};
export type TrainPartner = { partnerId: string; name: string; status: string; gaps: TrainGap[] };

const matches = (c: { certificationCatalogId?: string; competencyId?: string }, target: string) =>
  c.certificationCatalogId === target || c.competencyId === target;

export function trainingPlan(
  quotas: QuotaP[] | undefined,
  partners: PartnerLite[] | undefined,
  certs: CertLite[] | undefined,
  assigns: AssignLite[] | undefined,
): TrainPartner[] {
  const catByPartner = new Map<string, CatEntry[]>();
  for (const p of partners || []) catByPartner.set(p.id, p.certificationCatalog || []);
  const certsByP = new Map<string, CertLite[]>();
  for (const c of certs || []) { const a = certsByP.get(c.partnerId) || []; a.push(c); certsByP.set(c.partnerId, a); }
  const assignsByP = new Map<string, AssignLite[]>();
  for (const a of assigns || []) { const l = assignsByP.get(a.partnerId) || []; l.push(a); assignsByP.set(a.partnerId, l); }

  const out: TrainPartner[] = [];
  for (const p of quotas || []) {
    if (p.status !== "at_risk" && p.status !== "non_compliant") continue;
    const cat = catByPartner.get(p.partnerId) || [];
    const pc = certsByP.get(p.partnerId) || [];
    const pa = assignsByP.get(p.partnerId) || [];
    const nameById = new Map<string, string>();
    for (const c of pc) if (c.consultantId && c.consultantName) nameById.set(c.consultantId, c.consultantName);
    for (const a of pa) if (a.consultantId && a.consultantName) nameById.set(a.consultantId, a.consultantName);
    // Bassin de candidats : ingénieurs déjà engagés chez ce partenaire.
    const engaged = new Set<string>();
    for (const c of pc) if (c.consultantId) engaged.add(c.consultantId);
    for (const a of pa) if (a.consultantId) engaged.add(a.consultantId);

    const gaps: TrainGap[] = [];
    for (const cov of p.coverage || []) {
      if (cov.ok) continue;
      const need = Math.max(0, (cov.minCount || 0) - (cov.holders || 0));
      if (!need) continue;
      // Certif de catalogue à viser : la cible elle-même si c'est une certif, sinon la 1re certif de la compétence.
      const direct = cat.find((e) => e.id === cov.target);
      const byComp = direct ? null : cat.find((e) => e.competencyId === cov.target);
      const assignCert = direct || byComp || null;
      const targetLabel = direct?.name || (byComp ? `${cov.target} (compétence)` : cov.target);
      // Ingénieurs couvrant déjà (certif active OU déjà assignés) → exclus des candidats.
      const covering = new Set<string>();
      for (const c of pc) if (c.status === "active" && matches(c, cov.target)) covering.add(c.consultantId);
      for (const a of pa) if (matches(a, cov.target) || (assignCert && a.certificationCatalogId === assignCert.id)) covering.add(a.consultantId);
      const candidates = [...engaged].filter((id) => !covering.has(id)).map((id) => ({ consultantId: id, name: nameById.get(id) || id }));
      gaps.push({
        target: cov.target, targetLabel, minCount: cov.minCount, holders: cov.holders, need,
        assignCertId: assignCert ? assignCert.id : null, assignCertName: assignCert?.name || "",
        candidates,
      });
    }
    if (gaps.length) out.push({ partnerId: p.partnerId, name: p.name, status: p.status, gaps });
  }
  return out;
}
