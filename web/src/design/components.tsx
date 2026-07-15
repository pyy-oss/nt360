// Primitives UI "Forest & Gold" (Tailwind). BUILD_KIT §12.
import { Component, createContext, Fragment, lazy, Suspense, useContext, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Inbox, TrendingUp, TrendingDown, Minus, AlertTriangle, ArrowRight, ChevronUp, ChevronDown, ChevronsUpDown, ChevronLeft, ChevronRight, Search, CheckCircle2, XCircle, WifiOff, X, Columns3, Download, Activity, Loader2 } from "lucide-react";
import { fmt, pct } from "./tokens";
import { buildCsv, downloadCsv } from "../lib/exportCsv";
import { isStaleChunkError, reloadForStaleChunk } from "../lib/staleChunk";
import { trackWrite, useWriteActivity, useActivityLog } from "../lib/activity";

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
type Col = { header: string; align?: "left" | "right"; render: (row: any) => ReactNode; sort?: (row: any) => number | string; key?: string; sec?: boolean; raw?: boolean };

// Marque une colonne comme SECONDAIRE : elle quitte la ligne principale et s'affiche dans le détail
// déroulant (grille clé/valeur). Sert à garder des tableaux étroits, sans scroll horizontal.
export const det = (c: Col): Col => ({ ...c, sec: true });

// Marque une colonne dont le rendu est un CONTENU RICHE auto-géré (chips, badges multiples, mini-barres)
// qui ne doit PAS être coincé dans `.cell-txt` (nowrap + troncature à 34ch écrête les 2e/3e chips et
// l'indicateur « +N »). La cellule gère sa propre largeur/débordement.
export const raw = (c: Col): Col => ({ ...c, raw: true });

// Une colonne d'ACTION/contrôle porte un en-tête vide (boutons, menus, éditeurs inline). Elle ne doit
// JAMAIS partir dans l'accordéon de détail (sinon l'action principale d'un tableau devient invisible).
const isActionCol = (c: Col): boolean => (c.header || "").trim() === "";

// Répartit les colonnes VISIBLES en principales (ligne) + détail (déroulé). Priorité au marquage
// explicite `sec` ; sinon repli automatique de l'excédent au-delà d'un plafond (zéro scroll partout).
// Dans les deux cas les colonnes d'action restent EN LIGNE : on ne replie que des colonnes de données.
const PRIMARY_CAP = 7;
function splitCols(cols: Col[]): { primary: Col[]; detail: Col[] } {
  // Repli auto au-delà du plafond : les PRIMARY_CAP premières colonnes de DONNÉES restent en ligne, le
  // reste bascule au détail. Les colonnes d'action restent TOUJOURS en ligne. `sec` = repli explicite.
  const explicit = cols.some((c) => c.sec);
  let kept = 0;
  const primary: Col[] = [], detail: Col[] = [];
  for (const c of cols) {
    const fold = isActionCol(c) ? false : explicit ? !!c.sec : (cols.length > PRIMARY_CAP && kept++ >= PRIMARY_CAP);
    (fold ? detail : primary).push(c);
  }
  // GARDE-FOU : une ligne ne doit jamais être VIDE (chevron + actions seuls). Si toutes les colonnes de
  // données ont été repliées, on remonte la première colonne de détail en principale (essentiel visible).
  if (detail.length && !primary.some((c) => !isActionCol(c))) {
    primary.unshift(detail.shift() as Col);
  }
  return { primary, detail };
}

// Cellule principale (partagée Table + ListView) : `.cell-txt` (nowrap + troncature) sauf colonnes
// alignées à droite / d'action / `raw` (contenu riche auto-géré).
function PrimaryCell({ c, r }: { c: Col; r: any }) {
  return (
    <td data-label={c.header} className={cx("px-3 py-2 border-t border-line/60 tabnum align-middle", c.align === "right" ? "text-right whitespace-nowrap" : "text-left")}>
      {c.align === "right" || isActionCol(c) || c.raw ? c.render(r) : <span className="cell-txt">{c.render(r)}</span>}
    </td>
  );
}

// Grille clé/valeur du détail d'une ligne (colonnes secondaires). Responsive, lisible, premium.
function DetailGrid({ cols, row }: { cols: Col[]; row: any }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-6 gap-y-2.5">
      {cols.map((c, i) => (
        <div key={i} className="flex flex-col gap-0.5 min-w-0">
          <span className="text-[10px] uppercase tracking-wider text-faint">{c.header}</span>
          <span className={cx("text-[13px] text-ink truncate", c.align === "right" && "tabnum")}>{c.render(row)}</span>
        </div>
      ))}
    </div>
  );
}

