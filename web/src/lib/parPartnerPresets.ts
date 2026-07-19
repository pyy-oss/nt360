// Modèles de référentiel partenaire (par_) amorcés avec les DONNÉES RÉELLES NT (fichiers de référence
// direction : Partners_Status_Tracking + CERTIFICATIONS_TOP_PARTENAIRES, juillet 2026) — TOP 20 partenaires.
// Chaque modèle pré-remplit le formulaire « Nouveau partenaire » : statut courant, plan d'affaires (objectif
// BP vs réalisé YTD par axe), échéance de renouvellement, statut de validation, catalogue de certifications
// et EXIGENCES de quota (niveau → cible → minimum d'ingénieurs) inspirées des programmes constructeurs réels.
// Ce sont des POINTS DE DÉPART ÉDITABLES : la direction clique un partenaire, ajuste, enregistre — le module
// remplace le fichier Excel. Validités (mois) et exigences INDICATIVES (le fichier ne les porte pas ; les
// programmes évoluent) ; le backend validatePartner reste seul juge. PUR → testable.
import type { PartnerFormState, TierRow, CompRow, CertRow, ReqRow, BpForm } from "./parPartnerForm";
import { BP_AXES } from "./parPartnerForm";

export type PresetId =
  | "fortinet" | "paloalto" | "cisco" | "huawei" | "f5" | "hpe-aruba" | "checkpoint" | "kaspersky" | "dell" | "microsoft"
  | "sophos" | "nutanix" | "wallix" | "jabra" | "veritas" | "apc-schneider" | "tufin" | "rapid7" | "allot" | "juniper";

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
  { id: "sophos", label: "Sophos" },
  { id: "nutanix", label: "Nutanix" },
  { id: "wallix", label: "Wallix" },
  { id: "jabra", label: "Jabra" },
  { id: "veritas", label: "Veritas" },
  { id: "apc-schneider", label: "APC — Schneider" },
  { id: "tufin", label: "Tufin" },
  { id: "rapid7", label: "Rapid7" },
  { id: "allot", label: "Allot" },
  { id: "juniper", label: "Juniper" },
];

// Plan d'affaires réel (Partners_Status_Tracking) : [objectif BP, réalisé YTD] par axe.
type Bp = { pipeline: [number, number]; booking: [number, number]; cert: [number, number]; growth: [number, number] };
type CertDef = { code: string; name: string; compIdx: number; level: string; validityMonths: number };
type ReqDef = { tierIdx: number; target: { kind: "comp" | "cert"; idx: number }; minCount: number };
type PresetDef = {
  name: string; programName: string; // fiche de suivi (statut/échéance/validation/plan d'affaires) → SCORECARD
  tiers: { name: string; rank: number }[]; comps: string[]; certs: CertDef[]; reqs: ReqDef[];
};

