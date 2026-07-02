// Modules pilotage : Suivi Backlog, Prévision (atterrissage CAS/CAF), liste Commandes.
import { type FC } from "react";
import { useDocData, useCollectionData } from "../lib/hooks";
import { T, fmt, pct } from "../design/tokens";
import { Card, Kpi, Table, Tip, EmptyState, ErrorState, CardSkeleton, ListView, colText, colNum, money, cx } from "../design/components";
import { Bars, DonutBU, GroupedBars, Gauge } from "../design/charts";
import { Props, grid4, cols2, objToArr, toDonut, buBadge } from "./_shared";
import type { BacklogSummary, PipelineSummary, AtterrissageSummary, PeriodsConfig, Order } from "../types";

// 5 — Suivi Backlog
export const Backlog: FC<Props> = () => {
  const { data, loading, error } = useDocData<BacklogSummary>("summaries/backlog_fy");
  if (error) return <ErrorState error={error} />;
  if (loading && !data) return <CardSkeleton />;
  if (!data) return <EmptyState />;
  return (
    <div className="flex flex-col gap-4">
      <div className={grid4}><Kpi label={`Backlog FY ${data.fy || ""}`} value={fmt(data.total)} tone="steel" sub={`${data.count} commandes`} /></div>
      <div className={cols2}>
        <Card title="Par millésime"><Bars data={objToArr(data.byVintage)} color={T.clay} name="Backlog" /></Card>
        <Card title="Par domaine"><DonutBU data={toDonut(data.byBu)} /></Card>
      </div>
      <Card title="Top commandes ouvertes">
        <Table columns={[colText("FP", (t) => t.fp), colText("Client", (t) => t.client), colText("BU", (t) => t.bu), colNum("RAF", (t) => money(t.raf))]} rows={data.top || []} />
      </Card>
      <Tip>Ancré sur l'année fiscale — inchangé quand on change la période.</Tip>
    </div>
  );
};

