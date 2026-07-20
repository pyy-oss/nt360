// Exposition & lignes de crédit fournisseurs (BUILD_KIT §7, §18.6).
//
// RÈGLE MÉTIER (SOA — relevé de compte fournisseur) : SEULE une FACTURE fournisseur impacte le
// SOLDE du compte. Un bon de commande (BC) est un ENGAGEMENT, pas un débit du compte tant qu'il
// n'est pas facturé. On sépare donc explicitement :
//   • SOLDE du compte = solde d'OUVERTURE (SOA posé à date, saisi) + Σ BC au statut « facturé »
//     (facturés, non encore soldés/payés). C'est ce qui impacte réellement le compte.
//   • ENGAGEMENT = Σ BC NON facturés (a_emettre / émis / livré) + achat des commandes ouvertes non
//     encore couvert par un BC (prévisionnel). Consomme le disponible mais NE bouge PAS le solde.
//   • Disponible = autorisé − solde − engagement.  Exposition = Σ achats prévus par les commandes.
const { fpKey, cleanName } = require("../lib/ids");

// Statuts BC : a_emettre → emis → livre → facture → solde. « facture » = facturé non payé (dans le
// solde) ; « solde » = payé (hors compte) ; les 3 premiers = engagé non facturé.
const INVOICED = "facture";
const PAID = "solde";
const COMMITTED = new Set(["a_emettre", "emis", "livre"]);

/**
 * @param {object[]} orders commandes (avec suppliers[])
 * @param {object[]} bcLines lignes BC (status, amountXof, fp, supplier)
 * @param {object[]} creditLines lignes de crédit saisies {id/_id, authorized, openingBalance, openingDate}
 * @param {object[]} [supplierInvoices] factures fournisseur RÉELLES {supplier, amountXof, ...} — Lot 8 (ADR-P21)
 * @param {object} [opts] { soaFromInvoices, resolveSupplier } : `soaFromInvoices` drapeau (défaut FALSE =
 *   comportement historique) ; `resolveSupplier` résolveur nom brut → clé canonique (alias fournisseur,
 *   ADR-046) — défaut `cleanName` (identité de la clé canonique → SOA byte-identique, non-régression).
 */
