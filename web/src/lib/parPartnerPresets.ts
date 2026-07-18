// Modèles de référentiel partenaire (par_) amorcés avec les DONNÉES RÉELLES NT (fichiers de référence
// direction : Partners_Status_Tracking + CERTIFICATIONS_TOP_PARTENAIRES, juillet 2026). Chaque modèle
// pré-remplit le formulaire « Nouveau partenaire » : statut courant, plan d'affaires (objectif BP vs
// réalisé YTD par axe), échéance de renouvellement, statut de validation, catalogue de certifications réel
// et exemples d'exigences. Ce sont des POINTS DE DÉPART ÉDITABLES : la direction clique un partenaire clé,
// ajuste, enregistre — le module remplace le fichier Excel. Validités (mois) indicatives (le fichier ne les
// porte pas) ; le backend validatePartner reste seul juge. PUR → testable.
import type { PartnerFormState, TierRow, CompRow, CertRow, ReqRow, BpForm } from "./parPartnerForm";
import { BP_AXES } from "./parPartnerForm";

export type PresetId = "huawei" | "fortinet" | "paloalto" | "cisco" | "f5" | "hpe-aruba" | "kaspersky" | "dell" | "microsoft" | "checkpoint";

export const PARTNER_PRESETS: { id: PresetId; label: string }[] = [
  { id: "fortinet", label: "Fortinet" },
  { id: "paloalto", label: "Palo Alto" },
  { id: "cisco", label: "Cisco" },
  { id: "huawei", label: "Huawei" },
  { id: "f5", label: "F5" },
  { id: "hpe-aruba", label: "HPE Aruba" },
  { id: "checkpoint", label: "Check Point" },
  { id: "kaspersky", label: "Kaspersky" },
  { id: "dell", label: "Dell" },
  { id: "microsoft", label: "Microsoft" },
];

// Plan d'affaires réel (Partners_Status_Tracking) : [objectif BP, réalisé YTD] par axe.
type Bp = { pipeline: [number, number]; booking: [number, number]; cert: [number, number]; growth: [number, number] };
type CertDef = { code: string; name: string; compIdx: number; level: string; validityMonths: number };
type ReqDef = { tierIdx: number; target: { kind: "comp" | "cert"; idx: number }; minCount: number };
type PresetDef = {
  name: string; programName: string; status: string; renewalDate: string; validationStatus: string; bp: Bp;
  tiers: { name: string; rank: number }[]; comps: string[]; certs: CertDef[]; reqs: ReqDef[];
};

