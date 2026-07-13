// BILAN HEBDOMADAIRE CODIR — « Projection CAF » : one-pager de pilotage hebdo (comité de direction).
// Réassemble des AGRÉGATS EXISTANTS (atterrissage, clients, backlog, tendance de facturation) dans la
// mise en page du tableau de bord Excel « Projection CA ». AUCUN calcul confidentiel (CAF, backlog,
// prise de commande — pas de marge) → visible au niveau « overview ». Export XLSX = one-pager CODIR
// existant (exportReport).
import { useState, type FC } from "react";
import { Card, Kpi, Badge, Table, money, useToast, EmptyState, colText, colNum } from "../design/components";
import { Gauge } from "../design/charts";
import { HBars, FreshnessGuard, type Props } from "./_shared";
import { T, fmt } from "../design/tokens";
import { useDocData } from "../lib/hooks";
import { useCanExport } from "../lib/rbac";
import { callExportReport } from "../lib/writes";
import type { AtterrissageSummary, EntitySummary, BacklogSummary, BillingTrendSummary, PeriodsConfig } from "../types";

// N° de semaine ISO (le titre « S 27 » du bilan) — calculé côté client, sans dépendance.
function isoWeek(d: Date) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const ys = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return Math.ceil((((t.getTime() - ys.getTime()) / 86400000) + 1) / 7);
}
const MONTH_FR = ["janv", "févr", "mars", "avr", "mai", "juin", "juil", "août", "sept", "oct", "nov", "déc"];
const monthLabel = (ym: string) => { const [, m] = (ym || "").split("-"); return MONTH_FR[Number(m) - 1] || ym; };

// Barres mensuelles maison (projection facturation) — réalisé vs planifié, style sobre du design system.
function MonthBars({ rows }: { rows: { name: string; realise: number; planifie: number }[] }) {
  if (!rows.length) return <EmptyState label="Projection de facturation indisponible (dates ClickUp à synchroniser)." />;
  const mx = Math.max(1, ...rows.map((r) => r.realise + r.planifie));
  return (
    <div className="flex items-end justify-around gap-2 h-[200px] pt-4">
      {rows.map((r) => {
        const hR = (r.realise / mx) * 160, hP = (r.planifie / mx) * 160;
        return (
          <div key={r.name} className="flex flex-col items-center gap-1 flex-1 min-w-0">
            <span className="text-[10px] text-muted tabnum">{fmt(r.realise + r.planifie)}</span>
            <div className="flex flex-col justify-end" style={{ height: 160 }}>
              {hP > 0 && <div className="w-7 rounded-t" style={{ height: hP, background: T.gold, opacity: 0.5 }} title={`Planifié ${fmt(r.planifie)}`} />}
              <div className="w-7" style={{ height: hR, background: T.emerald }} title={`Réalisé ${fmt(r.realise)}`} />
            </div>
            <span className="text-[11px] text-faint">{r.name}</span>
          </div>
        );
      })}
    </div>
  );
}

