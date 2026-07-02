// Modules finance : Objectifs / R-O, Facturation, liste Factures, Rentabilité.
import { useState, type FC } from "react";
import { useDocData, useCollectionData } from "../lib/hooks";
import { useCan } from "../lib/rbac";
import { T, fmt, pct } from "../design/tokens";
import { Card, Kpi, Table, Badge, Tip, EmptyState, ErrorState, CardSkeleton, Busy, ListView, colText, colNum, money, cx } from "../design/components";
import { AreaTrend, DonutBU, GroupedBars } from "../design/charts";
import { upsertObjective } from "../lib/writes";
import { Props, grid4, cols2, monthsAsc, topArr, toDonut, HBars, buBadge } from "./_shared";
import type { OverviewSummary, FacturationSummary, RentabiliteSummary, Objective, Invoice } from "../types";

// 3 — Objectifs / R-O
export const Objectifs: FC<Props> = ({ period }) => {
  const { rows } = useCollectionData<Objective>("objectives");
  const { data: ov } = useDocData<OverviewSummary>(`summaries/overview_${period}`);
  const canWrite = useCan("objectifs") === "write";
  const realiseCas = ov?.commandes || 0;
  const [o, setO] = useState({ fiscalYear: "", scope: "global", scopeValue: "all", targetCas: "", targetInvoiced: "", targetMargin: "" });
  return (
    <div className="flex flex-col gap-4">
      <Card title="Objectifs annuels & Réalisé / Objectif">
        <Table
          columns={[
            colText("Périmètre", (x) => `${x.fiscalYear} ${x.scope || ""} ${x.scopeValue || ""}`.trim()),
            colNum("Cible CAS", (x) => money(x.targetCas)), colNum("Cible Facturé", (x) => money(x.targetInvoiced)),
            colNum("Cible Marge", (x) => money(x.targetMargin)),
            // R/O = réalisé de la période SÉLECTIONNÉE / cible de la MÊME année (sinon "—").
            colNum("R/O CAS", (x) => (x.targetCas > 0 && String(x.fiscalYear) === String(period)) ? <Badge tone={realiseCas / x.targetCas >= 1 ? "emerald" : "gold"}>{pct(realiseCas / x.targetCas)}</Badge> : "—"),
          ]}
          rows={rows}
        />
        <Tip>Réalisé CAS de la période {period} : {fmt(realiseCas)} · Facturé : {fmt(ov?.facture)} · Marge : {fmt(ov?.mb)}. Le R/O n'est affiché que pour l'objectif de l'année sélectionnée.</Tip>
      </Card>
      {canWrite && (
        <Card title="Ajouter / mettre à jour un objectif">
          <div className="flex flex-wrap gap-2 items-center">
            <input className="field w-24" aria-label="Année fiscale" placeholder="Année" value={o.fiscalYear} onChange={(e) => setO({ ...o, fiscalYear: e.target.value })} />
            <input className="field" aria-label="Périmètre (scope)" placeholder="Scope" value={o.scope} onChange={(e) => setO({ ...o, scope: e.target.value })} />
            <input className="field" aria-label="Valeur du périmètre" placeholder="Valeur" value={o.scopeValue} onChange={(e) => setO({ ...o, scopeValue: e.target.value })} />
            <input className="field w-32" aria-label="Cible CAS" placeholder="Cible CAS" value={o.targetCas} onChange={(e) => setO({ ...o, targetCas: e.target.value })} />
            <input className="field w-32" aria-label="Cible Facturé" placeholder="Cible Facturé" value={o.targetInvoiced} onChange={(e) => setO({ ...o, targetInvoiced: e.target.value })} />
            <input className="field w-32" aria-label="Cible Marge" placeholder="Cible Marge" value={o.targetMargin} onChange={(e) => setO({ ...o, targetMargin: e.target.value })} />
            <Busy label="Enregistrer" fn={() => upsertObjective({ fiscalYear: Number(o.fiscalYear) || 0, scope: o.scope, scopeValue: o.scopeValue, targetCas: Number(o.targetCas) || 0, targetInvoiced: Number(o.targetInvoiced) || 0, targetMargin: Number(o.targetMargin) || 0 })} />
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

// Liste Factures (drill-down)
export const InvoiceList: FC<Props> = () => {
  const { rows, loading } = useCollectionData<Invoice>("invoices");
  const [f, setF] = useState<"all" | "linked" | "orphan">("all");
  if (loading && !rows.length) return <CardSkeleton />;
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
      {orphan.length > 0 && (
        <div className={grid4}>
          <Kpi label="Factures non rattachées" value={orphan.length.toLocaleString("fr-FR")} tone="clay" sub={`${fmt(orphanAmt)} FCFA`} />
        </div>
      )}
      <Card title={`Factures · ${rows.length.toLocaleString("fr-FR")}`} actions={<div className="flex gap-1.5">{seg("all", "Toutes")}{seg("linked", "Rattachées")}{seg("orphan", "Non rattachées", orphan.length)}</div>}>
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
      <Card title="CAS vs MB par domaine">
        <GroupedBars data={(data.byBu || []).map((b) => ({ name: b.bu, CAS: b.cas, MB: b.mb }))} series={[{ key: "CAS", color: T.steel, name: "CAS" }, { key: "MB", color: T.plum, name: "MB" }]} />
      </Card>
      <Card title="Top clients (marge)"><HBars rows={topArr(data.topClients).slice(0, 10)} colorFn={() => T.gold} /></Card>
    </div>
  );
};