const DEFS: Record<PresetId, PresetDef> = {
  fortinet: {
    name: "Fortinet", programName: "Engage Partner Program", status: "Expert", renewalDate: "2025-12-31", validationStatus: "presque_valide",
    bp: { pipeline: [4350000, 4000000], booking: [550000, 680000], cert: [2, 2], growth: [25, 20] },
    tiers: [{ name: "Advocate", rank: 1 }, { name: "Select", rank: 2 }, { name: "Advanced", rank: 3 }, { name: "Expert", rank: 4 }],
    comps: ["Network Security", "SASE", "OT Security", "Security Operations"],
    certs: [
      { code: "NSE", name: "NSE Certification", compIdx: 0, level: "professional", validityMonths: 24 },
      { code: "NSE7-SASE", name: "NSE 7 — FortiSASE Enterprise Administrator", compIdx: 1, level: "expert", validityMonths: 24 },
      { code: "NSE6-OT", name: "NSE 6 — OT Security Architect", compIdx: 2, level: "professional", validityMonths: 24 },
      { code: "NSE7-SECOPS", name: "NSE 7 — Security Operations Architect", compIdx: 3, level: "expert", validityMonths: 24 },
    ],
    reqs: [{ tierIdx: 3, target: { kind: "comp", idx: 0 }, minCount: 2 }, { tierIdx: 3, target: { kind: "cert", idx: 1 }, minCount: 1 }],
  },
  paloalto: {
    name: "Palo Alto Networks", programName: "NextWave Partner Program", status: "Innovator", renewalDate: "2026-07-31", validationStatus: "valide",
    bp: { pipeline: [3150000, 4000000], booking: [20000, 92288], cert: [2, 0], growth: [25, 20] },
    tiers: [{ name: "Innovator", rank: 1 }, { name: "Gold Innovator", rank: 2 }, { name: "Platinum Innovator", rank: 3 }, { name: "Diamond Innovator", rank: 4 }],
    comps: ["Network Security", "Prisma SASE", "Cortex"],
    certs: [
      { code: "HW-FW", name: "Hardware Firewall Product Specialization", compIdx: 0, level: "professional", validityMonths: 24 },
      { code: "SW-FW", name: "Software Firewall Product Specialization", compIdx: 0, level: "professional", validityMonths: 24 },
      { code: "PRISMA-SASE", name: "Prisma SASE Product Specialization", compIdx: 1, level: "professional", validityMonths: 24 },
      { code: "CORTEX-XSIAM", name: "Cortex XSIAM Product Specialization", compIdx: 2, level: "expert", validityMonths: 24 },
      { code: "PCNSE", name: "PCNSE — Network Security Engineer", compIdx: 0, level: "expert", validityMonths: 24 },
    ],
    reqs: [{ tierIdx: 2, target: { kind: "cert", idx: 4 }, minCount: 2 }, { tierIdx: 2, target: { kind: "comp", idx: 2 }, minCount: 1 }],
  },
  cisco: {
    name: "Cisco", programName: "Cisco Partner Program", status: "Premier Integrator", renewalDate: "2025-12-31", validationStatus: "non_valide",
    bp: { pipeline: [3750000, 4000000], booking: [3000000, 3000000], cert: [6, 0], growth: [25, 20] },
    tiers: [{ name: "Select", rank: 1 }, { name: "Premier", rank: 2 }, { name: "Gold", rank: 3 }],
    comps: ["Enterprise Networking", "Security", "Collaboration", "SMB & Mid-Market"],
    certs: [
      { code: "CCNA", name: "CCNA", compIdx: 0, level: "associate", validityMonths: 36 },
      { code: "CCNP-ENT", name: "CCNP Enterprise", compIdx: 0, level: "professional", validityMonths: 36 },
      { code: "CCNP-SEC", name: "CCNP Sécurité", compIdx: 1, level: "professional", validityMonths: 36 },
      { code: "CCNP-COL", name: "CCNP Collaboration", compIdx: 2, level: "professional", validityMonths: 36 },
      { code: "BB-SMB", name: "Black Belt SMB & Mid-Market", compIdx: 3, level: "associate", validityMonths: 24 },
    ],
    reqs: [{ tierIdx: 1, target: { kind: "cert", idx: 0 }, minCount: 3 }, { tierIdx: 2, target: { kind: "cert", idx: 1 }, minCount: 2 }],
  },
  huawei: {
    name: "Huawei", programName: "Huawei Partner Program (ICT)", status: "Silver", renewalDate: "2026-01-02", validationStatus: "presque_valide",
    bp: { pipeline: [3450000, 2000000], booking: [250000, 502140], cert: [4, 1], growth: [25, 20] },
    tiers: [{ name: "Registered", rank: 1 }, { name: "Silver", rank: 2 }, { name: "Gold", rank: 3 }, { name: "Platinum", rank: 4 }],
    comps: ["Datacom", "Storage"],
    certs: [
      { code: "HCSA-DATACOM", name: "HCSA-Sales Datacom", compIdx: 0, level: "associate", validityMonths: 36 },
      { code: "HCSP-DATACOM", name: "HCSP-Datacom", compIdx: 0, level: "professional", validityMonths: 36 },
      { code: "HCIE-DATACOM", name: "HCIE-Datacom", compIdx: 0, level: "expert", validityMonths: 36 },
      { code: "HCSA-STORAGE", name: "HCSA-Sales Storage", compIdx: 1, level: "associate", validityMonths: 36 },
      { code: "HCIP-STORAGE", name: "HCIP-Storage", compIdx: 1, level: "professional", validityMonths: 36 },
    ],
    reqs: [{ tierIdx: 2, target: { kind: "cert", idx: 1 }, minCount: 2 }, { tierIdx: 3, target: { kind: "cert", idx: 2 }, minCount: 1 }],
  },
  f5: {
    name: "F5", programName: "Unity+ Partner Program", status: "Silver", renewalDate: "2025-09-30", validationStatus: "valide",
    bp: { pipeline: [2100000, 5000000], booking: [175000, 344000], cert: [3, 1], growth: [25, 20] },
    tiers: [{ name: "Registered", rank: 1 }, { name: "Silver", rank: 2 }, { name: "Gold", rank: 3 }, { name: "Platinum", rank: 4 }],
    comps: ["Application Delivery"],
    certs: [
      { code: "201", name: "201 — BIG-IP Administrator", compIdx: 0, level: "associate", validityMonths: 24 },
      { code: "202", name: "202 — BIG-IP LTM", compIdx: 0, level: "professional", validityMonths: 24 },
      { code: "F5-ACC", name: "F5 Accreditation", compIdx: 0, level: "associate", validityMonths: 24 },
    ],
    reqs: [{ tierIdx: 1, target: { kind: "cert", idx: 0 }, minCount: 1 }, { tierIdx: 2, target: { kind: "cert", idx: 1 }, minCount: 1 }],
  },
  "hpe-aruba": {
    name: "HPE Aruba", programName: "HPE Partner Ready", status: "Silver", renewalDate: "2025-10-31", validationStatus: "valide",
    bp: { pipeline: [1950000, 2000000], booking: [60000, 789656], cert: [2, 0], growth: [25, 20] },
    tiers: [{ name: "Silver", rank: 1 }, { name: "Gold", rank: 2 }, { name: "Platinum", rank: 3 }],
    comps: ["Switching", "Mobility (WLAN)", "Sales"],
    certs: [
      { code: "ACSA", name: "Aruba Certified Switching Associate (ACSA)", compIdx: 0, level: "associate", validityMonths: 36 },
      { code: "ACSP", name: "Aruba Certified Switching Professional (ACSP)", compIdx: 0, level: "professional", validityMonths: 36 },
      { code: "GMP", name: "Gold Mobility Professional", compIdx: 1, level: "professional", validityMonths: 24 },
      { code: "APAS", name: "HPE Sales Certified — Aruba Networking Solutions", compIdx: 2, level: "associate", validityMonths: 24 },
    ],
    reqs: [{ tierIdx: 1, target: { kind: "cert", idx: 1 }, minCount: 1 }, { tierIdx: 2, target: { kind: "comp", idx: 1 }, minCount: 1 }],
  },
  checkpoint: {
    name: "Check Point", programName: "Check Point Partner Program", status: "Advanced", renewalDate: "2025-12-31", validationStatus: "non_valide",
    bp: { pipeline: [3000000, 3000000], booking: [200000, 167800], cert: [5, 0], growth: [25, 20] },
    tiers: [{ name: "Authorized", rank: 1 }, { name: "Advanced", rank: 2 }, { name: "Elite", rank: 3 }],
    comps: ["Security", "Harmony"],
    certs: [
      { code: "CPSC", name: "CPSC — Check Point Sales", compIdx: 0, level: "associate", validityMonths: 24 },
      { code: "CP-TECH", name: "Check Point Technical", compIdx: 0, level: "professional", validityMonths: 24 },
      { code: "HARMONY-EP", name: "Harmony Endpoint", compIdx: 1, level: "professional", validityMonths: 24 },
      { code: "HARMONY-MOB", name: "Harmony Mobile", compIdx: 1, level: "professional", validityMonths: 24 },
    ],
    reqs: [{ tierIdx: 1, target: { kind: "cert", idx: 1 }, minCount: 2 }, { tierIdx: 2, target: { kind: "comp", idx: 1 }, minCount: 1 }],
  },
  kaspersky: {
    name: "Kaspersky", programName: "Kaspersky United Partner Program", status: "Platinum", renewalDate: "2026-01-31", validationStatus: "valide",
    bp: { pipeline: [300000, 3000000], booking: [220000, 215000], cert: [6, 8], growth: [25, 20] },
    tiers: [{ name: "Registered", rank: 1 }, { name: "Silver", rank: 2 }, { name: "Gold", rank: 3 }, { name: "Platinum", rank: 4 }],
    comps: ["Technique", "Sales"],
    certs: [
      { code: "KESC", name: "Kaspersky Endpoint Security Cloud", compIdx: 0, level: "professional", validityMonths: 24 },
      { code: "SALES-FND", name: "Sales — Security Foundations", compIdx: 1, level: "associate", validityMonths: 24 },
      { code: "SALES-OPT", name: "Sales — Optimum", compIdx: 1, level: "associate", validityMonths: 24 },
    ],
    reqs: [{ tierIdx: 3, target: { kind: "comp", idx: 0 }, minCount: 1 }, { tierIdx: 2, target: { kind: "cert", idx: 1 }, minCount: 2 }],
  },
  dell: {
    name: "Dell", programName: "Dell Technologies Partner Program", status: "Platinum", renewalDate: "2026-01-30", validationStatus: "valide",
    bp: { pipeline: [150000, 1000000], booking: [860000, 2647125], cert: [3, 2], growth: [25, 20] },
    tiers: [{ name: "Authorized", rank: 1 }, { name: "Gold", rank: 2 }, { name: "Platinum", rank: 3 }, { name: "Titanium", rank: 4 }],
    comps: ["Server", "Storage", "Core Client", "Data Protection"],
    certs: [
      { code: "SE-SERVER", name: "SE — Server Credential", compIdx: 0, level: "professional", validityMonths: 12 },
      { code: "SE-CLIENT", name: "SE — Core Client Credential", compIdx: 2, level: "professional", validityMonths: 12 },
      { code: "SE-MIDSTOR", name: "SE — MidRange Storage Credential", compIdx: 1, level: "professional", validityMonths: 12 },
      { code: "SALES-STOR", name: "Sales — Storage Credential", compIdx: 1, level: "associate", validityMonths: 12 },
      { code: "SALES-DP", name: "Sales — Data Protection Credential", compIdx: 3, level: "associate", validityMonths: 12 },
    ],
    reqs: [{ tierIdx: 2, target: { kind: "cert", idx: 2 }, minCount: 1 }, { tierIdx: 2, target: { kind: "comp", idx: 1 }, minCount: 2 }],
  },
  microsoft: {
    name: "Microsoft", programName: "Microsoft AI Cloud Partner Program", status: "Modern Work — SMB", renewalDate: "2025-12-31", validationStatus: "valide",
    bp: { pipeline: [750000, 5000000], booking: [1000000, 713815], cert: [3, 4], growth: [25, 20] },
    tiers: [{ name: "Member", rank: 1 }, { name: "Solutions Partner", rank: 2 }, { name: "Specialization", rank: 3 }],
    comps: ["Modern Work"],
    certs: [
      { code: "MS-INT", name: "Microsoft Intermediate Certification", compIdx: 0, level: "professional", validityMonths: 12 },
      { code: "MS-ADV", name: "Microsoft Advanced Certification", compIdx: 0, level: "expert", validityMonths: 12 },
    ],
    reqs: [{ tierIdx: 1, target: { kind: "cert", idx: 0 }, minCount: 2 }, { tierIdx: 2, target: { kind: "cert", idx: 1 }, minCount: 2 }],
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
  // Plan d'affaires : objectif BP + réalisé YTD par axe (miroir du fichier direction).
  const bp = {} as BpForm;
  for (const ax of BP_AXES) { bp[`${ax}Bp`] = String(d.bp[ax][0]); bp[`${ax}Ytd`] = String(d.bp[ax][1]); }
  return { name: d.name, programName: d.programName, status: d.status, renewalDate: d.renewalDate, validationStatus: d.validationStatus, bp, tiers, comps, certs, reqs };
}
