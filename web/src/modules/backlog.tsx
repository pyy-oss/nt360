// Modules pilotage : Suivi Backlog, Prévision (atterrissage CAS/CAF), liste Commandes.
import { useState, type FC } from "react";
import { useDocData, useCollectionData } from "../lib/hooks";
import { useCanImport, useCanSeeMargin, useClaims } from "../lib/rbac";
import { T, fmt, pct } from "../design/tokens";
import { Card, Kpi, Table, Badge, Busy, Tip, EmptyState, ErrorState, CardSkeleton, ListView, Segmented, Eyebrow, colText, colNum, money, cx } from "../design/components";
import { Bars, DonutBU, GroupedBars, Gauge, MultiLine } from "../design/charts";
import { Props, grid4, cols2, objToArr, toDonut, buBadge, ImportButton, FilterNote, useCommandesRows, FpLink } from "./_shared";
import { DERIVE_SUSPECT_PCT, FIAB } from "../lib/thresholds";
import { useFilters } from "../lib/filters";
import { patchOrder, setBillingMilestones, type BillingMilestone } from "../lib/writes";
import { defaultMilestones } from "../lib/milestones";
import type { BacklogSummary, PipelineSummary, AtterrissageSummary, PeriodsConfig, TrendsSummary, Order, CashflowSummary, BillingMilestonesDoc, BillingTrendSummary } from "../types";

// 5 — Suivi Backlog
export const Backlog: FC<Props> = () => {
  const { data, loading, error } = useDocData<BacklogSummary>("summaries/backlog_fy");
  if (error) return <ErrorState error={error} />;
  if (loading && !data) return <CardSkeleton />;
  if (!data) return <EmptyState />;
  const total = data.total || 0;
  const derive = data.totalDerive || 0;
  const excel = data.totalExcel ?? (total - derive);
  const derivePct = total > 0 ? derive / total : 0;
  const deriveRows = data.deriveTop || [];
  return (
    <div className="flex flex-col gap-4">
      <div className={grid4}><Kpi label={`Backlog FY ${data.fy || ""}`} value={fmt(total)} tone="steel" sub={`${data.count} commandes`} /></div>

      {/* Diagnostic de fiabilité du RAF : curaté Excel (fiable) vs dérivé CAS − facturé (surévalué). */}
      {(data.totalDerive != null || data.totalExcel != null) && (
        <Card title="Fiabilité du RAF — d'où vient le backlog">
          <div className={grid4}>
            <Kpi label="RAF curaté (Excel P&L)" value={fmt(excel)} tone="emerald" sub={`${data.countExcel ?? 0} commandes · fiable`} />
            <Kpi label="RAF dérivé (CAS − facturé)" value={fmt(derive)} tone={derivePct > DERIVE_SUSPECT_PCT ? "clay" : "steel"} sub={`${data.countDerive ?? 0} commandes · ${pct(derivePct)} du total`} />
          </div>
          <Tip>
            Le <b>RAF dérivé</b> (opp. gagnée ou fiche <b>sans base P&L</b>, ou facture non rattachée au N° FP)
            vaut <code>CAS − facturé</code> — <b>surévalué</b> tant que le rattachement facture→FP est partiel.
            C'est cette part ({fmt(derive)}) qui gonfle le backlog au-dessus de la cible.
          </Tip>
        </Card>
      )}

      <div className={cols2}>
        <Card title="Par millésime"><Bars data={objToArr(data.byVintage)} color={T.clay} name="Backlog" /></Card>
        <Card title="Par domaine"><DonutBU data={toDonut(data.byBu)} /></Card>
      </div>

      {deriveRows.length > 0 && (
        <Card title={`Commandes à RAF dérivé (suspectes) · ${deriveRows.length}`}>
          <Table columns={[
            colText("FP", (t) => <FpLink fp={t.fp} />, (t) => t.fp),
            colText("Client", (t) => t.client),
            colText("Affaire", (t) => t.affaire || "—"),
            colText("BU", (t) => t.bu),
            colText("Source", (t) => SRC_LABEL[t.source || ""] || t.source || "—"),
            colNum("Année", (t) => t.yearPo || "—"),
            colNum("CAS", (t) => money(t.cas)),
            colNum("Facturé", (t) => money(t.facture)),
            colNum("RAF dérivé", (t) => money(t.raf)),
          ]} rows={deriveRows} />
          <Tip>Ces lignes n'ont pas de RAF curaté dans l'Excel P&L : leur RAF est calculé <code>CAS − facturé</code>. Vérifie si elles devraient déjà être soldées, ou si des factures leur manquent un rattachement N° FP.</Tip>
        </Card>
      )}

      <Card title="Top commandes ouvertes">
        <Table columns={[colText("FP", (t) => <FpLink fp={t.fp} />, (t) => t.fp), colText("Client", (t) => t.client), colText("Affaire", (t) => t.affaire || "—"), colText("BU", (t) => t.bu), colNum("RAF", (t) => money(t.raf))]} rows={data.top || []} />
      </Card>
      <CarryoverCard />
      <Tip>Ancré sur l'année fiscale — inchangé quand on change la période.</Tip>
    </div>
  );
};

type OpenOrder = Order & { projetable: number };

