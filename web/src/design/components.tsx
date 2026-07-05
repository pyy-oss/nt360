// Primitives UI "Forest & Gold" (Tailwind). BUILD_KIT §12.
import { Component, createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { Inbox, TrendingUp, TrendingDown, Minus, AlertTriangle, ArrowRight, ChevronUp, ChevronDown, ChevronsUpDown, ChevronLeft, ChevronRight, Search, CheckCircle2, XCircle, WifiOff } from "lucide-react";
import { fmt, pct } from "./tokens";

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

export function Eyebrow({ children, color, as: As = "div" }: { children: ReactNode; color?: string; as?: "div" | "h2" | "h3" }) {
  return <As className="text-xs uppercase tracking-wider text-dim mb-2 font-semibold" style={color ? { color } : undefined}>{children}</As>;
}

export function Card({ title, actions, children, className }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx("card p-3 sm:p-4 animate-fade-in", className)}>
      {(title || actions) && (
        <div className="flex items-center justify-between gap-2 mb-3">
          {title ? <Eyebrow as="h3">{title}</Eyebrow> : <span />}
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

const TONES: Record<string, string> = {
  ink: "text-ink", gold: "text-gold", emerald: "text-emerald", clay: "text-clay", steel: "text-steel", plum: "text-plum",
};

export function Kpi({ label, value, sub, tone = "ink", delta }: { label: string; value: string; sub?: string; tone?: keyof typeof TONES | string; delta?: number | null }) {
  const showDelta = delta != null && isFinite(delta);
  const up = (delta || 0) >= 0;
  return (
    <div className="card p-3 sm:p-4 min-w-0">
      <div className="text-xs text-muted truncate" title={label}>{label}</div>
      <div className={cx("font-display text-[22px] sm:text-[26px] leading-tight tabnum mt-1 break-words", TONES[tone] || "text-ink")}>{value}</div>
      <div className="flex items-center gap-2 mt-1 min-h-[18px]">
        {showDelta && (
          <span className={cx("inline-flex items-center gap-0.5 text-xs font-medium", up ? "text-emerald" : "text-clay")}>
            {delta === 0 ? <Minus size={12} /> : up ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
            {pct(Math.abs(delta || 0))}
          </span>
        )}
        {sub && <span className="text-xs text-muted">{sub}</span>}
      </div>
    </div>
  );
}

const BADGE: Record<string, string> = {
  neutral: "bg-panel2 text-muted", gold: "bg-gold/15 text-gold", emerald: "bg-emerald/15 text-emerald",
  clay: "bg-clay/15 text-clay", steel: "bg-steel/15 text-steel", plum: "bg-plum/15 text-plum",
};
export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: keyof typeof BADGE }) {
  return <span className={cx("inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-semibold", BADGE[tone])}>{children}</span>;
}

/** Contrôle segmenté (filtres rapides / bascule de vue). Cibles tactiles ≥ 34 px, repli en wrap. */
export function Segmented<T extends string>({ value, onChange, options, ariaLabel }:
  { value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode; count?: number; disabled?: boolean; title?: string }[]; ariaLabel?: string }) {
  return (
    <div role="tablist" aria-label={ariaLabel} className="inline-flex flex-wrap gap-0.5 rounded-lg bg-panel2 p-0.5">
      {options.map((o) => {
        const on = value === o.value;
        return (
          <button key={o.value} type="button" role="tab" aria-selected={on} disabled={o.disabled} title={o.title} onClick={() => !o.disabled && onChange(o.value)}
            className={cx("inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium min-h-[34px] transition-colors",
              o.disabled ? "text-faint opacity-40 cursor-not-allowed" : on ? "bg-gold/20 text-gold" : "text-muted hover:text-ink hover:bg-ink/[.06]")}>
            {o.label}{o.count != null && <span className={cx("tabnum", on ? "text-gold/70" : "text-faint")}>{o.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

// --- Chaîne de valeur (Overview) ---
export function Stage({ idx, label, value, accent, sub }: { idx: number; label: string; value: string; accent: string; sub?: string }) {
  return (
    <div className="flex-1 min-w-0 card p-3 sm:p-4" style={{ borderTop: `3px solid ${accent}` }}>
      <div className="flex justify-between items-baseline">
        <Eyebrow color={accent}>{label}</Eyebrow>
        <span className="font-display text-[13px] text-faint">0{idx}</span>
      </div>
      <div className="font-display text-[25px] font-bold tabnum mt-1 leading-none">{value}</div>
      {sub && <div className="text-[11px] text-muted mt-1">{sub}</div>}
    </div>
  );
}
export function Chain({ children }: { children: ReactNode[] }) {
  return (
    <div className="flex items-stretch gap-2 flex-col md:flex-row">
      {children.map((c, i) => (
        <div key={i} className="flex items-center gap-2 flex-1 min-w-0">
          {c}
          {i < children.length - 1 && <ArrowRight size={18} className="text-faint shrink-0 rotate-90 md:rotate-0" />}
        </div>
      ))}
    </div>
  );
}

// --- Table triable ---
type Col = { header: string; align?: "left" | "right"; render: (row: any) => ReactNode; sort?: (row: any) => number | string };
export function Table({ columns, rows, empty }: { columns: Col[]; rows: any[]; empty?: string }) {
  const [sort, setSort] = useState<{ i: number; dir: 1 | -1 } | null>(null);
  const sorted = useMemo(() => {
    if (!sort || !columns[sort.i]?.sort) return rows;
    const key = columns[sort.i].sort!;
    return [...rows].sort((a, b) => {
      const va = key(a), vb = key(b);
      if (va < vb) return -1 * sort.dir;
      if (va > vb) return 1 * sort.dir;
      return 0;
    });
  }, [rows, sort, columns]);
  if (!rows.length) return <EmptyState label={empty} />;
  const toggle = (i: number) => setSort((s) => (s && s.i === i ? { i, dir: (s.dir * -1) as 1 | -1 } : { i, dir: 1 }));
  return (
    <div className="overflow-x-auto -mx-1">
      <table className="w-full text-sm rtable">
        <thead>
          <tr className="text-muted">
            {columns.map((c, i) => (
              <th key={i} aria-sort={c.sort && sort?.i === i ? (sort.dir === 1 ? "ascending" : "descending") : undefined}
                className={cx("px-3 py-2 font-medium text-xs sticky top-0 bg-panel select-none", c.align === "right" ? "text-right" : "text-left")}>
                {c.sort ? (
                  <button type="button" onClick={() => toggle(i)} className={cx("inline-flex items-center gap-1 hover:text-ink", c.align === "right" && "flex-row-reverse")}>
                    {c.header}{sort?.i === i ? (sort.dir === 1 ? <ChevronUp size={12} /> : <ChevronDown size={12} />) : <ChevronsUpDown size={12} className="text-faint" />}
                  </button>
                ) : <span className="inline-flex items-center gap-1">{c.header}</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r, ri) => (
            <tr key={ri} className="odd:bg-ink/[.03] hover:bg-ink/[.06] transition-colors">
              {columns.map((c, ci) => (
                <td key={ci} data-label={c.header} className={cx("px-3 py-2 border-t border-line/60 tabnum", c.align === "right" ? "text-right" : "text-left")}>{c.render(r)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
export const colText = (header: string, render: (r: any) => ReactNode, sort?: (r: any) => any): Col => ({ header, align: "left", render, sort });
export const colNum = (header: string, render: (r: any) => ReactNode, sort?: (r: any) => any): Col => ({ header, align: "right", render, sort });
export const money = (v: number | null | undefined) => <span className="tabnum">{fmt(v)}</span>;

export function EmptyState({ label, icon, action }: { label?: string; icon?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-10 text-center text-muted">
      <div className="text-muted/50">{icon || <Inbox size={28} />}</div>
      <div className="text-sm">{label || "Aucune donnée pour cette sélection."}</div>
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

/** État d'erreur de données (distinct du vide) : refus de droit / panne réseau. */
export function ErrorState({ error }: { error: Error }) {
  const denied = String((error as any)?.code || error?.message || "").includes("permission");
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
      <WifiOff size={26} className="text-clay/70" />
      <div className="text-sm text-clay">{denied ? "Accès refusé à ces données (droits insuffisants)." : "Impossible de charger les données (réseau ou service)."}</div>
      <div className="text-xs text-muted">Réessaie plus tard ou contacte un administrateur.</div>
    </div>
  );
}

/** Rend l'état d'un hook de données : erreur → vide → skeleton → contenu. */
export function DataGate({ loading, error, empty, skeleton, children }:
  { loading: boolean; error: Error | null; empty: boolean; skeleton?: ReactNode; children: ReactNode }) {
  if (error) return <ErrorState error={error} />;
  if (empty && loading) return <>{skeleton ?? <CardSkeleton />}</>;
  if (empty) return <EmptyState />;
  return <>{children}</>;
}

export function Skeleton({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return <div className={cx("relative overflow-hidden rounded-lg bg-panel2", className)} style={style}>
    <div className="absolute inset-0 -translate-x-full animate-[shimmer_1.4s_infinite] bg-gradient-to-r from-transparent via-ink/[.06] to-transparent" />
  </div>;
}
export function KpiSkeletons({ n = 4 }: { n?: number }) {
  return <div className="grid gap-3 grid-cols-2 md:grid-cols-4">{Array.from({ length: n }).map((_, i) => <Skeleton key={i} className="h-[92px]" />)}</div>;
}
export function CardSkeleton({ h = 240 }: { h?: number }) {
  return <div className="card p-4"><Skeleton className="h-4 w-32 mb-3" /><Skeleton style={{ height: h }} /></div>;
}

export function Tip({ children }: { children: ReactNode }) {
  return <div className="text-xs text-muted mt-3 leading-relaxed">{children}</div>;
}

// --- Liste détaillée : recherche + tri + pagination (drill-down collections) ---
export function ListView({ rows, columns, searchKeys, pageSize = 25, placeholder = "Rechercher…" }:
  { rows: any[]; columns: Col[]; searchKeys: ((r: any) => any)[]; pageSize?: number; placeholder?: string }) {
  const [q, setQ] = useState("");
  const [page, setPage] = useState(0);
  const [sort, setSort] = useState<{ i: number; dir: 1 | -1 } | null>(null);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    let r = !s ? rows : rows.filter((row) => searchKeys.some((k) => String(k(row) ?? "").toLowerCase().includes(s)));
    if (sort && columns[sort.i]?.sort) {
      const key = columns[sort.i].sort!;
      r = [...r].sort((a, b) => { const va = key(a), vb = key(b); return va < vb ? -sort.dir : va > vb ? sort.dir : 0; });
    }
    return r;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, q, sort, columns]);

  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const cur = Math.min(page, pages - 1);
  const slice = filtered.slice(cur * pageSize, (cur + 1) * pageSize);
  const toggle = (i: number) => { setSort((s) => (s && s.i === i ? { i, dir: (s.dir * -1) as 1 | -1 } : { i, dir: 1 })); };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="relative w-full sm:w-64">
          <Search size={14} aria-hidden="true" className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
          <input className="field pl-8 w-full" aria-label={placeholder} placeholder={placeholder} value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} />
        </div>
        <span className="text-xs text-muted tabnum">{filtered.length.toLocaleString("fr-FR")} résultat{filtered.length > 1 ? "s" : ""}{filtered.length !== rows.length ? ` / ${rows.length.toLocaleString("fr-FR")}` : ""}</span>
      </div>
      {slice.length === 0 ? <EmptyState label="Aucun résultat." /> : (
        <div className="overflow-x-auto -mx-1">
          <table className="w-full text-sm rtable">
            <thead>
              <tr className="text-muted">
                {columns.map((c, i) => (
                  <th key={i} aria-sort={c.sort && sort?.i === i ? (sort.dir === 1 ? "ascending" : "descending") : undefined}
                    className={cx("px-3 py-2 font-medium text-xs sticky top-0 bg-panel select-none", c.align === "right" ? "text-right" : "text-left")}>
                    {c.sort ? (
                      <button type="button" onClick={() => toggle(i)} className={cx("inline-flex items-center gap-1 hover:text-ink", c.align === "right" && "flex-row-reverse")}>
                        {c.header}{sort?.i === i ? (sort.dir === 1 ? <ChevronUp size={12} /> : <ChevronDown size={12} />) : <ChevronsUpDown size={12} className="text-faint" />}
                      </button>
                    ) : <span className="inline-flex items-center gap-1">{c.header}</span>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {slice.map((r, ri) => (
                <tr key={ri} className="odd:bg-ink/[.03] hover:bg-ink/[.06] transition-colors">
                  {columns.map((c, ci) => <td key={ci} data-label={c.header} className={cx("px-3 py-2 border-t border-line/60 tabnum", c.align === "right" ? "text-right" : "text-left")}>{c.render(r)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {pages > 1 && (
        <div className="flex items-center justify-end gap-3 text-sm">
          <button className="btn-ghost !px-3 min-h-[40px]" aria-label="Page précédente" disabled={cur === 0} onClick={() => setPage(cur - 1)}><ChevronLeft size={18} /></button>
          <span className="text-muted tabnum">Page {cur + 1} / {pages}</span>
          <button className="btn-ghost !px-3 min-h-[40px]" aria-label="Page suivante" disabled={cur >= pages - 1} onClick={() => setPage(cur + 1)}><ChevronRight size={18} /></button>
        </div>
      )}
    </div>
  );
}

// --- Toaster ---
type Toast = { id: number; msg: string; type: "ok" | "err" | "info" };
const ToastCtx = createContext<(msg: string, type?: Toast["type"]) => void>(() => {});
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  let seq = 0;
  const push = (msg: string, type: Toast["type"] = "info") => {
    const id = ++seq + Date.now();
    setToasts((t) => [...t, { id, msg, type }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3500);
  };
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div role="status" aria-live="polite" className="fixed bottom-4 inset-x-4 sm:inset-x-auto sm:right-4 z-50 flex flex-col gap-2 sm:max-w-[360px]">
        {toasts.map((t) => (
          <div key={t.id} className={cx("card px-3 py-2 text-sm flex items-center gap-2 animate-fade-in border-l-2", t.type === "ok" && "border-l-emerald", t.type === "err" && "border-l-clay", t.type === "info" && "border-l-steel")}>
            {t.type === "ok" ? <CheckCircle2 size={16} className="text-emerald" /> : t.type === "err" ? <XCircle size={16} className="text-clay" /> : <AlertTriangle size={16} className="text-steel" />}
            <span>{t.msg}</span>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);

/** Bouton d'action asynchrone avec état + toast. */
export function Busy({ label, fn, variant = "gold", okMsg = "Fait", errMsg = "Action refusée" }: { label: string; fn: () => Promise<any>; variant?: "gold" | "ghost"; okMsg?: string; errMsg?: string }) {
  const [s, setS] = useState<"" | "busy">("");
  const toast = useToast();
  return (
    <button
      className={variant === "gold" ? "btn-gold" : "btn-ghost"}
      disabled={s === "busy"}
      onClick={async () => { setS("busy"); try { await fn(); toast(okMsg, "ok"); } catch (e: any) { const detail = String(e?.message || e?.code || "").replace(/^functions\//, ""); toast(detail ? `${errMsg} — ${detail}` : errMsg, "err"); } finally { setS(""); } }}
    >
      {s === "busy" ? "…" : label}
    </button>
  );
}

export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    if (this.state.error) {
      return (
        <Card title="Erreur d'affichage">
          <div className="flex items-start gap-2 text-clay text-sm">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
            <span>{String(this.state.error.message || this.state.error)}</span>
          </div>
          <button className="btn-ghost mt-3" onClick={() => this.setState({ error: null })}>Réessayer</button>
        </Card>
      );
    }
    return this.props.children;
  }
}
