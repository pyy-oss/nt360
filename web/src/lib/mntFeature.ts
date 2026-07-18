// Module Contrats de maintenance (mnt_) — drapeau de fonctionnalité côté front (ADR-009).
// MIROIR EXACT de functions/domain/mntFeature.js : le module n'est visible que si l'overlay
// config/mntFeature { enabled: true } est présent. Absent ⇒ éteint (l'ERP reste celui d'avant).
export type MntFeature = { enabled?: boolean } | null | undefined;

/** Drapeau du module allumé ? Absent / enabled ≠ true ⇒ éteint. Miroir de isMntEnabled (back). */
export const isMntEnabled = (cfg: MntFeature): boolean => cfg?.enabled === true;

/** Un module portant un `flag` n'est visible que si ce drapeau est allumé ; sans `flag`, toujours
 *  visible (comportement inchangé des modules existants). Générique : `enabledByFlag` mappe chaque
 *  identifiant de drapeau (`"mntFeature"`, `"parFeature"`, …) à son état résolu ; un flag absent de la
 *  table est éteint. Chaque nouveau module gaté ajoute une entrée à la table (App.tsx). Pur → testable. */
export const moduleFlagOn = (flag: string | undefined, enabledByFlag?: Record<string, boolean>): boolean =>
  !flag || enabledByFlag?.[flag] === true;
