// Contrôles de saisie PREMIUM (remplacent les natifs <select> / <input type=date>).
// 100 % maison, sans dépendance : cohérents avec le design system (tokens, thème clair/sombre),
// accessibles (clavier + ARIA) et positionnés par PORTAIL en position fixe → fonctionnent même dans
// une cellule de tableau à débordement (overflow) sans être tronqués.
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, ChevronLeft, ChevronRight, Check, Calendar, X, Search, Plus, Loader2 } from "lucide-react";
import { cx } from "./components";

// --- Popover ancré (portail + position fixe, avec bascule vers le haut si peu de place) ---
function useAnchoredPanel(open: boolean, anchor: HTMLElement | null) {
  const [pos, setPos] = useState<{ left: number; top: number; width: number; drop: "down" | "up" } | null>(null);
  useLayoutEffect(() => {
    if (!open || !anchor) return;
    const compute = () => {
      const r = anchor.getBoundingClientRect();
      const below = window.innerHeight - r.bottom;
      const drop: "down" | "up" = below < 300 && r.top > below ? "up" : "down";
      setPos({ left: r.left, top: drop === "down" ? r.bottom + 6 : r.top - 6, width: r.width, drop });
    };
    compute();
    // Recalcule sur scroll (capture : attrape aussi les conteneurs internes) et redimensionnement.
    window.addEventListener("scroll", compute, true);
    window.addEventListener("resize", compute);
    return () => { window.removeEventListener("scroll", compute, true); window.removeEventListener("resize", compute); };
  }, [open, anchor]);
  return pos;
}

function Panel({ anchor, onClose, children, minWidth }: { anchor: HTMLElement | null; onClose: () => void; children: ReactNode; minWidth?: number }) {
  const pos = useAnchoredPanel(true, anchor);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (ref.current && !ref.current.contains(t) && anchor && !anchor.contains(t)) onClose();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDoc); document.removeEventListener("keydown", onKey); };
  }, [anchor, onClose]);
  if (!pos) return null;
  return createPortal(
    <div
      ref={ref}
      className="fixed z-[120] rounded-xl border border-line bg-panel shadow-card p-1 animate-fade-in"
      style={{
        left: pos.left, width: Math.max(pos.width, minWidth || 0),
        ...(pos.drop === "down" ? { top: pos.top } : { top: pos.top, transform: "translateY(-100%)" }),
      }}
    >
      {children}
    </div>,
    document.body,
  );
}

