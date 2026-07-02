// Filtre transverse (BU / AM / client) — s'applique aux VUES DÉTAILLÉES (listes lisant les
// collections brutes : Opportunités, Commandes, Factures, Fiches). Les agrégats pré-calculés
// (graphes, cockpit) ne sont PAS filtrés côté client — un libellé le précise dans la barre.
import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

export type Filters = { bu: string; am: string; client: string };
export type Dim = "bu" | "am" | "client";

type Ctx = {
  f: Filters;
  set: (p: Partial<Filters>) => void;
  clear: () => void;
  active: boolean;
  /** true si la ligne passe le filtre sur les dimensions supportées par la vue. */
  match: (row: { bu?: string; am?: string; client?: string }, dims?: Dim[]) => boolean;
};

const up = (s?: string) => (s || "").trim().toUpperCase();
const FilterCtx = createContext<Ctx>({ f: { bu: "", am: "", client: "" }, set: () => {}, clear: () => {}, active: false, match: () => true });

export function FilterProvider({ children }: { children: ReactNode }) {
  const [f, setF] = useState<Filters>({ bu: "", am: "", client: "" });
  const value = useMemo<Ctx>(() => ({
    f,
    set: (p) => setF((s) => ({ ...s, ...p })),
    clear: () => setF({ bu: "", am: "", client: "" }),
    active: !!(f.bu || f.am || f.client),
    match: (row, dims = ["bu", "am", "client"]) => {
      if (dims.includes("bu") && f.bu && up(row.bu) !== up(f.bu)) return false;
      if (dims.includes("am") && f.am && up(row.am) !== up(f.am)) return false;
      if (dims.includes("client") && f.client && up(row.client) !== up(f.client)) return false;
      return true;
    },
  }), [f]);
  return <FilterCtx.Provider value={value}>{children}</FilterCtx.Provider>;
}

export const useFilters = () => useContext(FilterCtx);
