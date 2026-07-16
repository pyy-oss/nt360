// Chrome de tableau chargé en LAZY (barre d'actions en masse, case « tout sélectionner », sélecteur de
// colonnes) — séparé de components.tsx pour rester HORS du chunk d'entrée. Table/ListView chargent ces
// pièces via React.lazy. Réutilise le toast + la confirmation accessible + le traçage d'écriture.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Download, X, Columns3, Filter } from "lucide-react";
import { cx, useToast, useConfirm, type Col, type BulkAction } from "./components";
import { Select } from "./inputs";
import { trackWrite } from "../lib/activity";
import { buildCsv, downloadCsv } from "../lib/exportCsv";

// Menu « Filtres » : pour chaque colonne filtrable, la liste de ses valeurs DISTINCTES en cases à cocher.
// Cumulable avec recherche/tri/pagination. Valeurs plafonnées (lisibilité). `value` = { entête: [valeurs] }.
const FILTER_VALUES_CAP = 60;
export function ColumnFilterMenu({ columns, rows, value, onChange }:
  { columns: Col[]; rows: any[]; value: Record<string, string[]>; onChange: (v: Record<string, string[]>) => void }) {
  const active = Object.values(value).reduce((n, a) => n + (a && a.length ? 1 : 0), 0);
  const toggle = (header: string, v: string) => {
    const cur = value[header] || [];
    const next = cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v];
    onChange({ ...value, [header]: next });
  };
  return (
    <details className="relative shrink-0 [&_summary::-webkit-details-marker]:hidden">
      <summary className={cx("btn-ghost !px-2.5 !py-1 text-xs cursor-pointer list-none inline-flex items-center gap-1.5", active > 0 && "text-gold")} title="Filtrer par colonne">
        <Filter size={14} aria-hidden="true" />Filtres{active > 0 && <span className="rounded-full bg-gold/15 text-gold px-1.5 leading-tight tabnum">{active}</span>}
      </summary>
      <div role="menu" className="absolute right-0 z-30 mt-1 w-64 max-h-80 overflow-auto rounded-lg border border-line bg-panel shadow-lg p-1.5">
        {active > 0 && (
          <button type="button" onClick={() => onChange({})} className="w-full text-left px-2 py-1.5 rounded text-[12px] text-clay hover:bg-panel2">Réinitialiser les filtres</button>
        )}
        {columns.map((c) => {
          const vals = [...new Set(rows.map((r) => c.filter!(r)).filter((v) => v != null && v !== ""))].sort() as string[];
          if (!vals.length) return null;
          const capped = vals.slice(0, FILTER_VALUES_CAP);
          return (
            <div key={c.header} className="mt-1 pt-1 border-t border-line/60 first:border-0 first:mt-0 first:pt-0">
              <div className="px-2 py-1 text-[10px] uppercase tracking-wider text-faint">{c.header}</div>
              {capped.map((v) => {
                const on = (value[c.header] || []).includes(v);
                return (
                  <label key={v} className="flex items-center gap-2 px-2 py-1.5 rounded text-[13px] cursor-pointer hover:bg-panel2">
                    <input type="checkbox" checked={on} onChange={() => toggle(c.header, v)} className="accent-gold" aria-label={`${c.header} : ${v}`} />
                    <span className="truncate">{v}</span>
                  </label>
                );
              })}
              {vals.length > FILTER_VALUES_CAP && <div className="px-2 py-1 text-[11px] text-faint">+{vals.length - FILTER_VALUES_CAP} autres valeurs (affiner par la recherche)</div>}
            </div>
          );
        })}
      </div>
    </details>
  );
}

// Export CSV des colonnes VISIBLES + lignes courantes (après recherche/filtre/tri). Exporte « ce qu'on voit ».
export function ExportBtn({ cols, rows, name }: { cols: Col[]; rows: any[]; name?: string }) {
  if (!rows.length) return null;
  const onClick = () => {
    const visible = cols.filter((c) => (c.header || "").trim() !== "");
    const d = new Date();
    const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
    downloadCsv(`nt360-${name || "export"}-${stamp}.csv`, buildCsv(visible, rows));
  };
  return (
    <button type="button" onClick={onClick} className="btn-ghost !px-2.5 !py-1 text-xs inline-flex items-center gap-1.5" title="Exporter les lignes affichées en CSV (Excel)">
      <Download size={14} aria-hidden="true" />CSV
    </button>
  );
}

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
  const [picks, setPicks] = useState<Record<number, string>>({});
  const n = selected.length;
  const run = async (a: BulkAction, picked?: string) => {
    if (a.pick && !picked) return; // aucune valeur choisie
    if (a.confirm && !(await ask(a.confirm, { tone: a.tone === "danger" ? "clay" : "gold", confirmLabel: a.label }))) return;
    setBusy(a.label);
    try {
      await trackWrite(Promise.resolve(a.run(selected, picked)), a.label);
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
        {(actions || []).map((a, i) => {
          const pv = a.pick ? (picks[i] ?? a.pick.options[0]?.value ?? "") : undefined;
          return (
            <span key={i} className="inline-flex items-center gap-1">
              {a.pick && (
                <Select ariaLabel={a.pick.placeholder || a.label} value={pv!} onChange={(v) => setPicks((p) => ({ ...p, [i]: v }))} options={a.pick.options} className="!py-0.5 text-xs" />
              )}
              <button type="button" disabled={!!busy} onClick={() => run(a, pv)}
                className={cx("btn-ghost !px-2.5 !py-1 text-xs inline-flex items-center gap-1.5 disabled:opacity-40", a.tone === "danger" && "text-clay")}>
                {a.icon as ReactNode}{busy === a.label ? "…" : a.label}
              </button>
            </span>
          );
        })}
        <button type="button" onClick={onClear} className="btn-ghost !px-2 !py-1 text-xs" aria-label="Tout désélectionner" title="Tout désélectionner">
          <X size={14} aria-hidden="true" />
        </button>
      </div>
      {confirmNode}
    </div>
  );
}
