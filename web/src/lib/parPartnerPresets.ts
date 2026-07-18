// Modèles indicatifs de référentiel partenaire (par_) — s'inspirent des grands programmes constructeurs
// (Fortinet Engage, F5 Unity+, Palo Alto NextWave, Huawei ICT). Ils PRÉ-REMPLISSENT le formulaire de
// création (niveaux, compétences, catalogue de certifications, exigences de quota) pour éviter la page
// blanche — et pour que les listes déroulantes des exigences ne soient jamais vides. Ce sont des points de
// départ ÉDITABLES : codes/niveaux/validités des programmes réels évoluent, l'utilisateur ajuste avant
// d'enregistrer. PUR (aucun I/O) → testable ; produit un PartnerFormState prêt pour buildPartnerPayload.
import type { PartnerFormState, TierRow, CompRow, CertRow, ReqRow } from "./parPartnerForm";

export type PresetId = "fortinet" | "f5" | "paloalto" | "huawei";

export const PARTNER_PRESETS: { id: PresetId; label: string }[] = [
  { id: "fortinet", label: "Fortinet — Engage" },
  { id: "f5", label: "F5 — Unity+" },
  { id: "paloalto", label: "Palo Alto — NextWave" },
  { id: "huawei", label: "Huawei — ICT" },
];

// Définition brute d'un modèle : les références croisées (certif→compétence, exigence→niveau/cible) se font
// par INDICE dans les tableaux (aucun libellé à retaper) ; buildPreset les relie ensuite par clé locale.
type CertDef = { code: string; name: string; compIdx: number; level: string; validityMonths: number };
type ReqDef = { tierIdx: number; target: { kind: "comp" | "cert"; idx: number }; minCount: number };
type PresetDef = { name: string; programName: string; tiers: { name: string; rank: number }[]; comps: string[]; certs: CertDef[]; reqs: ReqDef[] };

