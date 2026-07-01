import { signOut } from "firebase/auth";
import { auth } from "./lib/firebase";
import { useClaims, useCan } from "./lib/rbac";
import Login from "./components/Login";
import { colors, fonts } from "./design/tokens";

// Les 13 modules (parité prototype) arrivent en F4 ; F1 pose l'auth + le RBAC.
const MODULES = [
  "overview", "pipeline", "objectifs", "facturation", "backlog", "prevision",
  "rentabilite", "pnlprojet", "fournisseurs", "bc", "clients", "domaines", "habilitations",
];

function AccessGrid() {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px,1fr))", gap: 8 }}>
      {MODULES.map((m) => (
        <ModuleChip key={m} module={m} />
      ))}
    </div>
  );
}

function ModuleChip({ module }: { module: string }) {
  const level = useCan(module); // none | read | write
  const bg = level === "write" ? colors.emerald : level === "read" ? colors.steel : colors.panel;
  return (
    <div style={{ background: colors.panel, borderRadius: 10, padding: "10px 12px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
      <span style={{ fontSize: 13 }}>{module}</span>
      <span style={{ fontSize: 11, background: bg, color: colors.bg, borderRadius: 6, padding: "2px 6px", fontWeight: 600 }}>
        {level}
      </span>
    </div>
  );
}

export default function App() {
  const { user, role, loading } = useClaims();

  if (loading) {
    return (
      <div style={{ minHeight: "100vh", background: colors.bg, color: colors.ink, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: fonts.body }}>
        Chargement…
      </div>
    );
  }

  if (!user) return <Login />;

  return (
    <div style={{ minHeight: "100vh", background: colors.bg, color: colors.ink, fontFamily: fonts.body, padding: 24 }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
        <h1 style={{ fontFamily: fonts.display, color: colors.gold, margin: 0, fontSize: 22 }}>
          Pilote Revenu NT CI
        </h1>
        <div style={{ display: "flex", gap: 12, alignItems: "center", fontSize: 13 }}>
          <span style={{ opacity: 0.8 }}>{user.email}</span>
          <span style={{ background: colors.gold, color: colors.bg, borderRadius: 6, padding: "2px 8px", fontWeight: 600 }}>
            {role ?? "sans rôle"}
          </span>
          <button
            onClick={() => signOut(auth)}
            style={{ background: "transparent", color: colors.ink, border: `1px solid ${colors.steel}`, borderRadius: 6, padding: "4px 10px", cursor: "pointer" }}
          >
            Déconnexion
          </button>
        </div>
      </header>

      <p style={{ opacity: 0.7, marginTop: 0 }}>
        Socle F1 — Auth &amp; RBAC. Accès par module pour ton rôle (les 13 modules arrivent en F4) :
      </p>
      <AccessGrid />
    </div>
  );
}
