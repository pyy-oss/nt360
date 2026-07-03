// Helpers et primitives partagés par les modules (extraits de index.tsx pour le découpage).
import { useState, type ChangeEvent, type ReactNode } from "react";
import { AlertTriangle, Upload, Filter, X } from "lucide-react";
import { useDocData, useCollectionData } from "../lib/hooks";
import { useNav } from "../lib/nav";
import { useFilters } from "../lib/filters";
import { T, fmt, pct } from "../design/tokens";
import { Card, Badge, EmptyState, cx, useToast } from "../design/components";
import { callImportDelta } from "../lib/writes";
import type { AlertsSummary, AmsSummary, EntitySummary, Objective } from "../types";

// --- R/O (Réalisé / Objectif) — partagé par les vues qui pilotent un périmètre ---
const upScope = (s?: string) => (s || "").trim().toUpperCase();

/** Badge R/O : vert si ≥ 100 %, or sinon ; « — » si pas de cible ou réalisé indisponible. */
export function roBadge(real: number | undefined, target: number | undefined) {
  if (!target || target <= 0 || real == null || !Number.isFinite(real)) return <span className="text-faint">—</span>;
  return <Badge tone={real / target >= 1 ? "emerald" : "gold"}>{pct(real / target)}</Badge>;
}

/** Objectifs de l'année {fy} indexés par périmètre. `.get(scope, scopeValue)` → objectif ou undefined.
 *  Les objectifs étant ANNUELS, le R/O n'a de sens que si la période sélectionnée est cette année-là. */
export function useObjectives(fy: number | string | undefined) {
  const { rows } = useCollectionData<Objective>("objectives");
  const map = new Map<string, Objective>();
  for (const o of rows || []) {
    if (fy == null || String(o.fiscalYear) !== String(fy)) continue;
    map.set(`${o.scope || "global"}|${upScope(o.scopeValue) || "ALL"}`, o);
  }
  return { get: (scope: string, scopeValue?: string) => map.get(`${scope}|${upScope(scopeValue) || "ALL"}`) };
}

// Module cible de chaque type d'alerte (pour rendre le centre d'alertes cliquable).
const ALERT_TARGET: Record<string, string> = {
  marge_negative: "orderlist", achat_sup_vente: "orderlist", raf_incoherent: "orderlist",
  factures_non_rattachees: "invoicelist", facture_pre_po: "invoicelist", surfacturation: "invoicelist",
  backlog_dormant: "backlog", ligne_saturee: "fournisseurs", ligne_tension: "fournisseurs",
  concentration_client: "clients", bc_en_attente: "bc", bc_en_retard: "bc",
};

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

// Libellés FR des types de fichiers reconnus à l'import (mapping kind serveur → module alimenté).
const IMPORT_KIND_LABEL: Record<string, string> = {
  pnl: "Commandes (P&L)",
  fiche: "Fiche affaire (P&L Projet)",
  facturationDf: "Factures",
  salesData: "Pipeline / Opportunités",
  logistics: "BC fournisseurs (Exécution BC)",
};

// Bouton d'import d'un fichier XLSX (modèle reconnu automatiquement). L'upsert serveur est
// idempotent par clé déterministe : un delta partiel se fusionne sans doublon, un ré-import
// remplace. Le rôle est revérifié côté serveur (l'UI n'est qu'un garde-fou).
export function ImportButton({ label = "Importer un fichier" }: { label?: string }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // autorise le ré-import du même fichier
    if (!file) return;
    setBusy(true);
    try {
      const r = await callImportDelta(file);
      const kinds = (r.kinds || []).map((k) => IMPORT_KIND_LABEL[k] || k).join(", ") || "aucun";
      const filesPart = (r.files || 0) > 1 ? ` · ${r.files} fichiers` : "";
      toast(`Import réussi : ${r.rowsOk} ligne(s)${r.rowsSkipped ? ` · ${r.rowsSkipped} ignorée(s)` : ""}${filesPart} · ${kinds}`, "ok");
    } catch (err: any) {
      toast(err?.message ? `Import refusé : ${err.message}` : "Import refusé", "err");
    } finally {
      setBusy(false);
    }
  };
  return (
    <label
      title="Importer un XLSX (P&L, Fiche affaire, Facturation DF ou LIVE/Sales) ou un ZIP de classeurs — type détecté automatiquement. Fiches affaire : plusieurs fiches par onglets ou par ZIP."
      className={cx("btn-ghost !px-2.5 !py-1 text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer", busy && "opacity-60 pointer-events-none")}
    >
      <Upload size={14} aria-hidden="true" />
      {busy ? "Import…" : label}
      <input type="file" accept=".xlsx,.xls,.zip" className="sr-only" onChange={onFile} disabled={busy} aria-label="Choisir un fichier XLSX ou ZIP à importer" />
    </label>
  );
}

