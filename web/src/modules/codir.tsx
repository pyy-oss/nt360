// BILAN HEBDOMADAIRE CODIR — « Projection CAF » : one-pager de pilotage hebdo (comité de direction).
// Réassemble des AGRÉGATS EXISTANTS (atterrissage, clients, backlog, tendance de facturation) dans la
// mise en page du tableau de bord Excel « Projection CA ». AUCUN calcul confidentiel (CAF, backlog,
// prise de commande — pas de marge) → visible au niveau « overview ». Export XLSX = one-pager CODIR
// existant (exportReport).
import { useState, type FC } from "react";
import { Card, Kpi, Badge, Table, money, useToast, EmptyState, colText, colNum } from "../design/components";
import { Gauge } from "../design/charts";
import { FreshnessGuard, type Props } from "./_shared";
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
// Montant compact : « 1.39 Md » au-delà du milliard, sinon « 693 M » (aligné sur l'affichage Excel CODIR).
const mM = (v: number) => (Math.abs(v) >= 1e9 ? `${(v / 1e9).toFixed(2)} Md` : `${Math.round(v / 1e6)} M`);

// Barre horizontale client — soit simple (CAS), soit EMPILÉE Certitudes (CAS) + Forecast (pipeline
// pondéré ouvert), pour que la part de forecast soit VISIBLE même petite. Aligné à droite : valeur + delta.
function ClientBars({ rows, stacked }: { rows: { name: string; cas: number; forecast: number }[]; stacked?: boolean }) {
  if (!rows.length) return <EmptyState />;
  const mx = Math.max(1, ...rows.map((r) => r.cas + (stacked ? r.forecast : 0)));
  return (
    <div className="flex flex-col gap-2.5 mt-1">
      {rows.map((r) => {
        const total = r.cas + (stacked ? r.forecast : 0);
        return (
          <div key={r.name}>
            <div className="flex justify-between text-[12.5px] mb-1">
              <span className="truncate max-w-[180px] text-ink">{r.name}</span>
              <span className="text-muted tabnum">
                {mM(total)}
                {stacked && r.forecast > 0 && <span className="text-gold"> · +{mM(r.forecast)} forecast</span>}
              </span>
            </div>
            <div className="flex h-[8px] w-full overflow-hidden rounded bg-panel2">
              <div className="h-full" style={{ width: `${Math.max((r.cas / mx) * 100, 1)}%`, background: T.steel }} title={`Commandes (CAS) ${fmt(r.cas)}`} />
              {stacked && r.forecast > 0 && (
                <div className="h-full" style={{ width: `${(r.forecast / mx) * 100}%`, background: T.gold }} title={`Forecast pondéré ${fmt(r.forecast)}`} />
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// Projection facturation mensuelle — barres verticales empilées (réalisé + planifié), valeur en M au
// sommet, ligne de base, largeur constante. Plus lisible que la version brute.
function MonthBars({ rows }: { rows: { name: string; realise: number; planifie: number }[] }) {
  if (!rows.length) return <EmptyState label="Projection de facturation indisponible (dates ClickUp à synchroniser)." />;
  const mx = Math.max(1, ...rows.map((r) => r.realise + r.planifie));
  const H = 150;
  return (
    <div className="relative pt-5">
      <div className="flex items-end justify-between gap-1.5 border-b border-line" style={{ height: H + 4 }}>
        {rows.map((r) => {
          const total = r.realise + r.planifie;
          const hR = (r.realise / mx) * H, hP = (r.planifie / mx) * H;
          return (
            <div key={r.name} className="group relative flex flex-1 flex-col items-center justify-end min-w-0" style={{ height: H }}>
              <span className="mb-1 text-[10px] text-muted tabnum whitespace-nowrap">{mM(total)}</span>
              {hP > 0 && <div className="w-full max-w-[30px] rounded-t-sm" style={{ height: hP, background: T.gold, opacity: 0.45 }} title={`Planifié ${fmt(r.planifie)}`} />}
              {hR > 0 && <div className={`w-full max-w-[30px] ${hP > 0 ? "" : "rounded-t-sm"}`} style={{ height: hR, background: T.emerald }} title={`Réalisé ${fmt(r.realise)}`} />}
            </div>
          );
        })}
      </div>
      <div className="flex justify-between gap-1.5">
        {rows.map((r) => <span key={r.name} className="flex-1 text-center text-[11px] text-faint">{r.name}</span>)}
      </div>
    </div>
  );
}

function Legend({ items }: { items: { color: string; label: string; faded?: boolean }[] }) {
  return (
    <span className="ml-2 inline-flex items-center gap-2 text-[10px] font-normal text-faint">
      {items.map((it) => (
        <span key={it.label} className="inline-flex items-center gap-1">
          <span className="inline-block h-2 w-2.5 rounded-sm" style={{ background: it.color, opacity: it.faded ? 0.45 : 1 }} />{it.label}
        </span>
      ))}
    </span>
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
  // Le champ `forecast`/`projete` est produit par le recompute. S'il est absent (agrégat antérieur à
  // l'ajout du champ), on le signale plutôt que d'afficher deux graphes identiques (CAS = projeté).
  const hasForecast = rows.some((r) => r.forecast != null);
  const barRows = (getVal: (r: typeof rows[number]) => number) =>
    [...rows].sort((a, b) => getVal(b) - getVal(a)).slice(0, 8)
      .map((r) => ({ name: r.key, cas: r.cas || 0, forecast: r.forecast || 0 }));
  const topCmd = barRows((r) => r.cas || 0);
  const topProj = barRows((r) => r.projete || r.cas || 0);

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
          <div className="flex flex-col gap-5">
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
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <div className="text-[12px] font-semibold text-muted mb-2">Top clients — Commandes <Legend items={[{ color: T.steel, label: "PO value (CAS)" }]} /></div>
                <ClientBars rows={topCmd} />
              </div>
              <div>
                <div className="text-[12px] font-semibold text-muted mb-2">Top clients — Commandes &amp; Certitudes &amp; Forecast
                  <Legend items={[{ color: T.steel, label: "certitudes" }, { color: T.gold, label: "forecast" }]} /></div>
                {hasForecast
                  ? <ClientBars rows={topProj} stacked />
                  : <div className="rounded-lg border border-gold/40 bg-gold/10 px-3 py-2 text-[12px] text-ink">Le <b>forecast par client</b> sera disponible au prochain recalcul (nouvel indicateur). Lance « Recalculer » (Vue d'ensemble) pour distinguer certitudes et forecast.</div>}
              </div>
            </div>

            {/* Top 10 backlog + projection facturation */}
            <div className="grid gap-4 lg:grid-cols-2">
              <div>
                <div className="text-[12px] font-semibold text-muted mb-2">Top 10 Backlog</div>
                <Table columns={backlogCols} rows={top10} colsKey="codir-backlog" empty="Aucun backlog." pageSize={10} />
              </div>
              <div>
                <div className="text-[12px] font-semibold text-muted mb-2">Projection facturation
                  <Legend items={[{ color: T.emerald, label: "réalisé" }, { color: T.gold, label: "planifié", faded: true }]} /></div>
                <MonthBars rows={monthRows} />
              </div>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
};
