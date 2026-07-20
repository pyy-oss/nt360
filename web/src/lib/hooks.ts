// Hooks de données temps réel (BUILD_KIT §12) : dashboards sur summaries/* (onSnapshot),
// détail à la demande (collections). Offline via la persistance activée dans firebase.ts.
import { useEffect, useRef, useState } from "react";
import { collection, doc, limit as fbLimit, onSnapshot, query, type QueryConstraint } from "firebase/firestore";
import { db } from "./firebase";
import { useWriteEpoch } from "./activity";

// Borne de SÉCURITÉ des abonnements temps réel non paginés (Lot 12 — scalabilité front). Un onSnapshot
// sans `limit` diffuse la collection ENTIÈRE à chaque client et re-streame à chaque écriture : ça ne passe
// pas à l'échelle quand opportunities/invoices/bcLines grossissent. On plafonne les abonnements qui n'ont
// PAS de limite explicite, et on signale la troncature (jamais de cap SILENCIEUX — l'UI doit le dire).
export const DEFAULT_SUB_CAP = 2000;

// Un abonnement porte-t-il déjà sa propre borne (limit/limitToLast) ? Si oui, on ne la double pas. PUR.
export function subHasLimit(constraints: QueryConstraint[]): boolean {
  return constraints.some((c) => { const t = (c as any).type; return t === "limit" || t === "limitToLast"; });
}

/** RÉACTIVITÉ des vues CALLABLE : rappelle `reload` après chaque mutation réussie de l'app (fini le
 *  rechargement manuel de page). Réservé aux vues qui tiennent leurs données en état local via un
 *  callable (les vues Firestore sont déjà temps-réel). `enabled=false` (ex. données pas encore chargées)
 *  suspend le rafraîchissement. Ne se déclenche PAS au montage — seulement sur une écriture ultérieure. */
export function useReloadOnWrite(reload: () => void, enabled = true): void {
  const epoch = useWriteEpoch();
  const reloadRef = useRef(reload);
  reloadRef.current = reload;
  const seen = useRef(epoch); // époque au montage : on ignore, on ne réagit qu'aux écritures SUIVANTES
  useEffect(() => {
    if (epoch === seen.current) return;
    seen.current = epoch;
    if (enabled) reloadRef.current();
  }, [epoch, enabled]);
}

/** Abonnement temps réel à un document (ex. summaries/overview_2026).
 * Expose `error` pour distinguer un refus de droit / une panne réseau d'un document absent. */
export function useDocData<T = any>(path: string | null): { data: T | null; loading: boolean; error: Error | null } {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  useEffect(() => {
    if (!path) {
      setData(null);
      setLoading(false);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    return onSnapshot(
      doc(db, path),
      (snap) => {
        setData((snap.exists() ? (snap.data() as T) : null));
        setLoading(false);
      },
      (err) => { setError(err); setLoading(false); }
    );
  }, [path]);
  return { data, loading, error };
}

/** Abonnement temps réel à une collection (détail paginable côté client).
 * `queryKey` DOIT refléter la VALEUR des contraintes dynamiques (ex. le N° FP recherché),
 * sinon le hook ne se ré-abonne pas quand la valeur change (bug de recherche FP 360°). */
export function useCollectionData<T = any>(
  name: string | null,
  constraints: QueryConstraint[] = [],
  queryKey: string = ""
): { rows: T[]; loading: boolean; error: Error | null; truncated: boolean } {
  const [rows, setRows] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [truncated, setTruncated] = useState(false);
  const key = (name || "") + "|" + queryKey + "|" + constraints.map((c) => (c as any).type ?? "").join(",");
  useEffect(() => {
    // name falsy = pas d'abonnement (ex. collection réservée non lisible par le rôle) → liste vide.
    if (!name) { setRows([]); setLoading(false); setError(null); setTruncated(false); return; }
    setLoading(true);
    setError(null);
    // Abonnement sans borne explicite → on ajoute le plafond de sécurité (Lot 12). Un abonnement déjà
    // paginé (limit fourni par l'appelant) est laissé tel quel.
    const explicit = subHasLimit(constraints);
    const capped = explicit ? constraints : [...constraints, fbLimit(DEFAULT_SUB_CAP)];
    return onSnapshot(
      query(collection(db, name), ...capped),
      (snap) => {
        setRows(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as T[]);
        // Troncature = plafond atteint sur un abonnement NON paginé par l'appelant → l'UI doit le signaler.
        setTruncated(!explicit && snap.docs.length >= DEFAULT_SUB_CAP);
        setLoading(false);
      },
      (err) => { setError(err); setLoading(false); }
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return { rows, loading, error, truncated };
}