const DEFS: Record<PresetId, PresetDef> = {
  fortinet: {
    name: "Fortinet", programName: "Engage Partner Program",
    tiers: [{ name: "Advocate", rank: 1 }, { name: "Select", rank: 2 }, { name: "Advanced", rank: 3 }, { name: "Expert", rank: 4 }],
    comps: ["Network Security", "SASE", "OT Security", "Security Operations"],
    certs: [
      { code: "NSE", name: "NSE Certification", compIdx: 0, level: "professional", validityMonths: 24 },
      { code: "NSE7-SASE", name: "NSE 7 — FortiSASE Enterprise Administrator", compIdx: 1, level: "expert", validityMonths: 24 },
      { code: "NSE6-OT", name: "NSE 6 — OT Security Architect", compIdx: 2, level: "professional", validityMonths: 24 },
      { code: "NSE7-SECOPS", name: "NSE 7 — Security Operations Architect", compIdx: 3, level: "expert", validityMonths: 24 },
    ],
    reqs: [{ tierIdx: 2, target: { kind: "comp", idx: 0 }, minCount: 2 }, { tierIdx: 3, target: { kind: "cert", idx: 1 }, minCount: 2 }, { tierIdx: 3, target: { kind: "comp", idx: 0 }, minCount: 4 }],
  },
  paloalto: {
    name: "Palo Alto Networks", programName: "NextWave Partner Program",
    tiers: [{ name: "Innovator", rank: 1 }, { name: "Gold Innovator", rank: 2 }, { name: "Platinum Innovator", rank: 3 }, { name: "Diamond Innovator", rank: 4 }],
    comps: ["Network Security", "Prisma SASE", "Cortex"],
    certs: [
      { code: "HW-FW", name: "Hardware Firewall Product Specialization", compIdx: 0, level: "professional", validityMonths: 24 },
      { code: "SW-FW", name: "Software Firewall Product Specialization", compIdx: 0, level: "professional", validityMonths: 24 },
      { code: "PRISMA-SASE", name: "Prisma SASE Product Specialization", compIdx: 1, level: "professional", validityMonths: 24 },
      { code: "CORTEX-XSIAM", name: "Cortex XSIAM Product Specialization", compIdx: 2, level: "expert", validityMonths: 24 },
      { code: "PCNSE", name: "PCNSE — Network Security Engineer", compIdx: 0, level: "expert", validityMonths: 24 },
    ],
    reqs: [{ tierIdx: 1, target: { kind: "cert", idx: 0 }, minCount: 1 }, { tierIdx: 2, target: { kind: "cert", idx: 4 }, minCount: 2 }, { tierIdx: 3, target: { kind: "comp", idx: 0 }, minCount: 4 }],
  },
  cisco: {
    name: "Cisco", programName: "Cisco Partner Program",
    tiers: [{ name: "Select", rank: 1 }, { name: "Premier", rank: 2 }, { name: "Gold", rank: 3 }],
    comps: ["Enterprise Networking", "Security", "Collaboration", "SMB & Mid-Market"],
    certs: [
      { code: "CCNA", name: "CCNA", compIdx: 0, level: "associate", validityMonths: 36 },
      { code: "CCNP-ENT", name: "CCNP Enterprise", compIdx: 0, level: "professional", validityMonths: 36 },
      { code: "CCNP-SEC", name: "CCNP Sécurité", compIdx: 1, level: "professional", validityMonths: 36 },
      { code: "CCNP-COL", name: "CCNP Collaboration", compIdx: 2, level: "professional", validityMonths: 36 },
      { code: "BB-SMB", name: "Black Belt SMB & Mid-Market", compIdx: 3, level: "associate", validityMonths: 24 },
    ],
    reqs: [{ tierIdx: 1, target: { kind: "cert", idx: 0 }, minCount: 3 }, { tierIdx: 2, target: { kind: "cert", idx: 1 }, minCount: 2 }, { tierIdx: 2, target: { kind: "cert", idx: 2 }, minCount: 1 }],
  },
  huawei: {
    name: "Huawei", programName: "Huawei Partner Program (ICT)",
    tiers: [{ name: "Registered", rank: 1 }, { name: "Silver", rank: 2 }, { name: "Gold", rank: 3 }, { name: "Platinum", rank: 4 }],
    comps: ["Datacom", "Storage"],
    certs: [
      { code: "HCSA-DATACOM", name: "HCSA-Sales Datacom", compIdx: 0, level: "associate", validityMonths: 36 },
      { code: "HCSP-DATACOM", name: "HCSP-Datacom", compIdx: 0, level: "professional", validityMonths: 36 },
      { code: "HCIE-DATACOM", name: "HCIE-Datacom", compIdx: 0, level: "expert", validityMonths: 36 },
      { code: "HCSA-STORAGE", name: "HCSA-Sales Storage", compIdx: 1, level: "associate", validityMonths: 36 },
      { code: "HCIP-STORAGE", name: "HCIP-Storage", compIdx: 1, level: "professional", validityMonths: 36 },
    ],
    reqs: [{ tierIdx: 1, target: { kind: "cert", idx: 0 }, minCount: 2 }, { tierIdx: 2, target: { kind: "cert", idx: 1 }, minCount: 2 }, { tierIdx: 3, target: { kind: "cert", idx: 2 }, minCount: 1 }],
  },
  f5: {
    name: "F5", programName: "Unity+ Partner Program",
    tiers: [{ name: "Registered", rank: 1 }, { name: "Silver", rank: 2 }, { name: "Gold", rank: 3 }, { name: "Platinum", rank: 4 }],
    comps: ["Application Delivery"],
    certs: [
      { code: "201", name: "201 — BIG-IP Administrator", compIdx: 0, level: "associate", validityMonths: 24 },
      { code: "202", name: "202 — BIG-IP LTM", compIdx: 0, level: "professional", validityMonths: 24 },
      { code: "F5-ACC", name: "F5 Accreditation", compIdx: 0, level: "associate", validityMonths: 24 },
    ],
    reqs: [{ tierIdx: 1, target: { kind: "cert", idx: 0 }, minCount: 1 }, { tierIdx: 2, target: { kind: "cert", idx: 1 }, minCount: 1 }, { tierIdx: 3, target: { kind: "cert", idx: 1 }, minCount: 2 }],
  },
  "hpe-aruba": {
    name: "HPE Aruba", programName: "HPE Partner Ready",
    tiers: [{ name: "Silver", rank: 1 }, { name: "Gold", rank: 2 }, { name: "Platinum", rank: 3 }],
    comps: ["Switching", "Mobility (WLAN)", "Sales"],
    certs: [
      { code: "ACSA", name: "Aruba Certified Switching Associate (ACSA)", compIdx: 0, level: "associate", validityMonths: 36 },
      { code: "ACSP", name: "Aruba Certified Switching Professional (ACSP)", compIdx: 0, level: "professional", validityMonths: 36 },
      { code: "GMP", name: "Gold Mobility Professional", compIdx: 1, level: "professional", validityMonths: 24 },
      { code: "APAS", name: "HPE Sales Certified — Aruba Networking Solutions", compIdx: 2, level: "associate", validityMonths: 24 },
    ],
    reqs: [{ tierIdx: 0, target: { kind: "cert", idx: 0 }, minCount: 1 }, { tierIdx: 1, target: { kind: "cert", idx: 1 }, minCount: 1 }, { tierIdx: 2, target: { kind: "comp", idx: 1 }, minCount: 1 }],
  },
  checkpoint: {
    name: "Check Point", programName: "Check Point Partner Program",
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
    name: "Kaspersky", programName: "Kaspersky United Partner Program",
    tiers: [{ name: "Registered", rank: 1 }, { name: "Silver", rank: 2 }, { name: "Gold", rank: 3 }, { name: "Platinum", rank: 4 }],
    comps: ["Technique", "Sales"],
    certs: [
      { code: "KESC", name: "Kaspersky Endpoint Security Cloud", compIdx: 0, level: "professional", validityMonths: 24 },
      { code: "SALES-FND", name: "Sales — Security Foundations", compIdx: 1, level: "associate", validityMonths: 24 },
      { code: "SALES-OPT", name: "Sales — Optimum", compIdx: 1, level: "associate", validityMonths: 24 },
    ],
    reqs: [{ tierIdx: 2, target: { kind: "cert", idx: 1 }, minCount: 2 }, { tierIdx: 3, target: { kind: "comp", idx: 0 }, minCount: 1 }],
  },
  dell: {
    name: "Dell", programName: "Dell Technologies Partner Program",
    tiers: [{ name: "Authorized", rank: 1 }, { name: "Gold", rank: 2 }, { name: "Platinum", rank: 3 }, { name: "Titanium", rank: 4 }],
    comps: ["Server", "Storage", "Core Client", "Data Protection"],
    certs: [
      { code: "SE-SERVER", name: "SE — Server Credential", compIdx: 0, level: "professional", validityMonths: 12 },
      { code: "SE-CLIENT", name: "SE — Core Client Credential", compIdx: 2, level: "professional", validityMonths: 12 },
      { code: "SE-MIDSTOR", name: "SE — MidRange Storage Credential", compIdx: 1, level: "professional", validityMonths: 12 },
      { code: "SALES-STOR", name: "Sales — Storage Credential", compIdx: 1, level: "associate", validityMonths: 12 },
      { code: "SALES-DP", name: "Sales — Data Protection Credential", compIdx: 3, level: "associate", validityMonths: 12 },
    ],
    reqs: [{ tierIdx: 1, target: { kind: "cert", idx: 2 }, minCount: 1 }, { tierIdx: 2, target: { kind: "comp", idx: 1 }, minCount: 2 }],
  },
  microsoft: {
    name: "Microsoft", programName: "Microsoft AI Cloud Partner Program",
    tiers: [{ name: "Member", rank: 1 }, { name: "Solutions Partner", rank: 2 }, { name: "Specialization", rank: 3 }],
    comps: ["Modern Work"],
    certs: [
      { code: "MS-INT", name: "Microsoft Intermediate Certification", compIdx: 0, level: "professional", validityMonths: 12 },
      { code: "MS-ADV", name: "Microsoft Advanced Certification", compIdx: 0, level: "expert", validityMonths: 12 },
    ],
    reqs: [{ tierIdx: 1, target: { kind: "cert", idx: 0 }, minCount: 2 }, { tierIdx: 2, target: { kind: "cert", idx: 1 }, minCount: 2 }],
  },
  sophos: {
    name: "Sophos", programName: "Sophos Partner Program",
    tiers: [{ name: "Authorized", rank: 1 }, { name: "Silver", rank: 2 }, { name: "Gold", rank: 3 }, { name: "Platinum", rank: 4 }],
    comps: ["Endpoint (Intercept X)", "Firewall (XGS)", "MDR", "Sales"],
    certs: [
      { code: "SCE-EP", name: "Sophos Certified Engineer — Endpoint", compIdx: 0, level: "professional", validityMonths: 24 },
      { code: "SCA-EP", name: "Sophos Certified Architect — Endpoint", compIdx: 0, level: "expert", validityMonths: 24 },
      { code: "SCE-FW", name: "Sophos Certified Engineer — Firewall", compIdx: 1, level: "professional", validityMonths: 24 },
      { code: "SOPHOS-SALES", name: "Sophos Sales Consultant", compIdx: 3, level: "associate", validityMonths: 24 },
    ],
    reqs: [{ tierIdx: 2, target: { kind: "cert", idx: 2 }, minCount: 2 }, { tierIdx: 3, target: { kind: "cert", idx: 1 }, minCount: 1 }],
  },
  nutanix: {
    name: "Nutanix", programName: "Nutanix Elevate Partner Program",
    tiers: [{ name: "Authorized", rank: 1 }, { name: "Professional", rank: 2 }, { name: "Master", rank: 3 }, { name: "Elite", rank: 4 }],
    comps: ["Hyperconverged Infrastructure", "Cloud"],
    certs: [
      { code: "NCA", name: "Nutanix Certified Associate (NCA)", compIdx: 0, level: "associate", validityMonths: 24 },
      { code: "NCP-MCI", name: "Nutanix Certified Professional — Multicloud Infrastructure", compIdx: 0, level: "professional", validityMonths: 24 },
      { code: "NCM-MCI", name: "Nutanix Certified Master — Multicloud Infrastructure", compIdx: 0, level: "expert", validityMonths: 24 },
      { code: "NPX", name: "Nutanix Platform Expert (NPX)", compIdx: 1, level: "expert", validityMonths: 24 },
    ],
    reqs: [{ tierIdx: 1, target: { kind: "cert", idx: 1 }, minCount: 2 }, { tierIdx: 2, target: { kind: "cert", idx: 2 }, minCount: 1 }],
  },
  wallix: {
    name: "Wallix", programName: "Wallix Partner Program",
    tiers: [{ name: "Registered", rank: 1 }, { name: "Silver", rank: 2 }, { name: "Gold", rank: 3 }, { name: "VAR Premier", rank: 4 }],
    comps: ["PAM (Privileged Access Management)", "Sales"],
    certs: [
      { code: "WBA", name: "Wallix Bastion Certified Administrator", compIdx: 0, level: "professional", validityMonths: 24 },
      { code: "WCE", name: "Wallix Certified Engineer", compIdx: 0, level: "expert", validityMonths: 24 },
      { code: "WALLIX-SALES", name: "Wallix Sales Certified", compIdx: 1, level: "associate", validityMonths: 24 },
    ],
    reqs: [{ tierIdx: 2, target: { kind: "cert", idx: 0 }, minCount: 2 }, { tierIdx: 3, target: { kind: "cert", idx: 1 }, minCount: 1 }],
  },
  jabra: {
    name: "Jabra", programName: "Jabra Partner Program",
    tiers: [{ name: "Registered", rank: 1 }, { name: "Authorized", rank: 2 }, { name: "Gold", rank: 3 }],
    comps: ["Unified Communications", "Contact Center"],
    certs: [
      { code: "JABRA-SALES", name: "Jabra Certified Sales", compIdx: 0, level: "associate", validityMonths: 24 },
      { code: "JABRA-TECH", name: "Jabra Certified Technical", compIdx: 0, level: "professional", validityMonths: 24 },
    ],
    reqs: [{ tierIdx: 1, target: { kind: "cert", idx: 1 }, minCount: 1 }, { tierIdx: 2, target: { kind: "comp", idx: 0 }, minCount: 2 }],
  },
  veritas: {
    name: "Veritas", programName: "Veritas Partner Force",
    tiers: [{ name: "Registered", rank: 1 }, { name: "Silver", rank: 2 }, { name: "Gold", rank: 3 }, { name: "Platinum", rank: 4 }],
    comps: ["Data Protection (NetBackup)", "InfoScale"],
    certs: [
      { code: "VCS-NBU", name: "Veritas Certified Specialist — NetBackup", compIdx: 0, level: "professional", validityMonths: 24 },
      { code: "VCP-NBU", name: "Veritas Certified Professional — NetBackup", compIdx: 0, level: "expert", validityMonths: 24 },
      { code: "VERITAS-SALES", name: "Veritas Sales Accreditation", compIdx: 0, level: "associate", validityMonths: 24 },
    ],
    reqs: [{ tierIdx: 1, target: { kind: "cert", idx: 0 }, minCount: 2 }, { tierIdx: 2, target: { kind: "cert", idx: 1 }, minCount: 1 }],
  },
  "apc-schneider": {
    name: "APC — Schneider Electric", programName: "APC Channel Partner Program",
    tiers: [{ name: "Registered", rank: 1 }, { name: "Select", rank: 2 }, { name: "Premier", rank: 3 }, { name: "Elite", rank: 4 }],
    comps: ["Secure Power (UPS)", "Data Center Physical Infrastructure"],
    certs: [
      { code: "APC-SP", name: "APC Certified — Secure Power", compIdx: 0, level: "professional", validityMonths: 24 },
      { code: "SE-DCPI", name: "Schneider Electric Certified — DCPI", compIdx: 1, level: "professional", validityMonths: 24 },
      { code: "APC-SALES", name: "APC Sales Certified", compIdx: 0, level: "associate", validityMonths: 24 },
    ],
    reqs: [{ tierIdx: 1, target: { kind: "cert", idx: 0 }, minCount: 1 }, { tierIdx: 2, target: { kind: "cert", idx: 0 }, minCount: 2 }],
  },
  tufin: {
    name: "Tufin", programName: "Tufin Partner Program",
    tiers: [{ name: "Authorized", rank: 1 }, { name: "Silver", rank: 2 }, { name: "Gold", rank: 3 }],
    comps: ["Security Policy Management"],
    certs: [
      { code: "TCSA", name: "Tufin Certified Security Administrator", compIdx: 0, level: "associate", validityMonths: 24 },
      { code: "TCSE", name: "Tufin Certified Security Engineer", compIdx: 0, level: "professional", validityMonths: 24 },
      { code: "TUFIN-SALES", name: "Tufin Sales Professional", compIdx: 0, level: "associate", validityMonths: 24 },
    ],
    reqs: [{ tierIdx: 1, target: { kind: "cert", idx: 0 }, minCount: 2 }, { tierIdx: 2, target: { kind: "cert", idx: 1 }, minCount: 1 }],
  },
  rapid7: {
    name: "Rapid7", programName: "Rapid7 PACT Partner Program",
    tiers: [{ name: "Authorized", rank: 1 }, { name: "Silver", rank: 2 }, { name: "Gold", rank: 3 }, { name: "Platinum", rank: 4 }],
    comps: ["Vulnerability Management (InsightVM)", "SIEM (InsightIDR)"],
    certs: [
      { code: "R7-VM", name: "Rapid7 Certified Administrator — InsightVM", compIdx: 0, level: "professional", validityMonths: 24 },
      { code: "R7-IDR", name: "Rapid7 Certified Administrator — InsightIDR", compIdx: 1, level: "professional", validityMonths: 24 },
      { code: "R7-SALES", name: "Rapid7 Sales Certified", compIdx: 0, level: "associate", validityMonths: 24 },
    ],
    reqs: [{ tierIdx: 1, target: { kind: "cert", idx: 0 }, minCount: 2 }, { tierIdx: 2, target: { kind: "comp", idx: 1 }, minCount: 1 }],
  },
  allot: {
    name: "Allot", programName: "Allot Partner Program",
    tiers: [{ name: "Authorized", rank: 1 }, { name: "Silver", rank: 2 }, { name: "Gold", rank: 3 }],
    comps: ["Network Intelligence", "Security (DDoS)"],
    certs: [
      { code: "ALLOT-SE", name: "Allot Certified Engineer", compIdx: 0, level: "professional", validityMonths: 24 },
      { code: "ALLOT-SALES", name: "Allot Certified Sales", compIdx: 0, level: "associate", validityMonths: 24 },
    ],
    reqs: [{ tierIdx: 1, target: { kind: "cert", idx: 0 }, minCount: 1 }, { tierIdx: 2, target: { kind: "comp", idx: 1 }, minCount: 1 }],
  },
  juniper: {
    name: "Juniper", programName: "Juniper Partner Advantage",
    tiers: [{ name: "Select", rank: 1 }, { name: "Elite", rank: 2 }, { name: "Elite Plus", rank: 3 }],
    comps: ["Enterprise (EX/Mist)", "Service Provider (MX)", "Security (SRX)"],
    certs: [
      { code: "JNCIA", name: "JNCIA-Junos", compIdx: 0, level: "associate", validityMonths: 36 },
      { code: "JNCIS-ENT", name: "JNCIS-ENT", compIdx: 0, level: "professional", validityMonths: 36 },
      { code: "JNCIP-ENT", name: "JNCIP-ENT", compIdx: 0, level: "expert", validityMonths: 36 },
      { code: "JNCIP-SEC", name: "JNCIP-SEC", compIdx: 2, level: "expert", validityMonths: 36 },
    ],
    reqs: [{ tierIdx: 1, target: { kind: "cert", idx: 1 }, minCount: 2 }, { tierIdx: 2, target: { kind: "cert", idx: 2 }, minCount: 1 }],
  },
};