// 6 — Prévision (ancrée FY, cohérente avec l'atterrissage)
export const Prevision: FC<Props> = () => {
  const { data: bl } = useDocData<BacklogSummary>("summaries/backlog_fy");
  const { data: pl } = useDocData<PipelineSummary>("summaries/pipeline");
  const { data: cfg } = useDocData<PeriodsConfig>("config/periods");
  const { data: att } = useDocData<AtterrissageSummary>(cfg?.currentFy ? `summaries/atterrissage_${cfg.currentFy}` : null);
  if (!bl && !pl && !att) return <EmptyState />;
  const realiseCas = att?.realiseCas || 0;
  const backlog = bl?.total || 0;
  const pond = att?.pipelinePondere ?? 0; // pipeline de projection (tiéré, fenêtre D Prev)
  const projete = att?.projete ?? (realiseCas + pond);
  const factureN = att?.factureN || 0;
  const cafProjete = att?.cafProjete ?? (factureN + backlog + pond);
  const fy = att?.fy || cfg?.currentFy;
  return (
    <div className="flex flex-col gap-4">
      {/* Composantes (chacune une seule fois) : le Pipeline projeté et le Backlog alimentent
          les DEUX atterrissages — on ne les duplique plus. */}
      <div className={grid4}>
        <Kpi label={`Réalisé CAS (FY ${fy || ""})`} value={fmt(realiseCas)} tone="emerald" />
        <Kpi label={`Facturé réalisé (FY ${fy || ""})`} value={fmt(factureN)} tone="emerald" />
        <Kpi label="Backlog (RAF)" value={fmt(backlog)} tone="steel" sub="reste à facturer, glissant" />
        <Kpi label="Pipeline projeté" value={fmt(pond)} tone="gold" sub="100 %≥90 · 20 %≥70 · fenêtre FY" />
      </div>
      {/* Atterrissages : les deux projections issues des composantes ci-dessus. */}
      <div className={cols2}>
        <Kpi label="Projeté CAS (FY)" value={fmt(projete)} sub="Réalisé CAS + Pipeline projeté" />
        <Kpi label="Projeté CAF (FY)" value={fmt(cafProjete)} tone="gold" sub="Facturé + Backlog + Pipeline projeté" />
      </div>
      {att && (
        <>
          <div className={cols2}>
            <Card title={`Atterrissage CAS ${att.fy} — prise de commande`}>
              <Gauge value={att.probaAtteinte || 0} color={(att.ecart || 0) < 0 ? T.clay : T.emerald} />
              <div className="grid grid-cols-3 gap-2 mt-2 text-center">
                <div><div className="text-[11px] text-muted">Projeté CAS</div><div className="font-display tabnum">{fmt(att.projete)}</div></div>
                <div><div className="text-[11px] text-muted">Objectif</div><div className="font-display tabnum">{(att.objectif || 0) > 0 ? fmt(att.objectif) : "—"}</div></div>
                <div><div className="text-[11px] text-muted">Écart</div><div className={cx("font-display tabnum", (att.ecart || 0) < 0 ? "text-clay" : "text-emerald")}>{(att.objectif || 0) > 0 ? fmt(att.ecart) : "—"}</div></div>
              </div>
            </Card>
            <Card title={`Atterrissage CAF ${att.fy} — facturation`}>
              <Gauge value={att.probaAtteinteCaf || 0} color={(att.ecartCaf || 0) < 0 ? T.clay : T.emerald} />
              <div className="grid grid-cols-3 gap-2 mt-2 text-center">
                <div><div className="text-[11px] text-muted">Projeté CAF</div><div className="font-display tabnum">{fmt(att.cafProjete)}</div></div>
                <div><div className="text-[11px] text-muted">Objectif</div><div className="font-display tabnum">{(att.objectifCaf || 0) > 0 ? fmt(att.objectifCaf) : "—"}</div></div>
                <div><div className="text-[11px] text-muted">Écart</div><div className={cx("font-display tabnum", (att.ecartCaf || 0) < 0 ? "text-clay" : "text-emerald")}>{(att.objectifCaf || 0) > 0 ? fmt(att.ecartCaf) : "—"}</div></div>
              </div>
            </Card>
          </div>
          <Card title="Facturation N vs N-1">
            <GroupedBars data={[{ name: `FY ${(att.fy || 0) - 1}`, Facturé: att.factureN1 }, { name: `FY ${att.fy}`, Facturé: att.factureN }]} series={[{ key: "Facturé", color: T.emerald, name: "Facturé" }]} h={220} size={54} />
            <Tip>Croissance : <span className={(att.croissanceFacture || 0) >= 0 ? "text-emerald" : "text-clay"}>{pct(att.croissanceFacture)}</span></Tip>
          </Card>
        </>
      )}
      <Tip><b>Pipeline projeté</b> (logique de projection moyen terme) = 100 % du CA des opportunités IdC ≥ 90 % + 20 % du CA des IdC ≥ 70 % (&lt; 90 %), <b>uniquement</b> celles dont la clôture prévue (D Prev) tombe entre aujourd'hui et fin {fy} — les projections obsolètes (D Prev passée) ou prévues en {fy ? Number(fy) + 1 : "N+1"}+ sont exclues. <b>Projeté CAS</b> = Réalisé CAS + pipeline projeté. <b>Projeté CAF</b> = Facturé réalisé + Backlog (RAF) + pipeline projeté (le backlog y entre, sans double compte).</Tip>
    </div>
  );
};

// Liste Commandes (drill-down)
export const OrderList: FC<Props> = () => {
  const { rows, loading } = useCollectionData<Order>("orders");
  if (loading && !rows.length) return <CardSkeleton />;
  return (
    <Card title={`Commandes · ${rows.length.toLocaleString("fr-FR")}`}>
      <ListView
        rows={rows}
        searchKeys={[(r) => r.fp, (r) => r.client, (r) => r.am]}
        columns={[
          colText("FP", (r) => r.fp, (r) => r.fp),
          colText("Client", (r) => r.client, (r) => r.client),
          colText("BU", (r) => buBadge(r.bu), (r) => r.bu),
          colText("AM", (r) => r.am, (r) => r.am),
          colNum("CAS", (r) => money(r.cas), (r) => r.cas),
          colNum("RAF", (r) => money(r.raf), (r) => r.raf),
          colNum("MB", (r) => money(r.mb), (r) => r.mb),
          colNum("%MB", (r) => pct(r.cas ? r.mb / r.cas : 0), (r) => (r.cas ? r.mb / r.cas : 0)),
          colNum("Année", (r) => r.yearPo || "—", (r) => r.yearPo || 0),
        ]}
      />
    </Card>
  );
};
