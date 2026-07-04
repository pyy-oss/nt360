// Résolution PURE du niveau d'accès (sans dépendance Firebase → testable).
// direction = write partout (cohérent avec les Security Rules) ; sinon, valeur de la matrice, none par défaut.
export type Level = "none" | "read" | "write";

export function resolveLevel(
  role: string | null | undefined,
  matrix: Record<string, Record<string, Level>> | null | undefined,
  module: string,
): Level {
  if (!role) return "none";
  if (role === "direction") return "write";
  return matrix?.[role]?.[module] ?? "none";
}
