// Hooks de données temps réel (BUILD_KIT §12) : dashboards sur summaries/* (onSnapshot),
// détail à la demande (collections). Offline via la persistance activée dans firebase.ts.
import { useEffect, useState } from "react";
import { collection, doc, onSnapshot, query, type QueryConstraint } from "firebase/firestore";
import { db } from "./firebase";

/** Abonnement temps réel à un document (ex. summaries/overview_2026). */
export function useDocData<T = any>(path: string | null): { data: T | null; loading: boolean } {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!path) {
      setData(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    return onSnapshot(
      doc(db, path),
      (snap) => {
        setData((snap.exists() ? (snap.data() as T) : null));
        setLoading(false);
      },
      () => setLoading(false)
    );
  }, [path]);
  return { data, loading };
}

/** Abonnement temps réel à une collection (détail paginable côté client). */
export function useCollectionData<T = any>(
  name: string,
  constraints: QueryConstraint[] = []
): { rows: T[]; loading: boolean } {
  const [rows, setRows] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  // La clé de dépendance sérialise les contraintes pour un re-abonnement contrôlé.
  const key = name + "|" + constraints.map((c) => (c as any).type ?? "").join(",");
  useEffect(() => {
    setLoading(true);
    return onSnapshot(
      query(collection(db, name), ...constraints),
      (snap) => {
        setRows(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as T[]);
        setLoading(false);
      },
      () => setLoading(false)
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return { rows, loading };
}
