// Seuils & pondérations ÉDITORIAUX centralisés (source unique côté client).
//
// Ce sont des hypothèses de pilotage — pas des faits — regroupées ici pour être lisibles, testées
// et modifiables en un seul endroit (fin de la dispersion de « nombres magiques » dans les modules).
//
// ⚠️ CONTRAT SERVEUR ↔ CLIENT : ces valeurs DOIVENT rester alignées avec le serveur, qui reste la
// source de vérité des agrégats. En cas de changement, mettre à jour EN MÊME TEMPS :
//   • pondération de projection : functions/domain/chaine.js  (projectionWeight, CONF_*)
//   • défauts d'alerte         : functions/domain/alerts.js   (ALERT_DEFAULTS)
// Le test web thresholds.test.ts fige ces valeurs pour détecter une dérive accidentelle.

/** Paliers de « certitude » (IdC) → pondération de la projection (miroir de projectionWeight). */
export const PROJ = {
  FULL: 0.9,   // ≥ 90 % ⇒ quasi-certitude, comptée à 100 %
  T2: 0.7,     // [70 %, 90 %[
  T3: 0.5,     // [50 %, 70 %[
  W_FULL: 1,   // poids du palier « certain »
  W_T2: 0.2,   // poids du palier 70–90
  W_T3: 0.1,   // poids du palier 50–70
} as const;

/** Seuils couleur %MB (marge brute) : < LOW = alerte, < OK = à surveiller, ≥ OK = sain. */
export const MARGIN = { LOW: 0.1, OK: 0.2 } as const;

/** Part de RAF « dérivé » (CAS − facturé) au-delà de laquelle le backlog est jugé surévalué. */
export const DERIVE_SUSPECT_PCT = 0.05;

/** Fiabilité de la prévision de décaissement (complétude ETA) : ≥ GOOD = fiable, ≥ FAIR = moyen. */
export const FIAB = { GOOD: 0.8, FAIR: 0.5 } as const;

/** Score de complétude des données (Qualité) : ≥ GOOD = propre, ≥ FAIR = à surveiller. */
export const QUALITY = { GOOD: 0.9, FAIR: 0.7 } as const;
