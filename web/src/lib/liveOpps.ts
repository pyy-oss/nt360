// Dédup des opportunités LIVE côté front — SOURCE UNIQUE partagée (overviewCalc + OppList/pipeline),
// MIROIR EXACT de domain/liveOpps.js côté serveur (aggregate.js). Sans une source unique, chaque écran
// re-dérivait sa propre assiette et un même FP en double (webhook Odoo + import Excel) était sur-compté
// dans le pondéré/certitudes d'un écran mais pas d'un autre → violation « même métrique = même nombre ».
import { fpKey, isAgedLost } from "./ids";

type OppLike = {
  source?: string;
  fp?: string;
  stale?: boolean;
  probability?: number;
  ageDays?: number;
  updatedAt?: { toMillis?: () => number } | number;
};

const isLiveSource = (o?: OppLike) => !!o && (o.source === "salesData" || o.source === "odoo");
// updatedAt peut être un Timestamp Firestore (toMillis) ou un nombre : on garde le PLUS RÉCENT par FP.
const ts = (o: OppLike) => {
  const u = o.updatedAt;
  return u && typeof (u as { toMillis?: () => number }).toMillis === "function"
    ? (u as { toMillis: () => number }).toMillis()
    : Number(u) || 0;
};

/**
 * Déduplique les opps LIVE de MÊME N° FP canonique (fpKey) en gardant la plus récente (updatedAt),
 * puis masque les opps « saisie » dont le FP est déjà couvert par une opp live.
 * NE TOUCHE PAS aux stale/aged (parité serveur : `liveFps` est calculé AVANT toute exclusion d'âge ;
 * l'appelant applique ensuite son propre filtre stale/isAgedLost selon son besoin).
 */
export function dedupeMaskLiveOpps<T>(opps: T[]): T[] {
  // Générique TRANSPARENT (T non contraint) : on préserve le type exact de l'appelant (Opportunity[]).
  // L'accès aux champs métier passe par un cast local vers OppLike (source/fp/updatedAt).
  const asO = (o: T) => o as unknown as OppLike;
  // 0) Dédup INTER-source LIVE par FP : on retient le doc live le plus récent par FP.
  const bestLiveByFp = new Map<string, T>();
  for (const o of opps) {
    if (!isLiveSource(asO(o))) continue;
    const k = fpKey(asO(o).fp);
    if (!k) continue;
    const prev = bestLiveByFp.get(k);
    if (!prev || ts(asO(o)) >= ts(asO(prev))) bestLiveByFp.set(k, o);
  }
  const deduped = opps.filter((o) => {
    if (!isLiveSource(asO(o))) return true;
    const k = fpKey(asO(o).fp);
    if (!k) return true;
    return bestLiveByFp.get(k) === o;
  });
  // 1) liveFps calculé sur les opps dédupliquées (y compris stale/aged — parité serveur).
  const liveFps = new Set<string>();
  for (const o of deduped) {
    if (!isLiveSource(asO(o))) continue;
    const k = fpKey(asO(o).fp);
    if (k) liveFps.add(k);
  }
  // 2) Masquage inter-source : une opp « saisie » couverte par un FP live est écartée (double-compte).
  return deduped.filter((o) => {
    if (asO(o).source !== "saisie") return true;
    const k = fpKey(asO(o).fp);
    return !(k && liveFps.has(k));
  });
}

// Re-export pour les appelants qui appliquent aussi l'exclusion d'âge (parité).
export { isAgedLost };
