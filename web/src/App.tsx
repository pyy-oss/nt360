import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { signOut } from "firebase/auth";
import { LogOut, Sun, Moon } from "lucide-react";
import { auth } from "./lib/firebase";
import { currentTheme, toggleTheme, type Theme } from "./lib/theme";
import { useClaims, useCanFn } from "./lib/rbac";
import { useDocData } from "./lib/hooks";
import Login from "./components/Login";
import { ErrorBoundary, KpiSkeletons, CardSkeleton, cx } from "./design/components";
import { NavContext, useNav, type NavIntent } from "./lib/nav";
import { FilterProvider, useFilters } from "./lib/filters";
import { FilterBar, FreshnessGuard } from "./modules/_shared";
import { MODULES, GROUPS } from "./modules";

function ActiveModule({ mod, period }: { mod: (typeof MODULES)[number]; period: string }) {
  const Comp = mod.Component;
  return <Comp period={period} />;
}

// Pont Nav → Filtre : quand une navigation porte une intention `filter`, l'applique au filtre
// transverse (le FilterProvider est un enfant du NavProvider, donc ce pont vit dans les deux).
function NavFilterBridge() {
  const { intent } = useNav();
  const { set } = useFilters();
  useEffect(() => { if (intent?.filter) set(intent.filter); }, [intent]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

export default function App() {
  const { user, role, loading } = useClaims();
  const can = useCanFn();
  const { data: periods } = useDocData<any>("config/periods");
  const [period, setPeriod] = useState<string>("all");
  const [active, setActive] = useState<string>("overview");
  // Intention de navigation courante (filtre / segment / FP à pré-appliquer par le module cible).
  // Remise à zéro sur toute navigation MANUELLE (clic onglet/domaine) pour ne pas rejouer un
  // contexte périmé ; posée par `go(id, intent)` lors d'un drill-through.
  const [intent, setIntent] = useState<NavIntent | null>(null);
  const openManual = (id: string) => { setActive(id); setIntent(null); };
  const [theme, setTheme] = useState<Theme>(() => currentTheme());

  const available: string[] = useMemo(() => periods?.available || ["all"], [periods]);
  const visible = useMemo(() => MODULES.filter((m) => can(m.key) !== "none"), [can]);
  const current = MODULES.find((m) => m.id === active) || visible[0];
  const allowed = current && can(current.key) !== "none" ? current : visible[0];

  // Navigation à 2 niveaux : domaines (groupes) → onglets. On n'affiche qu'un groupe
  // s'il contient au moins un module visible pour le profil courant.
  const groups = useMemo(() => {
    const visibleIdsSet = new Set(visible.map((m) => m.id));
    return GROUPS
      .map((g) => ({
        label: g.label,
        mods: g.ids.map((id) => MODULES.find((m) => m.id === id)).filter((m): m is (typeof MODULES)[number] => !!m && visibleIdsSet.has(m.id)),
      }))
      .filter((g) => g.mods.length > 0);
  }, [visible]);
  // Groupe actif = celui qui contient le module affiché (repli sur le 1er groupe).
  const activeGroup = groups.find((g) => g.mods.some((m) => m.id === allowed?.id)) || groups[0];

  // Navigation inter-modules (centre d'alertes → module concerné), limitée aux modules visibles.
  const visibleIds = useMemo(() => new Set(visible.map((m) => m.id)), [visible]);
  const nav = useMemo(() => ({
    canGo: (id: string) => visibleIds.has(id),
    go: (id: string, it?: NavIntent) => { if (visibleIds.has(id)) { setActive(id); setIntent(it ?? null); } },
    intent,
  }), [visibleIds, intent]);

  // Au lancement : sélectionner par défaut l'année fiscale en cours (si l'utilisateur
  // n'a pas encore choisi de période et qu'elle est disponible). Ne surcharge pas un choix manuel.
  const userPickedPeriod = useRef(false);
  useEffect(() => {
    const fy = periods?.currentFy ? String(periods.currentFy) : null;
    if (!userPickedPeriod.current && fy && available.includes(fy)) setPeriod(fy);
  }, [periods?.currentFy, available]);

  // Amène l'onglet actif dans la zone visible (barre scrollable horizontalement sur mobile).
  const activeTabRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    activeTabRef.current?.scrollIntoView({ inline: "center", block: "nearest" });
  }, [allowed?.id]);

  // Accessibilité SPA (WCAG 2.4.3) : au changement de module (onglet OU drill-through), déplacer le
  // focus sur la zone de contenu — le lecteur d'écran annonce la nouvelle vue et l'utilisateur clavier
  // repart du contenu sans retraverser la navigation. `preventScroll` : ne perturbe pas le défilement ;
  // focus programmatique ⇒ pas d'anneau :focus-visible pour la souris. On saute le tout premier rendu.
  const mainRef = useRef<HTMLElement | null>(null);
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) { firstRender.current = false; return; }
    mainRef.current?.focus({ preventScroll: true });
  }, [allowed?.id]);

  if (loading) {
    return <div className="min-h-screen grid place-items-center text-muted">Chargement…</div>;
  }
  if (!user) return <Login />;

  return (
    <NavContext.Provider value={nav}>
    <FilterProvider>
    <NavFilterBridge />
    <div className="min-h-screen">
      {/* Lien d'évitement (WCAG 2.4.1) : caché jusqu'au focus clavier, saute la navigation → contenu. */}
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:top-2 focus:left-2 focus:rounded-lg focus:bg-gold focus:text-bg focus:px-3 focus:py-2 focus:text-sm focus:font-semibold">Aller au contenu</a>
      <div className="mx-auto max-w-[1440px] px-4 md:px-6 pb-16">
        {/* Header */}
        <header className="flex items-center justify-between flex-wrap gap-3 py-3 sm:py-4">
          <div className="flex items-center gap-3">
            <div className="grid place-items-center w-9 h-9 rounded-[10px] font-display font-bold text-bg text-lg" style={{ background: "linear-gradient(135deg,#C9A24B,#8E6F2A)" }}>N</div>
            <div>
              <div className="font-display font-bold text-lg leading-none">Neurones 360</div>
              <div className="text-[11px] text-muted mt-0.5 hidden sm:block">Neurones Technologies CI · cockpit P&amp;L + Facturation DF</div>
            </div>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-1.5 flex-wrap" role="group" aria-label="Période">
              <span className="text-[11px] uppercase tracking-wider text-faint mr-0.5">Période</span>
              {available.map((p) => (
                <button
                  key={p}
                  onClick={() => { userPickedPeriod.current = true; setPeriod(p); }}
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
            <button onClick={() => setTheme(toggleTheme())} className="btn-ghost !px-2.5 !py-1.5 min-h-[36px]" aria-label={theme === "light" ? "Passer au thème sombre" : "Passer au thème clair"} title={theme === "light" ? "Thème sombre" : "Thème clair"}>{theme === "light" ? <Moon size={16} /> : <Sun size={16} />}</button>
            <button onClick={() => signOut(auth)} className="btn-ghost !px-2.5 !py-1.5 min-h-[36px]" aria-label="Déconnexion" title="Déconnexion"><LogOut size={16} /></button>
          </div>
        </header>

        {/* Navigation à 2 niveaux — niveau 1 : domaines ; niveau 2 : onglets du domaine actif. */}
        <div className="mb-4 sm:mb-6 flex flex-col gap-2">
          {/* Niveau 1 : domaines. Cliquer un domaine ouvre son 1er onglet (sauf s'il contient déjà l'actif). */}
          <nav aria-label="Domaines" className="flex gap-1.5 overflow-x-auto [&::-webkit-scrollbar]:h-0">
            {groups.map((g) => {
              const on = g.label === activeGroup?.label;
              return (
                <button
                  key={g.label}
                  onClick={() => { if (!g.mods.some((m) => m.id === allowed?.id)) openManual(g.mods[0].id); }}
                  aria-pressed={on}
                  className={cx("whitespace-nowrap rounded-full px-3.5 py-1.5 min-h-[34px] text-[13px] font-semibold transition-colors",
                    on ? "bg-panel text-ink ring-1 ring-gold/60" : "text-muted hover:text-ink hover:bg-panel/50")}
                >
                  {g.label}
                </button>
              );
            })}
          </nav>
          {/* Niveau 2 : onglets du domaine actif — dégradé de bord si débordement horizontal (mobile). */}
          <div className="relative">
            <nav aria-label="Onglets" className="flex gap-1 border-b border-line overflow-x-auto [&::-webkit-scrollbar]:h-0">
              {(activeGroup?.mods || []).map((m) => {
                const on = m.id === (allowed?.id);
                const Icon = m.icon;
                return (
                  <button
                    key={m.id}
                    ref={on ? activeTabRef : undefined}
                    onClick={() => openManual(m.id)}
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
          {/* Filtre transverse (BU / AM / client) — s'applique aux vues détaillées (listes). */}
          <FilterBar />
        </div>

        {/* Content */}
        <main id="main" ref={mainRef} tabIndex={-1} className="outline-none scroll-mt-4">
          <FreshnessGuard />
          {allowed ? (
            <ErrorBoundary key={allowed.id}>
              <h1 className="font-display text-xl sm:text-2xl font-bold mb-3 sm:mb-4">{allowed.label}</h1>
              {/* Chargement paresseux du module : squelette pendant la récupération de son chunk. */}
              <Suspense fallback={<div className="flex flex-col gap-4"><KpiSkeletons n={4} /><CardSkeleton h={160} /></div>}>
                <ActiveModule mod={allowed} period={period} />
              </Suspense>
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
    </FilterProvider>
    </NavContext.Provider>
  );
}
