// FICHE D'AFFAIRE dématérialisée — cœur métier PUR (machine à états 6 étapes + calcul prix de
// revient / marge). Remplace le fichier Excel « fiche d'affaire » : calcule le prix de revient et
// la marge d'une affaire, fait circuler la fiche dans un circuit de validation à 6 étapes avec une
// trace d'audit immuable, et — une fois VALIDÉE — ALIMENTE le P&L de la commande (projectSheets)
// comme CHEMIN ALTERNATIF à l'import du fichier P&L (cf. mergeCommandes : la fiche enrichit une
// ligne P&L existante, jamais de création hors P&L). Aucune I/O → testable en isolation.
const { num, fpKey, cleanName, plausibleYear } = require("../lib/ids");
const { FIXED_PEG } = require("../lib/fx"); // parité fixe légale (EUR 655,957) — MÊME autorité que la conversion BC

// ── Constantes métier ────────────────────────────────────────────────────────
const TYPES_CHARGE = ["Materiel", "Licences", "Support", "Logiciel", "Frais_approche", "Prestation", "Marge_arriere"];
const DEVISES = ["XOF", "USD", "EUR"];
const DEFAULT_SEUIL = 15; // seuil de marge par défaut (%), alerte NON bloquante en dessous.

// Champs financiers CONFIDENTIELS — OMIS (pas null) de la réponse servie au rôle PM (lecture).
// cf. BUSINESS_RULES §6 / api-spec « principe transversal ». Masquage CÔTÉ SERVEUR obligatoire.
const CONFIDENTIAL_KEYS = ["provisions_xof", "autres_frais_financiers_xof", "prix_de_revient_ht", "marge_brute", "pct_marge", "seuil_marge_pct"];

// Circuit de validation à 6 étapes (etape_courante 0..5). Rôles du kit MAPPÉS sur les rôles nt360
// existants (claim nt360Role) : AC→assistante · DC→commercial_dir · DRO→pmo · DGA/CDGDF→direction ·
// PM→lecture. `statut` = état de la fiche EN ATTENTE à cette étape (aligné api-spec).
const CIRCUIT = [
  { etape: 0, code: "AC1",   role: "assistante",     statut: "brouillon",        canReject: false, action: "soumission" },
  { etape: 1, code: "DC",    role: "commercial_dir", statut: "validation_dc",    canReject: true,  action: "validation" },
  { etape: 2, code: "DRO",   role: "pmo",            statut: "validation_dro",   canReject: true,  action: "validation", requiresDc: true },
  { etape: 3, code: "AC2",   role: "assistante",     statut: "retour_ac_bc",     canReject: false, action: "soumission", requiresBc: true },
  { etape: 4, code: "DGA",   role: "direction",      statut: "validation_dga",   canReject: true,  action: "validation" },
  { etape: 5, code: "CDGDF", role: "direction",      statut: "validation_cdgdf", canReject: true,  action: "validation", final: true },
];
const STATUT_VALIDEE = "validee";

const stepDef = (etape) => CIRCUIT[etape] || null;
const roleAllowed = (role, etape) => { const s = stepDef(etape); return !!s && String(role || "") === s.role; };

// ── Calculs (prix de revient / marge) ────────────────────────────────────────
// Taux applicable à une devise (XOF = 1). Tolérant (num()). REPLI parité fixe légale (FIXED_PEG, EUR) quand
// aucun taux n'est saisi dans la fiche — MÊME règle que la conversion BC (lib/fx.toXof) : sans ce repli, une
// ligne devise sans taux valait 0 XOF → coût sous-évalué et marge GONFLÉE en silence (audit thème ①). L'USD
// n'a pas de parité fixe → 0 (« à saisir »), signalé par missing_fx_rate + blocage de validation (stepErrors).
function rateFor(devise, fiche) {
  const d = String(devise || "XOF").toUpperCase();
  if (d === "XOF") return 1;
  const manual = d === "USD" ? num(fiche && fiche.taux_usd) : d === "EUR" ? num(fiche && fiche.taux_eur) : 0;
  if (manual > 0) return manual;         // taux saisi dans la fiche prioritaire
  return FIXED_PEG[d] || 0;              // repli peg légal (EUR) ; sinon 0 = « à saisir »
}

