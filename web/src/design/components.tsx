// Composants "Forest & Gold" conservés du prototype (BUILD_KIT §12).
import { Component, type ReactNode, type CSSProperties } from "react";
import { colors, fonts, fmt, pct } from "./tokens";

export function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <div style={{ textTransform: "uppercase", letterSpacing: 1, fontSize: 11, color: colors.gold, opacity: 0.9, marginBottom: 6 }}>
      {children}
    </div>
  );
}

export function Card({ title, children, style }: { title?: string; children: ReactNode; style?: CSSProperties }) {
  return (
    <div style={{ background: colors.panel, borderRadius: 14, padding: 16, ...style }}>
      {title && <Eyebrow>{title}</Eyebrow>}
      {children}
    </div>
  );
}

export function Kpi({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: string }) {
  return (
    <div style={{ background: colors.panel, borderRadius: 14, padding: 16, minWidth: 150 }}>
      <div style={{ fontSize: 12, opacity: 0.7 }}>{label}</div>
      <div style={{ fontFamily: fonts.display, fontSize: 26, color: tone || colors.ink, fontVariantNumeric: "tabular-nums" }}>
        {value}
      </div>
      {sub && <div style={{ fontSize: 12, opacity: 0.6 }}>{sub}</div>}
    </div>
  );
}

/** Barres horizontales à partir d'un objet {clé: valeur} ou d'une liste {key,value}. */
export function HBars({ data, max, money = true }: { data: Record<string, number> | { key: string; value: number }[]; max?: number; money?: boolean }) {
  const rows = Array.isArray(data) ? data : Object.entries(data).map(([key, value]) => ({ key, value }));
  const top = rows.slice().sort((a, b) => b.value - a.value);
  const m = max ?? Math.max(1, ...top.map((r) => r.value));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {top.map((r) => (
        <div key={r.key} style={{ display: "grid", gridTemplateColumns: "120px 1fr 90px", gap: 8, alignItems: "center", fontSize: 12 }}>
          <span style={{ opacity: 0.8, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.key}</span>
          <span style={{ background: "#0E1613", borderRadius: 6, height: 10, overflow: "hidden" }}>
            <span style={{ display: "block", height: "100%", width: `${(r.value / m) * 100}%`, background: colors.emerald }} />
          </span>
          <span style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{money ? fmt(r.value) : pct(r.value)}</span>
        </div>
      ))}
    </div>
  );
}

/** Puce d'étape du pipeline. */
export function Stage({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ background: colors.panel, borderRadius: 10, padding: "8px 12px", display: "flex", justifyContent: "space-between", gap: 10, fontSize: 13 }}>
      <span style={{ opacity: 0.8 }}>{label}</span>
      <span style={{ fontVariantNumeric: "tabular-nums" }}>{value}</span>
    </div>
  );
}

export function Tip({ children }: { children: ReactNode }) {
  return <div style={{ fontSize: 12, opacity: 0.6, marginTop: 8 }}>{children}</div>;
}

export function Empty({ children }: { children?: ReactNode }) {
  return <div style={{ opacity: 0.6, fontSize: 13, padding: 12 }}>{children || "Aucune donnée — lancer une ingestion / un recalcul."}</div>;
}

/** ErrorBoundary par vue (garde-fou du prototype, §18.7). */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (this.state.error) {
      return (
        <Card title="Erreur d'affichage">
          <div style={{ color: colors.clay, fontSize: 13 }}>{String(this.state.error.message || this.state.error)}</div>
        </Card>
      );
    }
    return this.props.children;
  }
}
