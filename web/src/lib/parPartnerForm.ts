// Assistance PURE au formulaire de référentiel partenaire (par_) — construit le payload `upsertParPartner`
// à partir de l'état du formulaire, et l'inverse pour l'édition. La difficulté : les exigences (objectifs)
// et le catalogue référencent des niveaux/compétences PAR IDENTIFIANT (slug), or l'utilisateur saisit des
// LIBELLÉS. On relie donc chaque ligne par une CLÉ LOCALE stable (`k`) et on remappe vers le slug au moment
// de bâtir le payload — l'intégrité référentielle tient quel que soit l'ordre d'édition. Le backend
// (domain/parPartner.validatePartner) revalide et tranche ; ce module ne fait que préparer une entrée propre.
// PUR (aucun I/O, aucune horloge) → testable.

export type TierRow = { k: string; id?: string; name: string; rank: string };
export type CompRow = { k: string; id?: string; name: string };
export type CertRow = { k: string; id?: string; name: string; code: string; compK: string; level: string; validityMonths: string };
export type ReqRow = { k: string; tierK: string; targetK: string; minCount: string }; // targetK = "comp:<k>" | "cert:<k>"
export type PartnerFormState = {
  id?: string; name: string; programName: string;
  tiers: TierRow[]; comps: CompRow[]; certs: CertRow[]; reqs: ReqRow[];
};

// Slug stable — MÊME règle que le backend (domain/parPartner.slug) : minuscules, chiffres, tirets.
export function parSlug(v: string): string {
  return String(v == null ? "" : v).trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

export const PAR_LEVELS: { value: string; label: string }[] = [
  { value: "associate", label: "Associate" },
  { value: "professional", label: "Professional" },
  { value: "expert", label: "Expert" },
];

export type BuildResult = { ok: true; value: Record<string, unknown> } | { ok: false; error: string };

// Bâtit le payload upsertParPartner. Un id de ligne existant (édition) est conservé pour la stabilité ;
// une ligne nouvelle prend le slug de son libellé (code prioritaire pour une certif). Les lignes à libellé
// vide sont ignorées ; les références (exigences/catalogue) sont remappées via la clé locale.
export function buildPartnerPayload(f: PartnerFormState): BuildResult {
  const name = f.name.trim();
  if (!name) return { ok: false, error: "Nom du constructeur requis." };
  const id = f.id || parSlug(name);
  if (!id) return { ok: false, error: "Nom invalide : aucun identifiant ne peut en être dérivé." };

  const tierId = new Map<string, string>();
  const tiers = f.tiers.filter((t) => t.name.trim()).map((t) => {
    const tid = t.id || parSlug(t.name); tierId.set(t.k, tid);
    return { id: tid, name: t.name.trim(), rank: Number(t.rank) || 0 };
  });
  const compId = new Map<string, string>();
  const competencies = f.comps.filter((c) => c.name.trim()).map((c) => {
    const cid = c.id || parSlug(c.name); compId.set(c.k, cid);
    return { id: cid, name: c.name.trim() };
  });
  const certId = new Map<string, string>();
  const certificationCatalog = f.certs.filter((c) => c.name.trim()).map((c) => {
    const cid = c.id || parSlug(c.code || c.name); certId.set(c.k, cid);
    return {
      id: cid, competencyId: compId.get(c.compK) || "", code: c.code.trim(), name: c.name.trim(),
      level: c.level, validityMonths: c.validityMonths.trim() === "" ? "" : Number(c.validityMonths),
    };
  });
  const requirements = f.reqs.filter((r) => r.tierK && r.targetK).map((r) => {
    const sep = r.targetK.indexOf(":");
    const kind = r.targetK.slice(0, sep), tk = r.targetK.slice(sep + 1);
    const target = kind === "cert" ? certId.get(tk) : compId.get(tk);
    return { tierId: tierId.get(r.tierK) || "", certIdOrCompetencyId: target || "", minCount: Number(r.minCount) || 0 };
  });

  const value: Record<string, unknown> = { id, name, tiers, competencies, certificationCatalog, requirements };
  if (f.programName.trim()) value.programName = f.programName.trim();
  return { ok: true, value };
}

// Reconstruit l'état du formulaire depuis un partenaire stocké (édition). La clé locale = l'id stocké, si
// bien que les références (exigences → niveau/cible) se relient directement par leur slug d'origine.
type StoredPartner = {
  id: string; name: string; programName?: string;
  tiers?: { id: string; name: string; rank: number }[];
  competencies?: { id: string; name: string }[];
  certificationCatalog?: { id: string; competencyId: string; code?: string; name: string; level: string; validityMonths: number }[];
  requirements?: { tierId: string; certIdOrCompetencyId: string; minCount: number }[];
};
export function partnerToForm(p: StoredPartner): PartnerFormState {
  const certIds = new Set((p.certificationCatalog || []).map((e) => e.id));
  return {
    id: p.id, name: p.name || "", programName: p.programName || "",
    tiers: (p.tiers || []).map((t) => ({ k: t.id, id: t.id, name: t.name, rank: String(t.rank ?? 0) })),
    comps: (p.competencies || []).map((c) => ({ k: c.id, id: c.id, name: c.name })),
    certs: (p.certificationCatalog || []).map((e) => ({ k: e.id, id: e.id, name: e.name, code: e.code || "", compK: e.competencyId, level: e.level, validityMonths: String(e.validityMonths ?? "") })),
    reqs: (p.requirements || []).map((r, i) => ({ k: `r${i}`, tierK: r.tierId, targetK: (certIds.has(r.certIdOrCompetencyId) ? "cert:" : "comp:") + r.certIdOrCompetencyId, minCount: String(r.minCount ?? "") })),
  };
}
