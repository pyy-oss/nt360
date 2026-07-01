// RBAC côté front (BUILD_KIT §12). Le front NE fait JAMAIS autorité : il désactive
// l'UI en amont, mais la barrière opposable reste les Security Rules.
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { onAuthStateChanged, type User } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { auth, db, functions } from "./firebase";

export type Level = "none" | "read" | "write";
export type Role = "direction" | "commercial_dir" | "commercial" | "pmo" | "achats" | "lecture";
export type PermMatrix = Record<string, Record<string, Level>>;

type Ctx = {
  user: User | null;
  role: Role | null;
  loading: boolean;
  can: (module: string) => Level;
};

const AuthCtx = createContext<Ctx>({ user: null, role: null, loading: true, can: () => "none" });

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [role, setRole] = useState<Role | null>(null);
  const [matrix, setMatrix] = useState<PermMatrix | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    return onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (u) {
        const token = await u.getIdTokenResult();
        setRole((token.claims.role as Role) ?? null);
        // Matrice lue une fois (cache mémoire) — les summaries et le reste passent par onSnapshot.
        if (!matrix) {
          try {
            const snap = await getDoc(doc(db, "config/permissions"));
            setMatrix((snap.data()?.matrix as PermMatrix) ?? null);
          } catch {
            setMatrix(null);
          }
        }
        // Audit de connexion (via Function, Admin SDK).
        try {
          await httpsCallable(functions, "logLogin")();
        } catch {
          /* non bloquant */
        }
      } else {
        setRole(null);
      }
      setLoading(false);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const can = (module: string): Level => {
    if (!role) return "none";
    if (role === "direction") return "write"; // direction = write partout (cohérent avec les rules)
    return matrix?.[role]?.[module] ?? "none";
  };

  return <AuthCtx.Provider value={{ user, role, loading, can }}>{children}</AuthCtx.Provider>;
}

/** Rôle & état d'authentification courant. */
export function useClaims() {
  const { user, role, loading } = useContext(AuthCtx);
  return { user, role, loading };
}

/** Niveau d'accès (none|read|write) au module donné pour le rôle courant. */
export function useCan(module: string): Level {
  return useContext(AuthCtx).can(module);
}

/** Fonction can(module) stable (à appeler dans des boucles/rendus sans violer les règles des hooks). */
export function useCanFn(): (module: string) => Level {
  return useContext(AuthCtx).can;
}
