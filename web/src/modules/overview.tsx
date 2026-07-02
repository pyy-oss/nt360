// 1 — Cockpit décisionnel : atterrissage exercice (décision n°1) + chaîne de valeur
// non additive + KPIs de pilotage (marge, cash) + alertes actionnables + tendance.
import { useState, type FC } from "react";
import { useDocData } from "../lib/hooks";
import { useCan, useCanExport } from "../lib/rbac";
import { T, fmt, pct } from "../design/tokens";
import { Kpi, Card, Tip, EmptyState, KpiSkeletons, CardSkeleton, Busy, Chain, Stage, cx } from "../design/components";
import { Gauge, MultiLine } from "../design/charts";
import { callRecompute, callExportReport } from "../lib/writes";
import { Props, grid4, cols2, AlertsBanner } from "./_shared";
import type { OverviewSummary, AtterrissageSummary, PeriodsConfig, TrendsSummary } from "../types";

// Bloc « atterrissage » : jauge de probabilité + Projeté / Objectif / Écart.
function Landing({ title, proba, projete, objectif, ecart, sub }: {
  title: string; proba: number; projete?: number; objectif?: number; ecart?: number; sub: string;
}) {
  const hasObj = (objectif || 0) > 0;
  return (
    <Card title={title}>
      <Gauge value={proba || 0} color={(ecart || 0) < 0 ? T.clay : T.emerald} h={170} />
      <div className="grid grid-cols-3 gap-2 mt-2 text-center">
        <div><div className="text-[11px] text-muted">Projeté</div><div className="font-display tabnum">{fmt(projete)}</div></div>
        <div><div className="text-[11px] text-muted">Objectif</div><div className="font-display tabnum">{hasObj ? fmt(objectif) : "—"}</div></div>
        <div><div className="text-[11px] text-muted">Écart</div><div className={cx("font-display tabnum", (ecart || 0) < 0 ? "text-clay" : "text-emerald")}>{hasObj ? fmt(ecart) : "—"}</div></div>
      </div>
      <div className="text-[11px] text-faint text-center mt-2">{sub}</div>
    </Card>
  );
}

export const Overview: FC<Props> = ({ period }) => {
  const { data, loading } = useDocData<OverviewSummary>(`summaries/overview_${period}`);
  const { data: cfg } = useDocData<PeriodsConfig>("config/periods");
  const { data: att } = useDocData<AtterrissageSummary>(cfg?.currentFy ? `summaries/atterrissage_${cfg.currentFy}` : null);
  const { data: trends } = useDocData<TrendsSummary>("summaries/trends");
  const canWrite = useCan("overview") === "write";
  const canExport = useCanExport();
  const [url, setUrl] = useState<string | null>(null);
  const actions = (
    <div className="flex gap-2 items-center">
      {canWrite && <Busy variant="ghost" label="Recalculer" fn={callRecompute} okMsg="Agrégats recalculés" />}
      {canExport && <Busy variant="ghost" label="Export CODIR" fn={async () => { const r = await callExportReport(period); setUrl(r.url || null); }} okMsg="Export généré" />}
      {url && <a className="text-gold text-xs underline" href={url} target="_blank" rel="noreferrer">Télécharger</a>}
    </div>
  );
  if (loading && !data) return <div className="flex flex-col gap-4"><KpiSkeletons n={4} /><CardSkeleton h={120} /></div>;
  if (!data) return <div className="flex flex-col gap-3"><div className="flex justify-end">{actions}</div><AlertsBanner /><EmptyState /></div>;

  const fy = att?.fy || cfg?.currentFy;
  const points = (trends?.points || []).map((p) => ({
    name: p.date, "Projeté CAS": p.projeteCas || 0, "Réalisé CAS": p.casReel || 0, "Facturé": p.caf || 0, Backlog: p.backlog || 0,
  }));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">{actions}</div>

      {/* DÉCISION N°1 — Atterrissage de l'exercice : allons-nous atteindre l'objectif ? */}
      {att ? (
        <div className={cols2}>
          <Landing title={`Atterrissage CAS ${fy || ""} — prise de commande`} proba={att.probaAtteinte || 0}
            projete={att.projete} objectif={att.objectif} ecart={att.ecart}
            sub="Réalisé CAS + pipeline pondéré (certitudes glissantes)" />
          <Landing title={`Atterrissage CAF ${fy || ""} — facturation`} proba={att.probaAtteinteCaf || 0}
            projete={att.cafProjete} objectif={att.objectifCaf} ecart={att.ecartCaf}
            sub="Facturé + backlog + pipeline pondéré" />
        </div>
      ) : (
        <Card title="Atterrissage de l'exercice"><EmptyState label="Atterrissage indisponible — importer données & objectifs, puis recalculer." /></Card>
      )}

      {/* Alertes actionnables — ce qui bloque / à arbitrer, en haut du cockpit. */}
      <AlertsBanner />

      {/* Chaîne de valeur (non additive) */}
      <Chain>
        <Stage idx={1} label="Certitudes" accent={T.gold} value={fmt(data.certitudes)} sub="pondéré IdC ≥ 90 % · D Prev période" />
        <Stage idx={2} label="Commandes · CAS" accent={T.steel} value={fmt(data.commandes)} sub="prise de commande" />
        <Stage idx={3} label="Facturé · CAF" accent={T.emerald} value={fmt(data.facture)} sub="figé sur l'exercice" />
        <Stage idx={4} label="Backlog · RAF" accent={T.clay} value={fmt(data.backlog)} sub={data.backlogCount ? `${data.backlogCount} commandes · glissant` : "glissant"} />
      </Chain>

      {/* KPIs de pilotage : marge, croissance facturation, pondéré certain, avancement. */}
      <div className={grid4}>
        <Kpi label="Marge brute" value={fmt(data.mb)} tone="gold" sub={`%MB ${pct(data.ratios?.pmb)}`} />
        <Kpi label="Facturé (FY)" value={att ? fmt(att.factureN) : "—"} tone="emerald" delta={att?.croissanceFacture} sub={att ? "vs N-1" : "atterrissage indispo."} />
        <Kpi label="Pondéré certain (IdC ≥ 90 %)" value={fmt(data.pondCertain)} tone="steel" sub="à venir" />
        <Kpi label="Avancement facturation" value={pct(data.ratios?.tauxFacturation)} sub="commandes de la période" />
      </div>

      {/* Tendance : burn-down du backlog et écart projeté vs réalisé dans le temps. */}
      {points.length >= 2 && (
        <Card title="Trajectoire (projeté vs réalisé)">
          <MultiLine data={points} series={[
            { key: "Projeté CAS", color: T.gold, name: "Projeté CAS" },
            { key: "Réalisé CAS", color: T.steel, name: "Réalisé CAS" },
            { key: "Facturé", color: T.emerald, name: "Facturé" },
            { key: "Backlog", color: T.clay, name: "Backlog" },
          ]} h={220} />
        </Card>
      )}

      <Tip><b>Grandeurs non additives</b> (CAS ≠ Facturé + Backlog). <b>CAS</b> = prise de commande (figée sur l'année de PO). <b>CAF</b> = facturation, seule grandeur figée sur l'exercice. <b>Backlog</b> (RAF) est <b>glissant</b> (toutes les commandes ouvertes). <b>Certitudes</b> = pondéré ≥ 90 % des opportunités dont la <b>D Prev</b> tombe dans la période sélectionnée. L'<b>atterrissage</b> combine réalisé + pipeline pondéré pour projeter la fin d'exercice.</Tip>
    </div>
  );
};
