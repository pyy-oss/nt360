// Domain PUR — import des certifications par FICHIER utilisateur (.xlsx/.csv), module partenariats (par_).
// Aucune I/O → testable. Contrairement à parCertSeed (dataset direction transcrit dans le code), ce module
// parse un classeur ARBITRAIRE déposé par le steward : en-têtes reconnus en français (tolérants aux
// accents/casse), une ligne = une certification d'un ingénieur (détenue ou à obtenir).
//
// PARTI PRIS (honnêteté des données — « n'invente aucune donnée ») :
//  • Le partenaire ET l'entrée de catalogue doivent RÉSOUDRE contre le référentiel par_partners existant
//    (par slug/nom pour le partenaire ; par code ou libellé pour la certif). Ligne non résolue = ÉCARTÉE
//    et rapportée — l'import de fichier ne crée NI partenaire NI entrée de catalogue (le référentiel est
//    piloté par la direction, pas par un fichier).
//  • Détenue sans date d'obtention : rétro-calculée depuis l'échéance et la validité catalogue
//    (obtainedFromExpiry, dérivation documentée) ; sans échéance non plus → écartée, jamais devinée.
//  • Un ingénieur absent de l'annuaire est proposé à la CRÉATION (après rapprochement par nom normalisé,
//    normName) — même règle que l'import direction, confirmée par un dry-run côté handler.
const { normName, obtainedFromExpiry } = require("./parCertSeed");
const { slug } = require("./parPartner");

// Repli d'une cellule d'en-tête pour la reconnaissance : mêmes règles que normName (accents/casse/séparateurs).
const foldHeader = (v) => normName(v);

// En-têtes reconnus par colonne logique (repliés). Le premier match gagne, colonne par colonne.
const HEADERS = {
  engineer: ["ingenieur", "consultant", "nom", "engineer"],
  partner: ["constructeur", "partenaire", "partner", "editeur"],
  cert: ["certification", "certif", "cert"],
  status: ["statut", "etat", "status"],
  // NB : normName LIE les apostrophes (« d'obtention » → « dobtention ») — variantes pliées incluses.
  obtained: ["date dobtention", "dobtention", "date d obtention", "obtention", "obtenue", "obtained"],
  target: ["echeance", "date cible", "cible", "target", "deadline", "expiration"],
};

