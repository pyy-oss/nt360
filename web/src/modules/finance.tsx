// Modules finance : Objectifs / R-O, Facturation, liste Factures, Rentabilité.
import { useState, type FC } from "react";
import { useDocData, useCollectionData } from "../lib/hooks";
import { useCan, useCanImport } from "../lib/rbac";
import { T, fmt, pct } from "../design/tokens";
import { Card, Kpi, Table, Badge, Tip, EmptyState, ErrorState, CardSkeleton, Busy, ListView, colText, colNum, money, cx, useToast } from "../design/components";
import { AreaTrend, DonutBU, GroupedBars } from "../design/charts";
import { upsertObjective, deleteObjective, objectiveId, setInvoiceFp } from "../lib/writes";
import { Props, grid4, cols2, monthsAsc, topArr, toDonut, HBars, buBadge, ImportButton, FilterNote } from "./_shared";
import { useFilters } from "../lib/filters";
import type { FacturationSummary, RentabiliteSummary, Objective, Invoice } from "../types";

// 3 — Objectifs / R-O
const SCOPES = [
  { v: "global", label: "Global" },
  { v: "bu", label: "Par BU" },
  { v: "commercial", label: "Par commercial (AM)" },
  { v: "client", label: "Par client" },
];
const EMPTY_OBJ = { fiscalYear: "", scope: "global", scopeValue: "all", label: "", targetCas: "", targetInvoiced: "", targetMargin: "", targetMarginPct: "" };

export const Objectifs: FC<Props> = () => {
  const { rows } = useCollectionData<Objective>("objectives");
  const canWrite = useCan("objectifs") === "write";
  const toast = useToast();
  const [f, setF] = useState({ ...EMPTY_OBJ });
  const [editingId, setEditingId] = useState<string | null>(null);
  const set = (k: keyof typeof f, v: string) => setF((s) => ({ ...s, [k]: v }));
  const reset = () => { setF({ ...EMPTY_OBJ }); setEditingId(null); };

  const edit = (x: Objective) => {
    setEditingId(x.id || null);
    setF({
      fiscalYear: String(x.fiscalYear || ""), scope: x.scope || "global", scopeValue: x.scopeValue || "all", label: x.label || "",
      targetCas: String(x.targetCas || ""), targetInvoiced: String(x.targetInvoiced || ""), targetMargin: String(x.targetMargin || ""), targetMarginPct: String(x.targetMarginPct || ""),
    });
  };

  const save = async () => {
    const fiscalYear = Number(f.fiscalYear) || 0;
    if (fiscalYear < 2000) { toast("Année invalide (ex. 2026).", "err"); return; }
    const scopeValue = f.scope === "global" ? "all" : (f.scopeValue.trim() || "all");
    const payload = {
      fiscalYear, scope: f.scope, scopeValue, label: f.label.trim() || undefined,
      targetCas: Number(f.targetCas) || 0, targetInvoiced: Number(f.targetInvoiced) || 0,
      targetMargin: Number(f.targetMargin) || 0, targetMarginPct: Number(f.targetMarginPct) || 0,
    };
    // Si la clé (année/périmètre/valeur) a changé lors d'une édition, supprimer l'ancien doc.
    if (editingId && editingId !== objectiveId(payload)) await deleteObjective(editingId);
    await upsertObjective(payload);
    reset();
  };

  const remove = async (x: Objective) => {
    if (!x.id || !window.confirm(`Supprimer l'objectif « ${x.fiscalYear} ${x.scope} ${x.scopeValue} » ?`)) return;
    await deleteObjective(x.id);
    if (editingId === x.id) reset();
  };

  const cols = [
    colText("Périmètre", (x) => x.label || `${x.fiscalYear} ${x.scope || ""} ${x.scopeValue || ""}`.trim(), (x) => `${x.fiscalYear}${x.scope}`),
    colNum("Cible CAS", (x) => money(x.targetCas), (x) => x.targetCas || 0),
    colNum("Cible Facturé", (x) => money(x.targetInvoiced), (x) => x.targetInvoiced || 0),
    colNum("Cible Marge", (x) => money(x.targetMargin), (x) => x.targetMargin || 0),
    colNum("Cible %MB", (x) => x.targetMarginPct ? pct(x.targetMarginPct) : "—", (x) => x.targetMarginPct || 0),
    ...(canWrite ? [colNum("", (x: Objective) => (
      <span className="inline-flex gap-1.5 justify-end">
        <button className="btn-ghost !px-2.5 !py-1 text-xs" onClick={() => edit(x)}>Modifier</button>
        <Busy variant="ghost" label="Suppr." okMsg="Objectif supprimé" fn={() => remove(x)} />
      </span>
    ))] : []),
  ];

  return (
    <div className="flex flex-col gap-4">
      <Card title="Objectifs annuels par univers / dimension">
        <Table columns={cols} rows={rows} empty="Aucun objectif défini." />
        <Tip>Cette page sert uniquement à <b>définir les objectifs</b> (global, par BU, par client, par commercial). Le <b>R/O (Réalisé / Objectif)</b> se suit désormais sur la vue de chaque périmètre : global → Vue d'ensemble · BU → Domaines · client → Clients · commercial → AM 360°.</Tip>
      </Card>
      {canWrite && (
        <Card title={editingId ? "Modifier l'objectif" : "Ajouter un objectif"}>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            <label className="flex flex-col gap-1 text-xs text-muted">Année fiscale
              <input className="field" type="number" min={2000} placeholder="2026" value={f.fiscalYear} onChange={(e) => set("fiscalYear", e.target.value)} /></label>
            <label className="flex flex-col gap-1 text-xs text-muted">Périmètre
              <select className="field" value={f.scope} onChange={(e) => set("scope", e.target.value)}>{SCOPES.map((s) => <option key={s.v} value={s.v}>{s.label}</option>)}</select></label>
            <label className="flex flex-col gap-1 text-xs text-muted">{f.scope === "global" ? "Valeur (— global)" : f.scope === "bu" ? "BU" : f.scope === "commercial" ? "Commercial (AM)" : "Client"}
              {f.scope === "bu"
                ? <select className="field" value={f.scopeValue} onChange={(e) => set("scopeValue", e.target.value)}>{["ICT", "CLOUD", "FORMATION", "AUTRE"].map((b) => <option key={b}>{b}</option>)}</select>
                : <input className="field" disabled={f.scope === "global"} placeholder={f.scope === "global" ? "all" : "nom / identifiant"} value={f.scope === "global" ? "all" : f.scopeValue} onChange={(e) => set("scopeValue", e.target.value)} />}</label>
            <label className="flex flex-col gap-1 text-xs text-muted">Libellé (optionnel)
              <input className="field" placeholder="ex. Objectif CODIR 2026" value={f.label} onChange={(e) => set("label", e.target.value)} /></label>
            <label className="flex flex-col gap-1 text-xs text-muted">Cible CAS (FCFA)
              <input className="field" type="number" placeholder="0" value={f.targetCas} onChange={(e) => set("targetCas", e.target.value)} /></label>
            <label className="flex flex-col gap-1 text-xs text-muted">Cible Facturé (FCFA)
              <input className="field" type="number" placeholder="0" value={f.targetInvoiced} onChange={(e) => set("targetInvoiced", e.target.value)} /></label>
            <label className="flex flex-col gap-1 text-xs text-muted">Cible Marge (FCFA)
              <input className="field" type="number" placeholder="0" value={f.targetMargin} onChange={(e) => set("targetMargin", e.target.value)} /></label>
            <label className="flex flex-col gap-1 text-xs text-muted">Cible %MB (0..1)
              <input className="field" type="number" step="0.01" placeholder="0.21" value={f.targetMarginPct} onChange={(e) => set("targetMarginPct", e.target.value)} /></label>
          </div>
          <div className="flex gap-2 mt-3">
            <Busy label={editingId ? "Mettre à jour" : "Enregistrer"} fn={save} okMsg={editingId ? "Objectif mis à jour" : "Objectif créé"} />
            {editingId && <button className="btn-ghost" onClick={reset}>Annuler</button>}
          </div>
        </Card>
      )}
    </div>
  );
};


