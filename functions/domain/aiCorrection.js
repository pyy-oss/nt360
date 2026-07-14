// ASSISTANT IA DU CENTRE DE CORRECTION — partie PURE (spécification des corrections proposables,
// construction du prompt, et NORMALISATION défensive des propositions du modèle). Le pont LLM vit dans
// lib/aiCorrection.js ; l'I/O (Firestore, secret, RBAC) dans index.js. Testable sans SDK.
//
// PRINCIPE DE GOUVERNANCE — « l'IA PROPOSE, l'humain VALIDE » : ce module ne produit JAMAIS d'écriture.
// Il transforme un lot d'anomalies (déjà chargées par le Centre de correction) en PROPOSITIONS de
// correction { ref, action, fields, confidence, rationale }, que le front affiche avec leur justification
// et n'applique QUE sur clic explicite, via les mêmes écritures gouvernées (setInvoiceFp, patchOrder…).
//
// GARDE-FOUS (dans normalizeSuggestions, la vraie barrière — on ne fait JAMAIS confiance à la sortie brute) :
//  1. `ref` doit désigner un enregistrement RÉELLEMENT présent dans le lot (jamais d'hallucination d'un ref).
//  2. `action` doit appartenir à la liste blanche du TYPE d'anomalie (+ « review » toujours permis).
//  3. `fields` est réduit aux SEULS champs autorisés pour cette action ; les autres sont supprimés.
//  4. Aucune INVENTION de montant/date : les champs monétaires et de date ne sont pas auto-applicables —
//     ils forcent l'action « review » (proposition informative, non appliquée d'un clic).
//  5. Un N° FP proposé doit être CANONIQUE (FP/AAAA/N), une année plausible — sinon la proposition tombe.
//  6. confidence bornée [0,1] ; rationale tronquée ; dé-doublonnage par ref (on garde la plus confiante).

const { fpKey, plausibleYear, cleanName, cleanBu } = require("../lib/ids");

// Champs d'un enregistrement transmis au modèle (liste blanche — rien d'interne, rien de superflu). La
// clé stable `ref` est ajoutée à part. Ces champs sont NÉCESSAIRES au raisonnement (rapprochement FP,
// dérivation d'année, inférence client/AM depuis le contexte) ; on n'expose rien au-delà.
const RECORD_FIELDS = [
  "fp", "client", "am", "bu", "amountHt", "amount", "cas", "raf", "yearPo",
  "date", "dueDate", "designation", "numero", "supplier", "bcNumber", "saleTotal", "stageLabel",
];

// Clé stable d'un enregistrement (sert de `ref` dans la proposition). Cohérente avec l'affichage front.
function refOf(rec) {
  const r = rec || {};
  return String(r.id || r.numero || r.fp || r.bcNumber || r.client || "").trim();
}

// Spécification par TYPE d'anomalie : actions AUTO-APPLICABLES autorisées + champs autorisés par action +
// consigne métier passée au modèle. « review » (proposition informative) est toujours implicitement permis.
// On EXCLUT volontairement l'invention de montants/dates (voir garde-fou 4) : pour ces cas, seule « review »
// est proposable — le modèle explique et priorise, l'humain saisit la valeur.
const TYPE_SPECS = {
  factures_orphelines: {
    actions: { set_invoice_fp: ["fp"], generate_from_invoice: [] },
    hint: "Rattache la facture à SA commande en proposant le N° FP CANONIQUE (FP/AAAA/N) le plus probable, " +
      "choisi PARMI les commandes candidates fournies (rapprochement par client + montant + désignation). " +
      "Ne propose « set_invoice_fp » que si un candidat concorde nettement ; si la facture porte déjà un N° FP " +
      "canonique ABSENT du carnet, propose « generate_from_invoice » (créer commande + opp). Sinon « review ».",
  },
  commandes_sans_annee: {
    actions: { patch_order: ["yearPo"] },
    hint: "Déduis l'année de PO de l'année portée par le N° FP (« FP/2024/… » → 2024). Confiance élevée si le " +
      "N° FP est daté, faible sinon (alors « review »).",
  },
  commandes_sans_client: {
    actions: { patch_order: ["client"] },
    hint: "Propose le nom de client à partir de la désignation/affaire et des commandes candidates de même N° FP " +
      "ou même famille. Ne devine pas un client hors contexte : sans indice fiable, « review ».",
  },
  commandes_sans_am: {
    actions: { patch_order: ["am"] },
    hint: "Propose le commercial (AM) UNIQUEMENT s'il est déductible du contexte (autres commandes du même client). " +
      "Sinon « review ». Ne propose jamais un nombre comme AM.",
  },
  am_invalide: {
    actions: { patch_order: ["am"] },
    hint: "L'AM actuel est un NOMBRE (colonne mal mappée). Propose un vrai nom de commercial s'il est déductible du " +
      "contexte (mêmes client/BU), sinon « review » (à ré-importer à la source).",
  },
  opps_gagnees_sans_fp: {
    actions: { patch_opportunity: ["fp"] },
    hint: "Propose le N° FP CANONIQUE de l'opportunité gagnée à partir des commandes candidates (client + montant). " +
      "Sans concordance nette, « review ».",
  },
  bc_sans_fp: {
    actions: { patch_bc_line: ["fp"] },
    hint: "Propose le N° FP CANONIQUE du bon de commande à partir du client/fournisseur et des commandes candidates. " +
      "Sans concordance, « review ».",
  },
  bc_sans_fournisseur: {
    actions: { patch_bc_line: ["supplier"] },
    hint: "Propose le fournisseur s'il est déductible de la description/du N° BC. Sinon « review ».",
  },
  opps_doublons: {
    actions: {},
    hint: "JUGE si les enregistrements du lot sont de VRAIS doublons (même affaire ré-importée) ou des affaires " +
      "distinctes qui se ressemblent. Action « review » uniquement : indique dans la justification lequel semble " +
      "la copie à retirer et pourquoi ; l'arbitrage reste humain.",
  },
  bc_doublons: {
    actions: {},
    hint: "Même consigne que les doublons d'opportunités, appliquée aux lignes BC. Action « review » uniquement.",
  },
};

