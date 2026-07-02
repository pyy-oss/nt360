// 1 — Vue d'ensemble : chaîne de valeur (non additive) + KPIs + alertes.
import { useState, type FC } from "react";
import { useDocData } from "../lib/hooks";
import { useCan } from "../lib/rbac";
import { T, fmt, pct } from "../design/tokens";
import { Kpi, Tip, EmptyState, KpiSkeletons, CardSkeleton, Busy, Chain, Stage } from "../design/components";
import { callRecompute, callExportReport } from "../lib/writes";
import { Props, grid4, AlertsBanner } from "./_shared";
import type { OverviewSummary, AtterrissageSummary, PeriodsConfig } from "../types";

export const Overview: FC<Props> = ({ period }) => {
  const { data, loading } = useDocData<OverviewSummary>(`summaries/overview_${period}`);
  const { data: cfg } = useDocData<PeriodsConfig>("config/periods");
  const { data: att } = useDocData<AtterrissageSummary>(cfg?.currentFy ? `summaries/atterrissage_${cfg.currentFy}` : null);
  const canWrite = useCan("overview") === "write";
  const [url, setUrl] = useState<string | null>(null);
  const actions = (
    <div className="flex gap-2 items-center">
      {canWrite && <Busy variant="ghost" label="Recalculer" fn={callRecompute} okMsg="Agrégats recalculés" />}
      <Busy variant="ghost" label="Export CODIR" fn={async () => { const r = await callExportReport(period); setUrl(r.url || null); }} okMsg="Export généré" />
      {url && <a className="text-gold text-xs underline" href={url} target="_blank" rel="noreferrer">Télécharger</a>}
    </div>
  );
  if (loading && !data) return <div className="flex flex-col gap-4"><KpiSkeletons n={4} /><CardSkeleton h={120} /></div>;
  if (!data) return <div className="flex flex-col gap-3"><div className="flex justify-end">{actions}</div><AlertsBanner /><EmptyState /></div>;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">{actions}</div>
      {/* Chaîne de valeur */}
      <Chain>
        <Stage idx={1} label="Certitudes" accent={T.gold} value={fmt(data.certitudes)} sub="pondéré IdC ≥ 90 % · glissant" />
        <Stage idx={2} label="Commandes · CAS" accent={T.steel} value={fmt(data.commandes)} sub="prise de commande" />
        <Stage idx={3} label="Facturé · CAF" accent={T.emerald} value={fmt(data.facture)} sub="figé sur l'exercice" />
        <Stage idx={4} label="Backlog · RAF" accent={T.clay} value={fmt(data.backlog)} sub={data.backlogCount ? `${data.backlogCount} commandes · glissant` : "glissant"} />
      </Chain>
      <div className={grid4}>
        <Kpi label="Marge brute" value={fmt(data.mb)} tone="gold" sub={`%MB ${pct(data.ratios?.pmb)}`} />
        <Kpi label="Facturé (FY)" value={att ? fmt(att.factureN) : "—"} tone="emerald" delta={att?.croissanceFacture} sub={att ? "vs N-1" : "atterrissage indispo."} />
        <Kpi label="Pondéré certain (IdC ≥ 90 %)" value={fmt(data.pondCertain)} tone="steel" sub="à venir" />
        <Kpi label="Avancement facturation" value={pct(data.ratios?.tauxFacturation)} sub="commandes de la période" />
      </div>
      <AlertsBanner />
      <Tip><b>Grandeurs non additives</b> (CAS ≠ Facturé + Backlog). <b>CAS</b> = prise de commande (figée sur l'année de PO). <b>CAF</b> = facturation, seule grandeur figée sur l'exercice. <b>Backlog</b> (RAF) et <b>Certitudes</b> (pondéré ≥ 90 %) sont <b>glissants</b> : ils cumulent toutes les commandes ouvertes / opportunités jusqu'à l'année en cours, indépendamment de la période.</Tip>
    </div>
  );
};
