// Chrome de tableau chargé en LAZY (barre d'actions en masse, case « tout sélectionner », sélecteur de
// colonnes) — séparé de components.tsx pour rester HORS du chunk d'entrée. Table/ListView chargent ces
// pièces via React.lazy. Réutilise le toast + la confirmation accessible + le traçage d'écriture.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Download, X, Columns3 } from "lucide-react";
import { cx, useToast, useConfirm, type Col, type BulkAction } from "./components";
import { trackWrite } from "../lib/activity";
import { buildCsv, downloadCsv } from "../lib/exportCsv";

// Identité stable d'une colonne (miroir de components.colId) : `key` explicite sinon l'entête.
const colId = (c: Col, i: number) => c.key || c.header || `col${i}`;

// Sélecteur de colonnes affichées (persistance gérée par l'appelant via onToggle).
export function ColumnsMenu({ columns, hidden, onToggle }: { columns: Col[]; hidden: Set<string>; onToggle: (id: string) => void }) {
  const items = columns.map((c, i) => ({ id: colId(c, i), header: c.header })).filter((x) => (x.header || "").trim() !== "");
  const shown = items.filter((x) => !hidden.has(x.id)).length;
  return (
    <details className="relative shrink-0 [&_summary::-webkit-details-marker]:hidden">
      <summary className="btn-ghost !px-2.5 !py-1 text-xs cursor-pointer list-none inline-flex items-center gap-1.5" title="Choisir les colonnes affichées">
        <Columns3 size={14} aria-hidden="true" />Colonnes<span className="text-faint tabnum">{shown}/{items.length}</span>
      </summary>
      <div role="menu" className="absolute right-0 z-30 mt-1 w-56 max-h-72 overflow-auto rounded-lg border border-line bg-panel shadow-lg p-1.5">
        {items.map((x) => {
          const on = !hidden.has(x.id);
          const last = on && shown <= 1; // ne pas masquer la dernière colonne visible
          return (
            <label key={x.id} className={cx("flex items-center gap-2 px-2 py-1.5 rounded text-[13px] cursor-pointer hover:bg-panel2", last && "opacity-60 cursor-not-allowed")}>
              <input type="checkbox" checked={on} disabled={last} onChange={() => onToggle(x.id)} className="accent-gold" aria-label={`Colonne ${x.header}`} />
              <span className="truncate">{x.header}</span>
            </label>
          );
        })}
      </div>
    </details>
  );
}

// Case de tête « tout sélectionner » (état indéterminé quand la sélection est partielle).
export function SelectAllBox({ allKeys, sel, setAll }: { allKeys: string[]; sel: Set<string>; setAll: (k: string[], on: boolean) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const selCount = allKeys.reduce((n, k) => n + (sel.has(k) ? 1 : 0), 0);
  const all = allKeys.length > 0 && selCount === allKeys.length;
  useEffect(() => { if (ref.current) ref.current.indeterminate = selCount > 0 && !all; }, [selCount, all]);
  return (
    <input ref={ref} type="checkbox" checked={all} onChange={() => setAll(allKeys, !all)}
      className="accent-gold align-middle" aria-label={all ? "Tout désélectionner" : "Tout sélectionner"} />
  );
}

// Barre d'actions en masse : surgit dès qu'≥1 ligne est cochée. Export CSV de la sélection intégré
// (zéro risque, toujours dispo) + actions métier fournies par l'écran. Actions destructives → confirmation.
export function BulkBar({ selected, actions, cols, exportName, onClear }:
  { selected: any[]; actions?: BulkAction[]; cols: Col[]; exportName?: string; onClear: () => void }) {
  const toast = useToast();
  const [ask, confirmNode] = useConfirm();
  const [busy, setBusy] = useState("");
  const n = selected.length;
  const run = async (a: BulkAction) => {
    if (a.confirm && !(await ask(a.confirm, { tone: a.tone === "danger" ? "clay" : "gold", confirmLabel: a.label }))) return;
    setBusy(a.label);
    try {
      await trackWrite(Promise.resolve(a.run(selected)), a.label);
      toast(typeof a.okMsg === "function" ? a.okMsg(selected) : (a.okMsg || `${n} élément${n > 1 ? "s" : ""} traité${n > 1 ? "s" : ""}`), "ok");
      onClear();
    } catch (e: any) {
      const d = String(e?.message || e?.code || "").replace(/^functions\//, "");
      toast(d ? `${a.errMsg || "Action refusée"} — ${d}` : (a.errMsg || "Action refusée"), "err");
    } finally { setBusy(""); }
  };
  const exportSel = () => {
    const visible = cols.filter((c) => (c.header || "").trim() !== "");
    const dt = new Date();
    const stamp = `${dt.getFullYear()}${String(dt.getMonth() + 1).padStart(2, "0")}${String(dt.getDate()).padStart(2, "0")}`;
    downloadCsv(`nt360-${exportName || "selection"}-${stamp}.csv`, buildCsv(visible, selected));
  };
  return (
    <div role="region" aria-label="Actions en masse" className="flex flex-wrap items-center gap-2 rounded-lg border border-gold/40 bg-gold/[.06] px-3 py-2 animate-fade-in">
      <span className="text-[13px] font-medium text-ink tabnum">{n} sélectionné{n > 1 ? "s" : ""}</span>
      <div className="flex flex-wrap items-center gap-1.5 ml-auto">
        <button type="button" onClick={exportSel} className="btn-ghost !px-2.5 !py-1 text-xs inline-flex items-center gap-1.5" title="Exporter la sélection en CSV (Excel)">
          <Download size={14} aria-hidden="true" />Exporter
        </button>
        {(actions || []).map((a, i) => (
          <button key={i} type="button" disabled={!!busy} onClick={() => run(a)}
            className={cx("btn-ghost !px-2.5 !py-1 text-xs inline-flex items-center gap-1.5 disabled:opacity-40", a.tone === "danger" && "text-clay")}>
            {a.icon as ReactNode}{busy === a.label ? "…" : a.label}
          </button>
        ))}
        <button type="button" onClick={onClear} className="btn-ghost !px-2 !py-1 text-xs" aria-label="Tout désélectionner" title="Tout désélectionner">
          <X size={14} aria-hidden="true" />
        </button>
      </div>
      {confirmNode}
    </div>
  );
}