// Report de CA sur N+1 & JALONS de facturation par projet (direction / PMO). Deux niveaux :
//  • report simple : montant du RAF facturé en N+1 (fallback quand pas de jalons) ;
//  • jalons (≤ 15, date + montant) : échéancier prévisionnel — SOURCE UNIQUE du report N+1 (Σ après
//    le 31/12) quand ils existent. Persistés hors des commandes, non écrasés par les réimports.
function CarryoverCard() {
  const { role } = useClaims();
  const canEdit = role === "direction" || role === "pmo";
  const canMargin = useCanSeeMargin();
  const { data: cfg } = useDocData<PeriodsConfig>("config/periods");
  const fy = cfg?.currentFy;
  const cutoff = fy ? `${fy}-12-31` : "9999-12-31";
  const { rows: orders } = useCommandesRows(canEdit); // toutes les commandes (chargées seulement si éditeur)
  const { rows: mstones } = useCollectionData<BillingMilestonesDoc>(canEdit ? "billingMilestones" : null);
  const [editFp, setEditFp] = useState<string | null>(null);
  const [seg, setSeg] = useState<"all" | "ms" | "drift" | "none">("all");
  if (!canEdit) return null;
  const msBy = new Map<string, BillingMilestone[]>();
  for (const m of mstones) if (m.fp) msBy.set(m.fp.toUpperCase(), (m.milestones || []) as BillingMilestone[]);
  const rateOf = (o: Order) => ((o.cas || 0) > 0 ? (o.mb || 0) / (o.cas || 0) : (o.marginPct || 0));
  // Report N+1 : SOURCE UNIQUE = les jalons (Σ après le 31/12, borné au RAF). Nul sans jalon post-31/12.
  const repOf = (o: OpenOrder) => {
    const ms = msBy.get((o.fp || "").toUpperCase());
    if (!ms) return 0;
    return Math.min(ms.filter((x) => (x.date || "") > cutoff).reduce((s, x) => s + (x.amount || 0), 0), o.projetable);
  };
  const msOf = (o: OpenOrder) => msBy.get((o.fp || "").toUpperCase());
  const driftOf = (o: OpenOrder) => { const ms = msOf(o); return !!ms?.length && Math.round(ms.reduce((s, x) => s + (x.amount || 0), 0)) !== Math.round(o.projetable); };
  const open: OpenOrder[] = orders
    .map((o) => ({ ...o, projetable: Math.max(Math.min(o.raf || 0, (o.cas || 0) - (o.facture || 0)), 0) }))
    .filter((o) => o.projetable > 0)
    .sort((a, b) => b.projetable - a.projetable);
  const totalRaf = open.reduce((s, o) => s + o.projetable, 0);
  const totalReporte = open.reduce((s, o) => s + repOf(o), 0);
  const totalMarge = open.reduce((s, o) => s + rateOf(o) * repOf(o), 0);
  const withMs = open.filter((o) => msOf(o)?.length);
  const drifting = open.filter(driftOf);
  // Filtre segmenté : concentrer sur ce qui demande une action (à réconcilier) plutôt que défiler 569 lignes.
  const SEGS = [
    { value: "all" as const, label: "Tous", count: open.length },
    { value: "ms" as const, label: "À jalons", count: withMs.length },
    { value: "drift" as const, label: "À réconcilier", count: drifting.length },
    { value: "none" as const, label: "Sans jalon", count: open.length - withMs.length },
  ];
  const shown = seg === "ms" ? withMs : seg === "drift" ? drifting : seg === "none" ? open.filter((o) => !msOf(o)?.length) : open;
  const editing = editFp ? open.find((o) => o.fp === editFp) : null;
  // Rendu atténué d'un zéro (réduit le bruit visuel des colonnes majoritairement nulles).
  const num = (v: number, tone = "text-steel") => v > 0 ? <span className={cx("tabnum", tone)}>{fmt(v)}</span> : <span className="tabnum text-faint">·</span>;
  return (
    <Card title="Jalons de facturation (par projet)">
      {/* Synthèse : contexte avant les lignes. Total reporté N+1 (et marge) mis en avant s'il existe. */}
      <div className={grid4}>
        <Kpi label="Projets ouverts" value={open.length.toLocaleString("fr-FR")} sub={`${fmt(totalRaf)} RAF projetable`} />
        <Kpi label="Échéancés (jalons)" value={withMs.length.toLocaleString("fr-FR")} tone="gold" sub={drifting.length ? `${drifting.length} à réconcilier` : "à jour"} />
        <Kpi label="Reporté sur N+1" value={fmt(totalReporte)} tone="steel" sub="exclu du Projeté CAF courant" />
        {canMargin && <Kpi label="Marge reportée N+1" value={fmt(totalMarge)} tone="steel" sub="au prorata du CA reporté" />}
      </div>
      {drifting.length > 0 && (
        <button type="button" onClick={() => setSeg("drift")} className="mt-3 flex w-full items-center gap-2 rounded-lg border border-gold/40 bg-gold/10 px-3 py-2 text-left text-[13px] text-ink hover:bg-gold/15">
          <span aria-hidden="true">⚠</span><span><b>{drifting.length} projet{drifting.length > 1 ? "s" : ""} à réconcilier</b> — la facturation a progressé, Σ jalons ≠ RAF projetable. Réajuste l'échéancier.</span>
        </button>
      )}
      <div className="mt-3 mb-2">
        <Segmented value={seg} onChange={setSeg} options={SEGS} ariaLabel="Filtrer les projets" />
      </div>
      {editing && <MilestoneEditor fp={editing.fp!} raf={editing.projetable} initial={msBy.get((editing.fp || "").toUpperCase()) || []} fy={fy} onClose={() => setEditFp(null)} />}
      <ListView
        rows={shown}
        searchKeys={[(r) => r.fp, (r) => r.client, (r) => r.affaire || ""]}
        columns={[
          colText("FP", (r) => <FpLink fp={r.fp} />, (r) => r.fp),
          colText("Client", (r) => r.client, (r) => r.client),
          colText("Affaire", (r) => r.affaire || "—", (r) => r.affaire || ""),
          colNum("RAF projetable", (r) => money(r.projetable), (r) => r.projetable),
          colNum("Reporté N+1", (r: OpenOrder) => <span title="Dérivé des jalons (Σ après le 31/12), borné au RAF projetable">{num(repOf(r))}</span>, (r: OpenOrder) => repOf(r)),
          ...(canMargin ? [colNum("Marge reportée", (r: OpenOrder) => num(rateOf(r) * repOf(r)), (r: OpenOrder) => rateOf(r) * repOf(r))] : []),
          colNum("Jalons", (r: OpenOrder) => {
            const ms = msOf(r);
            return (
              <button className="btn-ghost !px-2.5 !py-1 text-xs min-h-[34px] inline-flex items-center gap-1.5 justify-end" onClick={() => setEditFp(r.fp!)} title={ms?.length ? "Modifier l'échéancier" : "Définir l'échéancier"}>
                {ms?.length ? <><span className="tabnum text-ink">{ms.length}</span><span className="text-muted">jalon{ms.length > 1 ? "s" : ""}</span></> : <span className="text-gold">Définir</span>}
                {driftOf(r) && <Badge tone="gold">⚠</Badge>}
              </button>
            );
          }, (r: OpenOrder) => (msOf(r)?.length || 0)),
        ]}
      />
      <Tip><b>Jalons</b> (≤ 15, date + montant) : échéancier prévisionnel de facturation, <b>source unique</b> du report N+1. <b>Reporté N+1</b> (lecture seule) = Σ des jalons datés <b>après le 31/12</b>, borné au RAF projetable — ce CA (et sa marge) est <b>exclu du Projeté CAF</b> courant (Prévision / Vue d'ensemble) et amorce l'exercice N+1. Un <b>⚠</b> signale une <b>réconciliation</b> (Σ jalons ≠ RAF, la facturation a progressé). L'enregistrement relance le calcul.</Tip>
    </Card>
  );
}
// Éditeur d'échéancier de facturation (≤ 15 jalons). Règle STRICTE : Σ jalons = RAF projetable pour
// pouvoir enregistrer. Le report N+1 dérivé (Σ après le 31/12) est affiché en direct.
function MilestoneEditor({ fp, raf, initial, fy, onClose }: { fp: string; raf: number; initial: BillingMilestone[]; fy?: number; onClose: () => void }) {
  const [rows, setRows] = useState<BillingMilestone[]>(initial.length ? initial.map((m) => ({ date: m.date, amount: m.amount })) : [{ date: "", amount: 0 }]);
  const set = (i: number, patch: Partial<BillingMilestone>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const add = () => setRows((rs) => (rs.length < 15 ? [...rs, { date: "", amount: 0 }] : rs));
  const del = (i: number) => setRows((rs) => rs.filter((_, j) => j !== i));
  // Pré-remplissage par défaut : RAF projetable réparti uniformément sur 3 jalons jusqu'au 31/12
  // (aligné sur le repli serveur). L'utilisateur peut ensuite ajuster dates/montants avant d'enregistrer.
  const fill = () => { const today = new Date().toISOString().slice(0, 10); const d = defaultMilestones(raf, today, fy || Number(today.slice(0, 4))); if (d.length) setRows(d); };
  const clean = rows.filter((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.date) && Number(r.amount) > 0).map((r) => ({ date: r.date, amount: Math.round(Number(r.amount)) }));
  const total = clean.reduce((s, r) => s + r.amount, 0);
  const matches = Math.round(total) === Math.round(raf);
  const cutoff = fy ? `${fy}-12-31` : "";
  const reported = cutoff ? clean.filter((r) => r.date > cutoff).reduce((s, r) => s + r.amount, 0) : 0;
  return (
    <div className="mb-3 rounded-lg border border-gold/40 bg-panel2 p-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-semibold">Jalons de facturation — {fp}</span>
        <button className="btn-ghost !px-2 !py-1 text-xs" onClick={onClose}>Fermer</button>
      </div>
      <div className="flex flex-col gap-2">
        {rows.map((r, i) => (
          <div key={i} className="flex items-center gap-2">
            <input type="date" className="field !py-1 text-xs" value={r.date} onChange={(e) => set(i, { date: e.target.value })} aria-label="Date du jalon" />
            <input className="field !py-1 text-xs w-40 text-right" inputMode="numeric" placeholder="Montant" value={r.amount || ""} onChange={(e) => set(i, { amount: Number(String(e.target.value).replace(/\s/g, "").replace(",", ".")) || 0 })} aria-label="Montant du jalon" />
            <button className="btn-ghost !px-2 !py-1 text-xs text-clay" onClick={() => del(i)} aria-label="Supprimer le jalon">×</button>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-3 mt-2 flex-wrap text-[12px]">
        {rows.length < 15 && <button className="btn-ghost !px-2 !py-1 text-xs" onClick={add}>+ Jalon</button>}
        <button className="btn-ghost !px-2 !py-1 text-xs" onClick={fill} title="Répartir uniformément le RAF projetable sur 3 jalons jusqu'au 31/12 (ajustable)">Répartir par défaut</button>
        <span className={matches ? "text-emerald" : "text-clay"}>Σ jalons {fmt(total)} / RAF {fmt(raf)}{matches ? " ✓" : ` · écart ${fmt(total - raf)}`}</span>
        <span className="text-steel">dont reporté N+1 : {fmt(reported)}</span>
        {matches
          ? <Busy label="Enregistrer" okMsg="Jalons enregistrés (recalcul lancé)" fn={async () => { await setBillingMilestones(fp, clean); onClose(); }} />
          : <button className="btn-gold opacity-40 cursor-not-allowed" disabled title="Σ jalons doit égaler le RAF projetable">Enregistrer</button>}
      </div>
      <Tip>≤ 15 jalons (date + montant). <b>Σ jalons = RAF projetable</b> requis pour enregistrer (règle stricte). Le <b>report N+1</b> dérive des jalons datés <b>après le 31/12</b>. Quand la facturation progresse, réajuste les jalons — l'écart Σ ≠ RAF signale la réconciliation.</Tip>
    </div>
  );
}
// 6 — Prévision (ancrée FY, cohérente avec l'atterrissage)
export const Prevision: FC<Props> = () => {
  const { data: bl } = useDocData<BacklogSummary>("summaries/backlog_fy");
  const { data: pl } = useDocData<PipelineSummary>("summaries/pipeline");
  const { data: cfg } = useDocData<PeriodsConfig>("config/periods");
  const { data: att } = useDocData<AtterrissageSummary>(cfg?.currentFy ? `summaries/atterrissage_${cfg.currentFy}` : null);
  const canMargin = useCanSeeMargin();
  // Marge reportée sur N+1 (isolée, gatée « rentabilite ») — pour le caveat de l'atterrissage CAF.
  const { data: attMargin } = useDocData<{ reporteMarge?: number }>(canMargin && cfg?.currentFy ? `summaries/atterrissageMargin_${cfg.currentFy}` : null);
  const { data: trends } = useDocData<TrendsSummary>("summaries/trends");
  const { data: cf } = useDocData<CashflowSummary>("summaries/cashflow");
  // Tendance de facturation (réalisé vs planifié par les jalons) jusqu'au 31/12 — accès facturation.
  const { data: billTrend } = useDocData<BillingTrendSummary>(cfg?.currentFy ? `summaries/billingTrend_${cfg.currentFy}` : null);
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
        <Kpi label="Projeté CAF (FY)" value={fmt(cafProjete)} tone="gold" sub="Facturé + Backlog (à facturer) + Pipeline projeté" />
      </div>
      {att && (
        <>
          <div className={cols2}>
            <Card title={`Atterrissage CAS ${att.fy} — prise de commande`}>
              <Gauge value={att.probaAtteinte || 0} color={(att.ecart || 0) < 0 ? T.clay : T.emerald} />
              {(att.objectif || 0) > 0 && <div className="text-[11px] text-faint text-center -mt-1">Taux d'atteinte : projeté / objectif (plafonné à 100 %)</div>}
              <div className="grid grid-cols-3 gap-2 mt-2 text-center">
                <div><div className="text-[11px] text-muted">Projeté CAS</div><div className="font-display tabnum text-[17px] leading-tight text-gold">{fmt(att.projete)}</div></div>
                <div><div className="text-[11px] text-muted">Objectif</div><div className="font-display tabnum">{(att.objectif || 0) > 0 ? fmt(att.objectif) : "—"}</div></div>
                <div><div className="text-[11px] text-muted">Écart</div><div className={cx("font-display tabnum", (att.ecart || 0) < 0 ? "text-clay" : "text-emerald")}>{(att.objectif || 0) > 0 ? fmt(att.ecart) : "—"}</div></div>
              </div>
              {(att.pipelineRetard || 0) > 0 && <div className="text-[11px] text-clay text-center mt-1" title="Comptées dans le projeté (D Prev dans l'exercice) mais D Prev déjà dépassée — « en retard de closing » côté Pipeline.">dont {fmt(att.pipelineRetard)}{(att.pipelineRetardCount || 0) > 0 ? ` (${att.pipelineRetardCount} opp.)` : ""} à requalifier — D Prev dépassée</div>}
            </Card>
            <Card title={`Atterrissage CAF ${att.fy} — facturation`}>
              <Gauge value={att.probaAtteinteCaf || 0} color={(att.ecartCaf || 0) < 0 ? T.clay : T.emerald} />
              {(att.objectifCaf || 0) > 0 && <div className="text-[11px] text-faint text-center -mt-1">Taux d'atteinte : projeté / objectif (plafonné à 100 %)</div>}
              <div className="grid grid-cols-3 gap-2 mt-2 text-center">
                <div><div className="text-[11px] text-muted">Projeté CAF</div><div className="font-display tabnum text-[17px] leading-tight text-gold">{fmt(att.cafProjete)}</div></div>
                <div><div className="text-[11px] text-muted">Objectif</div><div className="font-display tabnum">{(att.objectifCaf || 0) > 0 ? fmt(att.objectifCaf) : "—"}</div></div>
                <div><div className="text-[11px] text-muted">Écart</div><div className={cx("font-display tabnum", (att.ecartCaf || 0) < 0 ? "text-clay" : "text-emerald")}>{(att.objectifCaf || 0) > 0 ? fmt(att.ecartCaf) : "—"}</div></div>
              </div>
              {(att.pipelineRetard || 0) > 0 && <div className="text-[11px] text-clay text-center mt-1" title="Comptées dans le projeté (D Prev dans l'exercice) mais D Prev déjà dépassée — « en retard de closing » côté Pipeline.">dont {fmt(att.pipelineRetard)}{(att.pipelineRetardCount || 0) > 0 ? ` (${att.pipelineRetardCount} opp.)` : ""} à requalifier — D Prev dépassée</div>}
              {(att.reporteCaf || 0) > 0 && <div className="text-[11px] text-steel text-center mt-1" title="RAF explicitement reporté sur l'exercice suivant (par projet, Suivi Backlog) — EXCLU de ce projeté CAF.">hors {fmt(att.reporteCaf)} reporté sur N+1{canMargin && (attMargin?.reporteMarge || 0) > 0 ? ` · marge ${fmt(attMargin?.reporteMarge)}` : ""} (exclu du projeté)</div>}
            </Card>
          </div>
          <Card title="Facturation N vs N-1">
            <GroupedBars data={[{ name: `FY ${(att.fy || 0) - 1}`, Facturé: att.factureN1 }, { name: `FY ${att.fy}`, Facturé: att.factureN }]} series={[{ key: "Facturé", color: T.emerald, name: "Facturé" }]} h={220} size={54} />
            <Tip>Croissance : <span className={(att.croissanceFacture || 0) >= 0 ? "text-emerald" : "text-clay"}>{pct(att.croissanceFacture)}</span></Tip>
          </Card>
          {att.next && ((att.next.cafProjete || 0) > 0 || (att.next.projete || 0) > 0) && (
            <Card title={`Amorce d'atterrissage ${att.next.fy} — exercice suivant`}>
              <div className={cols2}>
                <Kpi label={`Projeté CAS ${att.next.fy}`} value={fmt(att.next.projete)} sub="Réalisé CAS N+1 + pipeline (D Prev N+1)" />
                <Kpi label={`Projeté CAF ${att.next.fy}`} value={fmt(att.next.cafProjete)} tone="gold" sub={`Facturé N+1 + reporté de ${att.fy} + pipeline`} />
              </div>
              <Tip>
                Amorce de l'exercice <b>{att.next.fy}</b> : le <b>CA reporté de {att.fy}</b> ({fmt(att.next.reporteEntrant)}{canMargin && (attMargin?.reporteMarge || 0) > 0 ? ` · marge ${fmt(attMargin?.reporteMarge)}` : ""}) constitue le <b>backlog entrant</b>, complété par le <b>pipeline</b> dont la D Prev tombe en {att.next.fy}. Le RAF glissant reste facturé en {att.fy} (non recompté ici). {(att.next.objectifCaf || 0) > 0 ? <>Objectif CAF {att.next.fy} : {fmt(att.next.objectifCaf)} · écart {fmt(att.next.ecartCaf)}.</> : null}
              </Tip>
            </Card>
          )}
        </>
      )}
      {billTrend && (billTrend.months?.length || 0) > 0 && (
        <Card title={`Tendance de facturation ${billTrend.fy} — jusqu'au 31/12`}>
          <div className={grid4}>
            <Kpi label="Facturé à date" value={fmt(billTrend.realiseYtd)} tone="emerald" sub="mois échus (réel)" />
            <Kpi label="Planifié restant" value={fmt(billTrend.planifieRestant)} tone="steel" sub="jalons des mois à venir" />
            <Kpi label="Projeté au 31/12" value={fmt(billTrend.projeteDec)} tone="gold" sub="réalisé + planifié restant" />
          </div>
          <MultiLine
            data={(billTrend.months || []).map((m) => ({ name: m.month.slice(5), "Réalisé cumulé": m.cumulRealise, "Trajectoire (→ 31/12)": m.cumulTrajectoire }))}
            series={[
              { key: "Réalisé cumulé", color: T.emerald, name: "Réalisé cumulé" },
              { key: "Trajectoire (→ 31/12)", color: T.gold, name: "Trajectoire (réalisé + planifié)" },
            ]}
          />
          <div className="mt-4 border-t border-line/60 pt-3">
            <Eyebrow>Réalisé vs planifié par mois</Eyebrow>
            <GroupedBars
              data={(billTrend.months || []).map((m) => ({ name: m.month.slice(5), Réalisé: m.realise, Planifié: m.planifie }))}
              series={[{ key: "Réalisé", color: T.emerald, name: "Réalisé" }, { key: "Planifié", color: T.steel, name: "Planifié (jalons)" }]}
              h={220} size={16} interval={0}
            />
          </div>
          <Tip>La <b>trajectoire</b> combine le <b>réalisé</b> (factures datées) pour les mois échus et le <b>planifié</b> (jalons de facturation) pour les mois à venir → <b>projeté de facturation au 31/12</b>. L'écart réalisé/planifié par mois révèle l'avance ou le retard sur le plan.</Tip>
        </Card>
      )}
      {cf && ((cf.openCount || 0) > 0 || (cf.bcOpenCount || 0) > 0) && (() => {
        // Prévision de trésorerie NETTE : encaissements AR attendus − décaissements fournisseurs
        // attendus, mois par mois (échus isolés des deux côtés). La fiabilité de la ventilation des
        // décaissements dépend de la part des lignes BC à ETA connue : sans ETA → rabattues sur le
        // mois courant, ce qui gonfle artificiellement la sortie du 1er mois.
        const months = cf.months || [];
        const fiab = cf.decaissementEtaCompleteness ?? 1;
        const fiabTone: "emerald" | "gold" | "clay" = fiab >= FIAB.GOOD ? "emerald" : fiab >= FIAB.FAIR ? "gold" : "clay";
        const netHorizon = (cf.arHorizon || 0) - months.reduce((s, m) => s + (m.decaissement || 0), 0);
        return (
          <Card title={`Prévision de trésorerie — position nette (${cf.horizon || 6} mois glissants)`}>
            <div className={grid4}>
              <Kpi label="Encaissements attendus (AR)" value={fmt(cf.arHorizon)} tone="emerald" sub={`${cf.openCount || 0} créances · échéancier`} />
              <Kpi label="Décaissements attendus (BC)" value={fmt(months.reduce((s, m) => s + (m.decaissement || 0), 0))} tone="clay" sub={`${cf.bcOpenCount || 0} lignes BC ouvertes`} />
              <Kpi label="Position nette horizon" value={fmt(netHorizon)} tone={netHorizon < 0 ? "clay" : "emerald"} sub="AR attendu − décaissements" />
              <Kpi label="Échus (recouvrer / payer)" value={`${fmt(cf.overdue)} / ${fmt(cf.decaissementOverdue)}`} tone={(cf.decaissementOverdue || 0) > 0 ? "clay" : "steel"} sub={`${cf.overdueCount || 0} créances · ${cf.decaissementOverdueCount || 0} BC échus`} />
            </div>
            <GroupedBars
              data={months.map((m) => ({ name: m.month, Encaissements: m.ar || 0, Décaissements: m.decaissement || 0 }))}
              series={[{ key: "Encaissements", color: T.emerald, name: "Encaissements (AR)" }, { key: "Décaissements", color: T.clay, name: "Décaissements (BC)" }]}
              h={220} size={26}
            />
            {/* Indicateur de fiabilité : complétude ETA des décaissements. */}
            <div className="mt-3 flex items-center gap-3">
              <span className="text-xs text-muted whitespace-nowrap">Fiabilité prévision décaissement</span>
              <div className="flex-1 h-2 rounded-full bg-line/60 overflow-hidden">
                <div className="h-full rounded-full" style={{ width: `${Math.round(fiab * 100)}%`, background: fiabTone === "emerald" ? T.emerald : fiabTone === "gold" ? T.gold : T.clay }} />
              </div>
              <Badge tone={fiabTone}>{pct(fiab)}</Badge>
            </div>
            <Tip>
              <b>Position nette</b> = encaissements AR attendus (créances émises, ancrées sur leur échéance) − décaissements fournisseurs attendus (lignes BC non soldées, ancrées sur leur ETA réel/contractuel). Les <b>échus</b> sont isolés des deux côtés (jamais empilés sur le mois courant). Le <b>backlog RAF</b> reste indicatif et hors du net.
              {(cf.decaissementNoEtaCount || 0) > 0 && (
                <> La <b>fiabilité</b> ({pct(fiab)}) reflète la part du montant BC à ETA connue : <b>{cf.decaissementNoEtaCount}</b> ligne{(cf.decaissementNoEtaCount || 0) > 1 ? "s" : ""} sans ETA {(cf.decaissementNoEtaCount || 0) > 1 ? "sont rabattues" : "est rabattue"} sur le mois courant — renseigner leur ETA affine la ventilation.</>
              )}
            </Tip>
          </Card>
        );
      })()}
      {(trends?.points?.length || 0) >= 2 && (
        <Card title="Tendances (historique des recalculs)">
          <MultiLine
            data={(trends!.points || []).map((p) => ({ name: p.date, Backlog: p.backlog || 0, "Pipeline projeté": p.pipeline || 0, "Projeté CAS": p.projeteCas || 0, "Facturé réalisé": p.caf || 0 }))}
            series={[
              { key: "Backlog", color: T.steel, name: "Backlog" },
              { key: "Pipeline projeté", color: T.gold, name: "Pipeline projeté" },
              { key: "Projeté CAS", color: T.ink, name: "Projeté CAS" },
              { key: "Facturé réalisé", color: T.emerald, name: "Facturé réalisé" },
            ]}
          />
          <Tip>Un point par recalcul (max 1/jour). Le <b>burn-down du backlog</b> et l'écart <b>projeté vs réalisé</b> se lisent dans le temps à mesure que les données sont mises à jour.</Tip>
        </Card>
      )}
      <Tip><b>Pipeline projeté</b> (logique de projection moyen terme) = 100 % du CA des opportunités IdC ≥ 90 % + 20 % du CA des IdC ≥ 70 % (&lt; 90 %), dont la clôture prévue (D Prev) tombe dans l'exercice {fy}. Les <b>certitudes glissent</b> : une D Prev déjà passée <b>dans l'année</b> compte toujours — seules celles de {fy ? Number(fy) - 1 : "N-1"} (révolues) ou de {fy ? Number(fy) + 1 : "N+1"}+ (non encore dans l'exercice) sont exclues. <b>Projeté CAS</b> = Réalisé CAS + pipeline projeté. <b>Projeté CAF</b> = Facturé réalisé + Backlog (RAF) + pipeline projeté (le backlog y entre, sans double compte).</Tip>
    </div>
  );
};

// 6bis — Simulateur d'atterrissage (what-if) : leviers commerciaux → impact live sur
// le Projeté CAS/CAF et le taux d'atteinte de l'objectif. 100 % client (aucune écriture).
const M = 1_000_000;
export const Simulateur: FC<Props> = () => {
  const { data: cfg } = useDocData<PeriodsConfig>("config/periods");
  const { data: att } = useDocData<AtterrissageSummary>(cfg?.currentFy ? `summaries/atterrissage_${cfg.currentFy}` : null);
  const [addPipe, setAddPipe] = useState(0);   // pipeline pondéré additionnel (FCFA)
  const [realiz, setRealiz] = useState(100);   // taux de réalisation du pipeline (%)
  const [objOverride, setObjOverride] = useState<string>(""); // objectif CAS simulé (M FCFA), vide = réel
  if (!att) return <EmptyState label="Atterrissage indisponible — importer données & objectifs, puis recalculer." />;

  const realiseCas = att.realiseCas || 0;
  // Backlog utilisé pour la projection CAF = RAF plafonné à (CAS − facturé) (neutralisation du double
  // compte facturé + RAF), pour que le simulateur parte de la MÊME base que l'atterrissage réel.
  const backlog = att.backlogProjete ?? att.backlog ?? 0;
  const factureN = att.factureN || 0;
  const basePipe = att.pipelinePondere || 0;
  const objectifCas = objOverride.trim() !== "" ? (Number(objOverride) || 0) * M : (att.objectif || 0);
  const objectifCaf = att.objectifCaf || 0;

  const pipeEff = (basePipe + addPipe) * (realiz / 100);
  const projeteCas = realiseCas + pipeEff;
  const projeteCaf = factureN + backlog + pipeEff;
  const ecartCas = projeteCas - objectifCas;
  const ecartCaf = projeteCaf - objectifCaf;
  const probaCas = objectifCas > 0 ? Math.max(0, Math.min(1, projeteCas / objectifCas)) : 0;
  const probaCaf = objectifCaf > 0 ? Math.max(0, Math.min(1, projeteCaf / objectifCaf)) : 0;

  const baseProjeteCas = att.projete ?? (realiseCas + basePipe);
  const baseProjeteCaf = att.cafProjete ?? (factureN + backlog + basePipe);
  const maxAdd = Math.max(Math.round((basePipe || 100 * M) * 2), 200 * M);
  const dirty = addPipe !== 0 || realiz !== 100 || objOverride.trim() !== "";
  const reset = () => { setAddPipe(0); setRealiz(100); setObjOverride(""); };

  return (
    <div className="flex flex-col gap-4">
      <Card title={`Leviers de simulation — exercice ${att.fy ?? cfg?.currentFy ?? ""}`} actions={dirty ? <button onClick={reset} className="btn-ghost !px-2.5 !py-1 text-xs">Réinitialiser</button> : undefined}>
        <div className="flex flex-col gap-4">
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted flex justify-between"><span>Pipeline pondéré additionnel (nouvelles affaires gagnées)</span><span className="text-ink font-semibold tabnum">+{fmt(addPipe)}</span></span>
            <input type="range" min={0} max={maxAdd} step={Math.round(maxAdd / 100)} value={addPipe} onChange={(e) => setAddPipe(Number(e.target.value))} aria-label="Pipeline additionnel" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted flex justify-between"><span>Taux de réalisation du pipeline projeté (part convertie)</span><span className="text-ink font-semibold tabnum">{realiz} %</span></span>
            {/* Borné à 100 % : le pipeline est DÉJÀ pondéré (100 %≥90 · 20 %≥70). L'upside passe par
                le « pipeline additionnel » ci-dessus, pas par une réalisation > 100 % (biais optimiste). */}
            <input type="range" min={0} max={100} step={5} value={realiz} onChange={(e) => setRealiz(Number(e.target.value))} aria-label="Taux de réalisation" />
          </label>
          <label className="flex flex-col gap-1 max-w-xs">
            <span className="text-xs text-muted">Objectif CAS simulé (M FCFA) — vide = objectif réel {(att.objectif || 0) > 0 ? `(${Math.round((att.objectif || 0) / M).toLocaleString("fr-FR")} M)` : "(non défini)"}</span>
            <input className="field" inputMode="numeric" placeholder="ex. 4000" value={objOverride} onChange={(e) => setObjOverride(e.target.value)} aria-label="Objectif CAS simulé" />
          </label>
        </div>
      </Card>

      <div className={cols2}>
        <Card title="Atterrissage CAS simulé — prise de commande">
          <Gauge value={probaCas} color={ecartCas < 0 ? T.clay : T.emerald} />
          {objectifCas > 0 && <div className="text-[11px] text-faint text-center -mt-1">Taux d'atteinte : projeté / objectif (plafonné à 100 %)</div>}
          <div className="grid grid-cols-3 gap-2 mt-2 text-center">
            <div><div className="text-[11px] text-muted">Projeté CAS</div><div className="font-display tabnum">{fmt(projeteCas)}</div></div>
            <div><div className="text-[11px] text-muted">Objectif</div><div className="font-display tabnum">{objectifCas > 0 ? fmt(objectifCas) : "—"}</div></div>
            <div><div className="text-[11px] text-muted">Écart</div><div className={cx("font-display tabnum", ecartCas < 0 ? "text-clay" : "text-emerald")}>{objectifCas > 0 ? fmt(ecartCas) : "—"}</div></div>
          </div>
        </Card>
        <Card title="Atterrissage CAF simulé — facturation">
          <Gauge value={probaCaf} color={ecartCaf < 0 ? T.clay : T.emerald} />
          {objectifCaf > 0 && <div className="text-[11px] text-faint text-center -mt-1">Taux d'atteinte : projeté / objectif (plafonné à 100 %)</div>}
          <div className="grid grid-cols-3 gap-2 mt-2 text-center">
            <div><div className="text-[11px] text-muted">Projeté CAF</div><div className="font-display tabnum">{fmt(projeteCaf)}</div></div>
            <div><div className="text-[11px] text-muted">Objectif</div><div className="font-display tabnum">{objectifCaf > 0 ? fmt(objectifCaf) : "—"}</div></div>
            <div><div className="text-[11px] text-muted">Écart</div><div className={cx("font-display tabnum", ecartCaf < 0 ? "text-clay" : "text-emerald")}>{objectifCaf > 0 ? fmt(ecartCaf) : "—"}</div></div>
          </div>
        </Card>
      </div>

      <Card title="Base (réel) vs simulé">
        <Table columns={[
          colText("Grandeur", (r) => r.label, (r) => r.label),
          colNum("Base (réel)", (r) => money(r.base), (r) => r.base),
          colNum("Simulé", (r) => money(r.sim), (r) => r.sim),
          colNum("Δ", (r) => <span className={cx(r.sim - r.base < 0 ? "text-clay" : "text-emerald")}>{fmt(r.sim - r.base)}</span>, (r) => r.sim - r.base),
        ]} rows={[
          { label: "Pipeline projeté (effectif)", base: basePipe, sim: pipeEff },
          { label: "Projeté CAS", base: baseProjeteCas, sim: projeteCas },
          { label: "Projeté CAF", base: baseProjeteCaf, sim: projeteCaf },
        ]} />
      </Card>

      <Tip>Simulateur <b>local</b> (aucune donnée modifiée). Il part de l'atterrissage réel et applique tes leviers : <b>pipeline additionnel</b> (affaires que tu penses gagner en plus), <b>taux de réalisation</b> (part du pipeline projeté effectivement convertie), et un <b>objectif simulé</b> optionnel. Projeté CAS = Réalisé CAS + pipeline effectif ; Projeté CAF = Facturé + Backlog + pipeline effectif.</Tip>
    </div>
  );
};

// Correction inline d'une commande P&L : année de PO manquante et/ou N° FP erroné.
function OrderFixer({ fp, yearMissing }: { fp: string; yearMissing: boolean }) {
  const [y, setY] = useState("");
  const [nf, setNf] = useState("");
  return (
    <span className="inline-flex gap-1 items-center flex-wrap">
      {yearMissing && (
        <><input className="field w-16 !py-1 text-xs" aria-label="Année de PO" placeholder="Année" value={y} onChange={(e) => setY(e.target.value)} />
          <Busy variant="ghost" label="An" okMsg="Année fixée" fn={() => patchOrder({ fp, yearPo: Number(y) || 0 })} /></>
      )}
      <input className="field w-28 !py-1 text-xs" aria-label="Corriger le N° FP" placeholder="Corriger FP" value={nf} onChange={(e) => setNf(e.target.value)} />
      <Busy variant="ghost" label="FP" okMsg="FP corrigé" fn={() => patchOrder({ fp, newFp: nf })} />
    </span>
  );
}

// Liste Commandes — vue fusionnée (fiche affaire > opp gagnée > P&L), matérialisée
// dans summaries/commandes par le recompute.
const SRC_LABEL: Record<string, string> = { fiche: "Fiche", opp_won: "Opp. gagnée", pnl: "P&L", legacy: "Legacy" };
// Provenance des données P&L (marge/coût) : saisie manuelle (import P&L Excel) ou fiche affaire.
const PNL_SRC: Record<string, { label: string; tone: "steel" | "gold" }> = {
  manuel: { label: "Manuel", tone: "steel" },
  fiche: { label: "Fiche affaire", tone: "gold" },
};
const pnlBadge = (s?: string | null) => {
  const m = s ? PNL_SRC[s] : null;
  return m ? <Badge tone={m.tone}>{m.label}</Badge> : <span className="text-faint">—</span>;
};
export const OrderList: FC<Props> = () => {
  const { rows: all, loading } = useCommandesRows();
  const { match } = useFilters();
  const rows = all.filter((r) => match(r, ["bu", "am", "client"]));
  const canImport = useCanImport();
  const canMargin = useCanSeeMargin();
  if (loading && !all.length) return <CardSkeleton />;
  if (!all.length) return <EmptyState label="Aucune commande. Importez des opportunités (gagnées) ou des fiches affaire." action={canImport ? <ImportButton label="Importer un fichier" /> : undefined} />;
  return (
    <div className="flex flex-col gap-2">
    <FilterNote dims="BU / AM / client" />
    <Card title={`Commandes · ${rows.length.toLocaleString("fr-FR")}`}>
      <ListView
        rows={rows}
        searchKeys={[(r) => r.fp, (r) => r.client, (r) => r.am, (r) => r.affaire || ""]}
        columns={[
          colText("FP", (r) => <FpLink fp={r.fp} />, (r) => r.fp),
          colText("Client", (r) => r.client, (r) => r.client),
          colText("Affaire", (r) => r.affaire || "—", (r) => r.affaire || ""),
          colText("BU", (r) => buBadge(r.bu), (r) => r.bu),
          colText("AM", (r) => r.am, (r) => r.am),
          colNum("CAS", (r) => money(r.cas), (r) => r.cas),
          colNum("RAF", (r) => money(r.raf), (r) => r.raf),
          // Marges masquées pour les rôles sans accès « Rentabilité » (confidentialité).
          ...(canMargin ? [
            colNum("MB", (r: Order) => money(r.mb), (r: Order) => r.mb),
            colNum("%MB", (r: Order) => pct(r.cas ? (r.mb || 0) / r.cas : 0), (r: Order) => (r.cas ? (r.mb || 0) / r.cas : 0)),
            colText("P&L", (r: Order) => pnlBadge(r.pnlSource), (r: Order) => r.pnlSource || ""),
          ] : []),
          colNum("Année", (r) => r.yearPo || "—", (r) => r.yearPo || 0),
          colText("Source", (r) => SRC_LABEL[r.source || ""] || r.source || "—", (r) => r.source || ""),
          ...(canImport ? [colText("Corriger", (r: Order) => (r.source === "pnl" && r.fp
            ? <OrderFixer fp={r.fp} yearMissing={!(r.yearPo && r.yearPo > 0)} />
            : <span className="text-[11px] text-faint">source</span>), () => 0)] : []),
        ]}
      />
    </Card>
    </div>
  );
};