// FICHE DE SUIVI — recopiée VERBATIM du fichier direction Partners_Status_Tracking (juillet 2026). Fait
// AUTORITÉ sur : statut atteint, échéance de renouvellement, statut de validation, et plan d'affaires
// (objectif BP vs réalisé YTD par axe). Montants XOF, pourcentages Growth en points (BP 25 / YTD 20 partout,
// tels quels dans le fichier). La STRUCTURE programme (niveaux/compétences/catalogue de certifs/exigences)
// reste dans DEFS ci-dessus (indicative : le fichier ne la porte pas). Une seule source par champ → pas de
// double vérité. (VEEAM, Oracle, Acronis figurent au fichier mais hors top-20 modèles — non repris ici.)
const SCORECARD: Record<PresetId, { status: string; renewalDate: string; validationStatus: string; bp: Bp }> = {
  fortinet:        { status: "Expert",             renewalDate: "2025-12-31", validationStatus: "presque_valide", bp: { pipeline: [4350000, 4000000], booking: [550000, 680000],   cert: [2, 2], growth: [25, 20] } },
  paloalto:        { status: "Innovator",          renewalDate: "2026-07-31", validationStatus: "valide",         bp: { pipeline: [3150000, 4000000], booking: [20000, 92288],     cert: [2, 0], growth: [25, 20] } },
  cisco:           { status: "Premier Integrator", renewalDate: "2025-12-31", validationStatus: "non_valide",     bp: { pipeline: [3750000, 4000000], booking: [3000000, 3000000], cert: [6, 0], growth: [25, 20] } },
  huawei:          { status: "Silver",             renewalDate: "2026-01-02", validationStatus: "presque_valide", bp: { pipeline: [3450000, 2000000], booking: [250000, 502140],   cert: [4, 1], growth: [25, 20] } },
  f5:              { status: "Silver",             renewalDate: "2025-09-30", validationStatus: "valide",         bp: { pipeline: [2100000, 5000000], booking: [175000, 344000],   cert: [3, 1], growth: [25, 20] } },
  "hpe-aruba":     { status: "Silver",             renewalDate: "2025-10-31", validationStatus: "valide",         bp: { pipeline: [1950000, 2000000], booking: [60000, 789656],    cert: [2, 0], growth: [25, 20] } },
  checkpoint:      { status: "Advanced",           renewalDate: "2025-12-31", validationStatus: "non_valide",     bp: { pipeline: [3000000, 3000000], booking: [200000, 167800],   cert: [5, 0], growth: [25, 20] } },
  kaspersky:       { status: "Platinum",           renewalDate: "2026-01-31", validationStatus: "valide",         bp: { pipeline: [300000, 3000000],  booking: [220000, 215000],   cert: [6, 8], growth: [25, 20] } },
  dell:            { status: "Platinum",           renewalDate: "2026-01-30", validationStatus: "valide",         bp: { pipeline: [150000, 1000000],  booking: [860000, 2647125],  cert: [3, 2], growth: [25, 20] } },
  microsoft:       { status: "Modern Work - SMB",  renewalDate: "2025-12-31", validationStatus: "valide",         bp: { pipeline: [750000, 5000000],  booking: [1000000, 713815],  cert: [3, 4], growth: [25, 20] } },
  sophos:          { status: "Silver",             renewalDate: "2026-03-31", validationStatus: "valide",         bp: { pipeline: [150000, 2000000],  booking: [5000, 14000],      cert: [4, 1], growth: [25, 20] } },
  nutanix:         { status: "Registered",         renewalDate: "2026-07-31", validationStatus: "valide",         bp: { pipeline: [3450000, 2000000], booking: [50000, 152439],    cert: [7, 5], growth: [25, 20] } },
  wallix:          { status: "VAR Premier",        renewalDate: "2025-12-31", validationStatus: "valide",         bp: { pipeline: [450000, 4000000],  booking: [0, 75000],         cert: [3, 0], growth: [25, 20] } },
  jabra:           { status: "Authorized",         renewalDate: "2025-12-31", validationStatus: "non_valide",     bp: { pipeline: [3600000, 5000000], booking: [0, 40000],         cert: [1, 0], growth: [25, 20] } },
  veritas:         { status: "Silver",             renewalDate: "2025-12-31", validationStatus: "valide",         bp: { pipeline: [2850000, 5000000], booking: [10000, 0],         cert: [0, 0], growth: [25, 20] } },
  "apc-schneider": { status: "Select Partner",     renewalDate: "2025-12-31", validationStatus: "non_valide",     bp: { pipeline: [0, 0],             booking: [123000, 0],        cert: [2, 0], growth: [25, 20] } },
  tufin:           { status: "Authorized",         renewalDate: "2025-12-31", validationStatus: "presque_valide", bp: { pipeline: [3600000, 4000000], booking: [0, 0],             cert: [0, 0], growth: [25, 20] } },
  rapid7:          { status: "Authorized",         renewalDate: "2025-12-31", validationStatus: "valide",         bp: { pipeline: [750000, 4000000],  booking: [0, 0],             cert: [0, 0], growth: [25, 20] } },
  allot:           { status: "Authorized",         renewalDate: "2025-12-31", validationStatus: "presque_valide", bp: { pipeline: [2700000, 3000000], booking: [0, 0],             cert: [0, 0], growth: [25, 20] } },
  juniper:         { status: "Elite",              renewalDate: "2025-12-31", validationStatus: "valide",         bp: { pipeline: [1500000, 2000000], booking: [0, 0],             cert: [0, 0], growth: [25, 20] } },
};

