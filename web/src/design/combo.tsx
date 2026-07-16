// Contrôles de saisie RECHERCHABLES (Combo autocomplete, MonthField) — séparés d'inputs.tsx pour rester
// HORS du chunk d'entrée : inputs.tsx (Select/DateField) est chargé par le shell via _shared, alors que
// Combo/MonthField ne servent que dans des écrans lazy → ils vivent dans leur propre chunk. Réutilisent le
// Panel portail d'inputs.tsx (exporté).
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, Check, Calendar, X, Search, Plus, Loader2, ChevronDown } from "lucide-react";
import { cx } from "./components";
import { Panel } from "./inputs";

// --- COMBO premium (saisie RECHERCHABLE : filtre + autocomplete + création optionnelle) ---
// Remplace un <input> libre quand un référentiel existe (client, AM, BU, fournisseur, FP…). Réutilise le
// Panel portail + la logique clavier/ARIA de Select, mais sur un <input role="combobox">. Deux modes :
//   - `options` : liste statique filtrée EN MÉMOIRE (insensible casse + accents, comme clientName.noAcc) ;
//   - `loadOptions` : async débouncé (référentiels callable-only). `allowCreate` : accepte une valeur libre.
export type ComboOpt = { value: string; label: string; hint?: ReactNode; disabled?: boolean };
const noAcc = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

