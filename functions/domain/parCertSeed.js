// DO — Amorçage des certifications par ingénieur depuis le fichier direction CERTIFICATIONS_TOP_PARTENAIRES
// (juillet 2026). Domaine PUR (aucune I/O) → testable. Transforme les lignes du fichier en un PLAN d'import
// que le handler applique (création consultants manquants, complétion catalogue, écriture certifs/assignations).
//
// PARTI PRIS (honnêteté des données — CLAUDE.md « n'invente aucune donnée ») :
//  • On ne retient que les lignes à ingénieur(s) NOMMÉ(s) explicitement (prénom + nom). Les lignes à
//    identifiants de compte (« adjibrine », « mikailou »…) ou à groupes vagues (« Tous les commerciaux »)
//    sont ÉCARTÉES et remontées dans le rapport — jamais devinées.
//  • « ✅ Complété » → certification DÉTENUE. Le fichier donne l'ÉCHÉANCE, pas la date d'obtention : on la
//    RÉTRO-CALCULE (échéance − validité catalogue). Dérivation documentée, pas une invention de valeur.
//  • Autres statuts (« À démarrer », « URGENT ») → ASSIGNATION à obtenir (date cible = échéance du fichier).
//  • Un consultant nommé absent de l'annuaire ESN est CRÉÉ (choix direction) — après correspondance par nom
//    normalisé d'abord, pour ne pas dupliquer un salarié existant.
// Slug d'identifiant (même règle que parCertification.js / le handler) : minuscules, non-alphanumérique → tiret.
const slug = (v) => { const s = String(v == null ? "" : v).trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, ""); return s || null; };

// Normalisation de nom pour le rapprochement annuaire : sans accents, casse repliée, espaces compactés.
// « Stevensky Aboua » ≡ « STEVENSKY  ABOUA ». On NE réordonne PAS (prénom/nom) — le fichier et l'annuaire
// suivent le même ordre (prénom nom) ; réordonner créerait de faux positifs.
function normName(s) {
  return String(s == null ? "" : s).normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim().toLowerCase();
}

// Rétro-calcul de la date d'obtention d'une certif détenue à partir de son échéance et de sa validité (mois).
// Sans échéance connue → null (le handler comblera par un repli documenté). PUR (pas de Date.now).
function obtainedFromExpiry(expiryIso, validityMonths) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(expiryIso || ""))) return null;
  const vm = Number(validityMonths) || 24;
  const d = new Date(expiryIso + "T00:00:00Z");
  d.setUTCMonth(d.getUTCMonth() - vm);
  return d.toISOString().slice(0, 10);
}