// Date de cellule → ISO AAAA-MM-JJ. Tolère : Date (xlsxRead, cellDates), ISO, JJ/MM/AAAA. null sinon.
function cellToIso(v) {
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v.toISOString().slice(0, 10);
  const s = String(v == null ? "" : v).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[3]}-${String(m[2]).padStart(2, "0")}-${String(m[1]).padStart(2, "0")}`;
  return null;
}

// Statut « détenue » ? Reconnu large (fichiers hétérogènes) : Complété/Obtenu/Détenu/Validé/Oui/Actif/✅.
function isHeldStatus(v) {
  const s = normName(v);
  if (!s) return null; // statut vide : on tranchera par les dates présentes
  if (/(complet|obtenu|detenu|valide|actif|active|oui|ok)/.test(s) || String(v).includes("✅")) return true;
  if (/(a demarrer|a obtenir|en cours|planifie|urgent|non|a faire|todo)/.test(s)) return false;
  return null; // statut inconnu : idem, les dates trancheront
}

// Repère la ligne d'en-tête (parmi les 10 premières) : celle qui résout AU MOINS ingénieur + constructeur
// + certification. Renvoie { rowIndex, cols: { engineer, partner, cert, status?, obtained?, target? } } ou null.
function detectHeader(aoa) {
  for (let r = 0; r < Math.min(10, (aoa || []).length); r++) {
    const row = aoa[r] || [];
    const cols = {};
    for (let c = 0; c < row.length; c++) {
      const h = foldHeader(row[c]);
      if (!h) continue;
      for (const [key, names] of Object.entries(HEADERS)) {
        if (cols[key] === undefined && names.some((n) => h === n || h.startsWith(n))) { cols[key] = c; break; }
      }
    }
    if (cols.engineer !== undefined && cols.partner !== undefined && cols.cert !== undefined) return { rowIndex: r, cols };
  }
  return null;
}

// Résout un libellé de partenaire contre le référentiel : slug direct, puis nom normalisé. null sinon.
function resolvePartnerLabel(label, partners) {
  const s = slug(label);
  if (!s) return null;
  const byId = new Map((partners || []).map((p) => [p.id, p]));
  if (byId.has(s)) return s;
  const n = normName(label);
  const hit = (partners || []).find((p) => normName(p.name) === n || normName(p.id) === n);
  return hit ? hit.id : null;
}

// Résout un libellé de certif contre le CATALOGUE d'un partenaire : code (replié) d'abord, puis libellé.
function resolveCatalogEntry(label, partner) {
  const n = normName(label);
  if (!n) return null;
  const cat = (partner && partner.certificationCatalog) || [];
  return cat.find((e) => normName(e.code) === n) || cat.find((e) => normName(e.name) === n) || null;
}

/**
 * Construit le PLAN d'import depuis l'AOA du classeur (une feuille). Ne touche à rien — le handler applique.
 * @param aoa  lignes du classeur (array of arrays, xlsxRead)
 * @param ctx.consultants  [{ id, name }] annuaire ESN existant
 * @param ctx.partners     [{ id, name, certificationCatalog }] référentiel par_partners
 * @returns { certs, assigns, needConsultants, skipped, parsedRows }
 *   certs   : [{ norm, name, partnerId, catalogId, obtainedDate }]
 *   assigns : [{ norm, name, partnerId, catalogId, targetDate }]
 */
function planCertFileImport(aoa, ctx = {}) {
  const consultants = ctx.consultants || [], partners = ctx.partners || [];
  const header = detectHeader(aoa);
  if (!header) return { error: "en-têtes introuvables — colonnes attendues : Ingénieur, Constructeur, Certification (+ Statut, Date d'obtention, Échéance)" };
  const { rowIndex, cols } = header;
  const partnerById = new Map(partners.map((p) => [p.id, p]));
  const knownByNorm = new Map();
  for (const c of consultants) { const n = normName(c.name); if (n && !knownByNorm.has(n)) knownByNorm.set(n, c.id); }

  const certs = [], assigns = [], skipped = [], needByNorm = new Map();
  let parsedRows = 0;
  const cell = (row, key) => (cols[key] === undefined ? null : row[cols[key]]);
  for (let r = rowIndex + 1; r < aoa.length; r++) {
    const row = aoa[r] || [];
    const engRaw = String(cell(row, "engineer") == null ? "" : cell(row, "engineer")).trim();
    const partnerRaw = String(cell(row, "partner") == null ? "" : cell(row, "partner")).trim();
    const certRaw = String(cell(row, "cert") == null ? "" : cell(row, "cert")).trim();
    if (!engRaw && !partnerRaw && !certRaw) continue; // ligne vide
    parsedRows++;
    if (!engRaw || !partnerRaw || !certRaw) { skipped.push({ reason: "ligne incomplète (ingénieur/constructeur/certification requis)", detail: `ligne ${r + 1}` }); continue; }
    // Un ingénieur NOMMÉ (prénom + nom) — même exigence que l'import direction : pas d'identifiant de compte.
    const norm = normName(engRaw);
    if (!norm || norm.split(" ").length < 2) { skipped.push({ reason: "ingénieur non nommé (prénom + nom requis)", detail: `ligne ${r + 1} : ${engRaw}` }); continue; }
    const partnerId = resolvePartnerLabel(partnerRaw, partners);
    if (!partnerId) { skipped.push({ reason: "constructeur inconnu du référentiel", detail: `ligne ${r + 1} : ${partnerRaw}` }); continue; }
    const entry = resolveCatalogEntry(certRaw, partnerById.get(partnerId));
    if (!entry) { skipped.push({ reason: "certification absente du catalogue du partenaire", detail: `ligne ${r + 1} : ${certRaw} (${partnerRaw})` }); continue; }

    const obtainedDate = cellToIso(cell(row, "obtained"));
    const targetDate = cellToIso(cell(row, "target"));
    let held = isHeldStatus(cell(row, "status"));
    if (held === null) held = obtainedDate ? true : targetDate ? false : null;
    if (held === null) { skipped.push({ reason: "statut indéterminable (ni statut reconnu, ni date)", detail: `ligne ${r + 1} : ${engRaw} / ${certRaw}` }); continue; }

    if (!knownByNorm.has(norm) && !needByNorm.has(norm)) needByNorm.set(norm, { name: engRaw, norm });
    if (held) {
      // Détenue : date d'obtention explicite, sinon rétro-calculée de l'échéance (validité catalogue).
      const od = obtainedDate || obtainedFromExpiry(targetDate, entry.validityMonths);
      if (!od) { skipped.push({ reason: "certif détenue sans date d'obtention ni échéance", detail: `ligne ${r + 1} : ${engRaw} / ${certRaw}` }); continue; }
      certs.push({ norm, name: engRaw, partnerId, catalogId: entry.id, obtainedDate: od });
    } else {
      if (!targetDate) { skipped.push({ reason: "assignation sans échéance cible", detail: `ligne ${r + 1} : ${engRaw} / ${certRaw}` }); continue; }
      assigns.push({ norm, name: engRaw, partnerId, catalogId: entry.id, targetDate });
    }
  }
  return { certs, assigns, needConsultants: [...needByNorm.values()], skipped, parsedRows };
}

module.exports = { planCertFileImport, detectHeader, resolvePartnerLabel, resolveCatalogEntry, cellToIso, isHeldStatus };
