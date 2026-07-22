// Fusion des OBJECTIFS annuels (doc gaté RBAC `summaries/atterrissageObjectifs_{fy}`) par-dessus le doc
// public `summaries/atterrissage_{fy}` — SOURCE UNIQUE partagée par Vue d'ensemble, Bilan CODIR et
// Cockpit commercial. Le recompute PURGE volontairement objectif/objectifCaf/… du doc public (isolation
// RBAC) et les isole dans le doc gaté ; chaque écran DOIT les re-fusionner pour afficher la cible.
// Un écran qui oubliait cette fusion (CODIR) montrait objectifCaf=0 → tout son suivi d'objectif faux,
// en divergence des autres écrans (audit métier). Fusion PROFONDE de `next` (garde le report public).
// Un rôle sans droit « objectifs » reçoit attObj=null → la cible se dégrade proprement en « — ».

/**
 * @param base doc public `summaries/atterrissage_{fy}` (sans les objectifs) — ou null pendant le chargement
 * @param obj  doc gaté `summaries/atterrissageObjectifs_{fy}` (les objectifs) — ou null si non autorisé
 * @returns l'atterrissage complet (base + objectifs re-fusionnés), ou null si base absent
 */
export function mergeAtterrissageObjectifs<
  B extends { next?: Record<string, unknown> } | null | undefined,
  O extends { next?: Record<string, unknown> } | null | undefined,
>(base: B, obj: O): B {
  if (!base) return base;
  return {
    ...base,
    ...(obj || {}),
    next: { ...(base.next || {}), ...((obj && obj.next) || {}) },
  } as B;
}