// --- Personnalisation des colonnes (afficher/masquer), persistée par liste dans localStorage ---
// Identité stable d'une colonne : `key` explicite sinon l'entête (les entêtes sont uniques par liste).
const colId = (c: Col, i: number) => c.key || c.header || `col${i}`;
const HIDDEN_PREFIX = "nt360-cols-";
function loadHiddenCols(storageKey: string): Set<string> {
  try { const s = localStorage.getItem(HIDDEN_PREFIX + storageKey); const a = s ? JSON.parse(s) : []; return new Set(Array.isArray(a) ? a : []); }
  catch { return new Set(); }
}
/** Gère la visibilité des colonnes d'une liste (état + persistance). Hook TOUJOURS appelé (même
 *  sans `storageKey`) pour respecter les règles des hooks ; sans clé il n'a aucun effet. */
function useColVisibility(storageKey: string | undefined, columns: Col[]) {
  const [hidden, setHidden] = useState<Set<string>>(() => (storageKey ? loadHiddenCols(storageKey) : new Set()));
  const toggle = (id: string) => setHidden((h) => {
    const n = new Set(h); n.has(id) ? n.delete(id) : n.add(id);
    if (storageKey) { try { localStorage.setItem(HIDDEN_PREFIX + storageKey, JSON.stringify([...n])); } catch { /* quota / mode privé */ } }
    return n;
  });
  // Colonnes masquables = celles qui portent un entête (les colonnes d'action, entête vide, restent
  // toujours visibles et hors du sélecteur). Repli de sécurité : ne jamais tout masquer.
  const hideable = columns.filter((c) => (c.header || "").trim() !== "");
  const visible = storageKey ? columns.filter((c, i) => !hidden.has(colId(c, i))) : columns;
  const cols = visible.length ? visible : columns;
  return { cols, hidden, toggle, hideable, enabled: !!storageKey };
}

