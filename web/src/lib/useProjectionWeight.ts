// Hook ISOLÉ (hors hooks.ts, qui est dans le chunk d'entrée) : n'est importé que par les modules LAZY
// du pipeline, pour ne pas tirer projection.ts dans le bundle d'entrée (budget serré).
import { useMemo } from "react";
import { useDocData } from "./hooks";
import { normalizeTiers, projectionWeight, type ProjectionConfig } from "./projection";

/** Pondéré TIÉRÉ d'une opportunité (poids par palier d'IdC, config/projection) — SOURCE UNIQUE avec les
 *  agrégats serveur. À utiliser partout où l'on affichait le champ linéaire persisté `o.weighted`
 *  (montant × proba), qui divergeait du cockpit (même libellé « pondéré », valeurs sans commune mesure). */
export function useProjectionWeight(): (o: { probability?: number; amount?: number }) => number {
  const { data } = useDocData<ProjectionConfig>("config/projection");
  const tiers = useMemo(() => normalizeTiers(data || undefined), [data]);
  return useMemo(() => (o: { probability?: number; amount?: number }) => projectionWeight(o, tiers), [tiers]);
}
