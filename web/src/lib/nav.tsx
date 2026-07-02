// Navigation inter-modules légère (l'app n'a pas de router : les onglets sont un état).
// Permet à un composant (ex. centre d'alertes) d'ouvrir un autre module, si l'utilisateur y a accès.
import { createContext, useContext } from "react";

export type NavFn = (moduleId: string) => void;
export const NavContext = createContext<{ go: NavFn; canGo: (id: string) => boolean }>({
  go: () => {},
  canGo: () => false,
});
export const useNav = () => useContext(NavContext);