export function Combo({ value, onChange, options, loadOptions, ariaLabel, placeholder = "Rechercher…",
  allowCreate = false, createLabel = (q: string) => `Créer « ${q} »`, clearable = true, disabled, className,
  emptyLabel = "Aucun résultat", minChars = 0, autoFocus = false }:
  { value: string; onChange: (v: string) => void; options?: ComboOpt[]; loadOptions?: (q: string) => Promise<ComboOpt[]>;
    ariaLabel?: string; placeholder?: string; allowCreate?: boolean; createLabel?: (q: string) => string;
    clearable?: boolean; disabled?: boolean; className?: string; emptyLabel?: ReactNode; minChars?: number; autoFocus?: boolean }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [hi, setHi] = useState(0);
  const [remote, setRemote] = useState<ComboOpt[] | null>(null);
  const [busy, setBusy] = useState(false);
  const inp = useRef<HTMLInputElement>(null);
  const skipBlur = useRef(false); // évite un double-commit quand une option vient d'être choisie (commit → blur programmatique)
  const lid = useId();
  const optId = (i: number) => `${lid}-opt-${i}`;

  const base = remote ?? options ?? [];
  const nq = noAcc(q.trim());
  const filtered = !nq ? base : base.filter((o) => noAcc(o.label).includes(nq));
  const exact = base.some((o) => noAcc(o.label) === nq || o.value === q.trim());
  const rows: (ComboOpt & { _create?: boolean })[] =
    allowCreate && nq && !exact ? [...filtered, { value: q.trim(), label: createLabel(q.trim()), _create: true }] : filtered;
  const selectedLabel = base.find((o) => o.value === value)?.label ?? value;

  useEffect(() => { if (open) setHi(0); }, [open, q]);
  // Chargement async débouncé (200 ms) — n'ouvre/charge qu'à partir de minChars caractères.
  useEffect(() => {
    if (!loadOptions || !open) return;
    if (q.trim().length < minChars) { setRemote([]); return; }
    setBusy(true);
    const t = setTimeout(() => { loadOptions(q).then(setRemote).catch(() => setRemote([])).finally(() => setBusy(false)); }, 200);
    return () => clearTimeout(t);
  }, [q, open]); // eslint-disable-line

  const commit = (o: ComboOpt) => { if (o.disabled) return; skipBlur.current = true; onChange(o.value); setQ(""); setOpen(false); inp.current?.blur(); };
  // Perte de focus : en saisie libre (allowCreate), on committe le texte tapé mais non sélectionné — sinon
  // un clic direct sur le bouton d'action (hors panneau) enregistrait une valeur vide (« taper = valeur »).
  const onBlur = () => {
    if (skipBlur.current) { skipBlur.current = false; return; }
    if (allowCreate) { const t = q.trim(); if (t && t !== value) onChange(t); }
    setQ(""); setOpen(false);
  };
  const move = (d: number) => setHi((h) => {
    if (!rows.length) return 0;
    let n = h;
    for (let i = 0; i < rows.length; i++) { n = (n + d + rows.length) % rows.length; if (!rows[n].disabled) break; }
    return n;
  });
  const onKey = (e: React.KeyboardEvent) => {
    if (disabled) return;
    if (!open && (e.key === "ArrowDown" || e.key === "Enter")) { e.preventDefault(); setOpen(true); return; }
    if (!open) return;
    if (e.key === "ArrowDown") { e.preventDefault(); move(1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); move(-1); }
    else if (e.key === "Enter") { e.preventDefault(); if (rows[hi]) commit(rows[hi]); }
    else if (e.key === "Escape") { e.preventDefault(); setQ(""); setOpen(false); }
  };

  return (
    <>
      <div className={cx("field inline-flex items-center gap-2 !py-0 !pl-0", disabled && "opacity-50 cursor-not-allowed", className)}>
        <Search size={14} className="shrink-0 text-muted ml-3" />
        <input
          ref={inp} type="text" role="combobox" aria-autocomplete="list" aria-expanded={open} aria-label={ariaLabel}
          aria-controls={open ? lid : undefined} aria-activedescendant={open && rows[hi] ? optId(hi) : undefined}
          disabled={disabled} placeholder={value && !open ? undefined : placeholder}
          {...(autoFocus ? { "data-autofocus": true } : {})}
          className="flex-1 min-w-0 bg-transparent outline-none py-2 text-sm text-ink placeholder:text-muted"
          value={open ? q : (selectedLabel as string) || ""}
          onChange={(e) => { setQ(e.target.value); if (!open) setOpen(true); }}
          onFocus={() => setOpen(true)} onKeyDown={onKey} onBlur={onBlur}
        />
        {busy && <Loader2 size={14} className="shrink-0 animate-spin text-gold" />}
        {clearable && value && !disabled && (
          <button type="button" tabIndex={-1} aria-label="Effacer" className="shrink-0 text-muted hover:text-clay"
            onMouseDown={(e) => { e.preventDefault(); onChange(""); setQ(""); }}><X size={14} /></button>
        )}
        <ChevronDown size={15} className={cx("shrink-0 text-muted transition-transform mr-2", open && "rotate-180")} />
      </div>
      {open && (
        <Panel anchor={inp.current} onClose={() => { setQ(""); setOpen(false); }} minWidth={200}>
          <ul id={lid} role="listbox" aria-label={ariaLabel} className="max-h-[280px] overflow-auto">
            {rows.length === 0 && <li className="px-2.5 py-2 text-[13px] text-faint">{busy ? "Recherche…" : emptyLabel}</li>}
            {rows.map((o, i) => {
              const on = o.value === value;
              return (
                <li key={o.value + "-" + i} id={optId(i)} role="option" aria-selected={on} aria-disabled={o.disabled}
                  onMouseEnter={() => setHi(i)} onMouseDown={(e) => { e.preventDefault(); commit(o); }}
                  className={cx("flex items-center gap-2 rounded-lg px-2.5 py-2 text-[13px] cursor-pointer select-none",
                    o.disabled ? "text-faint opacity-50 cursor-not-allowed" : i === hi ? "bg-gold/15 text-ink" : "text-ink hover:bg-ink/[.05]")}>
                  {o._create ? <Plus size={14} className="shrink-0 text-gold" /> : <Check size={14} className={cx("shrink-0", on ? "text-gold" : "opacity-0")} />}
                  <span className="truncate">{o.label}</span>
                  {o.hint != null && <span className="ml-auto text-[11px] text-faint shrink-0">{o.hint}</span>}
                </li>
              );
            })}
          </ul>
        </Panel>
      )}
    </>
  );
}

