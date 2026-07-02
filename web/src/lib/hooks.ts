// Hooks de données temps réel (BUILD_KIT §12) : dashboards sur summaries/* (onSnapshot),
// détail à la demande (collections). Offline via la persistance activée dans firebase.ts.
import { useEffect, useState } from "react";
import { collection, doc, onSnapshot, query, type QueryConstraint } from "firebase/firestore";
import { db } from "./firebase";

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
  name: string,
  constraints: QueryConstraint[] = [],
  queryKey: string = ""
): { rows: T[]; loading: boolean; error: Error | null } {
  const [rows, setRows] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const key = name + "|" + queryKey + "|" + constraints.map((c) => (c as any).type ?? "").join(",");
  useEffect(() => {
    setLoading(true);
    setError(null);
    return onSnapshot(
      query(collection(db, name), ...constraints),
      (snap) => {
        setRows(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as T[]);
        setLoading(false);
      },
      (err) => { setError(err); setLoading(false); }
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return { rows, loading, error };
}