// Montant XOF d'une ligne — DÉRIVÉ (jamais persisté comme seule source de vérité : on garde le montant + la
// devise d'origine pour recalculer si le taux change). Arrondi à l'entier XOF (le FCFA n'a pas de subdivision).
function ligneXof(ligne, fiche) {
  return Math.round(num(ligne && ligne.montant) * rateFor(ligne && ligne.devise, fiche));
}

// Vrai si AU MOINS une ligne est en devise étrangère SANS taux exploitable (ni saisi, ni parité fixe) → son
// montant XOF est 0, le coût est sous-évalué et la marge affichée FAUSSE (gonflée). Sert au flag + au blocage.
function hasMissingFxRate(fiche) {
  const lignes = Array.isArray(fiche && fiche.lignes) ? fiche.lignes : [];
  return lignes.some((l) => { const d = String(l.devise || "XOF").toUpperCase(); return d !== "XOF" && !(rateFor(d, fiche) > 0); });
}

// Prix de revient = Σ(montant×taux) + provisions + autres frais ; marge = vente − revient.
function computeFinancials(fiche) {
  const f = fiche || {};
  const lignes = Array.isArray(f.lignes) ? f.lignes : [];
  const lignesXof = lignes.reduce((s, l) => s + ligneXof(l, f), 0); // déjà arrondi par ligne
  const prixRevient = Math.round(lignesXof + num(f.provisions_xof) + num(f.autres_frais_financiers_xof));
  const prixVente = Math.round(num(f.prix_vente_ht_xof));
  const marge = prixVente - prixRevient;
  const pct = prixVente > 0 ? (marge / prixVente) * 100 : 0;
  const seuil = f.seuil_marge_pct == null ? DEFAULT_SEUIL : num(f.seuil_marge_pct);
  return {
    lignes_xof: lignesXof,
    prix_de_revient_ht: prixRevient,
    prix_vente_ht: prixVente,
    marge_brute: marge,
    pct_marge: pct,
    seuil_marge_pct: seuil,
    below_threshold: prixVente > 0 && pct < seuil, // alerte NON bloquante (vigilance)
    missing_fx_rate: hasMissingFxRate(f),          // devise étrangère sans taux → marge non fiable (audit ①)
  };
}

// ── Validation des champs obligatoires par étape ─────────────────────────────
// Renvoie la liste des erreurs métier AVANT la transition de l'étape courante (vide = OK).
function stepErrors(fiche) {
  const f = fiche || {};
  const etape = f.etape_courante || 0;
  const errors = [];
  if (etape === 0) {
    // Édition AC : entête + au moins une ligne complète. Le N° de BC n'est PAS requis ici.
    for (const [k, label] of [["numero_fp", "N° de FP"], ["client", "Client"], ["affaire", "Affaire"], ["commercial", "Commercial"], ["date_fiche", "Date fiche"], ["editeur_ac", "Éditée par"]]) {
      if (!String(f[k] || "").trim()) errors.push(`${label} obligatoire`);
    }
    if (String(f.numero_fp || "").trim() && !fpKey(f.numero_fp)) errors.push("N° de FP invalide (format FP/AAAA/N attendu)");
    const lignes = Array.isArray(f.lignes) ? f.lignes : [];
    if (lignes.length === 0) errors.push("Au moins une ligne de commande fournisseur requise");
    lignes.forEach((l, i) => {
      if (!String(l.description || "").trim()) errors.push(`Ligne ${i + 1} : description obligatoire`);
      if (!String(l.fournisseur || "").trim()) errors.push(`Ligne ${i + 1} : fournisseur obligatoire`);
      if (!(num(l.montant) > 0)) errors.push(`Ligne ${i + 1} : montant > 0 obligatoire`);
      // Devise étrangère non convertible (pas de taux saisi ni de parité fixe) → BLOQUE la validation : une
      // fiche à coût sous-évalué ne doit pas alimenter le P&L avec une marge gonflée (audit thème ①).
      const dv = String(l.devise || "XOF").toUpperCase();
      if (dv !== "XOF" && !(rateFor(dv, f) > 0)) errors.push(`Ligne ${i + 1} : taux de change ${dv} manquant (montant non convertible en XOF → marge faussée)`);
    });
  } else if (etape === 2) {
    // DRO définit le N° de DC avant de valider.
    if (!String(f.numero_dc || "").trim()) errors.push("N° de DC obligatoire (défini par le DRO)");
  } else if (etape === 3) {
    // AC renseigne TOUS les N° de BC avant de transmettre au DGA.
    const lignes = Array.isArray(f.lignes) ? f.lignes : [];
    lignes.forEach((l, i) => { if (!String(l.numero_bc || "").trim()) errors.push(`Ligne ${i + 1} : N° de BC obligatoire`); });
  }
  return errors;
}

