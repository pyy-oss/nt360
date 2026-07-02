import { useEffect, useMemo, useRef, useState } from "react";
import { signOut } from "firebase/auth";
import { LogOut } from "lucide-react";
import { auth } from "./lib/firebase";
import { useClaims, useCanFn } from "./lib/rbac";
import { useDocData } from "./lib/hooks";
import Login from "./components/Login";
import { ErrorBoundary, cx } from "./design/components";
import { MODULES } from "./modules";

function ActiveModule({ mod, period }: { mod: (typeof MODULES)[number]; period: string }) {
  const Comp = mod.Component;
  return <Comp period={period} />;
}

export default function App() {
  const { user, role, loading } = useClaims();
  const can = useCanFn();
  const { data: periods } = useDocData<any>("config/periods");
  const [period, setPeriod] = useState<string>("all");
  const [active, setActive] = useState<string>("overview");

  const available: string[] = useMemo(() => periods?.available || ["all"], [periods]);
  const visible = MODULES.filter((m) => can(m.key) !== "none");
  const current = MODULES.find((m) => m.id === active) || visible[0];
  const allowed = current && can(current.key) !== "none" ? current : visible[0];

  // Amène l'onglet actif dans la zone visible (barre scrollable horizontalement sur mobile).
  const activeTabRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    activeTabRef.current?.scrollIntoView({ inline: "center", block: "nearest" });
  }, [allowed?.id]);

  if (loading) {
    return <div className="min-h-screen grid place-items-center text-muted">Chargement…</div>;
  }
  if (!user) return <Login />;

  return (
    <div className="min-h-screen">
      <div className="mx-auto max-w-[1440px] px-4 md:px-6 pb-16">
        {/* Header */}
        <header className="flex items-center justify-between flex-wrap gap-3 py-4">
          <div className="flex items-center gap-3">
            <div className="grid place-items-center w-9 h-9 rounded-[10px] font-display font-bold text-bg text-lg" style={{ background: "linear-gradient(135deg,#C9A24B,#8E6F2A)" }}>N</div>
            <div>
              <div className="font-display font-bold text-lg leading-none">Pilote Revenu</div>
              <div className="text-[11px] text-muted mt-0.5">Neurones Technologies CI · cockpit P&amp;L + Facturation DF</div>
            </div>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-1.5" role="group" aria-label="Période">
              <span className="text-[11px] uppercase tracking-wider text-faint mr-0.5">Période</span>
              {available.map((p) => (
                <button
                  key={p}
                  onClick={() => setPeriod(p)}
                  aria-pressed={p === period}
                  className={cx("rounded-full border px-3 py-1.5 min-h-[36px] text-xs font-semibold transition-colors",
                    p === period ? "bg-gold border-gold text-bg" : "border-line bg-panel text-muted hover:border-gold/50")}
                >
                  {p === "all" ? "Tout" : p}
                </button>
              ))}
            </div>
            <span className="text-xs text-muted hidden md:inline">{user.email}</span>
            <span className="rounded-md bg-gold/15 text-gold px-2 py-1 text-[11px] font-semibold">{role ?? "sans rôle"}</span>
            <button onClick={() => signOut(auth)} className="btn-ghost !px-2.5 !py-1.5 min-h-[36px]" aria-label="Déconnexion" title="Déconnexion"><LogOut size={16} /></button>
          </div>
        </header>

        {/* Tabs — dégradé de bord pour signaler le débordement horizontal sur mobile */}
        <div className="relative mb-6">
          <nav aria-label="Modules" className="flex gap-1 border-b border-line overflow-x-auto [&::-webkit-scrollbar]:h-0">
            {visible.map((m) => {
              const on = m.id === (allowed?.id);
              const Icon = m.icon;
              return (
                <button
                  key={m.id}
                  ref={on ? activeTabRef : undefined}
                  onClick={() => setActive(m.id)}
                  aria-current={on ? "page" : undefined}
                  className={cx("inline-flex items-center gap-1.5 whitespace-nowrap px-3 py-2.5 text-[13px] font-semibold border-b-2 -mb-px transition-colors",
                    on ? "text-ink border-gold" : "text-muted border-transparent hover:text-ink hover:bg-panel/50 rounded-t-lg")}
                >
                  <Icon size={15} aria-hidden="true" className={on ? "text-gold" : ""} />
                  {m.label}
                </button>
              );
            })}
          </nav>
          <div aria-hidden="true" className="pointer-events-none absolute right-0 top-0 bottom-px w-8 bg-gradient-to-l from-bg to-transparent" />
        </div>

        {/* Content */}
        <main>
          {allowed ? (
            <ErrorBoundary key={allowed.id}>
              <h1 className="font-display text-2xl font-bold mb-4">{allowed.label}</h1>
              <ActiveModule mod={allowed} period={period} />
            </ErrorBoundary>
          ) : (
            <div className="text-muted">Aucun module accessible pour ce profil.</div>
          )}
        </main>

        <footer className="mt-10 pt-4 border-t border-line text-[11px] text-faint flex items-center justify-between flex-wrap gap-2">
          <span>Sources de vérité : P&amp;L + Facturation DF · clé N° FP · base Firestore nt360</span>
          <span className={role ? "text-emerald" : "text-gold"}>● {role ?? "sans rôle"}</span>
        </footer>
      </div>
    </div>
  );
}