// Champs jamais auto-applicables (invention de valeur monétaire/date interdite → force « review »).
const NON_APPLICABLE_FIELDS = new Set(["amount", "amountHt", "cas", "raf", "saleTotal", "date", "dueDate", "amountXof"]);

const DEFAULT_HINT =
  "Analyse chaque enregistrement, explique brièvement l'anomalie et PRIORISE la correction (impact). " +
  "Aucune correction automatique n'est sûre ici : action « review » uniquement, avec une justification actionnable.";

const clampConf = (v) => { const n = Number(v); return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0; };

/** Réduit un enregistrement aux champs de la liste blanche + `ref` stable (rien d'interne n'est transmis). */
function redactRecord(rec) {
  const out = { ref: refOf(rec) };
  for (const k of RECORD_FIELDS) {
    const v = rec && rec[k];
    if (v !== undefined && v !== null && v !== "") out[k] = v;
  }
  return out;
}

/**
 * Construit le prompt (system + user) à envoyer au modèle pour un TYPE d'anomalie donné. PURE.
 * @param {string} type          type d'anomalie (clé de dataQuality)
 * @param {object[]} records     enregistrements du lot (déjà chargés par le Centre de correction)
 * @param {{orders?:{fp:string,client?:string,cas?:number}[], label?:string}} [context] contexte de rapprochement
 * @returns {{system:string, user:string, spec:object}}
 */
function buildCorrectionPrompt(type, records, context = {}) {
  const spec = TYPE_SPECS[type] || { actions: {}, hint: DEFAULT_HINT };
  const allowed = Object.keys(spec.actions || {});
  const redacted = (records || []).map(redactRecord).filter((r) => r.ref);
  const orders = (context.orders || []).slice(0, 400).map((o) => ({
    fp: o.fp, client: o.client || "", cas: Number(o.cas) || 0,
  }));

  const system =
    "Tu es l'assistant d'ASSAINISSEMENT des données d'un cockpit ESN (audience : back-office & direction). " +
    "On te confie un lot d'anomalies d'un même type et tu proposes des CORRECTIONS que l'humain validera. " +
    "Tu NE corriges rien toi-même : tu produis des propositions justifiées. Règles absolues : " +
    "n'invente JAMAIS un montant, une date, ni un N° FP absent des candidats ; un N° FP proposé est de forme " +
    "« FP/AAAA/N » ; en cas de doute, propose l'action « review » (proposition informative). Réponds STRICTEMENT en JSON.";

  const actionsDoc = allowed.length
    ? "Actions AUTO-APPLICABLES autorisées pour ce type (avec leurs champs permis) :\n" +
      allowed.map((a) => `  • "${a}" → fields: { ${(spec.actions[a] || []).map((f) => `"${f}"`).join(", ")} }`).join("\n") +
      '\n  • "review" → aucune écriture, justification seulement (toujours permis).'
    : 'Seule l\'action "review" est permise pour ce type (aucune correction automatique sûre).';

  const user =
    `Type d'anomalie : ${type}${context.label ? ` — ${context.label}` : ""}.\n` +
    `Consigne : ${spec.hint || DEFAULT_HINT}\n\n` +
    actionsDoc + "\n\n" +
    "Enregistrements à corriger (JSON, chacun identifié par « ref ») :\n" + JSON.stringify(redacted) + "\n\n" +
    (orders.length ? "Commandes candidates pour le rapprochement (JSON — { fp, client, cas }) :\n" + JSON.stringify(orders) + "\n\n" : "") +
    'Renvoie UNIQUEMENT un objet JSON : ' +
    '{ "suggestions": [ { "ref": "<ref fourni>", "action": "<action autorisée ou review>", ' +
    '"fields": { <champs autorisés> }, "confidence": <réel 0..1>, "rationale": "<justification courte, en français>" } ] }. ' +
    "Une entrée AU PLUS par ref. N'invente aucun ref. Aucune prose hors du JSON.";

  return { system, user, spec };
}