// ── Journal d'audit (append-only) ────────────────────────────────────────────
function makeEvent(step, typeAction, actor, commentaire, nowMs, startedMs) {
  return {
    etape_code: step.code,
    type_action: typeAction,
    acteur_id: (actor && actor.id) || null,
    acteur_nom: (actor && actor.name) || "",
    role: (actor && actor.role) || "",
    commentaire: commentaire || null,
    duree_etape_s: startedMs ? Math.max(0, Math.round((num(nowMs) - startedMs) / 1000)) : null,
    horodatage_ms: num(nowMs),
  };
}

// ── Transitions (machine à états) ────────────────────────────────────────────
// Chaque transition est PURE : renvoie { ok, fiche, event } ou { ok:false, error|errors }.
// L'appelant (callable) persiste `fiche` et APPEND `event` au journal, puis passe nowMs = Date.now().

// Fait avancer la fiche à l'étape suivante (soumission AC ou validation d'un valideur).
// opts : { commentaire?, nowMs, numero_dc? } — numero_dc n'est appliqué qu'à l'étape 2 (DRO).
function advance(fiche, actor, opts) {
  const f = fiche || {};
  const o = opts || {};
  const etape = f.etape_courante || 0;
  const step = stepDef(etape);
  if (!step) return { ok: false, error: "étape inconnue" };
  if (f.terminee) return { ok: false, error: "fiche validée — verrouillée en écriture" };
  if (!roleAllowed(actor && actor.role, etape)) return { ok: false, error: `action réservée au rôle « ${step.role} » à cette étape` };
  // Le DRO pose le N° de DC au moment de valider l'étape 2 — seul endroit où ce champ est éditable.
  const draft = { ...f };
  if (step.requiresDc && o.numero_dc != null) draft.numero_dc = String(o.numero_dc).trim();
  const errors = stepErrors(draft);
  if (errors.length) return { ok: false, errors };
  const nowMs = num(o.nowMs);
  const event = makeEvent(step, step.action, actor, o.commentaire, nowMs, f.etape_started_ms);
  const done = !!step.final;
  const next = done ? etape : etape + 1;
  const nextStep = done ? null : stepDef(next);
  const out = {
    ...draft,
    etape_courante: next,
    statut: done ? STATUT_VALIDEE : nextStep.statut,
    terminee: done,
    etape_started_ms: nowMs,
    updatedAt: nowMs,
  };
  return { ok: true, fiche: out, event };
}

// Rejette la fiche à l'étape courante (étapes de validation uniquement — pas 0 ni 3).
// Exige un commentaire (motif). Réinitialise N° de DC + tous les N° de BC, renvoie en édition AC.
function reject(fiche, actor, opts) {
  const f = fiche || {};
  const o = opts || {};
  const etape = f.etape_courante || 0;
  const step = stepDef(etape);
  if (!step) return { ok: false, error: "étape inconnue" };
  if (f.terminee) return { ok: false, error: "fiche validée — verrouillée en écriture" };
  if (!step.canReject) return { ok: false, error: "aucun rejet possible à cette étape (étape de saisie)" };
  if (!roleAllowed(actor && actor.role, etape)) return { ok: false, error: `rejet réservé au rôle « ${step.role} » à cette étape` };
  const commentaire = String(o.commentaire || "").trim();
  if (!commentaire) return { ok: false, error: "commentaire (motif de rejet) obligatoire" };
  const nowMs = num(o.nowMs);
  const event = makeEvent(step, "rejet", actor, commentaire, nowMs, f.etape_started_ms);
  // Les données ayant motivé le rejet ont pu changer → on vide N° de DC + tous les N° de BC.
  const lignes = (Array.isArray(f.lignes) ? f.lignes : []).map((l) => ({ ...l, numero_bc: null }));
  const out = {
    ...f,
    lignes,
    numero_dc: null,
    etape_courante: 0,
    statut: "brouillon",
    terminee: false,
    etape_started_ms: nowMs,
    updatedAt: nowMs,
  };
  return { ok: true, fiche: out, event };
}

