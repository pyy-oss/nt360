// Helpers et primitives partagés par les modules (extraits de index.tsx pour le découpage).
import type { ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import { useDocData } from "../lib/hooks";
import { T, fmt } from "../design/tokens";
import { Card, Badge, EmptyState, cx } from "../design/components";
import type { AlertsSummary } from "../types";

export type Props = { period: string };
export const grid4 = "grid gap-3 grid-cols-2 lg:grid-cols-4";
export const cols2 = "grid gap-3 md:grid-cols-2";

export const objToArr = (o: Record<string, number> = {}) =>
  Object.entries(o).map(([name, v]) => ({ name, v: Number(v) || 0 })).sort((a, b) => b.v - a.v);
export const monthsAsc = (o: Record<string, number> = {}) =>
  Object.entries(o).map(([name, v]) => ({ name, v: Number(v) || 0 })).sort((a, b) => a.name.localeCompare(b.name));
export const topArr = (a: { key: string; value: number }[] = []) => a.map((x) => ({ name: x.key, v: x.value }));
export const toDonut = (o: Record<string, number> = {}) => objToArr(o).map((x) => ({ name: x.name, value: x.v }));

export const STAGE_SHORT: Record<number, string> = { 1: "Qualif", 2: "Montage", 3: "Transmise", 4: "Négo", 5: "Contrat", 6: "Gagné", 7: "Perdu", 8: "Suspendu", 9: "Annulé" };

// Libellés FR des statuts techniques (jamais de code brut à l'écran).
export const BC_LABEL: Record<string, string> = { a_emettre: "À émettre", emis: "Émis", livre: "Livré", facture: "Facturé", solde: "Soldé" };
export const SUP_LABEL: Record<string, string> = { saturation: "Saturé", tension: "Tendu", ok: "OK", non_suivi: "Non suivi" };
export const BC_STAGES = ["a_emettre", "emis", "livre", "facture", "solde"];
export const bcLabel = (s?: string) => BC_LABEL[s || "a_emettre"] || (s || "a_emettre");

const buTone: Record<string, string> = { ICT: "emerald", CLOUD: "steel", FORMATION: "gold", AUTRE: "neutral" };
export const buBadge = (bu: string) => <Badge tone={(buTone[bu] || "neutral") as any}>{bu || "—"}</Badge>;

// Barres horizontales maison (listes AM / top clients / fournisseurs).
export function HBars({ rows, colorFn, max }: { rows: { name: string; v: number; sub?: string }[]; colorFn?: (r: any) => string; max?: number }) {
  if (!rows.length) return <EmptyState />;
  const mx = max ?? Math.max(1, ...rows.map((r) => r.v));
  return (
    <div className="flex flex-col gap-2.5 mt-1">
      {rows.map((r, i) => (
        <div key={i}>
          <div className="flex justify-between text-[12.5px] mb-1">
            <span className="truncate max-w-[220px] text-ink">{r.name}</span>
            <span className="text-muted tabnum">{fmt(r.v)}{r.sub != null && <span className="text-faint"> · {r.sub}</span>}</span>
          </div>
          <div className="h-[7px] rounded bg-panel2">
            <div className="h-full rounded" style={{ width: `${Math.max((r.v / mx) * 100, 1)}%`, background: colorFn ? colorFn(r) : T.emerald }} />
          </div>
        </div>
      ))}
    </div>
  );
}

// Centre d'alertes (bandeau).
export function AlertsBanner() {
  const { data } = useDocData<AlertsSummary>("summaries/alerts");
  const items = data?.items || [];
  if (!items.length) return null;
  const tone: Record<string, string> = { high: "clay", medium: "gold", low: "steel" };
  return (
    <Card title={`Centre d'alertes · ${items.length}`}>
      <div className="flex flex-col gap-2">
        {items.map((a, i) => (
          <div key={i} className="flex items-center gap-2 text-[13px]">
            <AlertTriangle size={14} aria-hidden="true" className={cx(a.severity === "high" ? "text-clay" : a.severity === "medium" ? "text-gold" : "text-steel")} />
            <span>{a.message}</span>
            <Badge tone={(tone[a.severity] || "neutral") as any}>{a.count}</Badge>
          </div>
        ))}
      </div>
    </Card>
  ) as ReactNode;
}
