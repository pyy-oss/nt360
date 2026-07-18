// Module Partenariats & Certifications (par_) — drapeau de fonctionnalité côté front (ADR-P01).
// MIROIR EXACT de functions/domain/parFeature.js : le module n'est visible que si l'overlay
// config/parFeature { enabled: true } est présent. Absent ⇒ éteint (l'ERP reste celui d'avant).
export type ParFeature = { enabled?: boolean } | null | undefined;

/** Drapeau du module allumé ? Absent / enabled ≠ true ⇒ éteint. Miroir de isParEnabled (back). */
export const isParEnabled = (cfg: ParFeature): boolean => cfg?.enabled === true;