// Carte d'import complète (onglet Admin) : peuple tous les modules à partir des exports XLSX.
export function DataImportCard() {
  return (
    <Card title="Import de données" actions={<ImportButton />}>
      <p className="text-[13px] text-muted">
        Dépose un fichier <b className="text-ink">Excel</b> (ou un ZIP) : le type est reconnu
        automatiquement et les chiffres se mettent à jour. Ré-importer ne crée jamais de doublon.
      </p>
      <details className="mt-2 text-[13px] text-muted">
        <summary className="cursor-pointer select-none text-faint hover:text-ink">Formats reconnus</summary>
        <ul className="mt-2 grid gap-1 sm:grid-cols-2">
          <li>• <b className="text-ink">P&amp;L</b> → Commandes · Rentabilité</li>
          <li>• <b className="text-ink">Fiche affaire</b> → P&amp;L Projet</li>
          <li>• <b className="text-ink">Import BC</b> (Logistics / PDF) → Exécution BC</li>
          <li>• <b className="text-ink">Facturation DF</b> → Factures</li>
          <li>• <b className="text-ink">LIVE / Sales</b> → Pipeline · Opportunités</li>
        </ul>
        <p className="mt-1 text-faint">Fiches affaire en lot : plusieurs onglets d'un classeur, ou plusieurs classeurs dans un ZIP.</p>
      </details>
    </Card>
  );
}

// Barre de filtre transverse (BU / AM / client) — options AM/clients issues des référentiels.
// N'affecte que les listes détaillées (les agrégats restent globaux), d'où le libellé « listes ».
export function FilterBar() {
  const { f, set, clear, active } = useFilters();
  const { data: ams } = useDocData<AmsSummary>("summaries/ams");
  const { data: cli } = useDocData<EntitySummary>("summaries/clients_all");
  const amOpts = (ams?.rows || []).map((r) => r.am).filter(Boolean);
  const cliOpts = (cli?.rows || []).map((r) => r.key).filter(Boolean);
  const BU = ["ICT", "CLOUD", "FORMATION", "AUTRE"];
  const sel = "field !py-1 text-xs";
  return (
    <div className="flex items-center gap-2 flex-wrap text-xs">
      <span className="inline-flex items-center gap-1 text-faint"><Filter size={13} aria-hidden="true" /> Filtre <span className="hidden sm:inline">(listes)</span></span>
      <select className={sel} aria-label="Filtrer par BU" value={f.bu} onChange={(e) => set({ bu: e.target.value })}>
        <option value="">BU · toutes</option>{BU.map((b) => <option key={b} value={b}>{b}</option>)}
      </select>
      <select className={sel} aria-label="Filtrer par commercial" value={f.am} onChange={(e) => set({ am: e.target.value })}>
        <option value="">AM · tous</option>{amOpts.map((a) => <option key={a} value={a}>{a}</option>)}
      </select>
      <select className={sel} aria-label="Filtrer par client" value={f.client} onChange={(e) => set({ client: e.target.value })}>
        <option value="">Client · tous</option>{cliOpts.map((c) => <option key={c} value={c}>{c}</option>)}
      </select>
      {active && <button onClick={clear} className="inline-flex items-center gap-1 text-clay hover:underline" aria-label="Effacer le filtre"><X size={13} /> Effacer</button>}
    </div>
  );
}

// Bandeau discret rappelant qu'un filtre transverse est actif sur une vue liste.
export function FilterNote({ dims }: { dims?: string }) {
  const { f, active } = useFilters();
  if (!active) return null;
  const parts = [f.bu && `BU ${f.bu}`, f.am && `AM ${f.am}`, f.client && `Client ${f.client}`].filter(Boolean);
  return <div className="text-[11px] text-gold">Filtre actif : {parts.join(" · ")}{dims ? ` — ${dims}` : ""}</div>;
}

// Centre d'alertes (bandeau) — actionnable : chaque alerte ouvre le module concerné
// (si l'utilisateur y a accès) et affiche ses références (FP / fournisseurs).
export function AlertsBanner() {
  const { data } = useDocData<AlertsSummary>("summaries/alerts");
  const { go, canGo } = useNav();
  const items = data?.items || [];
  if (!items.length) return null;
  const tone: Record<string, string> = { high: "clay", medium: "gold", low: "steel" };
  return (
    <Card title={`Centre d'alertes · ${items.length}`}>
      <div className="flex flex-col gap-2">
        {items.map((a, i) => {
          const target = ALERT_TARGET[a.type];
          const actionable = !!target && canGo(target);
          const refs = (a.refs || []).filter(Boolean);
          return (
            <div key={i} className="flex items-start gap-2 text-[13px]">
              <AlertTriangle size={14} aria-hidden="true" className={cx("mt-0.5 shrink-0", a.severity === "high" ? "text-clay" : a.severity === "medium" ? "text-gold" : "text-steel")} />
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                {actionable
                  ? <button onClick={() => go(target)} className="text-ink hover:text-gold underline decoration-dotted underline-offset-2 text-left" title="Ouvrir le module concerné">{a.message}</button>
                  : <span>{a.message}</span>}
                <Badge tone={(tone[a.severity] || "neutral") as any}>{a.count}</Badge>
                {refs.slice(0, 6).map((r, j) => (
                  <span key={j} className="rounded bg-panel2 text-faint px-1.5 py-0.5 text-[11px]">{r}</span>
                ))}
                {refs.length > 6 && <span className="text-[11px] text-faint">+{refs.length - 6}</span>}
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  ) as ReactNode;
}