// Valide une valeur de champ selon son nom (retourne la valeur nettoyée, ou undefined si à rejeter).
function sanitizeField(name, value) {
  if (value === undefined || value === null || value === "") return undefined;
  if (NON_APPLICABLE_FIELDS.has(name)) return undefined;         // garde-fou 4 : pas d'invention monétaire/date
  if (name === "fp") { const k = fpKey(value); return k || undefined; } // garde-fou 5 : FP canonique obligatoire
  if (name === "yearPo") { const y = plausibleYear(value); return y || undefined; }
  if (name === "client") { const c = cleanName(value); return c || undefined; }
  if (name === "bu") { const b = cleanBu(value); return b || undefined; }
  if (name === "am") {
    const s = String(value).trim();
    if (!s || /^[\d.,\s]+$/.test(s)) return undefined;           // un AM purement numérique = colonne mal mappée
    return s.slice(0, 80);
  }
  if (name === "supplier") { const s = String(value).trim(); return s ? s.slice(0, 120) : undefined; }
  const s = String(value).trim();
  return s ? s.slice(0, 200) : undefined;
}

/**
 * Normalise DÉFENSIVEMENT les propositions du modèle (garde-fous 1-6). PURE.
 * @param {object} parsed    objet JSON parsé (attendu { suggestions: [...] })
 * @param {object[]} records enregistrements du lot (source de vérité des `ref` autorisés)
 * @param {string} type      type d'anomalie (détermine les actions/champs permis)
 * @returns {{ref,action,fields,confidence,rationale}[]}  propositions sûres, dé-doublonnées par ref
 */
function normalizeSuggestions(parsed, records, type) {
  const spec = TYPE_SPECS[type] || { actions: {} };
  const allowedActions = spec.actions || {};
  const validRefs = new Set((records || []).map(refOf).filter(Boolean));
  const list = Array.isArray(parsed && parsed.suggestions) ? parsed.suggestions : [];
  const byRef = new Map();

  for (const s of list) {
    const ref = String((s && s.ref) || "").trim();
    if (!ref || !validRefs.has(ref)) continue;                    // garde-fou 1 : ref réellement présent

    let action = String((s && s.action) || "").trim();
    if (action !== "review" && !(action in allowedActions)) action = "review"; // garde-fou 2

    const fields = {};
    if (action !== "review") {
      const allowedFields = allowedActions[action] || [];         // garde-fou 3 : champs de la liste blanche
      for (const f of allowedFields) {
        const v = sanitizeField(f, s && s.fields && s.fields[f]);
        if (v !== undefined) fields[f] = v;
      }
      // Une action auto-applicable sans AUCUN champ exploitable retombe en « review » (rien à appliquer).
      const needsField = allowedFields.length > 0;
      if (needsField && Object.keys(fields).length === 0) action = "review";
    }

    const cand = {
      ref, action, fields,
      confidence: clampConf(s && s.confidence),
      rationale: String((s && s.rationale) || "").trim().slice(0, 240),
    };
    // Dé-doublonnage par ref : on garde la proposition la plus confiante (garde-fou 6).
    const prev = byRef.get(ref);
    if (!prev || cand.confidence > prev.confidence) byRef.set(ref, cand);
  }
  // Tri : propositions actionnables d'abord, puis par confiance décroissante (priorisation).
  return [...byRef.values()].sort((a, b) =>
    (Number(b.action !== "review") - Number(a.action !== "review")) || (b.confidence - a.confidence));
}

module.exports = {
  TYPE_SPECS, RECORD_FIELDS, refOf, redactRecord, buildCorrectionPrompt, normalizeSuggestions, sanitizeField,
};