// 4 — Facturation
export const Facturation: FC<Props> = ({ period }) => {
  const { data, loading, error } = useDocData<FacturationSummary>(`summaries/facturation_${period}`);
  if (error) return <ErrorState error={error} />;
  if (loading && !data) return <CardSkeleton />;
  if (!data) return <EmptyState />;
  return (
    <div className="flex flex-col gap-4">
      <div className={grid4}><Kpi label="Facturé (période)" value={fmt(data.total)} tone="emerald" sub={`${data.count} factures`} /></div>
      <Card title="Tendance mensuelle"><AreaTrend data={monthsAsc(data.monthly)} color={T.emerald} name="Facturé" /></Card>
      <div className={cols2}>
        <Card title="Mix BU"><DonutBU data={toDonut(data.byBu)} /></Card>
        <Card title="Top clients"><HBars rows={topArr(data.topClients).slice(0, 10)} colorFn={() => T.emerald} /></Card>
      </div>
    </div>
  );
};

// Rattachement inline d'une facture orpheline : saisie du N° FP → recompute serveur.
function FpFixer({ id }: { id: string }) {
  const [v, setV] = useState("");
  return (
    <span className="inline-flex gap-1 items-center">
      <input className="field w-32 !py-1 text-xs" aria-label="N° FP à rattacher" placeholder="FP/2026/…" value={v} onChange={(e) => setV(e.target.value)} />
      <Busy variant="ghost" label="Rattacher" okMsg="Facture rattachée" fn={() => setInvoiceFp(id, v)} />
    </span>
  );
}

