// Filtre transverse (BU / AM / client) — s'applique aux VUES DÉTAILLÉES (listes lisant les
// collections brutes : Opportunités, Commandes, Factures, Fiches). Les agrégats pré-calculés
// (graphes, cockpit) ne sont PAS filtrés côté client — un libellé le précise dans la barre.
import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

export type Filters = { bu: string; am: string; client: string; pm: string };
export type Dim = "bu" | "am" | "client" | "pm";

type Ctx = {
  f: Filters;
  set: (p: Partial<Filters>) => void;
  clear: () => void;
  active: boolean;
  /** true si la ligne passe le filtre sur les dimensions supportées par la vue. */
  match: (row: { bu?: string; am?: string; client?: string; pm?: string | null }, dims?: Dim[]) => boolean;
};

const up = (s?: string | null) => (s || "").trim().toUpperCase();
const EMPTY: Filters = { bu: "", am: "", client: "", pm: "" };

/** Prédicat PUR (testable) : la ligne passe-t-elle le filtre sur les dimensions demandées ?
 *  Comparaison insensible à la casse ; un critère vide n'exclut jamais.
 *  `clientKey` (optionnel) CANONICALISE le nom client des DEUX côtés — indispensable car les OPTIONS
 *  du filtre (summaries/clients_all) portent des clés canoniques (serveur) alors que les lignes brutes
 *  portent le nom d'origine : sans lui, « SOCIETE GENERALE » (option) ne matche jamais « Société
 *  Générale CI » (ligne) → la vue filtrée sous-compte vs le serveur (invariant « même métrique »). */
export function filterMatch(f: Filters, row: { bu?: string; am?: string; client?: string; pm?: string | null }, dims: Dim[] = ["bu", "am", "client", "pm"], clientKey?: (s?: string | null) => string): boolean {
  if (dims.includes("bu") && f.bu && up(row.bu) !== up(f.bu)) return false;
  if (dims.includes("am") && f.am && up(row.am) !== up(f.am)) return false;
  if (dims.includes("client") && f.client) {
    const ck = clientKey || up; // repli : comparaison brute (rétro-compat / avant chargement des alias)
    if (ck(row.client) !== ck(f.client)) return false;
  }
  if (dims.includes("pm") && f.pm && up(row.pm) !== up(f.pm)) return false;
  return true;
}

const FilterCtx = createContext<Ctx>({ f: EMPTY, set: () => {}, clear: () => {}, active: false, match: () => true });

export function FilterProvider({ children }: { children: ReactNode }) {
  const [f, setF] = useState<Filters>(EMPTY);
  const value = useMemo<Ctx>(() => ({
    f,
    set: (p) => setF((s) => ({ ...s, ...p })),
    clear: () => setF(EMPTY),
    active: !!(f.bu || f.am || f.client || f.pm),
    // NB : `match` compare le client BRUT. La canonicalisation (miroir serveur config/clientAliases) est
    // apportée par les vues qui filtrent des collections brutes via `useClientKey()` (lib/clientName), pour
    // NE PAS embarquer clientName dans le chunk d'ENTRÉE (FilterProvider est chargé au démarrage).
    match: (row, dims) => filterMatch(f, row, dims),
  }), [f]);
  return <FilterCtx.Provider value={value}>{children}</FilterCtx.Provider>;
}

export const useFilters = () => useContext(FilterCtx);