// Dataset transcrit du fichier — lignes à ingénieur(s) NOMMÉ(s). Chaque entrée : partenaire (slug du
// référentiel), compétence, libellé de certif, niveau, validité (mois, indicative), ingénieurs, détenue?,
// échéance (ISO). Écarte volontairement les lignes à identifiants de compte / groupes vagues (rapportées).
const ROWS = [
  // ── Fortinet (Faissale YEO / Richard KOUADIO)
  { p: "fortinet", comp: "Security Operations", cert: "NSE Certification", code: "NSE", level: "professional", vm: 24, eng: ["Faissale YEO", "Richard KOUADIO"], held: true, ech: "2026-04-30" },
  { p: "fortinet", comp: "Security Operations", cert: "NSE 7 - Security Operations Architect", code: "NSE7-SECOPS", level: "expert", vm: 24, eng: ["Faissale YEO", "Richard KOUADIO"], held: false, ech: "2026-10-31" },
  { p: "fortinet", comp: "SASE", cert: "NSE 7 - FortiSASE Enterprise Administrator", code: "NSE7-SASE", level: "expert", vm: 24, eng: ["Faissale YEO", "Richard KOUADIO"], held: false, ech: "2026-10-31" },
  { p: "fortinet", comp: "OT Security", cert: "NSE 6 - OT Security Architect", code: "NSE6-OT", level: "professional", vm: 24, eng: ["Faissale YEO", "Richard KOUADIO"], held: false, ech: "2026-10-31" },

  // ── Palo Alto
  { p: "paloalto", comp: "Network Security", cert: "Reseller: Innovator", code: "PA-INNOVATOR", level: "associate", vm: 24, eng: ["Agadji DJIBRINE"], held: true, ech: "2026-07-25" },
  { p: "paloalto", comp: "Network Security", cert: "Hardware Firewall Product Specialization", code: "HW-FW", level: "professional", vm: 24, eng: ["Agadji DJIBRINE"], held: true, ech: "2026-07-25" },
  { p: "paloalto", comp: "Network Security", cert: "Software Firewall Product Specialization", code: "SW-FW", level: "professional", vm: 24, eng: ["Awa Sana"], held: false, ech: "2026-07-25" },
  { p: "paloalto", comp: "Prisma SASE", cert: "Prisma SASE Product Specialization", code: "PRISMA-SASE", level: "professional", vm: 24, eng: ["Awa Sana"], held: false, ech: "2026-07-25" },
  { p: "paloalto", comp: "Cortex", cert: "Cortex Cloud Product Specialization", code: "CORTEX-CLOUD", level: "professional", vm: 24, eng: ["Agadji DJIBRINE"], held: false, ech: "2026-07-25" },
  { p: "paloalto", comp: "Network Security", cert: "PCNSE - Network Security Engineer", code: "PCNSE", level: "expert", vm: 24, eng: ["Christian Brou", "Stevensky Aboua"], held: false, ech: "2026-07-25" },

  // ── Huawei
  { p: "huawei", comp: "Datacom", cert: "HCSA-Sales Datacom", code: "HCSA-DATACOM", level: "associate", vm: 36, eng: ["Mireille KOUADIO", "Serge YAO"], held: false, ech: "2026-07-15" },
  { p: "huawei", comp: "Storage", cert: "HCSA-Sales Storage", code: "HCSA-STORAGE", level: "associate", vm: 36, eng: ["Raphael ANOMA", "Mireille KOUADIO", "Serge YAO", "Marc Antoine AGNERO"], held: false, ech: "2026-07-15" },
  { p: "huawei", comp: "Storage", cert: "HCSA-Pre Sales Storage", code: "HCSA-PRE-STORAGE", level: "associate", vm: 36, eng: ["Urbain OUREGA"], held: false, ech: "2026-07-15" },
  { p: "huawei", comp: "Storage", cert: "HCIA-Storage", code: "HCIA-STORAGE", level: "associate", vm: 36, eng: ["Emerson KONZAN"], held: true, ech: "2026-07-15" },
  { p: "huawei", comp: "Storage", cert: "HCIP-Storage", code: "HCIP-STORAGE", level: "professional", vm: 36, eng: ["Agadji DJIBRINE"], held: false, ech: "2026-07-15" },
  { p: "huawei", comp: "Datacom", cert: "HCIE-Datacom", code: "HCIE-DATACOM", level: "expert", vm: 36, eng: ["Pascal KOUASSI"], held: false, ech: "2026-07-15" },
  { p: "huawei", comp: "Datacom", cert: "HCIP-Datacom", code: "HCIP-DATACOM", level: "professional", vm: 36, eng: ["Alassane SAKANDE"], held: false, ech: "2026-07-15" },

  // ── HPE Aruba
  { p: "hpe-aruba", comp: "Application Delivery", cert: "Aruba Certified Switching Associate (ACSA)", code: "ACSA", level: "associate", vm: 36, eng: ["Stevensky Aboua"], held: true, ech: "2027-05-31" },
  { p: "hpe-aruba", comp: "Application Delivery", cert: "Aruba Certified Switching Professional (ACSP)", code: "ACSP", level: "professional", vm: 36, eng: ["Stevensky Aboua"], held: true, ech: "2027-05-31" },
  { p: "hpe-aruba", comp: "Application Delivery", cert: "Gold Mobility Professional", code: "ARUBA-GMP", level: "professional", vm: 24, eng: ["Stevensky Aboua"], held: false, ech: "2026-08-31" },
  { p: "hpe-aruba", comp: "Application Delivery", cert: "Gold Design Professional", code: "ARUBA-GDP", level: "professional", vm: 24, eng: ["Pascal KOUASSI"], held: false, ech: "2026-08-31" },

  // ── Kaspersky
  { p: "kaspersky", comp: "Endpoint Security", cert: "Kaspersky Endpoint Security Cloud", code: "KESC", level: "professional", vm: 24, eng: ["Mel N'DIAMOI"], held: true, ech: "2026-07-31" },

  // ── F5
  { p: "f5", comp: "Application Delivery", cert: "201 - BIG-IP Administrator", code: "201", level: "associate", vm: 24, eng: ["Stevensky Aboua"], held: true, ech: "2025-09-30" },
  { p: "f5", comp: "Application Delivery", cert: "202 - BIG-IP LTM", code: "202", level: "professional", vm: 24, eng: ["Stevensky Aboua"], held: false, ech: "2026-09-30" },
  { p: "f5", comp: "Application Delivery", cert: "F5 Accreditation", code: "F5-ACC", level: "associate", vm: 24, eng: ["Christian Brou", "Stevensky Aboua"], held: false, ech: "2026-09-30" },

  // ── Check Point
  { p: "checkpoint", comp: "Network Security", cert: "CPSC", code: "CPSC", level: "associate", vm: 24, eng: ["Mel N'DIAMOI"], held: true, ech: "2025-11-30" },
  { p: "checkpoint", comp: "Network Security", cert: "Check Point Technical", code: "CP-TECH", level: "professional", vm: 24, eng: ["Mel N'DIAMOI"], held: true, ech: "2025-11-30" },
  { p: "checkpoint", comp: "Network Security", cert: "Harmony Endpoint", code: "CP-HARMONY-EP", level: "professional", vm: 24, eng: ["Mel N'DIAMOI", "Faissale YEO", "Richard KOUADIO"], held: false, ech: "2026-11-30" },

  // ── Cisco (Black Belt — noms explicites)
  { p: "cisco", comp: "SMB & Mid-Market", cert: "Black Belt SMB & Mid-Market Business Seller (Stages 1-3)", code: "BB-SMB-BIZ", level: "associate", vm: 24, eng: ["Mel N'DIAMOI"], held: true, ech: "2026-07-15" },
  { p: "cisco", comp: "SMB & Mid-Market", cert: "Black Belt SMB & Mid-Market Technical Seller (Stages 1-3)", code: "BB-SMB-TECH", level: "associate", vm: 24, eng: ["Richard KOUADIO"], held: true, ech: "2026-07-15" },
  { p: "cisco", comp: "Enterprise Networking", cert: "CCNA", code: "CCNA", level: "associate", vm: 36, eng: ["Pascal KOUASSI", "Faissale YEO", "Richard KOUADIO"], held: false, ech: "2026-09-30" },
];