// Liste Factures (drill-down)
export const InvoiceList: FC<Props> = () => {
  const { rows: allRows, loading } = useCollectionData<Invoice>("invoices");
  const { match } = useFilters();
  const rows = allRows.filter((r) => match(r, ["bu", "client"])); // les factures ne portent pas d'AM
  const canImport = useCanImport();
  const [f, setF] = useState<"all" | "linked" | "orphan">("all");
  if (loading && !allRows.length) return <CardSkeleton />;
  const orphan = rows.filter((r) => r.linked !== true);
  const orphanAmt = orphan.reduce((s, r) => s + (r.amountHt || 0), 0);
  const filtered = f === "all" ? rows : f === "orphan" ? orphan : rows.filter((r) => r.linked === true);
  const seg = (id: typeof f, label: string, n?: number) => (
    <button onClick={() => setF(id)} className={cx("rounded-md px-2.5 py-1 text-xs font-semibold transition-colors", f === id ? "bg-gold text-bg" : "bg-panel2 text-muted hover:text-ink")}>
      {label}{n != null && <span className="ml-1 opacity-70">{n.toLocaleString("fr-FR")}</span>}
    </button>
  );
  return (
    <div className="flex flex-col gap-3">
      <FilterNote dims="BU / client" />
      {orphan.length > 0 && (
        <div className={grid4}>
          <Kpi label="Factures non rattachées" value={orphan.length.toLocaleString("fr-FR")} tone="clay" sub={`${fmt(orphanAmt)} FCFA`} />
        </div>
      )}
      <Card title={`Factures · ${rows.length.toLocaleString("fr-FR")}`} actions={<div className="flex gap-1.5 items-center flex-wrap">{seg("all", "Toutes")}{seg("linked", "Rattachées")}{seg("orphan", "Non rattachées", orphan.length)}{canImport && <ImportButton label="Importer un delta" />}</div>}>
        <ListView
          rows={filtered}
          searchKeys={[(r) => r.numero, (r) => r.fp, (r) => r.client]}
          columns={[
            colText("Numéro", (r) => r.numero, (r) => r.numero),
            colText("FP", (r) => r.fp || "—", (r) => r.fp || ""),
            colText("Client", (r) => r.client, (r) => r.client),
            colText("BU", (r) => buBadge(r.bu), (r) => r.bu),
            colText("Rattach.", (r) => (r.linked !== true ? <Badge tone="clay">non</Badge> : <Badge tone="emerald">oui</Badge>), (r) => (r.linked !== true ? 0 : 1)),
            colText("Date", (r) => r.date || "—", (r) => r.date || ""),
            colNum("Montant HT", (r) => money(r.amountHt), (r) => r.amountHt),
            colText("Statut", (r) => r.paymentStatus || "—", (r) => r.paymentStatus || ""),
            ...(canImport ? [colText("Rattacher", (r: Invoice) => (r.linked !== true && r.id ? <FpFixer id={r.id} /> : null), () => 0)] : []),
          ]}
        />
      </Card>
    </div>
  );
};

// 7 — Rentabilité
export const Rentabilite: FC<Props> = ({ period }) => {
  const { data, loading, error } = useDocData<RentabiliteSummary>(`summaries/rentabilite_${period}`);
  if (error) return <ErrorState error={error} />;
  if (loading && !data) return <CardSkeleton />;
  if (!data) return <EmptyState />;
  return (
    <div className="flex flex-col gap-4">
      <div className={grid4}>
        <Kpi label="Marge brute" value={fmt(data.mb)} tone="gold" />
        <Kpi label="CAS" value={fmt(data.cas)} />
        <Kpi label="%MB" value={pct(data.pmb)} />
      </div>
      <div className={cols2}>
        <Card title="CAS vs MB par domaine">
          <GroupedBars data={(data.byBu || []).map((b) => ({ name: b.bu, CAS: b.cas, MB: b.mb }))} series={[{ key: "CAS", color: T.steel, name: "CAS" }, { key: "MB", color: T.plum, name: "MB" }]} />
        </Card>
        <Card title="CAS vs MB par commercial (AM)">
          {(data.byAm || []).length
            ? <GroupedBars data={(data.byAm || []).slice(0, 10).map((a) => ({ name: a.am, CAS: a.cas, MB: a.mb }))} series={[{ key: "CAS", color: T.steel, name: "CAS" }, { key: "MB", color: T.gold, name: "MB" }]} />
            : <EmptyState label="Pas de commercial renseigné." />}
        </Card>
      </div>
      <Card title="Affaires à faible marge (à surveiller)">
        <Table columns={[
          colText("FP", (a) => a.fp || "—", (a) => a.fp || ""),
          colText("Client", (a) => a.client || "—", (a) => a.client || ""),
          colText("AM", (a) => a.am || "—", (a) => a.am || ""),
          colNum("CAS", (a) => money(a.cas), (a) => a.cas),
          colNum("MB", (a) => money(a.mb), (a) => a.mb),
          colNum("%MB", (a) => <Badge tone={(a.pmb < 0.1 ? "clay" : a.pmb < 0.2 ? "gold" : "emerald") as any}>{pct(a.pmb)}</Badge>, (a) => a.pmb),
        ]} rows={data.bottomAffaires || []} empty="Aucune commande à CAS positif." />
      </Card>
      <Card title="Top clients (marge)"><HBars rows={topArr(data.topClients).slice(0, 10)} colorFn={() => T.gold} /></Card>
    </div>
  );
};
