// Vue « par ingénieur » (par_) — PUR. Regroupe les certifications (détenues) et assignations (à obtenir) par
// consultant, pour lire le parcours de certification d'une personne d'un coup d'œil. Ne calcule rien d'autre
// (mêmes lignes que les onglets Certifications/Assignations, juste pivotées par consultant). PUR → testable.

export type EngCert = { id: string; consultantId: string; consultantName?: string; consultantBu?: string; partnerId: string; certName?: string; certificationCatalogId?: string; status: string; obtainedDate?: string; expiryDate?: string };
export type EngAssign = { id: string; consultantId: string; consultantName?: string; partnerId: string; cert?: string; certificationCatalogId?: string; targetDate?: string; status: string };
export type EngineerRow = {
  consultantId: string; consultantName: string; consultantBu: string;
  certs: EngCert[]; assigns: EngAssign[];
  certCount: number; assignCount: number;
  activeCerts: number; // certifs encore valides (statut ≠ « expired »)
};

// Regroupe certifs + assignations par consultantId. Le libellé (nom/BU) prend la première valeur NON VIDE
// rencontrée (les deux sources dénormalisent le nom ; la BU n'est portée que par les certifs). Trié par
// volume décroissant (plus actifs en tête) puis par nom.
export function byEngineer(certs: EngCert[] | null | undefined, assigns: EngAssign[] | null | undefined): EngineerRow[] {
  const map = new Map<string, EngineerRow>();
  const ensure = (id: string, name?: string, bu?: string): EngineerRow => {
    let e = map.get(id);
    if (!e) { e = { consultantId: id, consultantName: name || id, consultantBu: bu || "", certs: [], assigns: [], certCount: 0, assignCount: 0, activeCerts: 0 }; map.set(id, e); }
    if (name && (!e.consultantName || e.consultantName === id)) e.consultantName = name;
    if (bu && !e.consultantBu) e.consultantBu = bu;
    return e;
  };
  for (const c of certs || []) {
    if (!c || !c.consultantId) continue;
    const e = ensure(c.consultantId, c.consultantName, c.consultantBu);
    e.certs.push(c); e.certCount += 1;
    if (c.status !== "expired") e.activeCerts += 1;
  }
  for (const a of assigns || []) {
    if (!a || !a.consultantId) continue;
    const e = ensure(a.consultantId, a.consultantName);
    e.assigns.push(a); e.assignCount += 1;
  }
  return Array.from(map.values()).sort((x, y) =>
    (y.certCount + y.assignCount) - (x.certCount + x.assignCount) || x.consultantName.localeCompare(y.consultantName));
}
