// 2 — Pipeline (funnel pondéré, saisie) + liste des opportunités.
import { useState, type FC } from "react";
import { useDocData, useCollectionData } from "../lib/hooks";
import { useCan } from "../lib/rbac";
import { T, fmt, pct } from "../design/tokens";
import { Card, Kpi, Table, EmptyState, CardSkeleton, Busy, ListView, colText, colNum, money } from "../design/components";
import { AreaTrend, GroupedBars } from "../design/charts";
import { addOpportunity } from "../lib/writes";
import { Props, grid4, cols2, objToArr, monthsAsc, STAGE_SHORT, HBars, buBadge } from "./_shared";
import type { PipelineSummary, Opportunity } from "../types";

export const Pipeline: FC<Props> = ({ period }) => {
  // Pipeline de la période : opportunités dont la D Prev tombe dans l'année sélectionnée
  // (écarte les opps obsolètes / non mises à jour). "Tout" = tout le pipeline.
  const { data } = useDocData<PipelineSummary>(`summaries/pipeline_${period}`);
  const canWrite = useCan("pipeline") === "write";
  const [f, setF] = useState({ client: "", am: "", bu: "ICT", amount: "", stage: "1", probability: "", closingDate: "" });
  const funnel = [1, 2, 3, 4, 5].map((s) => ({ name: STAGE_SHORT[s], Brut: data?.byStage?.[s]?.amount || 0, "Pondéré": data?.byStage?.[s]?.weighted || 0 }));
  return (
    <div className="flex flex-col gap-4">
      {data ? (
        <>
          <div className={grid4}>
            <Kpi label="Actif (brut)" value={fmt(data.tot?.brut)} sub={`${data.tot?.count ?? 0} opp.`} />
            <Kpi label="Pondéré (IdC ≥ 90 %)" value={fmt(data.tot?.weighted)} tone="gold" sub={`${data.tot?.countConf ?? 0} opp.`} />
            <Kpi label="Suspendu" value={fmt(data.susp?.brut)} sub={`${data.susp?.count ?? 0} opp.`} tone="clay" />
            <Kpi label="Conversion" value={pct(data.conv)} sub={`${data.wonCount}/${(data.wonCount || 0) + (data.lostCount || 0)}`} />
          </div>
          <Card title="Funnel pondéré par étape">
            <GroupedBars data={funnel} series={[{ key: "Brut", color: T.steel, name: "Brut" }, { key: "Pondéré", color: T.gold, name: "Pondéré" }]} h={240} size={26} />
          </Card>
          <div className={cols2}>
            <Card title="Pondéré par AM"><HBars rows={objToArr(data.byAM).slice(0, 10)} colorFn={() => T.gold} /></Card>
            <Card title="Écoulement mensuel (pondéré)">{Object.keys(data.byMonth || {}).length ? <AreaTrend data={monthsAsc(data.byMonth)} color={T.gold} name="Pondéré" h={200} /> : <EmptyState label="Dates de closing indisponibles." />}</Card>
          </div>
          <Card title="Top opportunités (pondéré)">
            <Table columns={[colText("Client", (o) => o.client), colText("AM", (o) => o.am), colNum("Montant", (o) => money(o.amount)), colNum("Pondéré", (o) => money(o.weighted))]} rows={data.topOpps || []} />
          </Card>
        </>
      ) : <EmptyState />}
      {canWrite && (
        <Card title="Ajouter une opportunité (saisie)">
          <div className="flex flex-wrap gap-2 items-center">
            <input className="field" aria-label="Client" placeholder="Client" value={f.client} onChange={(e) => setF({ ...f, client: e.target.value })} />
            <input className="field" aria-label="Account Manager" placeholder="AM" value={f.am} onChange={(e) => setF({ ...f, am: e.target.value })} />
            <select aria-label="Business Unit" className="field" value={f.bu} onChange={(e) => setF({ ...f, bu: e.target.value })}>{["ICT", "CLOUD", "FORMATION", "AUTRE"].map((b) => <option key={b}>{b}</option>)}</select>
            <input className="field w-28" aria-label="Montant" placeholder="Montant" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} />
            <select aria-label="Étape du pipeline" className="field" value={f.stage} onChange={(e) => setF({ ...f, stage: e.target.value })}>{[1, 2, 3, 4, 5, 6, 7, 8, 9].map((s) => <option key={s} value={s}>{s} · {STAGE_SHORT[s]}</option>)}</select>
            <input className="field w-28" aria-label="Probabilité (0 à 1)" placeholder="Proba 0..1" value={f.probability} onChange={(e) => setF({ ...f, probability: e.target.value })} />
            <input className="field" aria-label="Date de clôture prévue" type="date" value={f.closingDate} onChange={(e) => setF({ ...f, closingDate: e.target.value })} />
            <Busy label="Ajouter" fn={() => addOpportunity({ client: f.client, am: f.am, bu: f.bu, amount: Number(f.amount) || 0, stage: Number(f.stage), probability: Number(f.probability) || 0, closingDate: f.closingDate || undefined })} />
          </div>
        </Card>
      )}
    </div>
  );
};

export const OppList: FC<Props> = () => {
  const { rows, loading } = useCollectionData<Opportunity>("opportunities");
  if (loading && !rows.length) return <CardSkeleton />;
  return (
    <Card title={`Opportunités · ${rows.length.toLocaleString("fr-FR")}`}>
      <ListView
        rows={rows}
        searchKeys={[(r) => r.client, (r) => r.am, (r) => r.fp, (r) => r.stageLabel]}
        columns={[
          colText("FP", (r) => r.fp || "—", (r) => r.fp || ""),
          colText("Client", (r) => r.client, (r) => r.client),
          colText("AM", (r) => r.am, (r) => r.am),
          colText("BU", (r) => buBadge(r.bu), (r) => r.bu),
          colNum("Montant", (r) => money(r.amount), (r) => r.amount),
          colText("Étape", (r) => r.stageLabel || r.stage, (r) => r.stage),
          colNum("Proba", (r) => pct(r.probability), (r) => r.probability),
          colNum("Pondéré", (r) => money(r.weighted), (r) => r.weighted),
          colText("Closing", (r) => r.closingDate || "—", (r) => r.closingDate || ""),
        ]}
      />
    </Card>
  );
};
