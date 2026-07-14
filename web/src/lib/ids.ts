// Miroir CLIENT des helpers déterministes serveur (functions/lib/ids.js). DOIT rester aligné :
// le frontal compare des N° FP au format SOURCE (opps/factures) à des N° FP déjà CANONISÉS par
// mergeCommandes côté serveur — sans la même canonicalisation, un FP zero-paddé/espacé différemment
// (« FP/2024/013 » vs « FP/2024/13 ») échappe au rapprochement et fausse les comptes (double-compte
// pipeline, faux « sans commande P&L », etc.).

/** Normalise un N° FP → forme canonique "FP/AAAA/N" (miroir exact de functions/lib/ids.js). */
export function fpKey(v?: string | null): string | null {
  const m = String(v || "").match(/FP\/?\s*(\d{4})(?!\d)\/?\s*(\d+)/i);
  if (!m) return null;
  if (/^0+$/.test(m[2])) return null; // FP factice .../0000
  const seq = String(parseInt(m[2], 10)); // « 013 » → « 13 »
  return `FP/${m[1]}/${seq}`;
}

// Règle « auto-perdue par âge » (miroir de functions/domain/oppLifecycle.js) : une opp LIVE (salesData)
// active depuis ≥ 366 j avec IdC ≤ 90 % est considérée PERDUE par la source → exclue du pipeline actif.
const AGE_LOST_DAYS = 366;
const AGE_LOST_IDC = 0.9;

/** Vrai si l'opportunité est « périmée par âge » (exclue des agrégats pipeline actifs côté serveur). */
export function isAgedLost(o: { source?: string; stage?: number; ageDays?: number | null; probability?: number }): boolean {
  if (!o || o.source !== "salesData") return false;
  const stage = Number(o.stage) || 0;
  if (stage < 1 || stage > 5) return false;
  const age = Number(o.ageDays);
  if (!Number.isFinite(age) || age < AGE_LOST_DAYS) return false;
  return Number(o.probability) <= AGE_LOST_IDC;
}

/** Résolveur de RÉCONCILIATION N° FP (miroir EXACT de functions/lib/ids.js buildFpAliasResolver) : la table
 *  config/fpAliases.map (clé canonique source → N° FP cible P&L) redirige un FP d'opp/facture vers le FP du
 *  P&L, comme le fait le recompute serveur AVANT l'overview. Sans ce miroir, la Vue d'ensemble filtrée ne
 *  reconnaît pas qu'une opp/facture partage le FP d'une commande (double-compte pipeline, rattachement raté).
 *  Canonise l'entrée (fpKey) pour la recherche, renvoie la CIBLE si alias, sinon le FP d'origine INCHANGÉ. */
export function buildFpAliasResolver(map?: Record<string, string> | null): (fp?: string | null) => string | null {
  const m = map && typeof map === "object" ? map : {};
  const hasAny = Object.keys(m).length > 0;
  return (fp) => {
    if (!hasAny || fp == null || fp === "") return fp ?? null;
    const k = fpKey(fp);
    return (k && m[k]) || fp;
  };
}