// Sélecteur de colonnes : petit menu (cases à cocher) pour afficher/masquer les colonnes de la liste.
function ColumnsMenu({ columns, hidden, onToggle }: { columns: Col[]; hidden: Set<string>; onToggle: (id: string) => void }) {
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

// Export CSV des colonnes VISIBLES + lignes courantes (après filtre/tri). Exporte « ce qu'on voit ».
function ExportBtn({ cols, rows, name }: { cols: Col[]; rows: any[]; name?: string }) {
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

export function Table({ columns, rows, empty, colsKey, pageSize = 50 }: { columns: Col[]; rows: any[]; empty?: string; colsKey?: string; pageSize?: number }) {
  const { cols, hidden, toggle: toggleCol, enabled } = useColVisibility(colsKey, columns);
  const [sort, setSort] = useState<{ i: number; dir: 1 | -1 } | null>(null);
  const [open, setOpen] = useState<Set<number>>(() => new Set());
  const [page, setPage] = useState(0);
  const { primary, detail } = splitCols(cols);
  const hasDetail = detail.length > 0;
  // Tri mémoïsé sur des signaux STABLES : lignes, état de tri, visibilité des colonnes (`hidden`, dont
  // l'identité ne change qu'à une bascule utilisateur). On NE dépend PAS de `primary`/`cols` : les
  // appelants construisent leurs colonnes en INLINE (identité neuve à CHAQUE rendu), ce qui re-triait la
  // liste entière à chaque rendu non lié (tick onSnapshot, frappe ailleurs) — le memo ne cachait jamais.
  // `primary` est relu au calcul (contenu identique tant que `hidden`/le contenu des colonnes ne bouge pas).
  const sorted = useMemo(() => {
    const base = rows.map((r, i) => ({ r, i }));
    const key = sort ? primary[sort.i]?.sort : null;
    if (!key || !sort) return base;
    const dir = sort.dir;
    return base.sort((a, b) => {
      const va = key(a.r), vb = key(b.r);
      return va < vb ? -1 * dir : va > vb ? 1 * dir : 0;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, sort, hidden]);
  // Pagination des longues listes : au-delà de `pageSize` lignes on ne rend qu'une fenêtre + un pager.
  // Les listes courtes (< pageSize) restent inchangées (aucun pager). `pageSize={0}` désactive.
  const total = sorted.length;
  const paged = pageSize > 0 && total > pageSize;
  const pageCount = paged ? Math.ceil(total / pageSize) : 1;
  const safePage = Math.min(page, pageCount - 1);
  // Le tri ramène à la première page. On NE dépend PAS de `total` : l'app est temps réel (onSnapshot),
  // et tout changement du nombre de lignes (import delta, ajout optimiste, annulation) ré-exécuterait
  // l'effet et téléporterait l'utilisateur en page 1 en pleine navigation. Le clamp `safePage` suffit à
  // rester dans les bornes quand la liste rétrécit (parité avec ListView).
  useEffect(() => { setPage(0); }, [sort, pageSize]);
  const pageRows = paged ? sorted.slice(safePage * pageSize, safePage * pageSize + pageSize) : sorted;
  if (!rows.length) return <EmptyState label={empty} />;
  const sortToggle = (i: number) => setSort((s) => (s && s.i === i ? { i, dir: (s.dir * -1) as 1 | -1 } : { i, dir: 1 }));
  const toggleRow = (i: number) => setOpen((s) => { const n = new Set(s); n.has(i) ? n.delete(i) : n.add(i); return n; });
  return (
    <div className="flex flex-col gap-2">
      <div className="flex justify-end gap-2">
        <ExportBtn cols={cols} rows={rows} name={colsKey} />
        {enabled && <ColumnsMenu columns={columns} hidden={hidden} onToggle={toggleCol} />}
      </div>
      <div className="overflow-x-auto -mx-1">
        <table className="w-full text-sm rtable">
          <thead>
            <tr className="text-muted">
              {hasDetail && <th scope="col" className="px-2 py-2 sticky top-0 bg-panel w-8" aria-label="Détail" />}
              {primary.map((c, i) => (
                <th key={i} scope="col" aria-sort={c.sort && sort?.i === i ? (sort.dir === 1 ? "ascending" : "descending") : undefined}
                  className={cx("px-3 py-2 font-medium text-xs sticky top-0 bg-panel select-none", c.align === "right" ? "text-right" : "text-left")}>
                  {c.sort ? (
                    <button type="button" onClick={() => sortToggle(i)} className={cx("inline-flex items-center gap-1 hover:text-ink", c.align === "right" && "flex-row-reverse")}>
                      {c.header}{sort?.i === i ? (sort.dir === 1 ? <ChevronUp size={12} /> : <ChevronDown size={12} />) : <ChevronsUpDown size={12} className="text-faint" />}
                    </button>
                  ) : <span className="inline-flex items-center gap-1">{c.header}</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pageRows.map(({ r, i: ri }) => {
              const isOpen = open.has(ri);
              return (
                <Fragment key={ri}>
                  <tr className="odd:bg-ink/[.03] hover:bg-ink/[.06] transition-colors">
                    {hasDetail && (
                      <td className="px-2 py-2 border-t border-line/60 align-middle">
                        <button type="button" onClick={() => toggleRow(ri)} aria-expanded={isOpen}
                          className="grid place-items-center w-6 h-6 rounded-md text-muted hover:text-ink hover:bg-panel2 transition-colors"
                          aria-label={isOpen ? "Masquer le détail" : "Afficher le détail"}>
                          {isOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                        </button>
                      </td>
                    )}
                    {primary.map((c, ci) => <PrimaryCell key={ci} c={c} r={r} />)}
                  </tr>
                  {hasDetail && isOpen && (
                    <tr className="bg-panel2/40">
                      <td colSpan={primary.length + 1} className="px-3 sm:px-5 py-3 border-t border-line/60"><DetailGrid cols={detail} row={r} /></td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      {paged && (() => {
        const pbtn = "btn-ghost !px-2 !py-1 inline-flex items-center gap-1 disabled:opacity-40 disabled:pointer-events-none";
        return (
        <div className="flex items-center justify-between gap-2 text-xs text-muted">
          <span className="tabnum">{safePage * pageSize + 1}–{Math.min(safePage * pageSize + pageSize, total)} sur {total}</span>
          <div className="flex items-center gap-1">
            <button type="button" onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={safePage <= 0} className={pbtn} aria-label="Page précédente">
              <ChevronLeft size={14} aria-hidden="true" />Préc.
            </button>
            <span className="tabnum px-1" aria-live="polite">{safePage + 1} / {pageCount}</span>
            <button type="button" onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))} disabled={safePage >= pageCount - 1} className={pbtn} aria-label="Page suivante">
              Suiv.<ChevronRight size={14} aria-hidden="true" />
            </button>
          </div>
        </div>
        );
      })()}
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
export function ListView({ rows, columns, searchKeys, pageSize = 25, placeholder = "Rechercher…", initialSearch = "", expand, rowKey, colsKey }:
  { rows: any[]; columns: Col[]; searchKeys: ((r: any) => any)[]; pageSize?: number; placeholder?: string; initialSearch?: string;
    // Détail masquable sous la ligne : `expand(row)` rend le panneau déplié (null ⇒ ligne non extensible).
    // `rowKey` identifie la ligne de façon stable (l'ouverture survit au tri/pagination/recherche).
    // `colsKey` active la personnalisation des colonnes (afficher/masquer), persistée sous cette clé.
    expand?: (row: any) => ReactNode; rowKey?: (row: any) => string; colsKey?: string }) {
  const [q, setQ] = useState(initialSearch);
  const [page, setPage] = useState(0);
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const { cols, hidden, toggle: toggleCol, enabled: colsEnabled } = useColVisibility(colsKey, columns);
  // Colonnes essentielles en ligne + secondaires dans le détail déroulant (zéro scroll horizontal).
  // Un `expand` explicite du module reste prioritaire ; sinon on génère la grille de détail.
  const { primary, detail: detailCols } = splitCols(cols);
  const hasDetail = !!expand || detailCols.length > 0;
  const keyOf = (r: any, i: number) => (rowKey ? rowKey(r) : String(i));
  const toggleRow = (k: string) => setOpen((s) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });
  // Remédiation guidée : quand une navigation transporte une recherche (ex. anomalie → ligne à
  // corriger), on pré-remplit le filtre. Se met à jour si l'intention change (nouvelle anomalie).
  useEffect(() => { if (initialSearch) { setQ(initialSearch); setPage(0); } }, [initialSearch]);
  const [sort, setSort] = useState<{ i: number; dir: 1 | -1 } | null>(null);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    let r = !s ? rows : rows.filter((row) => searchKeys.some((k) => String(k(row) ?? "").toLowerCase().includes(s)));
    if (sort && primary[sort.i]?.sort) {
      const key = primary[sort.i].sort!;
      r = [...r].sort((a, b) => { const va = key(a), vb = key(b); return va < vb ? -sort.dir : va > vb ? sort.dir : 0; });
    }
    return r;
    // Déps STABLES (rows/q/sort/hidden) — PAS `cols` : les colonnes sont construites en inline côté
    // appelant (identité neuve à chaque rendu) → sans ça le filtre+tri re-tournait à chaque rendu non
    // lié. `hidden` (bascule colonnes) capture le seul changement de colonnes qui doit re-trier ; `primary`
    // est relu au calcul.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, q, sort, hidden]);

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
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted tabnum">{filtered.length.toLocaleString("fr-FR")} résultat{filtered.length > 1 ? "s" : ""}{filtered.length !== rows.length ? ` / ${rows.length.toLocaleString("fr-FR")}` : ""}</span>
          <ExportBtn cols={cols} rows={filtered} name={colsKey} />
          {colsEnabled && <ColumnsMenu columns={columns} hidden={hidden} onToggle={toggleCol} />}
        </div>
      </div>
      {slice.length === 0 ? <EmptyState label="Aucun résultat." /> : (
        <div className="overflow-x-auto -mx-1">
          <table className="w-full text-sm rtable">
            <thead>
              <tr className="text-muted">
                {hasDetail && <th scope="col" className="px-2 py-2 sticky top-0 bg-panel w-8" aria-label="Détail" />}
                {primary.map((c, i) => (
                  <th key={i} scope="col" aria-sort={c.sort && sort?.i === i ? (sort.dir === 1 ? "ascending" : "descending") : undefined}
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
              {slice.map((r, ri) => {
                const k = keyOf(r, ri);
                // Détail = panneau custom du module (ex. actions groupées) ET/OU grille des colonnes
                // secondaires. Les deux coexistent : un `expand` custom n'efface plus les colonnes `det`.
                const auto = detailCols.length ? <DetailGrid cols={detailCols} row={r} /> : null;
                const custom = expand ? expand(r) : null;
                const detail = custom && auto ? <div className="flex flex-col gap-4">{custom}{auto}</div> : (custom || auto);
                const isOpen = hasDetail ? open.has(k) : false;
                return (
                <Fragment key={k}>
                  <tr className="odd:bg-ink/[.03] hover:bg-ink/[.06] transition-colors">
                    {hasDetail && (
                      <td className="px-2 py-2 border-t border-line/60 align-middle">
                        {detail ? (
                          <button type="button" onClick={() => toggleRow(k)} aria-expanded={isOpen}
                            className="grid place-items-center w-6 h-6 rounded-md text-muted hover:text-ink hover:bg-panel2 transition-colors"
                            aria-label={isOpen ? "Masquer le détail" : "Afficher le détail"}>
                            {isOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                          </button>
                        ) : null}
                      </td>
                    )}
                    {primary.map((c, ci) => <PrimaryCell key={ci} c={c} r={r} />)}
                  </tr>
                  {isOpen && detail && (
                    <tr className="bg-panel2/40">
                      <td colSpan={primary.length + 1} className="px-3 sm:px-5 py-3 border-t border-line/60">{detail}</td>
                    </tr>
                  )}
                </Fragment>
                );
              })}
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

// --- Toaster (premium) : glisse depuis la droite, accent + icône par type, fermeture manuelle ---
type Toast = { id: number; msg: string; type: "ok" | "err" | "info" };
const ToastCtx = createContext<(msg: string, type?: Toast["type"]) => void>(() => {});
const TOAST_SKIN = {
  ok: { bar: "bg-emerald", ring: "bg-emerald/12 text-emerald", Icon: CheckCircle2 },
  err: { bar: "bg-clay", ring: "bg-clay/12 text-clay", Icon: XCircle },
  info: { bar: "bg-steel", ring: "bg-steel/12 text-steel", Icon: AlertTriangle },
} as const;
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seq = useRef(0);
  const dismiss = (id: number) => setToasts((t) => t.filter((x) => x.id !== id));
  const push = (msg: string, type: Toast["type"] = "info") => {
    const id = ++seq.current;
    setToasts((t) => [...t, { id, msg, type }]);
    setTimeout(() => dismiss(id), type === "err" ? 5000 : 3500);
  };
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div role="status" aria-live="polite" className="fixed bottom-4 inset-x-4 sm:inset-x-auto sm:right-4 z-[90] flex flex-col gap-2 sm:max-w-[380px] pointer-events-none">
        {toasts.map((t) => {
          const sk = TOAST_SKIN[t.type];
          return (
            <div key={t.id} role={t.type === "err" ? "alert" : undefined} className="pointer-events-auto card overflow-hidden flex items-stretch gap-0 animate-slide-in shadow-card">
              <span className={cx("w-1 shrink-0", sk.bar)} aria-hidden="true" />
              <div className="flex items-center gap-2.5 px-3 py-2.5 text-sm flex-1 min-w-0">
                <span className={cx("shrink-0 grid place-items-center w-6 h-6 rounded-full", sk.ring)}><sk.Icon size={14} /></span>
                <span className="flex-1 min-w-0 break-words">{t.msg}</span>
                <button onClick={() => dismiss(t.id)} aria-label="Fermer" className="shrink-0 text-faint hover:text-ink transition-colors"><X size={15} /></button>
              </div>
            </div>
          );
        })}
      </div>
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);

// --- Toggle (interrupteur premium) : remplace les cases à cocher d'activation ---
export function Toggle({ checked, onChange, ariaLabel, disabled }: { checked: boolean; onChange: (v: boolean) => void; ariaLabel?: string; disabled?: boolean }) {
  return (
    <button
      type="button" role="switch" aria-checked={checked} aria-label={ariaLabel} disabled={disabled}
      onClick={() => !disabled && onChange(!checked)}
      className={cx("relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors outline-none focus-visible:ring-2 focus-visible:ring-gold/60 focus-visible:ring-offset-2 focus-visible:ring-offset-bg",
        checked ? "bg-gold" : "bg-line", disabled && "opacity-50 cursor-not-allowed")}
    >
      <span className={cx("inline-block h-5 w-5 rounded-full bg-bg shadow-sm transition-transform duration-200 ease-out", checked ? "translate-x-[22px]" : "translate-x-0.5")} />
    </button>
  );
}

// --- Modal (portail + overlay flou, Échap / clic-fond pour fermer, PIÈGE À FOCUS) ---
// Boîte de dialogue accessible : role="dialog" + aria-modal sur la CARTE (la frontière du dialogue,
// pas l'overlay), aria-labelledby vers le titre. Le focus est PIÉGÉ dans la carte (Tab/Maj+Tab bouclent
// entre le premier et le dernier élément focusable) — aria-modal seul ne piège pas dans un dialogue
// fait main. Focus initial : [data-autofocus] sinon la carte elle-même (tabIndex -1). À la fermeture,
// le focus est RESTITUÉ à l'élément déclencheur (sinon il retombait sur <body>, perdu pour le clavier).
export function Modal({ open, onClose, title, children, actions, size = "sm" }:
  { open: boolean; onClose: () => void; title?: ReactNode; children?: ReactNode; actions?: ReactNode; size?: "sm" | "md" }) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  // `onClose` capturé par REF : les appelants passent une lambda inline (identité neuve à chaque rendu).
  // Si l'effet de gestion du focus dépendait de `onClose`, il se ré-exécuterait à CHAQUE frappe (le
  // parent re-rend sur saisie) → son cleanup rend le focus au déclencheur puis le ré-effet refocalise la
  // carte, faisant PERDRE le focus du champ à chaque lettre. On ne dépend donc que de `open`.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    const card = ref.current;
    const previouslyFocused = document.activeElement as HTMLElement | null; // pour restitution à la fermeture
    const focusables = () => Array.from(
      card?.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])') || [],
    ).filter((el) => el.offsetParent !== null || el === document.activeElement);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { onCloseRef.current(); return; }
      if (e.key !== "Tab") return;
      const els = focusables();
      if (!els.length) { e.preventDefault(); card?.focus(); return; }
      const first = els[0], last = els[els.length - 1], act = document.activeElement;
      // Boucle : Maj+Tab depuis le premier → dernier ; Tab depuis le dernier → premier. Si le focus a
      // fui hors de la carte, on le ramène au bord approprié.
      if (e.shiftKey && (act === first || !card?.contains(act))) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (act === last || !card?.contains(act))) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden"; // fige le scroll d'arrière-plan
    const auto = card?.querySelector<HTMLElement>("[data-autofocus]");
    (auto || card)?.focus(); // focus initial : cible marquée, sinon la carte (tabIndex -1)
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
      previouslyFocused?.focus?.(); // restitution du focus au déclencheur
    };
  }, [open]); // volontairement PAS `onClose` (cf. onCloseRef ci-dessus) — sinon perte de focus par frappe
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-[100] grid place-items-center p-4">
      <div className="absolute inset-0 bg-ink/40 backdrop-blur-sm animate-overlay-in" onClick={onClose} />
      <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={title ? titleId : undefined}
        className={cx("relative card p-4 sm:p-5 w-full animate-scale-in outline-none", size === "md" ? "max-w-lg" : "max-w-sm")}>
        <div className="flex items-start justify-between gap-3 mb-2">
          {title ? <h2 id={titleId} className="font-display text-[17px] leading-tight text-ink">{title}</h2> : <span />}
          <button onClick={onClose} aria-label="Fermer" className="shrink-0 -mr-1 -mt-1 p-1 text-faint hover:text-ink transition-colors"><X size={18} /></button>
        </div>
        {children && <div className="text-[13px] text-muted leading-relaxed">{children}</div>}
        {actions && <div className="flex items-center justify-end gap-2 mt-4">{actions}</div>}
      </div>
    </div>,
    document.body,
  );
}

/** Bouton d'action asynchrone avec état + toast. */
// okMsg accepte une FONCTION (résultat → message) pour surfacer les compteurs d'un callable
// (« Rattachement — 12 tâches reliées ») sans réimplémenter le pattern busy+toast+trackWrite à la main.
export function Busy({ label, fn, variant = "gold", okMsg = "Fait", errMsg = "Action refusée" }: { label: string; fn: () => Promise<any>; variant?: "gold" | "ghost"; okMsg?: string | ((r: any) => string); errMsg?: string }) {
  const [s, setS] = useState<"" | "busy">("");
  const toast = useToast();
  return (
    <button
      className={variant === "gold" ? "btn-gold" : "btn-ghost"}
      disabled={s === "busy"}
      onClick={async () => { setS("busy"); try { const r = await trackWrite(fn(), label); toast(typeof okMsg === "function" ? okMsg(r) : okMsg, "ok"); } catch (e: any) { const detail = String(e?.message || e?.code || "").replace(/^functions\//, ""); toast(detail ? `${errMsg} — ${detail}` : errMsg, "err"); } finally { setS(""); } }}
    >
      {s === "busy" ? "…" : label}
    </button>
  );
}

/** Indicateur GLOBAL d'activité serveur : bandeau discret « traitement en cours » tant qu'une opération
 *  (écriture + recompute, export…) est en vol. Rend les écritures lentes « parlantes » — l'utilisateur
 *  sait que l'app travaille et que les listes vont se rafraîchir. Monté une fois au niveau App. */
export function WriteActivityBar() {
  const active = useWriteActivity();
  if (!active) return null;
  return (
    <div className="fixed top-2 left-1/2 -translate-x-1/2 z-[60] pointer-events-none" role="status" aria-live="polite">
      <div className="flex items-center gap-2 rounded-full border border-gold/40 bg-panel2 px-3 py-1 text-[11px] text-ink shadow-lg">
        <span className="w-2 h-2 rounded-full bg-gold animate-pulse" aria-hidden="true" />
        Traitement en cours… <span className="text-faint hidden sm:inline">recalcul des agrégats</span>
      </div>
    </div>
  );
}

// Le panneau (portail + liste) est chargé en LAZY à la 1re ouverture → hors chunk d'entrée (check-bundle).
const ActivityDrawer = lazy(() => import("./ActivityDrawer"));

/** CENTRE D'ACTIVITÉ : lanceur flottant + panneau (lazy) listant les opérations (en cours / terminées /
 *  échouées) avec horodatage et détail — au-delà du toast éphémère, l'utilisateur SAIT ce qui se passe et
 *  s'est passé. Alimenté par trackWrite (tous les boutons Busy/DangerBtn). Monté une fois au niveau App. */
export function ActivityCenter() {
  const log = useActivityLog();
  const [open, setOpen] = useState(false);
  const running = log.filter((e) => e.status === "running").length;
  const errors = log.filter((e) => e.status === "error").length;
  return (
    <>
      <button
        type="button" onClick={() => setOpen((o) => !o)}
        aria-label={`Centre d'activité${running ? ` — ${running} en cours` : ""}`} aria-expanded={open}
        className="fixed bottom-4 left-4 z-[80] flex items-center gap-1.5 rounded-full border border-line bg-panel2 px-3 py-1.5 text-[11px] text-ink shadow-lg hover:border-gold/50 transition-colors"
      >
        {running ? <Loader2 size={13} className="animate-spin text-gold" /> : <Activity size={13} className={errors ? "text-clay" : "text-faint"} />}
        <span>Activité</span>
        {running > 0 && <span className="rounded-full bg-gold/15 text-gold px-1.5 leading-tight">{running}</span>}
        {running === 0 && errors > 0 && <span className="rounded-full bg-clay/15 text-clay px-1.5 leading-tight">{errors}</span>}
      </button>
      {open && <Suspense fallback={null}><ActivityDrawer onClose={() => setOpen(false)} /></Suspense>}
    </>
  );
}

/** Bouton d'action DESTRUCTIVE : confirmation obligatoire avant exécution (annulation silencieuse),
 *  puis état + toast. Sert à l'assainissement (suppression d'enregistrements). */
export function DangerBtn({ label, confirm, fn, okMsg = "Supprimé", errMsg = "Suppression refusée", tone = "clay", confirmLabel }: { label: string; confirm: string; fn: () => Promise<any>; okMsg?: string; errMsg?: string; tone?: "clay" | "gold" | "steel"; confirmLabel?: string }) {
  const [s, setS] = useState<"" | "busy">("");
  const [open, setOpen] = useState(false);
  const toast = useToast();
  const toneCls = tone === "gold" ? "text-gold" : tone === "steel" ? "text-steel" : "text-clay";
  // Ton du bouton de confirmation dans la modale : rouge (clay) pour destructif, doré/acier sinon.
  const confirmBtnCls = tone === "clay" ? "btn bg-clay text-bg hover:bg-clay/90" : tone === "steel" ? "btn bg-steel text-bg hover:bg-steel/90" : "btn-gold";
  const run = async () => {
    setOpen(false); setS("busy");
    try { await trackWrite(fn(), label); toast(okMsg, "ok"); } catch (e: any) { const detail = String(e?.message || e?.code || "").replace(/^functions\//, ""); toast(detail ? `${errMsg} — ${detail}` : errMsg, "err"); } finally { setS(""); }
  };
  return (
    <>
      <button className={cx("btn-ghost hover:opacity-80", toneCls)} disabled={s === "busy"} onClick={() => setOpen(true)}>
        {s === "busy" ? "…" : label}
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="Confirmer l'action"
        actions={<>
          <button className="btn-ghost" onClick={() => setOpen(false)}>Annuler</button>
          <button className={confirmBtnCls} data-autofocus onClick={run}>{confirmLabel || label}</button>
        </>}>
        {confirm}
      </Modal>
    </>
  );
}

// Confirmation accessible et promise-based — remplace `window.confirm` (piégeage clavier, pas de
// style, bloque le thread). Retourne [ask, node] : place `node` dans le rendu, et fais
// `if (!(await ask("message"))) return;` en tête du handler. Utile quand l'action garde sa propre
// logique de toast/état occupé (là où DangerBtn, avec son toast générique, ne convient pas).
export function useConfirm() {
  const [state, setState] = useState<{ message: ReactNode; title?: string; confirmLabel?: string; tone?: "clay" | "gold" | "steel"; resolve: (v: boolean) => void } | null>(null);
  const ask = (message: ReactNode, opts?: { title?: string; confirmLabel?: string; tone?: "clay" | "gold" | "steel" }) =>
    new Promise<boolean>((resolve) => setState({ message, title: opts?.title, confirmLabel: opts?.confirmLabel, tone: opts?.tone, resolve }));
  const close = (v: boolean) => { state?.resolve(v); setState(null); };
  const tone = state?.tone || "gold";
  const btnCls = tone === "clay" ? "btn bg-clay text-bg hover:bg-clay/90" : tone === "steel" ? "btn bg-steel text-bg hover:bg-steel/90" : "btn-gold";
  const node = (
    <Modal open={!!state} onClose={() => close(false)} title={state?.title || "Confirmer l'action"}
      actions={<>
        <button className="btn-ghost" onClick={() => close(false)}>Annuler</button>
        <button className={btnCls} data-autofocus onClick={() => close(true)}>{state?.confirmLabel || "Confirmer"}</button>
      </>}>
      {state?.message}
    </Modal>
  );
  return [ask, node] as const;
}

export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null; stale: boolean }> {
  state = { error: null as Error | null, stale: false };
  static getDerivedStateFromError(error: Error) { return { error, stale: isStaleChunkError(error) }; }
  componentDidCatch(error: Error) {
    // CHUNK PÉRIMÉ après déploiement (chemin RUNTIME import()) : ce n'est pas un crash applicatif mais un
    // artefact de déploiement. On recharge une fois (util partagé) et on NE REMONTE PAS l'erreur (sinon
    // l'observabilité se remplit de faux positifs à chaque livraison — cf. « Failed to fetch … module »).
    if (isStaleChunkError(error)) { reloadForStaleChunk(); return; }
    // Vrai crash de rendu → observabilité (best-effort ; import paresseux pour éviter tout cycle d'import).
    import("../lib/errorReporter").then((m) => m.reportError(error?.message || "Crash de rendu", "ErrorBoundary", error?.stack)).catch(() => {});
  }
  render() {
    if (this.state.error) {
      // Chunk périmé : message doux + rechargement (le reload de componentDidCatch a pu être throttlé).
      if (this.state.stale) {
        return (
          <Card title="Mise à jour">
            <div className="flex items-start gap-2 text-muted text-sm">
              <AlertTriangle size={16} className="mt-0.5 shrink-0" />
              <span>Une nouvelle version est disponible. Rechargement…</span>
            </div>
            <button className="btn-ghost mt-3" onClick={() => reloadForStaleChunk() || window.location.reload()}>Recharger</button>
          </Card>
        );
      }
      return (
        <Card title="Erreur d'affichage">
          <div className="flex items-start gap-2 text-clay text-sm">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
            <span>{String(this.state.error.message || this.state.error)}</span>
          </div>
          <button className="btn-ghost mt-3" onClick={() => this.setState({ error: null, stale: false })}>Réessayer</button>
        </Card>
      );
    }
    return this.props.children;
  }
}
