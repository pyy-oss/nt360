// Domain PUR — RECOMMANDATIONS CONCRÈTES du Centre de correction. Aucun I/O → testable.
// Complète la DÉTECTION : au-delà de compter les anomalies, on propose une CORRECTION concrète. Deux volets :
//  1. `recommendCorrection` — une valeur chiffrée RECOMMANDÉE + sa BASE, calculée DÉTERMINISTIQUEMENT depuis
//     des données EXISTANTES (jamais inventée : la valeur vient d'un enregistrement rattaché, pas d'un modèle →
//     respecte « n'invente aucune donnée »). Le front pré-remplit le champ ; l'humain enregistre.
//  2. `remediationPlan` — un plan d'assainissement PRIORISÉ (par impact FCFA, sévérité, nombre) : « par où
//     commencer », transformant la liste d'anomalies en feuille de route.
const { fpKey } = require("../lib/ids");

const numOr = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };

/**
 * Recommandation concrète pour un item d'anomalie. `ctx` = { orderByFp: Map<fpKey, {cas, casPnl}>,
 * billedByFp: Map<fpKey, Σ factures> }. Renvoie { field, value, basis } (field=null ⇒ recommandation
 * TEXTUELLE, pas de pré-remplissage) ou null si aucun candidat déterministe. PUR.
 */
function recommendCorrection(type, item, ctx) {
  const orderByFp = (ctx && ctx.orderByFp) || new Map();
  const billedByFp = (ctx && ctx.billedByFp) || new Map();
  const k = fpKey(item && item.fp);
  const order = k ? orderByFp.get(k) : null;
  switch (type) {
    // Fiche affaire sans prix de vente → prix = CAS de la commande rattachée (même N° FP). Champ pré-remplissable.
    case "fiches_sans_vente": {
      const cas = order ? numOr(order.cas) : null;
      return cas && cas > 0 ? { field: "saleTotal", value: cas, basis: `CAS de la commande rattachée (${item.fp})` } : null;
    }
    // Opp active sans montant → montant = CAS de la commande de même N° FP si elle existe. Pré-remplissable.
    case "opps_sans_montant": {
      const cas = order ? numOr(order.cas) : null;
      return cas && cas > 0 ? { field: "amount", value: cas, basis: `CAS de la commande de même N° FP (${item.fp})` } : null;
    }
    // Écart de valorisation → CAS d'origine (casPnl) comme valeur de référence. Édité sur l'écran commandes
    // (pas d'éditeur inline ici) → recommandation TEXTUELLE chiffrée (field null).
    case "ecart_valorisation": {
      const casPnl = order ? numOr(order.casPnl) : null;
      const cas = numOr(item && item.cas);
      if (casPnl && casPnl > 0) return { field: null, value: casPnl, basis: cas != null ? `valeur P&L d'origine = ${Math.round(casPnl).toLocaleString("fr-FR")} (CAS retenu = ${Math.round(cas).toLocaleString("fr-FR")})` : `valeur P&L d'origine = ${Math.round(casPnl).toLocaleString("fr-FR")}` };
      return null;
    }
    // Surfacturation → l'anomalie est un DÉPASSEMENT : Σ factures > CAS. Recommandation textuelle chiffrée.
    case "surfacturation": {
      const billed = k ? numOr(billedByFp.get(k)) : null;
      const cas = numOr(item && item.cas);
      if (billed && billed > 0 && cas != null) {
        const ecart = Math.round(billed - cas);
        return { field: null, value: null, basis: `Σ factures = ${Math.round(billed).toLocaleString("fr-FR")} > CAS = ${Math.round(cas).toLocaleString("fr-FR")} (écart ${ecart.toLocaleString("fr-FR")}) — vérifier une facture en trop, ou relever le CAS` };
      }
      return null;
    }
    default: return null;
  }
}

// Montant représentatif d'un item pour l'impact FCFA (par ordre de pertinence selon le type d'objet).
const amountOf = (it) => Math.abs(numOr(it && (it.cas ?? it.amount ?? it.amountXof ?? it.amountHt)) || 0);
const SEV_RANK = { high: 0, medium: 1, low: 2 };

/**
 * Plan d'assainissement PRIORISÉ. `buckets` = [{ type, label, severity, count, items[] }]. Impact FCFA d'un
 * bucket = montant moyen des items × count (EXTRAPOLÉ quand items est plafonné, pour ne pas sous-estimer les
 * gros volumes). Trie par impact décroissant, puis sévérité, puis nombre. Renvoie l'ordre + le total + la
 * 1ʳᵉ catégorie à traiter (`top`). PUR.
 */
function remediationPlan(buckets) {
  const rows = (buckets || []).map((b) => {
    const items = Array.isArray(b.items) ? b.items : [];
    const sampled = items.reduce((s, it) => s + amountOf(it), 0);
    // Extrapolation honnête : si l'échantillon est plafonné (count > items.length), on projette la moyenne.
    const impact = items.length ? Math.round((sampled / items.length) * (b.count || items.length)) : 0;
    return { type: b.type, label: b.label, severity: b.severity, count: b.count || items.length, impact, estimated: items.length > 0 && (b.count || 0) > items.length };
  }).sort((a, b) => (b.impact - a.impact) || ((SEV_RANK[a.severity] ?? 3) - (SEV_RANK[b.severity] ?? 3)) || (b.count - a.count));
  return {
    rows,
    totalImpact: rows.reduce((s, r) => s + r.impact, 0),
    totalCount: rows.reduce((s, r) => s + r.count, 0),
    top: rows[0] || null,
  };
}

module.exports = { recommendCorrection, remediationPlan };