// --- SELECT premium (remplace <select>) ---
export type Opt = { value: string; label: ReactNode; disabled?: boolean };
export function Select({ value, onChange, options, ariaLabel, placeholder = "Sélectionner…", disabled, className }:
  { value: string; onChange: (v: string) => void; options: Opt[]; ariaLabel?: string; placeholder?: string; disabled?: boolean; className?: string }) {
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(-1); // index surligné (navigation clavier)
  const btn = useRef<HTMLButtonElement>(null);
  const sel = options.find((o) => o.value === value);
  const typeBuf = useRef({ s: "", t: 0 });
  const lid = useId(); // base d'id stable pour lier bouton ↔ liste ↔ option surlignée (a11y listbox)
  const optId = (i: number) => `${lid}-opt-${i}`;

  useEffect(() => { if (open) setHi(options.findIndex((o) => o.value === value)); }, [open]); // eslint-disable-line

  const pick = (o: Opt) => { if (o.disabled) return; onChange(o.value); setOpen(false); btn.current?.focus(); };
  const move = (d: number) => {
    setHi((h) => {
      let n = h;
      for (let i = 0; i < options.length; i++) { n = (n + d + options.length) % options.length; if (!options[n].disabled) break; }
      return n;
    });
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (disabled) return;
    if (!open && (e.key === "Enter" || e.key === " " || e.key === "ArrowDown")) { e.preventDefault(); setOpen(true); return; }
    if (!open) return;
    if (e.key === "ArrowDown") { e.preventDefault(); move(1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); move(-1); }
    else if (e.key === "Enter") { e.preventDefault(); if (options[hi]) pick(options[hi]); }
    else if (e.key === "Home") { e.preventDefault(); setHi(options.findIndex((o) => !o.disabled)); }
    else if (e.key === "End") { e.preventDefault(); for (let i = options.length - 1; i >= 0; i--) if (!options[i].disabled) { setHi(i); break; } }
    else if (e.key.length === 1) {
      // Recherche par frappe (type-ahead).
      const now = Date.now();
      typeBuf.current = { s: (now - typeBuf.current.t < 700 ? typeBuf.current.s : "") + e.key.toLowerCase(), t: now };
      const idx = options.findIndex((o) => typeof o.label === "string" && (o.label as string).toLowerCase().startsWith(typeBuf.current.s));
      if (idx >= 0) setHi(idx);
    }
  };

  return (
    <>
      <button
        ref={btn} type="button" disabled={disabled} aria-haspopup="listbox" aria-expanded={open} aria-label={ariaLabel}
        aria-controls={open ? lid : undefined} aria-activedescendant={open && hi >= 0 ? optId(hi) : undefined}
        onClick={() => !disabled && setOpen((v) => !v)} onKeyDown={onKey}
        className={cx("field inline-flex items-center justify-between gap-2 text-left", disabled && "opacity-50 cursor-not-allowed", !sel && "text-muted", className)}
      >
        <span className="truncate">{sel ? sel.label : placeholder}</span>
        <ChevronDown size={15} className={cx("shrink-0 text-muted transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <Panel anchor={btn.current} onClose={() => setOpen(false)} minWidth={180}>
          <ul id={lid} role="listbox" aria-label={ariaLabel} className="max-h-[280px] overflow-auto">
            {options.map((o, i) => {
              const on = o.value === value;
              return (
                <li key={o.value} id={optId(i)} role="option" aria-selected={on} aria-disabled={o.disabled}
                  onMouseEnter={() => setHi(i)} onMouseDown={(e) => { e.preventDefault(); pick(o); }}
                  className={cx("flex items-center gap-2 rounded-lg px-2.5 py-2 text-[13px] cursor-pointer select-none",
                    o.disabled ? "text-faint opacity-50 cursor-not-allowed" : i === hi ? "bg-gold/15 text-ink" : "text-ink hover:bg-ink/[.05]")}>
                  <Check size={14} className={cx("shrink-0", on ? "text-gold" : "opacity-0")} />
                  <span className="truncate">{o.label}</span>
                </li>
              );
            })}
          </ul>
        </Panel>
      )}
    </>
  );
}

// --- DATE FIELD premium (remplace <input type="date">) : calendrier maison, semaine lun→dim ---
const WD = ["lun", "mar", "mer", "jeu", "ven", "sam", "dim"];
const MO = ["Janvier", "Février", "Mars", "Avril", "Mai", "Juin", "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"];
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const parseISO = (s?: string): Date | null => {
  if (!s || !/^\d{4}-\d{2}-\d{2}/.test(s)) return null;
  const [y, m, d] = s.slice(0, 10).split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  return isNaN(dt.getTime()) ? null : dt;
};
const fmtFr = (s?: string) => { const d = parseISO(s); return d ? `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}` : ""; };