function ExportBtn() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const onClick = async () => {
    if (busy) return; setBusy(true);
    toast("Génération du one-pager CODIR…", "info");
    try {
      const r = await callExportReport("all");
      if (r.url) { window.open(r.url, "_blank"); toast("Export CODIR prêt.", "ok"); }
      else toast("Export généré (URL signée indisponible en émulateur).", "info");
    } catch (e: any) {
      toast("Export refusé : " + String(e?.message || e?.code || "").replace(/^functions\//, ""), "err");
    } finally { setBusy(false); }
  };
  return <button type="button" onClick={onClick} disabled={busy} className="btn-ghost !px-2.5 !py-1 text-xs font-semibold">{busy ? "Export…" : "Exporter CODIR (XLSX)"}</button>;
}

export const Codir: FC<Props> = () => {
  const { data: cfg } = useDocData<PeriodsConfig>("config/periods");
  const fy = cfg?.currentFy;
  const { data: att } = useDocData<AtterrissageSummary>(fy ? `summaries/atterrissage_${fy}` : null);
  const { data: clients } = useDocData<EntitySummary>("summaries/clients_all");
  const { data: backlog } = useDocData<BacklogSummary>("summaries/backlog_fy");
  const { data: trend } = useDocData<BillingTrendSummary>(fy ? `summaries/billingTrend_${fy}` : null);
  const canExport = useCanExport();

  const week = isoWeek(new Date());
  // KPI (atterrissage CAF) : facturé YTD, backlog, CAF projeté (certitudes) et yc forecast (pipeline pondéré).
  const cafYtd = att?.factureN || 0;
  const backlogYtd = att?.backlog || 0;
  const forecast = att?.pipelinePondere || 0;
  const cafEstYcForecast = att?.cafProjete || 0;
  const cafEst = Math.max(cafEstYcForecast - forecast, 0); // hors forecast = certitudes seules
  const objectifCaf = att?.objectifCaf || 0;
  const atteinte = objectifCaf > 0 ? Math.min(cafEstYcForecast / objectifCaf, 1) : 0;

  const rows = (clients?.rows || []).filter((r) => !r.isOther);
  const topCmd = [...rows].sort((a, b) => (b.cas || 0) - (a.cas || 0)).slice(0, 8)
    .map((r) => ({ name: r.key, v: r.cas || 0, sub: `${Math.round((r.cas || 0) / 1e6)} M` }));
  const topProj = [...rows].sort((a, b) => (b.projete || b.cas || 0) - (a.projete || a.cas || 0)).slice(0, 8)
    .map((r) => ({ name: r.key, v: r.projete || r.cas || 0, sub: `${Math.round((r.projete || r.cas || 0) / 1e6)} M` }));

  const top10 = (backlog?.top || []).slice(0, 10);
  const monthRows = (trend?.months || []).map((m) => ({ name: monthLabel(m.month), realise: m.realise || 0, planifie: m.planifie || 0 }))
    .filter((m) => m.realise + m.planifie > 0);

  const backlogCols = [
    colText("Client", (r: NonNullable<BacklogSummary["top"]>[number]) => r.client || "—", (r: any) => r.client || ""),
    colText("Description du projet", (r: any) => <span className="truncate max-w-[380px] inline-block align-bottom">{r.affaire || "—"}</span>),
    colNum("RAF total", (r: any) => money(r.raf), (r: any) => r.raf || 0),
  ];

  return (
    <div className="flex flex-col gap-4">
      <FreshnessGuard />
      <Card
        title={<span className="flex items-center gap-3">Bilan hebdomadaire — Projection CAF <Badge tone="gold">S{week}</Badge>{fy && <Badge tone="neutral">FY {fy}</Badge>}</span>}
        actions={canExport ? <ExportBtn /> : undefined}
      >
        {!att ? <div className="py-8 text-center text-faint">Agrégats indisponibles — lance un recalcul (Vue d'ensemble).</div> : (
          <div className="flex flex-col gap-4">
            {/* KPI row */}
            <div className="grid gap-2 sm:gap-3 grid-cols-2 lg:grid-cols-4">
              <Kpi label="CAF YTD" value={fmt(cafYtd)} tone="emerald" sub="facturé — exercice" />
              <Kpi label="Backlog YTD" value={fmt(backlogYtd)} tone="clay" sub="RAF glissant" />
              <Kpi label="CAF Estimé" value={fmt(cafEst)} tone="steel" sub="certitudes (hors forecast)" />
              <Kpi label="CAF Estimé yc Forecast" value={fmt(cafEstYcForecast)} tone="gold" sub={`+ ${fmt(forecast)} pipeline pondéré`} />
            </div>

            {/* Jauge d'atteinte + forecast */}
            <div className="grid gap-3 md:grid-cols-2">
              <div className="rounded-lg border border-line bg-panel2/40 p-3">
                <div className="text-[12px] text-muted mb-1">CAF prévisionnel vs objectif {fy || ""}</div>
                <Gauge value={atteinte} color={atteinte >= 0.9 ? T.emerald : atteinte >= 0.6 ? T.gold : T.clay} />
                <div className="text-center text-[12px] text-muted -mt-1">
                  <b className="text-ink tabnum">{fmt(cafEstYcForecast)}</b> / objectif <b className="tabnum">{fmt(objectifCaf)}</b>
                </div>
              </div>
              <div className="rounded-lg border border-line bg-panel2/40 p-3 flex flex-col justify-center">
                <div className="text-[12px] text-muted">Forecast annuel (pipeline pondéré)</div>
                <div className="font-display tabnum text-[28px] text-gold leading-tight">{fmt(forecast)}</div>
                <div className="text-[11px] text-faint">Écart entre le CAF estimé et le CAF estimé yc forecast — potentiel non encore certain.</div>
              </div>
            </div>

            {/* Top clients */}
            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <div className="text-[12px] font-semibold text-muted mb-2">Top clients — Commandes (PO value)</div>
                {topCmd.length ? <HBars rows={topCmd} colorFn={() => T.steel} /> : <EmptyState />}
              </div>
              <div>
                <div className="text-[12px] font-semibold text-muted mb-2">Top clients — Commandes &amp; Certitudes &amp; Forecast</div>
                {topProj.length ? <HBars rows={topProj} colorFn={() => T.gold} /> : <EmptyState />}
              </div>
            </div>

            {/* Top 10 backlog + projection facturation */}
            <div className="grid gap-3 lg:grid-cols-2">
              <div>
                <div className="text-[12px] font-semibold text-muted mb-2">Top 10 Backlog</div>
                <Table columns={backlogCols} rows={top10} colsKey="codir-backlog" empty="Aucun backlog." pageSize={10} />
              </div>
              <div>
                <div className="text-[12px] font-semibold text-muted mb-2">Projection facturation
                  <span className="ml-2 text-[10px] font-normal text-faint">▮ réalisé · ▯ planifié</span></div>
                <MonthBars rows={monthRows} />
              </div>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
};