// Données indicatives des programmes (codes de certification publics ; niveaux et validités à confirmer).
const DEFS: Record<PresetId, PresetDef> = {
  fortinet: {
    name: "Fortinet", programName: "Engage Partner Program",
    tiers: [{ name: "Advocate", rank: 1 }, { name: "Select", rank: 2 }, { name: "Advanced", rank: 3 }, { name: "Expert", rank: 4 }],
    comps: ["Sécurité réseau (FortiGate)", "Secure SD-WAN", "SASE", "OT Security", "Cloud Security"],
    certs: [
      { code: "FCP", name: "FCP — Network Security", compIdx: 0, level: "professional", validityMonths: 24 },
      { code: "FCSS", name: "FCSS — Network Security", compIdx: 0, level: "expert", validityMonths: 24 },
      { code: "FCP-SDWAN", name: "FCP — Secure SD-WAN", compIdx: 1, level: "professional", validityMonths: 24 },
      { code: "FCSS-SASE", name: "FCSS — SASE", compIdx: 2, level: "expert", validityMonths: 24 },
    ],
    reqs: [
      { tierIdx: 2, target: { kind: "cert", idx: 0 }, minCount: 2 },
      { tierIdx: 2, target: { kind: "cert", idx: 1 }, minCount: 1 },
      { tierIdx: 3, target: { kind: "comp", idx: 0 }, minCount: 4 },
    ],
  },
  f5: {
    name: "F5", programName: "Unity+ Partner Program",
    tiers: [{ name: "Registered", rank: 1 }, { name: "Silver", rank: 2 }, { name: "Gold", rank: 3 }, { name: "Platinum", rank: 4 }],
    comps: ["Application Delivery (BIG-IP LTM)", "Advanced WAF (sécurité applicative)", "DNS (BIG-IP DNS)", "Automation (NGINX / BIG-IQ)"],
    certs: [
      { code: "201", name: "F5-CA — Certified Administrator (201)", compIdx: 0, level: "associate", validityMonths: 24 },
      { code: "301", name: "F5-CTS — LTM (301)", compIdx: 0, level: "professional", validityMonths: 24 },
      { code: "303", name: "F5-CTS — Advanced WAF (303)", compIdx: 1, level: "professional", validityMonths: 24 },
      { code: "F5-CSE", name: "F5-CSE — Solution Expert Security", compIdx: 1, level: "expert", validityMonths: 24 },
    ],
    reqs: [
      { tierIdx: 2, target: { kind: "cert", idx: 1 }, minCount: 2 },
      { tierIdx: 2, target: { kind: "cert", idx: 3 }, minCount: 1 },
      { tierIdx: 3, target: { kind: "comp", idx: 1 }, minCount: 3 },
    ],
  },
  paloalto: {
    name: "Palo Alto Networks", programName: "NextWave Partner Program",
    tiers: [{ name: "Innovator", rank: 1 }, { name: "Gold Innovator", rank: 2 }, { name: "Platinum Innovator", rank: 3 }, { name: "Diamond Innovator", rank: 4 }],
    comps: ["NGFW (Network Security)", "Prisma Access (SASE)", "Prisma Cloud", "Cortex (XDR/XSIAM)", "SD-WAN"],
    certs: [
      { code: "PCNSA", name: "PCNSA — Network Security Administrator", compIdx: 0, level: "associate", validityMonths: 24 },
      { code: "PCNSE", name: "PCNSE — Network Security Engineer", compIdx: 0, level: "expert", validityMonths: 24 },
      { code: "PCSFE", name: "PCSFE — Software Firewall Engineer", compIdx: 2, level: "professional", validityMonths: 24 },
      { code: "PCDRA", name: "PCDRA — Detection & Remediation Analyst", compIdx: 3, level: "professional", validityMonths: 24 },
    ],
    reqs: [
      { tierIdx: 2, target: { kind: "cert", idx: 1 }, minCount: 2 },
      { tierIdx: 2, target: { kind: "comp", idx: 2 }, minCount: 1 },
      { tierIdx: 3, target: { kind: "comp", idx: 0 }, minCount: 4 },
    ],
  },
  huawei: {
    name: "Huawei", programName: "Huawei Partner Program (ICT)",
    tiers: [{ name: "Registered", rank: 1 }, { name: "Certified", rank: 2 }, { name: "Gold", rank: 3 }, { name: "Platinum", rank: 4 }],
    comps: ["Datacom (routing & switching)", "Sécurité (HiSec)", "Cloud", "Stockage", "WLAN"],
    certs: [
      { code: "HCIA-Datacom", name: "HCIA — Datacom", compIdx: 0, level: "associate", validityMonths: 36 },
      { code: "HCIP-Datacom", name: "HCIP — Datacom", compIdx: 0, level: "professional", validityMonths: 36 },
      { code: "HCIE-Datacom", name: "HCIE — Datacom", compIdx: 0, level: "expert", validityMonths: 36 },
      { code: "HCIP-Security", name: "HCIP — Security", compIdx: 1, level: "professional", validityMonths: 36 },
    ],
    reqs: [
      { tierIdx: 2, target: { kind: "cert", idx: 1 }, minCount: 2 },
      { tierIdx: 2, target: { kind: "cert", idx: 2 }, minCount: 1 },
      { tierIdx: 3, target: { kind: "comp", idx: 0 }, minCount: 4 },
    ],
  },
};

// Instancie un modèle en état de formulaire. `nextKey` fournit des clés locales UNIQUES (le compteur du
// formulaire) pour ne pas entrer en collision avec les lignes ajoutées ensuite. Les références croisées sont
// résolues via des tableaux de clés indexés — l'intégrité tient (buildPartnerPayload remappe vers les slugs).
export function buildPartnerPreset(id: PresetId, nextKey: () => string): PartnerFormState {
  const d = DEFS[id];
  const tierK = d.tiers.map(() => nextKey());
  const compK = d.comps.map(() => nextKey());
  const certK = d.certs.map(() => nextKey());
  const tiers: TierRow[] = d.tiers.map((t, i) => ({ k: tierK[i], name: t.name, rank: String(t.rank) }));
  const comps: CompRow[] = d.comps.map((c, i) => ({ k: compK[i], name: c }));
  const certs: CertRow[] = d.certs.map((c, i) => ({ k: certK[i], name: c.name, code: c.code, compK: compK[c.compIdx], level: c.level, validityMonths: String(c.validityMonths) }));
  const reqs: ReqRow[] = d.reqs.map((r) => ({ k: nextKey(), tierK: tierK[r.tierIdx], targetK: (r.target.kind === "cert" ? "cert:" + certK[r.target.idx] : "comp:" + compK[r.target.idx]), minCount: String(r.minCount) }));
  return { name: d.name, programName: d.programName, tiers, comps, certs, reqs };
}