// Lignes ÉCARTÉES du fichier (identifiants de compte / groupes vagues) — remontées pour transparence.
const SKIPPED_NOTES = [
  "Huawei — liste « SUIVI ECHEANCE » à identifiants de compte (adjibrine, mikailou, saboua, awasana…) : non rapprochables à un consultant nommé.",
  "Dell / Microsoft / Kaspersky (sales) — lignes « Tous les commerciaux » / groupes de prénoms sans nom complet : à saisir à la main.",
  "Huawei — récapitulatif des GAPS à groupes (« Mireille, Anoma, Serges, Marc… ») : ambigu, non importé.",
];

/**
 * Construit le PLAN d'import. PUR.
 * @param {Array<{id:string,name:string}>} consultants  annuaire ESN existant (id + nom)
 * @param {Array<{id:string}>} partners                 référentiel partenaire existant (par_partners) — ids
 * @param {string} today                                date du jour ISO (injectée)
 * @returns {{needConsultants:{norm:string,name:string}[], partnerPatches:Object, certs:object[], assignments:object[], skipped:object[], notes:string[]}}
 */
function planCertImport(consultants, partners, today) {
  const idx = new Map();                                   // normName → consultantId (annuaire existant)
  for (const c of consultants || []) { const n = normName(c.name); if (n && !idx.has(n)) idx.set(n, c.id); }
  const partnerSet = new Set((partners || []).map((p) => p.id));

  const needConsultants = new Map();                       // norm → display name (à créer, dédupliqué)
  const patches = {};                                      // partnerId → { addComps:Map, addCerts:Map }
  const certs = [], assignments = [], skipped = [];

  const ensurePatch = (pid) => { if (!patches[pid]) patches[pid] = { comps: new Map(), certs: new Map() }; return patches[pid]; };

  for (const r of ROWS) {
    if (!partnerSet.has(r.p)) { skipped.push({ reason: "partenaire absent du référentiel", detail: `${r.p} — importer d'abord les 20 partenaires`, cert: r.cert }); continue; }
    const compId = slug(r.comp), catalogId = slug(r.cert);
    const patch = ensurePatch(r.p);
    if (!patch.comps.has(compId)) patch.comps.set(compId, { id: compId, name: r.comp });
    if (!patch.certs.has(catalogId)) patch.certs.set(catalogId, { id: catalogId, code: r.code, name: r.cert, competencyId: compId, level: r.level, validityMonths: r.vm });

    for (const name of r.eng) {
      const norm = normName(name);
      if (!norm) continue;
      if (!idx.has(norm) && !needConsultants.has(norm)) needConsultants.set(norm, name.trim());
      if (r.held) {
        const obtained = obtainedFromExpiry(r.ech, r.vm) || today; // repli documenté : aujourd'hui si échéance absente
        certs.push({ norm, name: name.trim(), partnerId: r.p, catalogId, obtainedDate: obtained });
      } else {
        assignments.push({ norm, name: name.trim(), partnerId: r.p, catalogId, targetDate: r.ech || today, status: "planifie" });
      }
    }
  }

  // Matérialise les patchs partenaire (Map → tableaux) pour le handler.
  const partnerPatches = {};
  for (const [pid, p] of Object.entries(patches)) partnerPatches[pid] = { addComps: [...p.comps.values()], addCerts: [...p.certs.values()] };

  return {
    needConsultants: [...needConsultants.entries()].map(([norm, name]) => ({ norm, name })),
    partnerPatches, certs, assignments, skipped, notes: SKIPPED_NOTES,
  };
}

module.exports = { planCertImport, normName, obtainedFromExpiry, ROWS };
