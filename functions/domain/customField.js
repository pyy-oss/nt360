// CHAMPS CUSTOM (Lot 7b « niveau Salesforce ») — champs personnalisés d'opportunité DÉFINIS par la
// direction (sans code), façon « custom fields ». Comble l'écart #7 (aucune extensibilité de modèle).
// Les valeurs sont stockées dans une map `custom` sur l'opportunité, VALIDÉES contre les définitions.
//
// Fonctions PURES (aucun I/O) → testables.

const FIELD_TYPES = ["text", "number", "select", "date", "checkbox"];

// Slug de clé : minuscules, alphanumérique + underscore (identifiant stable, sûr en clé Firestore/map).
function slugKey(s) {
  return String(s || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);
}

// Normalise la liste de définitions (éditée par la direction). Rejette les doublons de clé, borne à 30.
function normalizeDefs(input) {
  const out = [];
  const seen = new Set();
  for (const raw of Array.isArray(input) ? input : []) {
    const key = slugKey(raw && (raw.key || raw.label));
    if (!key || seen.has(key)) continue;
    const type = FIELD_TYPES.includes(raw.type) ? raw.type : "text";
    const options = type === "select" && Array.isArray(raw.options)
      ? raw.options.map((o) => String(o).trim()).filter(Boolean).slice(0, 30) : [];
    seen.add(key);
    out.push({ key, label: String(raw.label || key).trim().slice(0, 80), type, options, active: raw.active !== false });
    if (out.length >= 30) break;
  }
  return out;
}

// Filtre + coerce une entrée de valeurs custom contre les définitions ACTIVES. Les clés inconnues ou
// inactives sont ignorées ; les types sont coercés ; un select hors options → null.
function sanitizeCustom(defs, input) {
  const byKey = new Map((defs || []).filter((d) => d.active !== false).map((d) => [d.key, d]));
  const out = {};
  for (const [k, v] of Object.entries(input || {})) {
    const def = byKey.get(k);
    if (!def) continue;
    if (def.type === "number") {
      out[k] = v === "" || v == null ? null : (Number.isFinite(Number(v)) ? Number(v) : null);
    } else if (def.type === "select") {
      const s = String(v == null ? "" : v);
      out[k] = def.options.includes(s) ? s : null;
    } else if (def.type === "date") {
      // Date ISO (YYYY-MM-DD) uniquement ; toute autre forme → null (pas de date « douteuse » stockée).
      const s = String(v == null ? "" : v).trim();
      out[k] = /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
    } else if (def.type === "checkbox") {
      // Booléen strict : true seulement pour true / "true" / 1 / "1" ; tout le reste → false.
      out[k] = v === true || v === "true" || v === 1 || v === "1";
    } else {
      out[k] = String(v == null ? "" : v).slice(0, 500);
    }
  }
  return out;
}

module.exports = { FIELD_TYPES, slugKey, normalizeDefs, sanitizeCustom };
