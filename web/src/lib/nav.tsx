// Navigation inter-modules légère (l'app n'a pas de router : les onglets sont un état).
// Permet à un composant (ex. centre d'alertes, cellule FP, anomalie) d'ouvrir un autre module,
// si l'utilisateur y a accès, en transportant une INTENTION (filtre à pré-appliquer, segment à
// pré-sélectionner, N° FP à ouvrir). Le module cible consomme l'intention à l'affichage.
import { createContext, useContext } from "react";

/** Intention de navigation transportée par `go(id, intent)`. Tous les champs sont optionnels. */
export type NavIntent = {
  /** Filtre transverse à pré-appliquer (BU / AM / client) sur la vue liste cible. */
  filter?: { bu?: string; am?: string; client?: string };
  /** Segment/onglet interne à pré-sélectionner (ex. « en retard » sur Exécution BC). */
  segment?: string;
  /** N° FP à ouvrir directement (FP 360°). */
  fp?: string;
  /** Recherche à pré-remplir sur la liste cible (remédiation guidée : pré-filtre sur la ligne à corriger). */
  search?: string;
};
export type NavFn = (moduleId: string, intent?: NavIntent) => void;
export const NavContext = createContext<{ go: NavFn; canGo: (id: string) => boolean; intent: NavIntent | null }>({
  go: () => {},
  canGo: () => false,
  intent: null,
});
export const useNav = () => useContext(NavContext);