function suppliers(orders, bcLines, creditLines, supplierInvoices, opts) {
  supplierInvoices = Array.isArray(supplierInvoices) ? supplierInvoices : [];
  // Clé fournisseur CANONIQUE : `cleanName` par défaut (autorité ADR-P20). Un résolveur d'ALIAS optionnel
  // (config/supplierAliases, ADR-046) fusionne en plus des graphies déterministes ; sans alias il EST
  // `cleanName` → aucun changement de regroupement (invariant de non-régression du SOA, prouvé par les tests).
  const keySup = (opts && typeof opts.resolveSupplier === "function") ? opts.resolveSupplier : cleanName;
  // VÉRITÉ DU COÛT (audit Exécution P0-1, ADR-P21) : quand le drapeau est actif, le SOLDE du compte fournisseur
  // (a.facture) dérive des FACTURES FOURNISSEUR RÉELLES (pièce comptable), et NON plus du statut « facturé » d'un
  // BC posé à la main. Le statut BC « facture » n'impacte alors plus le solde (il est SUPERSEDÉ par la facture) ;
  // les BC engagés (a_emettre/emis/livre) restent l'engagement. Drapeau OFF (défaut) → comportement historique.
  const soaFromInvoices = !!(opts && opts.soaFromInvoices);
  const acc = {}; // name → agrégat par fournisseur
  const get = (name) => (acc[name] = acc[name] || {
    name, expo: 0, open: 0, engagementBc: 0, facture: 0,
    authorized: 0, opening: 0, hasCredit: false, unvalued: false,
  });

  // BC : ventile facturé (→ solde) vs engagé (→ engagement) ; les soldés (payés) sont exclus.
  // bcByKey (FP|fournisseur) = Σ BC NON soldés → sert à NETTER l'achat des commandes déjà bon-de-commandé.
  const bcByKey = {};
  const bcNoFpBySup = {}; // Σ BC NON soldés SANS N° FP renseigné, par fournisseur → repli de netting.
  for (const b of bcLines) {
    if (b.source === "fiche") continue; // achats PLANIFIÉS de fiche (a_emettre) : pas des BC commandés → hors SOA/engagement (parité)
    if (b.status === PAID) continue; // payé → hors compte et hors engagement
    // Clé fournisseur CANONIQUE (cleanName, autorité unique ERP-wide, ADR-P20) : compacte espaces + trim +
    // MAJUSCULES. Sans compaction, un même fournisseur importé « à un espace près » selon la source (ClickUp/
    // fiche vs Odoo/logistics) se scindait en deux dans le SOA — alors que par_ca les fusionne déjà. Aligné.
    const sup = keySup(b.supplier);
    const a = get(sup);
    const amt = b.amountXof || 0;
    // Drapeau ACTIF : le solde vient des factures fournisseur réelles (plus bas) → un BC « facture »/« solde »
    // ne meut plus le solde (superséedé par la pièce). Drapeau OFF : comportement historique (statut BC → solde).
    if (!soaFromInvoices && b.status === INVOICED) a.facture += amt; // facturé non payé → SOLDE
    else if (COMMITTED.has(b.status)) a.engagementBc += amt; // commandé non facturé → ENGAGEMENT
    // BC RÉEL (N° BC émis) non payé mais à montant XOF nul = devise étrangère non convertie : il compte
    // pour 0 → le solde/l'engagement du fournisseur est SOUS-estimé, le disponible SURévalué. On le
    // signale (`unvalued`) pour que l'état ne rassure pas à tort tant que la conversion n'est pas posée.
    if (b.bcNumber && !(amt > 0)) a.unvalued = true;
    const fpk = fpKey(b.fp) || "";
    bcByKey[fpk + "|" + sup] = (bcByKey[fpk + "|" + sup] || 0) + amt;
    if (!fpk) bcNoFpBySup[sup] = (bcNoFpBySup[sup] || 0) + amt; // BC sans FP → pool fournisseur
  }

  // SOLDE = Σ FACTURES FOURNISSEUR RÉELLES (drapeau actif, ADR-P21) : pièce comptable, autorité du solde.
  // Un fournisseur n'ayant qu'une facture (sans BC ni commande) apparaît quand même dans le SOA.
  if (soaFromInvoices) {
    for (const inv of supplierInvoices) {
      const sup = keySup(inv && inv.supplier);
      if (!sup) continue;
      get(sup).facture += Number(inv.amountXof) || 0;
    }
  }

  for (const o of orders) {
    const openOrder = (o.raf || 0) > 0;
    const fp = fpKey(o.fp) || "";
    for (const s of o.suppliers || []) {
      const sup = keySup(s.name); // même autorité canonique (ADR-P20) + alias éventuels (ADR-046)
      const a = get(sup);
      a.expo += s.amount || 0;
      if (openOrder) {
        // Part de l'achat DÉJÀ couverte par un BC (tout statut non soldé) → retirée du prévisionnel
        // (pas de double compte avec l'engagement BC). Priorité au BC du MÊME FP+fournisseur ; le reliquat
        // est netté contre les BC du MÊME fournisseur SANS FP renseigné (repli — cf. audit P0-B : sinon
        // un BC sans FP compte en engagement ET l'achat de la commande compte en open = double compte).
        const k = fp + "|" + sup;
        const covered = Math.min(s.amount || 0, bcByKey[k] || 0);
        bcByKey[k] = (bcByKey[k] || 0) - covered;
        let remaining = (s.amount || 0) - covered;
        const fromNoFp = Math.min(remaining, bcNoFpBySup[sup] || 0);
        bcNoFpBySup[sup] = (bcNoFpBySup[sup] || 0) - fromNoFp;
        remaining -= fromNoFp;
        a.open += remaining;
      }
    }
  }

  // Ligne de crédit saisie : plafond autorisé + solde d'OUVERTURE SOA (posé à date). Rétro-compat :
  // à défaut d'openingBalance, on reprend l'ancien champ `outstanding` comme solde d'ouverture.
  const creditById = {};
  for (const c of creditLines) {
    const id = keySup(c.id || c._id || c.name); // même autorité canonique + alias → appariement stable (ADR-P20/046)
    if (!id) continue;
    creditById[id] = c;
    get(id); // un fournisseur avec ligne de crédit s'affiche même sans BC/commande (solde d'ouverture)
  }
  for (const name of Object.keys(acc)) {
    const c = creditById[name];
    if (c) {
      acc[name].hasCredit = true;
      acc[name].authorized = c.authorized || 0;
      acc[name].opening = c.openingBalance != null ? c.openingBalance : (c.outstanding || 0);
      acc[name].openingDate = c.openingDate || null;
    }
  }

  const bySupplier = Object.values(acc)
    .map((a) => {
      const solde = a.opening + a.facture;        // SOA : ouverture + facturé non payé
      const engagement = a.engagementBc + a.open; // BC non facturés + prévisionnel des commandes
      const disponible = a.authorized - solde - engagement; // <0 = saturation
      const util = a.authorized > 0 ? (solde + engagement) / a.authorized : 0;
      // Sans ligne de crédit saisie (authorized=0), on ne statue pas (évite un faux positif
      // systématique sur les fournisseurs P&L sans creditLines, §18.6).
      let state = a.authorized > 0
        ? (disponible < 0 ? "saturation" : util >= 0.9 ? "tension" : "ok")
        : "non_suivi";
      // Solde/disponible NON FIABLES tant qu'un BC réel n'est pas converti : on ne laisse pas afficher
      // « ok » rassurant (on remonte « indetermine »), sauf si déjà en saturation (état pire, conservé).
      if (a.unvalued && state !== "saturation") state = "indetermine";
      return {
        name: a.name, expo: a.expo, open: a.open, engagement, solde,
        opening: a.opening, facture: a.facture, authorized: a.authorized, openingDate: a.openingDate || null,
        disponible, coverage: disponible, util, state, hasCredit: a.hasCredit, unvalued: a.unvalued,
        // Ligne recommandée : couvrir le solde + l'engagement avec 10 % de marge.
        reco: solde + engagement * 1.1,
        // Rétro-compat : `encours` désigne désormais le SOLDE du compte (facturé), non plus tous les BC.
        encours: solde,
      };
    })
    .sort((x, y) => y.expo - x.expo);

  return {
    totalExpo: bySupplier.reduce((s, x) => s + x.expo, 0),
    openTotal: bySupplier.reduce((s, x) => s + x.open, 0),
    engagementTotal: bySupplier.reduce((s, x) => s + x.engagement, 0),
    soldeTotal: bySupplier.reduce((s, x) => s + x.solde, 0),
    encoursTotal: bySupplier.reduce((s, x) => s + x.solde, 0), // rétro-compat = soldeTotal
    // Listes COMPLÈTES (non tronquées) des états critiques : les alertes doivent voir TOUS les
    // fournisseurs saturés/en tension, y compris à faible exposition (hors du top affiché).
    saturated: bySupplier.filter((x) => x.state === "saturation").map((x) => x.name),
    tension: bySupplier.filter((x) => x.state === "tension").map((x) => x.name),
    // Fournisseurs dont le SOA est INDÉTERMINÉ (BC réel non converti) — à fiabiliser avant décision de crédit.
    indeterminate: bySupplier.filter((x) => x.unvalued).map((x) => x.name),
    // Cap relevé à 500 (ADR-044) : le référentiel Fournisseurs édite les lignes de crédit fournisseur
    // par fournisseur — la liste doit être complète, pas seulement le top exposition. Reste largement
    // sous la limite Firestore d'1 Mo (≈150 o/ligne). Additif : n'affecte pas les agrégats ci-dessus.
    bySupplier: bySupplier.slice(0, 500),
  };
}

// RÉCONCILIATION AMONT (coût) — regroupe le coût RÉEL (factures fournisseur, ADR-P21) par N° d'affaire
// CANONIQUE (fpKey, autorité N° FP : « FP/2026/007 » == « FP/2026/7 »). Pendant symétrique de la Σ facturé
// (aval) déjà rapprochée par fpKey en FP 360°. PUR (aucune I/O) → miroir trivial côté front, testé une fois.
// Les factures sans N° FP sont ignorées (rien à rapprocher à une affaire).
function supplierCostByFp(supplierInvoices) {
  const out = {};
  for (const inv of Array.isArray(supplierInvoices) ? supplierInvoices : []) {
    const k = fpKey(inv && inv.fp) || "";
    if (!k) continue;
    out[k] = (out[k] || 0) + (Number(inv && inv.amountXof) || 0);
  }
  return out;
}

module.exports = { suppliers, supplierCostByFp };
