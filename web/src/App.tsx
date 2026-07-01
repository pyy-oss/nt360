import { useMemo, useState } from "react";
import { signOut } from "firebase/auth";
import { auth } from "./lib/firebase";
import { useClaims, useCanFn, type Level } from "./lib/rbac";
import { useDocData } from "./lib/hooks";
import Login from "./components/Login";
import { colors, fonts } from "./design/tokens";
import { ErrorBoundary } from "./design/components";
import { MODULES } from "./modules";

function Nav({ active, onSelect, can }: { active: string; onSelect: (k: string) => void; can: (m: string) => Level }) {
  const visible = MODULES.filter((m) => can(m.key) !== "none");
  return (
    <nav style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 210 }}>
      {visible.map((m) => {
        const on = m.id === active;
        return (
          <button
            key={m.id}
            onClick={() => onSelect(m.id)}
            style={{
              textAlign: "left", padding: "8px 12px", borderRadius: 8, cursor: "pointer",
              border: "none", background: on ? colors.panel : "transparent",
              color: on ? colors.gold : colors.ink, fontSize: 13, fontFamily: fonts.body,
              borderLeft: `3px solid ${on ? colors.gold : "transparent"}`,
            }}
          >
            {m.label}
            <span style={{ float: "right", opacity: 0.4, fontSize: 10 }}>{can(m.key) === "write" ? "W" : "R"}</span>
          </button>
        );
      })}
    </nav>
  );
}

export default function App() {
  const { user, role, loading } = useClaims();
  const can = useCanFn();
  const { data: periods } = useDocData<any>("config/periods");
  const [period, setPeriod] = useState<string>("all");
  const [active, setActive] = useState<string>("overview");

  const available: string[] = useMemo(() => periods?.available || ["all"], [periods]);
  const current = MODULES.find((m) => m.id === active) || MODULES[0];
  const allowed = can(current.key) !== "none" ? current : MODULES.find((m) => can(m.key) !== "none");

  if (loading) {
    return <Centered>Chargement…</Centered>;
  }
  if (!user) return <Login />;

  return (
    <div style={{ minHeight: "100vh", background: colors.bg, color: colors.ink, fontFamily: fonts.body }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "16px 24px", borderBottom: `1px solid ${colors.panel}` }}>
        <h1 style={{ fontFamily: fonts.display, color: colors.gold, margin: 0, fontSize: 20 }}>Pilote Revenu NT CI</h1>
        <div style={{ display: "flex", gap: 12, alignItems: "center", fontSize: 13 }}>
          <label style={{ opacity: 0.7 }}>Période</label>
          <select value={period} onChange={(e) => setPeriod(e.target.value)} style={{ background: colors.panel, color: colors.ink, border: "none", borderRadius: 6, padding: "4px 8px" }}>
            {available.map((p) => <option key={p} value={p}>{p === "all" ? "Tout" : p}</option>)}
          </select>
          <span style={{ opacity: 0.8 }}>{user.email}</span>
          <span style={{ background: colors.gold, color: colors.bg, borderRadius: 6, padding: "2px 8px", fontWeight: 600 }}>{role ?? "sans rôle"}</span>
          <button onClick={() => signOut(auth)} style={{ background: "transparent", color: colors.ink, border: `1px solid ${colors.steel}`, borderRadius: 6, padding: "4px 10px", cursor: "pointer" }}>Déconnexion</button>
        </div>
      </header>

      <div style={{ display: "flex", gap: 24, padding: 24, alignItems: "flex-start" }}>
        <Nav active={allowed?.id || "overview"} onSelect={setActive} can={can} />
        <main style={{ flex: 1, minWidth: 0 }}>
          {allowed ? (
            <ErrorBoundary key={allowed.id}>
              <h2 style={{ fontFamily: fonts.display, marginTop: 0 }}>{allowed.label}</h2>
              {allowed.Component({ period })}
            </ErrorBoundary>
          ) : (
            <div style={{ opacity: 0.6 }}>Aucun module accessible pour ce profil.</div>
          )}
        </main>
      </div>
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div style={{ minHeight: "100vh", background: colors.bg, color: colors.ink, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: fonts.body }}>{children}</div>;
}
