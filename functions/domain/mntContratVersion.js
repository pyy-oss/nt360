// Domain PUR — Versionnement opposable des contrats de maintenance (mnt_), Lot 10b (ADR-P24). Aucun I/O.
// On fige une VERSION immuable du sous-ensemble SIGNIFICATIF du contrat (engagements SLA, couverture, quota,
// prix/périodicité) à chaque changement réel, pour que le SLA d'un ticket soit calculé sur la version EN
// VIGUEUR à son ouverture — opposable, indépendant des éditions ultérieures du contrat. Testable sans I/O.
const crypto = require("crypto");

// Sérialisation stable (clés triées récursivement) → le hash ne dépend NI de l'ordre des clés NI de l'ordre
// de saisie. Sans ça, réordonner deux engagements changerait le hash et créerait une fausse version.
function stableStringify(v) {
  if (Array.isArray(v)) return "[" + v.map(stableStringify).join(",") + "]";
  if (v && typeof v === "object") {
    return "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + stableStringify(v[k])).join(",") + "}";
  }
  return JSON.stringify(v);
}

// Sous-ensemble SIGNIFICATIF pour l'opposabilité (les seuls champs qui changent le SLA ou le prix engagé).
// EXCLUS volontairement : client/am/bu/statut/dateDebut/dateFin (cycle de vie, pas opposabilité SLA) →
// éditer le statut ne crée PAS une nouvelle version. Les engagements sont ordonnés canoniquement.
function versionPayload(contrat) {
  const o = contrat || {};
  const engagements = (Array.isArray(o.engagements) ? o.engagements : []).map((e) => ({
    type: String((e && e.type) || ""),
    couverture: String((e && e.couverture) || ""),
    seuilHeures: Math.round(Number(e && e.seuilHeures) || 0),
    quota: e && e.quota != null ? Math.round(Number(e.quota) || 0) : null,
  }));
  engagements.sort((a, b) =>
    (a.type < b.type ? -1 : a.type > b.type ? 1
      : a.couverture < b.couverture ? -1 : a.couverture > b.couverture ? 1
        : a.seuilHeures - b.seuilHeures));
  return {
    engagements,
    montantEngage: Math.round(Number(o.montantEngage) || 0),
    deviseEngage: String(o.deviseEngage || "XOF"),
    echeanceType: String(o.echeanceType || ""),
  };
}

// Empreinte stable du payload significatif.
function versionHash(payload) {
  return crypto.createHash("sha1").update(stableStringify(payload)).digest("hex");
}

// Une nouvelle version doit-elle être créée ? Oui ssi le hash du payload courant diffère du précédent
// (prevHash absent = premier enregistrement → toujours une version 1).
function versionsDiffer(prevHash, payload) {
  return !prevHash || prevHash !== versionHash(payload);
}

module.exports = { versionPayload, versionHash, versionsDiffer, stableStringify };