export function DateField({ value, onChange, ariaLabel, placeholder = "jj/mm/aaaa", disabled, clearable = true, className }:
  { value: string; onChange: (v: string) => void; ariaLabel?: string; placeholder?: string; disabled?: boolean; clearable?: boolean; className?: string }) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const sel = parseISO(value);
  const [view, setView] = useState<Date>(() => sel || new Date());
  useEffect(() => { if (open) setView(parseISO(value) || new Date()); }, [open]); // eslint-disable-line

  const y = view.getFullYear(), m = view.getMonth();
  const first = new Date(y, m, 1);
  const offset = (first.getDay() + 6) % 7; // lundi = 0
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const today = iso(new Date());
  const cells: (Date | null)[] = [];
  for (let i = 0; i < offset; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(y, m, d));

  const pick = (d: Date) => { onChange(iso(d)); setOpen(false); btn.current?.focus(); };

  return (
    <>
      <button
        ref={btn} type="button" disabled={disabled} aria-haspopup="dialog" aria-expanded={open} aria-label={ariaLabel}
        onClick={() => !disabled && setOpen((v) => !v)}
        onKeyDown={(e) => { if (!open && (e.key === "Enter" || e.key === " " || e.key === "ArrowDown")) { e.preventDefault(); setOpen(true); } }}
        className={cx("field inline-flex items-center justify-between gap-2 text-left", disabled && "opacity-50 cursor-not-allowed", !sel && "text-muted", className)}
      >
        <span className="inline-flex items-center gap-2 truncate"><Calendar size={14} className="shrink-0 text-muted" />{sel ? fmtFr(value) : placeholder}</span>
        {clearable && sel && !disabled && (
          <span role="button" tabIndex={-1} aria-label="Effacer la date" className="shrink-0 text-muted hover:text-clay"
            onClick={(e) => { e.stopPropagation(); onChange(""); }}><X size={14} /></span>
        )}
      </button>
      {open && (
        <Panel anchor={btn.current} onClose={() => setOpen(false)} minWidth={272}>
          <div className="p-1.5 w-[264px]" role="dialog" aria-modal="false" aria-label={`${ariaLabel || "Date"} — ${MO[m]} ${y}`}>
            <div className="flex items-center justify-between mb-2">
              <button type="button" className="btn-ghost !p-1.5" aria-label="Mois précédent" onClick={() => setView(new Date(y, m - 1, 1))}><ChevronLeft size={16} /></button>
              <div className="text-[13px] font-semibold text-ink">{MO[m]} {y}</div>
              <button type="button" className="btn-ghost !p-1.5" aria-label="Mois suivant" onClick={() => setView(new Date(y, m + 1, 1))}><ChevronRight size={16} /></button>
            </div>
            <div className="grid grid-cols-7 gap-0.5 mb-1">
              {WD.map((w) => <div key={w} className="text-center text-[10px] uppercase tracking-wide text-faint py-1">{w}</div>)}
            </div>
            <div className="grid grid-cols-7 gap-0.5">
              {cells.map((d, i) => {
                if (!d) return <div key={i} />;
                const di = iso(d);
                const on = value && di === value.slice(0, 10);
                const isToday = di === today;
                return (
                  <button key={i} type="button" onClick={() => pick(d)}
                    aria-label={`${d.getDate()} ${MO[m]} ${y}`} aria-pressed={!!on} aria-current={isToday ? "date" : undefined}
                    className={cx("h-8 rounded-lg text-[12px] tabnum transition-colors",
                      on ? "bg-gold text-bg font-semibold" : isToday ? "text-gold font-semibold hover:bg-ink/[.06]" : "text-ink hover:bg-ink/[.06]")}>
                    {d.getDate()}
                  </button>
                );
              })}
            </div>
            <div className="flex items-center justify-between mt-2 pt-2 border-t border-line/60">
              <button type="button" className="text-[12px] text-gold hover:opacity-80" onClick={() => pick(new Date())}>Aujourd'hui</button>
              {clearable && <button type="button" className="text-[12px] text-muted hover:text-clay" onClick={() => { onChange(""); setOpen(false); }}>Effacer</button>}
            </div>
          </div>
        </Panel>
      )}
    </>
  );
}

// --- COMBO premium (saisie RECHERCHABLE : filtre + autocomplete + création optionnelle) ---
// Remplace un <input> libre quand un référentiel existe (client, AM, BU, fournisseur, FP…). Réutilise le
// Panel portail + la logique clavier/ARIA de Select, mais sur un <input role="combobox">. Deux modes :
//   - `options` : liste statique filtrée EN MÉMOIRE (insensible casse + accents, comme clientName.noAcc) ;
//   - `loadOptions` : async débouncé (référentiels callable-only). `allowCreate` : accepte une valeur libre.
export type ComboOpt = { value: string; label: string; hint?: ReactNode; disabled?: boolean };
const noAcc = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

export function Combo({ value, onChange, options, loadOptions, ariaLabel, placeholder = "Rechercher…",
  allowCreate = false, createLabel = (q: string) => `Créer « ${q} »`, clearable = true, disabled, className,
  emptyLabel = "Aucun résultat", minChars = 0 }:
  { value: string; onChange: (v: string) => void; options?: ComboOpt[]; loadOptions?: (q: string) => Promise<ComboOpt[]>;
    ariaLabel?: string; placeholder?: string; allowCreate?: boolean; createLabel?: (q: string) => string;
    clearable?: boolean; disabled?: boolean; className?: string; emptyLabel?: ReactNode; minChars?: number }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [hi, setHi] = useState(0);
  const [remote, setRemote] = useState<ComboOpt[] | null>(null);
  const [busy, setBusy] = useState(false);
  const inp = useRef<HTMLInputElement>(null);
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

  const commit = (o: ComboOpt) => { if (o.disabled) return; onChange(o.value); setQ(""); setOpen(false); inp.current?.blur(); };
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
          className="flex-1 min-w-0 bg-transparent outline-none py-2 text-sm text-ink placeholder:text-muted"
          value={open ? q : (selectedLabel as string) || ""}
          onChange={(e) => { setQ(e.target.value); if (!open) setOpen(true); }}
          onFocus={() => setOpen(true)} onKeyDown={onKey}
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