// ── Édition (verrouillage des champs par étape / rôle) ───────────────────────
// Applique un patch en n'autorisant QUE les champs éditables à l'étape courante par le rôle acteur
// (verrou serveur, cf. api-spec PUT). Étape 0 (AC) : tout l'entête + lignes, sauf N° de DC / N° de BC.
// Étape 2 (DRO) : N° de DC uniquement. Étape 3 (AC) : N° de BC des lignes uniquement.
// { ok, fiche } ou { ok:false, error }.
function applyEdit(fiche, patch, role) {
  const f = fiche || {};
  if (f.terminee) return { ok: false, error: "fiche validée — verrouillée en écriture" };
  const etape = f.etape_courante || 0;
  const step = stepDef(etape);
  if (!step) return { ok: false, error: "étape inconnue" };
  if (String(role || "") !== step.role) return { ok: false, error: `édition réservée au rôle « ${step.role} » à cette étape` };
  const p = patch || {};
  if (etape === 0) {
    // L'AC édite l'entête + les lignes ; le N° de DC (DRO) et les N° de BC (étape 3) restent hors de
    // portée. On re-normalise depuis la fiche fusionnée puis on RESTAURE les champs de workflow + DC.
    const norm = normalizeFiche({ ...f, ...p });
    return { ok: true, fiche: {
      ...norm,
      lignes: norm.lignes.map((l) => ({ ...l, numero_bc: null })), // BC pas encore connus à l'édition
      numero_dc: f.numero_dc || null, // jamais éditable par l'AC
      statut: f.statut, etape_courante: f.etape_courante, terminee: f.terminee, etape_started_ms: f.etape_started_ms,
    } };
  }
  if (etape === 2) {
    if (!("numero_dc" in p)) return { ok: false, error: "seul le N° de DC est éditable à cette étape" };
    return { ok: true, fiche: { ...f, numero_dc: String(p.numero_dc || "").trim() || null } };
  }
  if (etape === 3) {
    // Patch = { lignes: [{ id|ordre, numero_bc }] } — uniquement le N° de BC ligne à ligne.
    const updates = Array.isArray(p.lignes) ? p.lignes : [];
    const byKey = new Map(updates.map((u) => [String(u.id != null ? u.id : u.ordre), String(u.numero_bc || "").trim() || null]));
    const lignes = (Array.isArray(f.lignes) ? f.lignes : []).map((l, i) => {
      const k1 = l.id != null ? String(l.id) : null;
      const k2 = String(l.ordre != null ? l.ordre : i);
      const bc = k1 != null && byKey.has(k1) ? byKey.get(k1) : byKey.has(k2) ? byKey.get(k2) : l.numero_bc;
      return { ...l, numero_bc: bc };
    });
    return { ok: true, fiche: { ...f, lignes } };
  }
  return { ok: false, error: "aucun champ éditable à cette étape (fiche en attente de validation)" };
}

// ── Présentation (masquage PM côté serveur) ──────────────────────────────────
// Le PM (rôle lecture) — et plus généralement TOUT rôle sans droit de voir la marge — ne reçoit
// JAMAIS les champs confidentiels : on les OMET du payload (jamais avec une valeur null — ils
// transiteraient sur le réseau). Par défaut, seul `lecture` est masqué ; l'appelant peut passer
// `canSeeMargin` explicite (dérivé de la matrice `rentabilite`) pour masquer aussi les autres rôles
// non habilités (commercial, achats…). Les rôles habilités reçoivent la fiche complète + agrégats.
function presentFor(fiche, role, canSeeMargin) {
  const f = fiche || {};
  const see = canSeeMargin === undefined ? String(role || "") !== "lecture" : !!canSeeMargin;
  if (!see) {
    const { provisions_xof, autres_frais_financiers_xof, seuil_marge_pct, ...rest } = f;
    return { ...rest, financials: null, pmMasked: true };
  }
  return { ...f, financials: computeFinancials(f), pmMasked: false };
}

