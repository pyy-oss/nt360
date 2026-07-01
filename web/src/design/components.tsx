// Primitives UI "Forest & Gold" (Tailwind). BUILD_KIT §12.
import { Component, useState, type ReactNode } from "react";
import { Inbox, TrendingUp, TrendingDown, Minus, AlertTriangle } from "lucide-react";
import { fmt, pct } from "./tokens";

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

export function Eyebrow({ children }: { children: ReactNode }) {
  return <div className="text-[11px] uppercase tracking-wider text-muted mb-2">{children}</div>;
}

export function Card({ title, actions, children, className }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx("card p-4 animate-fade-in", className)}>
      {(title || actions) && (
        <div className="flex items-center justify-between mb-3">
          {title ? <Eyebrow>{title}</Eyebrow> : <span />}
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

/** KPI avec valeur, sous-titre et variation optionnelle (delta en %). */
export function Kpi({ label, value, sub, tone = "ink", delta }: { label: string; value: string; sub?: string; tone?: keyof typeof TONES | string; delta?: number | null }) {
  const showDelta = delta != null && isFinite(delta);
  const up = (delta || 0) >= 0;
  return (
    <div className="card p-4">
      <div className="text-xs text-muted">{label}</div>
      <div className={cx("font-display text-[26px] leading-tight tabnum mt-1", TONES[tone] || "text-ink")}>{value}</div>
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
  neutral: "bg-panel2 text-muted",
  gold: "bg-gold/15 text-gold",
  emerald: "bg-emerald/15 text-emerald",
  clay: "bg-clay/15 text-clay",
  steel: "bg-steel/15 text-steel",
};
export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: keyof typeof BADGE }) {
  return <span className={cx("inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-semibold", BADGE[tone])}>{children}</span>;
}

type Col = { header: string; align?: "left" | "right"; render: (row: any) => ReactNode };
/** Table stylée : zebra, hover, en-têtes sticky, alignement numérique. */
export function Table({ columns, rows, empty }: { columns: Col[]; rows: any[]; empty?: string }) {
  if (!rows.length) return <EmptyState label={empty} />;
  return (
    <div className="overflow-x-auto -mx-1">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-muted">
            {columns.map((c, i) => (
              <th key={i} className={cx("px-3 py-2 font-medium text-xs sticky top-0 bg-panel", c.align === "right" ? "text-right" : "text-left")}>{c.header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, ri) => (
            <tr key={ri} className="odd:bg-white/[.015] hover:bg-white/[.04] transition-colors">
              {columns.map((c, ci) => (
                <td key={ci} className={cx("px-3 py-2 border-t border-line/60 tabnum", c.align === "right" ? "text-right" : "text-left")}>{c.render(r)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
// Helpers de colonnes
export const colText = (header: string, render: (r: any) => ReactNode): Col => ({ header, align: "left", render });
export const colNum = (header: string, render: (r: any) => ReactNode): Col => ({ header, align: "right", render });
export const money = (v: number) => <span className="tabnum">{fmt(v)}</span>;

export function EmptyState({ label, icon }: { label?: string; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-10 text-center text-muted">
      <div className="text-muted/50">{icon || <Inbox size={28} />}</div>
      <div className="text-sm">{label || "Aucune donnée — lancer une ingestion / un recalcul."}</div>
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx("relative overflow-hidden rounded-lg bg-panel2", className)}>
    <div className="absolute inset-0 -translate-x-full animate-[shimmer_1.4s_infinite] bg-gradient-to-r from-transparent via-white/5 to-transparent" />
  </div>;
}
export function KpiSkeletons({ n = 4 }: { n?: number }) {
  return <div className="grid gap-3 grid-cols-2 md:grid-cols-4">{Array.from({ length: n }).map((_, i) => <Skeleton key={i} className="h-[92px]" />)}</div>;
}

export function Tip({ children }: { children: ReactNode }) {
  return <div className="text-xs text-muted/80 mt-3">{children}</div>;
}

/** Bouton d'action asynchrone avec état (busy / ok / refusé). */
export function Busy({ label, fn, variant = "gold" }: { label: string; fn: () => Promise<any>; variant?: "gold" | "ghost" }) {
  const [s, setS] = useState<"" | "busy" | "ok" | "err">("");
  return (
    <button
      className={cx(variant === "gold" ? "btn-gold" : "btn-ghost", s === "err" && "!bg-clay !text-bg", s === "ok" && "!bg-emerald !text-bg")}
      disabled={s === "busy"}
      onClick={async () => { setS("busy"); try { await fn(); setS("ok"); setTimeout(() => setS(""), 1500); } catch { setS("err"); setTimeout(() => setS(""), 2500); } }}
    >
      {s === "busy" ? "…" : s === "ok" ? "✓ Fait" : s === "err" ? "✗ Refusé" : label}
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
        </Card>
      );
    }
    return this.props.children;
  }
}
