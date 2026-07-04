// 1 — Cockpit décisionnel : atterrissage exercice (décision n°1) + chaîne de valeur
// non additive + KPIs de pilotage (marge, cash) + alertes actionnables + tendance.
import { useState, type FC } from "react";
import { useDocData, useCollectionData } from "../lib/hooks";
import { useCan, useCanExport, useCanSeeMargin } from "../lib/rbac";
import { useFilters } from "../lib/filters";
import { T, fmt, pct } from "../design/tokens";
import { Kpi, Card, Tip, EmptyState, KpiSkeletons, CardSkeleton, Busy, Chain, Stage, cx } from "../design/components";
import { Gauge, MultiLine } from "../design/charts";
import { callRecompute, callExportReport } from "../lib/writes";
import { Props, grid4, cols2, AlertsBanner, useObjectives, roBadge, relTime, useCommandesRows } from "./_shared";
import { computeFilteredOverview } from "./overviewCalc";
import { normalizeTiers, type ProjectionConfig } from "../lib/projection";
import type { OverviewSummary, AtterrissageSummary, PeriodsConfig, TrendsSummary, Opportunity, Invoice } from "../types";

// Bloc « atterrissage » : jauge du TAUX D'ATTEINTE (projeté / objectif, plafonné à 100 %) + Réalisé /
// Projeté / Objectif / Écart, avec le R/O (Réalisé / Objectif) mis en avant dans le coin. Ce n'est PAS
// une probabilité statistique : c'est un ratio d'atteinte de l'objectif — libellé en conséquence.
function Landing({ title, proba, realise, projete, objectif, ecart, sub, retard, retardCount }: {
  title: string; proba: number; realise?: number; projete?: number; objectif?: number; ecart?: number; sub: string;
  retard?: number; retardCount?: number;
}) {
  const hasObj = (objectif || 0) > 0;
  return (
    <Card title={title} actions={hasObj ? <span className="inline-flex items-center gap-1.5 text-[11px] text-muted">R/O {roBadge(realise, objectif)}</span> : undefined}>
      <Gauge value={proba || 0} color={(ecart || 0) < 0 ? T.clay : T.emerald} h={170} />
      {hasObj && <div className="text-[11px] text-faint text-center -mt-1">Taux d'atteinte : projeté / objectif (plafonné à 100 %)</div>}
      <div className="grid grid-cols-4 gap-2 mt-2 text-center">
        <div><div className="text-[11px] text-muted">Réalisé</div><div className="font-display tabnum">{fmt(realise)}</div></div>
        <div><div className="text-[11px] text-muted">Projeté</div><div className="font-display tabnum">{fmt(projete)}</div></div>
        <div><div className="text-[11px] text-muted">Objectif</div><div className="font-display tabnum">{hasObj ? fmt(objectif) : "—"}</div></div>
        <div><div className="text-[11px] text-muted">Écart</div><div className={cx("font-display tabnum", (ecart || 0) < 0 ? "text-clay" : "text-emerald")}>{hasObj ? fmt(ecart) : "—"}</div></div>
      </div>
      <div className="text-[11px] text-faint text-center mt-2">{sub}</div>
      {(retard || 0) > 0 && (
        <div className="text-[11px] text-clay text-center mt-1" title="Ces opportunités sont comptées dans le projeté (D Prev dans l'exercice) mais leur date de clôture prévue est déjà dépassée — elles apparaissent « en retard de closing » côté Pipeline.">
          dont {fmt(retard)}{(retardCount || 0) > 0 ? ` (${retardCount} opp.)` : ""} à requalifier — D Prev dépassée
        </div>
      )}
    </Card>
  );
}

export const Overview: FC<Props> = ({ period }) => {
  const { data, loading } = useDocData<OverviewSummary>(`summaries/overview_${period}`);
  const { data: cfg } = useDocData<PeriodsConfig>("config/periods");
  const { data: att } = useDocData<AtterrissageSummary>(cfg?.currentFy ? `summaries/atterrissage_${cfg.currentFy}` : null);
  const { data: trends } = useDocData<TrendsSummary>("summaries/trends");
  const objGlobal = useObjectives(period).get("global", "all"); // R/O global (si objectif de l'année sélectionnée)
  const canWrite = useCan("overview") === "write";
  const canExport = useCanExport();
  const [url, setUrl] = useState<string | null>(null);
  // Filtre transverse : quand un BU/AM/client est sélectionné, on RECALCULE la chaîne & les KPI
  // par périmètre côté client (les collections dégradent proprement à vide si l'accès manque).
  const { active, f, match } = useFilters();
  // Les collections brutes ne sont abonnées QUE si un filtre est actif (le recalcul par périmètre en
  // a besoin) — sinon la Vue d'ensemble (page la plus vue) n'ouvre aucun listener plein-collection.
  const { rows: cmdRows } = useCommandesRows(active);
  const { rows: allOpps } = useCollectionData<Opportunity>(active ? "opportunities" : null);
  const { rows: allInvoices } = useCollectionData<Invoice>(active ? "invoices" : null);
  // Marge agrégée isolée dans overviewMargin_* (accès « Rentabilité ») : lue seulement hors filtre et
  // si le rôle a le droit marge ; en vue filtrée elle vient du recalcul (cmdRows a la marge fusionnée).
  const canMargin = useCanSeeMargin();
  const { data: ovMargin } = useDocData<{ mb?: number; pmb?: number }>(canMargin && !active ? `summaries/overviewMargin_${period}` : null);
  // Niveaux de projection configurés (Certitudes/Forecast/Pipe) : appliqués au recalcul filtré pour
  // rester cohérent avec les agrégats serveur (mêmes poids/activation).
  const { data: projCfg } = useDocData<ProjectionConfig>("config/projection");
  const projTiers = normalizeTiers(projCfg || undefined);
  const fresh = cfg?.lastRecomputeAt ? relTime(cfg.lastRecomputeAt) : "";
  const actions = (
    <div className="flex gap-2 items-center">
      {fresh && <span className="text-[11px] text-faint mr-1" title="Recompute planifié chaque jour à 05:00 ; « Recalculer » force la mise à jour.">Données à jour {fresh}</span>}
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
  // Vue par périmètre si le filtre est actif, sinon l'agrégat serveur.
  const filtered = active ? computeFilteredOverview(cmdRows, allInvoices, allOpps, period, match, projTiers) : null;
  const v = filtered ?? data;
  const filterLabel = [f.bu, f.am, f.client].filter(Boolean).join(" · ");
  // Marge : recalcul filtré (cmdRows) si filtre actif, sinon doc marge gated (undefined si non autorisé).
  const margeMb = active ? filtered?.mb : ovMargin?.mb;
  const margePmb = active ? filtered?.ratios.pmb : ovMargin?.pmb;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">{actions}</div>

      {active && (
        <div className="rounded-lg border border-gold/40 bg-gold/10 px-3 py-2 text-[12px] text-muted">
          Vue recalculée pour le périmètre <b className="text-ink">{filterLabel}</b> : chaîne de valeur & KPI ci-dessous filtrés. L'<b>atterrissage</b> et la <b>trajectoire</b> restent globaux (projection d'exercice).
        </div>
      )}

      {/* DÉCISION N°1 — Atterrissage de l'exercice : allons-nous atteindre l'objectif ? */}
      {att ? (
        <div className={cols2}>
          <Landing title={`Atterrissage CAS ${fy || ""} — prise de commande`} proba={att.probaAtteinte || 0}
            realise={att.realiseCas} projete={att.projete} objectif={att.objectif} ecart={att.ecart}
            retard={att.pipelineRetard} retardCount={att.pipelineRetardCount}
            sub="Réalisé CAS + pipeline pondéré (certitudes glissantes)" />
          <Landing title={`Atterrissage CAF ${fy || ""} — facturation`} proba={att.probaAtteinteCaf || 0}
            realise={att.factureN} projete={att.cafProjete} objectif={att.objectifCaf} ecart={att.ecartCaf}
            retard={att.pipelineRetard} retardCount={att.pipelineRetardCount}
            sub="Facturé + backlog + pipeline pondéré" />
        </div>
      ) : (
        <Card title="Atterrissage de l'exercice"><EmptyState label="Atterrissage indisponible — importer données & objectifs, puis recalculer." /></Card>
      )}

      {/* Alertes actionnables — ce qui bloque / à arbitrer, en haut du cockpit. */}
      <AlertsBanner />

      {/* Chaîne de valeur (non additive) — filtrée par périmètre si le filtre est actif. */}
      <Chain>
        <Stage idx={1} label="Certitudes" accent={T.gold} value={fmt(v.certitudes)} sub="pondéré IdC ≥ 90 % · D Prev période" />
        <Stage idx={2} label="Commandes · CAS" accent={T.steel} value={fmt(v.commandes)} sub="prise de commande" />
        <Stage idx={3} label="Facturé · CAF" accent={T.emerald} value={fmt(v.facture)} sub="figé sur l'exercice" />
        <Stage idx={4} label="Backlog · RAF" accent={T.clay} value={fmt(v.backlog)} sub={v.backlogCount ? `${v.backlogCount} commandes · glissant` : "glissant"} />
      </Chain>

      {/* KPIs de pilotage : marge, croissance facturation, taux de facturation, conversion vente. */}
      <div className={grid4}>
        {canMargin && <Kpi label="Marge brute" value={fmt(margeMb)} tone="gold" sub={`%MB ${pct(margePmb)}${!active && objGlobal?.targetMargin ? ` · R/O ${pct((margeMb || 0) / objGlobal.targetMargin)}` : ""}`} />}
        <Kpi label="Facturé (FY)" value={att ? fmt(att.factureN) : "—"} tone="emerald" delta={att?.croissanceFacture} sub={att ? "vs N-1 · global" : "atterrissage indispo."} />
        <Kpi label="Taux de facturation" value={pct(v.ratios?.tauxFacturation)} sub="Facturé / (Facturé + Backlog)" />
        <Kpi label="Taux de conversion vente" value={pct(v.ratios?.tauxConversionVente)} sub="Commande / potentiel adressable pondéré" />
      </div>


      {/* Tendance : burn-down du backlog et écart projeté vs réalisé dans le temps. */}
      {points.length >= 2 && (
        <Card title={`Trajectoire (projeté vs réalisé)${active ? " · global" : ""}`}>
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