// ── Alimentation du P&L (chemin alternatif à l'import Excel) ──────────────────
// Une fois la fiche VALIDÉE, projette une ligne de type `projectSheets` consommable par
// mergeCommandes (enrichit une ligne P&L existante, ne crée jamais de commande fantôme). La
// vente est publique (projectSheets) ; coût/marge sont confidentiels (projectSheetsMargin, gated
// rentabilité). Renvoie null si non finalisée ou FP illisible.
function toProjectSheet(fiche) {
  const f = fiche || {};
  const fp = fpKey(f.numero_fp);
  if (!fp || !f.terminee) return null;
  const fin = computeFinancials(f);
  return {
    fp,
    client: cleanName(f.client),
    affaire: String(f.affaire || "").trim(),
    commercial: cleanName(f.commercial),
    saleTotal: fin.prix_vente_ht,      // → projectSheets (public)
    costTotal: fin.prix_de_revient_ht, // → projectSheetsMargin (confidentiel)
    margin: fin.marge_brute,           // → projectSheetsMargin
    marginPct: fin.pct_marge,          // → projectSheetsMargin
    source: "fiche_affaire",
  };
}

// Extrait les lignes fournisseur en lignes BC canoniques (rapprochement logistics↔fiche via bcKey).
function toBcLines(fiche) {
  const f = fiche || {};
  const fp = fpKey(f.numero_fp);
  if (!fp) return [];
  return (Array.isArray(f.lignes) ? f.lignes : []).map((l) => ({
    fp,
    bcNumber: String(l.numero_bc || "").trim() || null,
    supplier: cleanName(l.fournisseur),
    description: String(l.description || "").trim(),
    typeCharge: l.type_charge || null,
    devise: String(l.devise || "XOF").toUpperCase(),
    montant: num(l.montant),
    amountXof: ligneXof(l, f),
    source: "fiche",
  }));
}

// ── Normalisation (création / édition) ───────────────────────────────────────
// Coerce les types (num tolérant, lignes en tableau, défauts) sans forcer la casse des libellés
// (canonicalisés au moment du merge, pas au stockage — on garde la saisie fidèle).
function normalizeFiche(input) {
  const f = input || {};
  const lignes = (Array.isArray(f.lignes) ? f.lignes : []).map((l, i) => ({
    id: l.id || null,
    description: String(l.description || "").trim(),
    fournisseur: String(l.fournisseur || "").trim(),
    type_charge: TYPES_CHARGE.includes(l.type_charge) ? l.type_charge : "Prestation",
    devise: DEVISES.includes(String(l.devise || "").toUpperCase()) ? String(l.devise).toUpperCase() : "XOF",
    montant: num(l.montant),
    numero_bc: String(l.numero_bc || "").trim() || null,
    ordre: l.ordre != null ? Number(l.ordre) : i,
  }));
  return {
    numero_fp: String(f.numero_fp || "").trim(),
    numero_dc: String(f.numero_dc || "").trim() || null,
    client: String(f.client || "").trim(),
    affaire: String(f.affaire || "").trim(),
    commercial: String(f.commercial || "").trim(),
    po_client_ref: String(f.po_client_ref || "").trim() || null,
    po_client_date: f.po_client_date || null,
    date_fiche: f.date_fiche || null,
    editeur_ac: String(f.editeur_ac || "").trim(),
    taux_usd: num(f.taux_usd),
    taux_eur: num(f.taux_eur),
    seuil_marge_pct: f.seuil_marge_pct == null ? DEFAULT_SEUIL : num(f.seuil_marge_pct),
    provisions_xof: num(f.provisions_xof),
    autres_frais_financiers_xof: num(f.autres_frais_financiers_xof),
    prix_vente_ht_xof: num(f.prix_vente_ht_xof),
    memo: f.memo != null ? String(f.memo) : null,
    lignes,
    statut: f.statut || "brouillon",
    etape_courante: f.etape_courante || 0,
    terminee: !!f.terminee,
  };
}

module.exports = {
  CIRCUIT, TYPES_CHARGE, DEVISES, DEFAULT_SEUIL, CONFIDENTIAL_KEYS, STATUT_VALIDEE,
  stepDef, roleAllowed, rateFor, ligneXof, computeFinancials, stepErrors,
  advance, reject, applyEdit, presentFor, toProjectSheet, toBcLines, normalizeFiche,
};