// --- MONTH FIELD premium (remplace <input type="month">) : sélecteur mois+année maison. value = "AAAA-MM" ---
const MO_SHORT = ["Jan", "Fév", "Mar", "Avr", "Mai", "Juin", "Juil", "Août", "Sep", "Oct", "Nov", "Déc"];
const parseMonth = (s?: string): { y: number; m: number } | null => {
  const mt = /^(\d{4})-(\d{2})/.exec(String(s || "")); return mt ? { y: +mt[1], m: +mt[2] } : null;
};
export function MonthField({ value, onChange, ariaLabel, placeholder = "mm/aaaa", disabled, clearable = true, className }:
  { value: string; onChange: (v: string) => void; ariaLabel?: string; placeholder?: string; disabled?: boolean; clearable?: boolean; className?: string }) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const sel = parseMonth(value);
  const [year, setYear] = useState<number>(() => sel?.y || new Date().getFullYear());
  useEffect(() => { if (open) setYear(parseMonth(value)?.y || new Date().getFullYear()); }, [open]); // eslint-disable-line
  const pick = (m: number) => { onChange(`${year}-${String(m).padStart(2, "0")}`); setOpen(false); btn.current?.focus(); };
  const display = sel ? `${String(sel.m).padStart(2, "0")}/${sel.y}` : "";

  return (
    <>
      <button ref={btn} type="button" disabled={disabled} aria-haspopup="dialog" aria-expanded={open} aria-label={ariaLabel}
        onClick={() => !disabled && setOpen((v) => !v)}
        onKeyDown={(e) => { if (!open && (e.key === "Enter" || e.key === " " || e.key === "ArrowDown")) { e.preventDefault(); setOpen(true); } }}
        className={cx("field inline-flex items-center justify-between gap-2 text-left", disabled && "opacity-50 cursor-not-allowed", !sel && "text-muted", className)}>
        <span className="inline-flex items-center gap-2 truncate"><Calendar size={14} className="shrink-0 text-muted" />{sel ? display : placeholder}</span>
        {clearable && sel && !disabled && (
          <span role="button" tabIndex={-1} aria-label="Effacer" className="shrink-0 text-muted hover:text-clay"
            onClick={(e) => { e.stopPropagation(); onChange(""); }}><X size={14} /></span>
        )}
      </button>
      {open && (
        <Panel anchor={btn.current} onClose={() => setOpen(false)} minWidth={232}>
          <div className="p-1.5 w-[224px]" role="dialog" aria-modal="false" aria-label={`${ariaLabel || "Mois"} — ${year}`}>
            <div className="flex items-center justify-between mb-2">
              <button type="button" className="btn-ghost !p-1.5" aria-label="Année précédente" onClick={() => setYear((y) => y - 1)}><ChevronLeft size={16} /></button>
              <div className="text-[13px] font-semibold text-ink tabnum">{year}</div>
              <button type="button" className="btn-ghost !p-1.5" aria-label="Année suivante" onClick={() => setYear((y) => y + 1)}><ChevronRight size={16} /></button>
            </div>
            <div className="grid grid-cols-3 gap-1">
              {MO_SHORT.map((mo, i) => {
                const m = i + 1;
                const on = sel && sel.y === year && sel.m === m;
                return (
                  <button key={mo} type="button" onClick={() => pick(m)} aria-pressed={!!on}
                    className={cx("h-9 rounded-lg text-[12px] transition-colors", on ? "bg-gold text-bg font-semibold" : "text-ink hover:bg-ink/[.06]")}>
                    {mo}
                  </button>
                );
              })}
            </div>
            {clearable && <div className="flex justify-end mt-2 pt-2 border-t border-line/60">
              <button type="button" className="text-[12px] text-muted hover:text-clay" onClick={() => { onChange(""); setOpen(false); }}>Effacer</button>
            </div>}
          </div>
        </Panel>
      )}
    </>
  );
}
