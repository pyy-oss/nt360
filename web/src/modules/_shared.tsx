// Helpers et primitives partagés par les modules (extraits de index.tsx pour le découpage).
import { useState, type ChangeEvent, type ReactNode } from "react";
import { AlertTriangle, Upload } from "lucide-react";
import { useDocData } from "../lib/hooks";
import { useNav } from "../lib/nav";
import { T, fmt } from "../design/tokens";
import { Card, Badge, EmptyState, cx, useToast } from "../design/components";
import { callImportDelta } from "../lib/writes";
import type { AlertsSummary } from "../types";

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
  fiche: "Fiche affaire (P&L Projet + BC)",
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
    <Card title="Import de données (XLSX)" actions={<ImportButton />}>
      <p className="text-[13px] text-muted">
        Chargez un export XLSX (ou un ZIP de plusieurs classeurs) : le type est détecté automatiquement
        puis fusionné (upsert par clé, ré-import sans doublon). Les agrégats sont recalculés dans la foulée.
        <br />Import groupé de <b className="text-ink">fiches affaire</b> : plusieurs fiches par onglets
        d'un même classeur, ou plusieurs classeurs dans un ZIP.
      </p>
      <ul className="mt-2 text-[13px] text-muted grid gap-1 sm:grid-cols-2">
        <li>• <b className="text-ink">P&amp;L</b> → Commandes · Rentabilité · Vue d'ensemble</li>
        <li>• <b className="text-ink">Fiche affaire</b> → P&amp;L Projet · Exécution BC</li>
        <li>• <b className="text-ink">Facturation DF</b> → Factures · Facturation</li>
        <li>• <b className="text-ink">LIVE / Sales</b> → Pipeline · Opportunités</li>
      </ul>
    </Card>
  );
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