// Instancie un modèle en état de formulaire. `nextKey` fournit des clés locales UNIQUES (le compteur du
// formulaire) pour ne pas entrer en collision avec les lignes ajoutées ensuite. Les références croisées sont
// résolues via des tableaux de clés indexés — l'intégrité tient (buildPartnerPayload remappe vers les slugs).
// La fiche de suivi (statut/échéance/validation/plan d'affaires) vient de SCORECARD (fichier direction).
export function buildPartnerPreset(id: PresetId, nextKey: () => string): PartnerFormState {
  const d = DEFS[id];
  const sc = SCORECARD[id];
  const tierK = d.tiers.map(() => nextKey());
  const compK = d.comps.map(() => nextKey());
  const certK = d.certs.map(() => nextKey());
  const tiers: TierRow[] = d.tiers.map((t, i) => ({ k: tierK[i], name: t.name, rank: String(t.rank) }));
  const comps: CompRow[] = d.comps.map((c, i) => ({ k: compK[i], name: c }));
  const certs: CertRow[] = d.certs.map((c, i) => ({ k: certK[i], name: c.name, code: c.code, compK: compK[c.compIdx], level: c.level, validityMonths: String(c.validityMonths) }));
  const reqs: ReqRow[] = d.reqs.map((r) => ({ k: nextKey(), tierK: tierK[r.tierIdx], targetK: (r.target.kind === "cert" ? "cert:" + certK[r.target.idx] : "comp:" + compK[r.target.idx]), minCount: String(r.minCount) }));
  // Plan d'affaires : objectif BP + réalisé YTD par axe (VERBATIM du fichier direction — cf. SCORECARD).
  const bp = {} as BpForm;
  for (const ax of BP_AXES) { bp[`${ax}Bp`] = String(sc.bp[ax][0]); bp[`${ax}Ytd`] = String(sc.bp[ax][1]); }
  // caDeclaredXof laissé vide : l'agrégat retombe sur le réalisé booking YTD du plan d'affaires (déjà saisi)
  // comme CA déclaratif — pas de double saisie. fiscalStartMonth vide : exercice calendaire par défaut (le
  // fichier direction ne fournit pas d'exercice décalé par partenaire ; éditable au cas par cas).
  return { name: d.name, programName: d.programName, status: sc.status, renewalDate: sc.renewalDate, validationStatus: sc.validationStatus, bp, caDeclaredXof: "", fiscalStartMonth: "", tiers, comps, certs, reqs };
}
