// Modules pilotage : Suivi Backlog, Prévision (atterrissage CAS/CAF), liste Commandes.
import { useState, useMemo, type FC, type ReactNode } from "react";
import { useDocData, useCollectionData } from "../lib/hooks";
import { useCanImport, useCanSeeMargin, useCan } from "../lib/rbac";
import { T, fmt, pct } from "../design/tokens";
import { Card, Kpi, Table, Badge, Busy, DangerBtn, Modal, Tip, EmptyState, ErrorState, CardSkeleton, ListView, Segmented, Eyebrow, colText, colNum, det, money, cx, useToast } from "../design/components";
import { Bars, DonutBU, GroupedBars, MultiLine } from "../design/charts";
import { DateField } from "../design/inputs";
import { Props, grid4, cols2, objToArr, toDonut, buBadge, ImportButton, FilterNote, AtterrissageGauge, useCommandesRows, useProjectManagers, FpLink } from "./_shared";
import { DERIVE_SUSPECT_PCT, FIAB } from "../lib/thresholds";
import { useFilters } from "../lib/filters";
import { useNav } from "../lib/nav";
import { useRecordScope } from "../lib/scope";
import { patchOrder, createOrder, deleteRecord, fpDocId, setBillingMilestones, setCancellation, patchOpportunity, setOrderPm, pushOrderToClickup, syncOrderAmount, type BillingMilestone } from "../lib/writes";
import { defaultMilestones } from "../lib/milestones";
import type { BacklogSummary, PipelineSummary, AtterrissageSummary, PeriodsConfig, TrendsSummary, Order, CashflowSummary, CashScenarioSummary, BillingMilestonesDoc, BillingTrendSummary, Opportunity, CancellationsDoc, PmsSummary, PmRow, ClickupDelaysSummary, ClickupPmDelay, ClickupStatusDist, ClickupMonthRaf } from "../types";

// Champs de formulaire HISSÉS au scope module : définis dans le corps d'un composant, ils étaient
// recréés à chaque render → React démontait/remontait le sous-arbre → PERTE DE FOCUS à chaque frappe.
const Fld = ({ label, children }: { label: string; children: ReactNode }) => (
  <label className="flex flex-col gap-1 text-[12px] text-muted">{label}{children}</label>
);
const Sel = ({ v, set, opts, ph }: { v: string; set: (s: string) => void; opts: string[]; ph: string }) => (
  <select className="field !py-1.5" value={v} onChange={(e) => set(e.target.value)}>
    <option value="">{ph}</option>
    {opts.map((o) => <option key={o} value={o}>{o}</option>)}
  </select>
);

// 5 — Suivi Backlog
export const Backlog: FC<Props> = () => {
  const { data, loading, error } = useDocData<BacklogSummary>("summaries/backlog_fy");
  const canImport = useCanImport(); // avant tout retour anticipé (règle des hooks)
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
            ...(canImport ? [colText("Intégration", (t) => <RafValidator row={t} />)] : []),
          ]} rows={deriveRows} />
          <Tip>Ces lignes n'ont pas de RAF curaté dans l'Excel P&L : leur RAF est calculé <code>CAS − facturé</code> (potentiellement surévalué). {canImport
            ? <>Après vérification, cliquez « <b>intégrer</b> » pour <b>valider le RAF</b> (le figer comme curaté → la commande rejoint le backlog fiable et quitte ce lot), ou « <b>Solder</b> » (RAF = 0) si l'affaire est livrée/facturée.</>
            : <>Vérifiez si elles devraient déjà être soldées, ou s'il manque un rattachement N° FP à des factures.</>}</Tip>
        </Card>
      )}

      <Card title="Top commandes ouvertes">
        <Table columns={[colText("FP", (t) => <FpLink fp={t.fp} />, (t) => t.fp), colText("Client", (t) => t.client), colText("Affaire", (t) => t.affaire || "—"), colText("BU", (t) => t.bu), colNum("RAF", (t) => money(t.raf))]} rows={data.top || []} />
      </Card>
      <ClickupDelaysCard />
      <CarryoverCard />
      <Tip>Ancré sur l'année fiscale — inchangé quand on change la période.</Tip>
    </div>
  );
};

// Analytique délais & échéances ClickUp (summaries/clickupDelays) : retard de livraison par PM /
// par statut + RAF échéancé par mois de date prév. de fin. N'apparaît qu'une fois la synchro inverse
// ClickUp peuplée (bouton « Synchroniser depuis ClickUp » ou tirage quotidien).
function ClickupDelaysCard() {
  const { data } = useDocData<ClickupDelaysSummary>("summaries/clickupDelays");
  const byPm = data?.byPm || [], byStatus = data?.byStatus || [], rafByMonth = data?.rafByMonth || [];
  if (!data || (!byPm.length && !byStatus.length && !rafByMonth.length)) return null;
  return (
    <Card title="Délais & échéances ClickUp">
      <div className={grid4}>
        <Kpi label="Projets en retard de livraison" value={String(data.overdueTotal || 0)} tone={(data.overdueTotal || 0) > 0 ? "clay" : "emerald"} sub="date contractuelle dépassée, non livrés" />
        <Kpi label="Retard moyen" value={`${data.avgDaysLate || 0} j`} tone="steel" sub="sur les projets en retard" />
      </div>
      <div className={cols2}>
        {byPm.length > 0 && (
          <div>
            <Eyebrow>Par Project Manager</Eyebrow>
            <Table columns={[
              colText("PM", (r: ClickupPmDelay) => r.pm),
              colNum("Actifs", (r: ClickupPmDelay) => r.active),
              colNum("En retard", (r: ClickupPmDelay) => (r.overdue ? <span className="text-clay">{r.overdue}</span> : 0)),
              colNum("Retard moy.", (r: ClickupPmDelay) => (r.overdue ? `${r.avgDaysLate} j` : "—")),
            ]} rows={byPm} />
          </div>
        )}
        {rafByMonth.length > 0 && (
          <div>
            <Eyebrow>RAF à facturer par mois (prév. ClickUp)</Eyebrow>
            <Table columns={[
              colText("Mois", (r: ClickupMonthRaf) => r.month),
              colNum("Projets", (r: ClickupMonthRaf) => r.count),
              colNum("RAF", (r: ClickupMonthRaf) => money(r.raf)),
            ]} rows={rafByMonth} />
          </div>
        )}
      </div>
      {byStatus.length > 0 && (
        <div className="mt-3">
          <Eyebrow>Par statut projet</Eyebrow>
          <Table columns={[
            colText("Statut", (r: ClickupStatusDist) => r.status),
            colNum("Projets", (r: ClickupStatusDist) => r.count),
            colNum("En retard", (r: ClickupStatusDist) => (r.overdue ? <span className="text-clay">{r.overdue}</span> : 0)),
          ]} rows={byStatus} />
        </div>
      )}
      <Tip>Alimenté par la synchro inverse ClickUp (statut + dates). Le <b>RAF échéancé</b> indique quand le backlog des projets actifs devrait se facturer, selon la <b>date prév. de fin</b> ClickUp.</Tip>
    </Card>
  );
}

type OpenOrder = Order & { projetable: number };

// Report de CA sur N+1 & JALONS de facturation par projet (direction / PMO). Deux niveaux :
//  • report simple : montant du RAF facturé en N+1 (fallback quand pas de jalons) ;
//  • jalons (≤ 15, date + montant) : échéancier prévisionnel — SOURCE UNIQUE du report N+1 (Σ après
//    le 31/12) quand ils existent. Persistés hors des commandes, non écrasés par les réimports.
function CarryoverCard() {
  const canEdit = useCan("backlog") === "write"; // gouverné par la matrice (comme le serveur : requireWrite('backlog'))
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
        colsKey="backlog-projets"
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
            <DateField className="!py-1 text-xs w-36" value={r.date} onChange={(v) => set(i, { date: v })} ariaLabel="Date du jalon" placeholder="date jalon" />
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
  const { data: attBase } = useDocData<AtterrissageSummary>(cfg?.currentFy ? `summaries/atterrissage_${cfg.currentFy}` : null);
  // Objectifs annuels isolés (doc gaté « objectifs », cf. audit RBAC) : re-fusionnés pour l'affichage ;
  // null si le rôle n'a pas « objectifs » → cible/écart « — ». Fusion profonde de `next`.
  const { data: attObj } = useDocData<AtterrissageSummary>(cfg?.currentFy ? `summaries/atterrissageObjectifs_${cfg.currentFy}` : null);
  const att = attBase ? { ...attBase, ...(attObj || {}), next: { ...(attBase.next || {}), ...(attObj?.next || {}) } } : attBase;
  const canMargin = useCanSeeMargin();
  // Marge reportée sur N+1 (isolée, gatée « rentabilite ») — pour le caveat de l'atterrissage CAF.
  const { data: attMargin } = useDocData<{ reporteMarge?: number }>(canMargin && cfg?.currentFy ? `summaries/atterrissageMargin_${cfg.currentFy}` : null);
  const { data: trends } = useDocData<TrendsSummary>("summaries/trends");
  const { data: cf } = useDocData<CashflowSummary>("summaries/cashflow");
  const { data: scen } = useDocData<CashScenarioSummary>("summaries/cashScenario");
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
  // Libellé des niveaux de projection DÉRIVÉ de config/projection (comme le Pipeline), et non codé
  // en dur : un poids/niveau modifié en Habilitations se reflète ici (cf. audit intégral F3).
  const projActive = (pl?.tierBreakdown || []).filter((t) => t.active);
  const projLabel = projActive.map((t) => `${Math.round(t.weight * 100)} %·${t.band}`).join(" · ") || "projection pipeline";
  const projDesc = projActive.map((t) => `${Math.round(t.weight * 100)} % du CA des opportunités IdC ${t.band}`).join(" + ") || "la pondération configurée (Habilitations)";
  return (
    <div className="flex flex-col gap-4">
      {/* Composantes (chacune une seule fois) : le Pipeline projeté et le Backlog alimentent
          les DEUX atterrissages — on ne les duplique plus. */}
      <div className={grid4}>
        <Kpi label={`Réalisé CAS (FY ${fy || ""})`} value={fmt(realiseCas)} tone="emerald" />
        <Kpi label={`Facturé réalisé (FY ${fy || ""})`} value={fmt(factureN)} tone="emerald" />
        <Kpi label="Backlog (RAF)" value={fmt(backlog)} tone="steel" sub="reste à facturer, glissant" />
        <Kpi label="Pipeline projeté" value={fmt(pond)} tone="gold" sub={`${projLabel} · fenêtre FY`} />
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
              <AtterrissageGauge proba={att.probaAtteinte || 0} hasObjectif={(att.objectif || 0) > 0} />
              <div className="grid grid-cols-3 gap-2 mt-2 text-center">
                <div><div className="text-[11px] text-muted">Projeté CAS</div><div className="font-display tabnum text-[17px] leading-tight text-gold">{fmt(att.projete)}</div></div>
                <div><div className="text-[11px] text-muted">Objectif</div><div className="font-display tabnum">{(att.objectif || 0) > 0 ? fmt(att.objectif) : "—"}</div></div>
                <div><div className="text-[11px] text-muted">Écart</div><div className={cx("font-display tabnum", (att.ecart || 0) < 0 ? "text-clay" : "text-emerald")}>{(att.objectif || 0) > 0 ? fmt(att.ecart) : "—"}</div></div>
              </div>
              {(att.pipelineRetard || 0) > 0 && <div className="text-[11px] text-clay text-center mt-1" title="Comptées dans le projeté (D Prev dans l'exercice) mais D Prev déjà dépassée — « en retard de closing » côté Pipeline.">dont {fmt(att.pipelineRetard)}{(att.pipelineRetardCount || 0) > 0 ? ` (${att.pipelineRetardCount} opp.)` : ""} à requalifier — D Prev dépassée</div>}
            </Card>
            <Card title={`Atterrissage CAF ${att.fy} — facturation`}>
              <AtterrissageGauge proba={att.probaAtteinteCaf || 0} hasObjectif={(att.objectifCaf || 0) > 0} />
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
              <Kpi label="Décaissements (facturés)" value={fmt(months.reduce((s, m) => s + (m.decaissement || 0), 0))} tone="clay" sub={`${cf.bcOpenCount || 0} BC facturés · règle SOA`} />
              <Kpi label="Position nette horizon" value={fmt(netHorizon)} tone={netHorizon < 0 ? "clay" : "emerald"} sub="AR attendu − payables facturés" />
              <Kpi label="Engagement (non facturé)" value={fmt(cf.decaissementEngaged)} tone="steel" sub={`${cf.decaissementEngagedCount || 0} BC en cours · sortie potentielle`} />
            </div>
            <GroupedBars
              data={months.map((m) => ({ name: m.month, Encaissements: m.ar || 0, "Décaissements (facturés)": m.decaissement || 0, "Engagement (potentiel)": m.engaged || 0 }))}
              series={[{ key: "Encaissements", color: T.emerald, name: "Encaissements (AR)" }, { key: "Décaissements (facturés)", color: T.clay, name: "Décaissements (facturés)" }, { key: "Engagement (potentiel)", color: T.steel, name: "Engagement (BC non facturés)" }]}
              h={220} size={20}
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
              <b>Position nette</b> = encaissements AR attendus (créances émises, ancrées sur leur échéance) − <b>décaissements facturés</b> (BC au statut « facturé », non payés — <b>règle SOA</b> : seule une facture est due). Les <b>échus</b> sont isolés des deux côtés. L'<b>engagement</b> (BC commandés non encore facturés) est une sortie <b>potentielle</b>, affichée à part et <b>hors position nette</b> (elle alourdit le seul scénario pessimiste ci-dessous). Le <b>backlog RAF</b> reste indicatif et hors du net.
              {(cf.decaissementNoEtaCount || 0) > 0 && (
                <> La <b>fiabilité</b> ({pct(fiab)}) reflète la part du montant BC à ETA connue : <b>{cf.decaissementNoEtaCount}</b> ligne{(cf.decaissementNoEtaCount || 0) > 1 ? "s" : ""} sans ETA {(cf.decaissementNoEtaCount || 0) > 1 ? "sont rabattues" : "est rabattue"} sur le mois courant — renseigner leur ETA affine la ventilation.</>
              )}
            </Tip>
          </Card>
        );
      })()}
      {scen && (scen.months?.length || 0) > 0 && (() => {
        const months = scen.months || [];
        const t = scen.tension || {};
        const inTension = (t.monthsCount || 0) > 0;
        const opening = scen.opening || 0;
        const endWorst = months[months.length - 1].cum.worst;
        const endBest = months[months.length - 1].cum.best;
        return (
          <Card title={`Prévision cash — scénarios & tension (${scen.horizon || months.length} mois glissants)`}>
            <div className={grid4}>
              <Kpi label="Position fin d'horizon (pire)" value={fmt(endWorst)} tone={endWorst < 0 ? "clay" : "emerald"} sub="worst : recouvrement lent, paiement rapide" />
              <Kpi label="Position fin d'horizon (optimiste)" value={fmt(endBest)} tone={endBest < 0 ? "clay" : "emerald"} sub="best : recouvrement rapide, paiement différé" />
              <Kpi label="Mois en tension (pire)" value={(t.monthsCount || 0).toLocaleString("fr-FR")} tone={inTension ? "clay" : "emerald"} sub={inTension ? `dès ${t.firstMonth}` : "aucun sous le plancher"} />
              <Kpi label="Creux de trésorerie (pire)" value={fmt(t.trough?.value || 0)} tone={(t.trough?.value || 0) < 0 ? "clay" : "steel"} sub={t.trough?.month ? `en ${t.trough.month}` : "—"} />
            </div>
            {inTension && (
              <div className="mt-3 rounded-lg border border-clay/40 bg-clay/10 px-3 py-2 text-[13px] text-clay">
                <b>Tension de trésorerie projetée</b> dès <b>{t.firstMonth}</b> — la position cumulée du scénario pessimiste passe sous le plancher{opening ? "" : " (variation cumulée depuis aujourd'hui, hors solde d'ouverture)"}. Creux à <b>{fmt(t.trough?.value || 0)}</b> en {t.trough?.month}. Anticiper : accélérer le recouvrement (Relances), différer des décaissements, ou mobiliser une ligne de trésorerie.
              </div>
            )}
            <div className="mt-3">
              <MultiLine
                data={months.map((m) => ({ name: m.month.slice(5), Pessimiste: m.cum.worst, Base: m.cum.base, Optimiste: m.cum.best }))}
                series={[
                  { key: "Optimiste", color: T.emerald, name: "Optimiste (best)" },
                  { key: "Base", color: T.gold, name: "Base" },
                  { key: "Pessimiste", color: T.clay, name: "Pessimiste (worst)" },
                ]}
              />
            </div>
            <Tip>
              Position de trésorerie <b>cumulée</b> par mois selon trois scénarios{opening ? <> (solde d'ouverture {fmt(opening)})</> : <> (variation depuis aujourd'hui — <b>solde d'ouverture non renseigné</b>)</>}. <b>Optimiste</b> : AR recouvré à 100 % et vite, payables échus différés. <b>Pessimiste</b> : recouvrement partiel et lent, payables échus réglés immédiatement, et l'<b>engagement</b> (BC non facturés) supposé facturé & payé sur l'horizon. La <b>tension</b> est un mois où la trajectoire pessimiste passe sous le plancher — signal d'anticipation, pas une fatalité.
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
      <Tip><b>Pipeline projeté</b> (logique de projection moyen terme, pondération configurée en Habilitations) = {projDesc}, dont la clôture prévue (D Prev) tombe dans l'exercice {fy}. Les <b>certitudes glissent</b> : une D Prev déjà passée <b>dans l'année</b> compte toujours — seules celles de {fy ? Number(fy) - 1 : "N-1"} (révolues) ou de {fy ? Number(fy) + 1 : "N+1"}+ (non encore dans l'exercice) sont exclues. <b>Projeté CAS</b> = Réalisé CAS + pipeline projeté. <b>Projeté CAF</b> = Facturé réalisé + Backlog (RAF) + pipeline projeté (le backlog y entre, sans double compte).</Tip>
    </div>
  );
};

// 6bis — Simulateur d'atterrissage (what-if) : leviers commerciaux → impact live sur
// le Projeté CAS/CAF et le taux d'atteinte de l'objectif. 100 % client (aucune écriture).
const M = 1_000_000;
export const Simulateur: FC<Props> = () => {
  const { data: cfg } = useDocData<PeriodsConfig>("config/periods");
  const { data: attBase } = useDocData<AtterrissageSummary>(cfg?.currentFy ? `summaries/atterrissage_${cfg.currentFy}` : null);
  // Objectifs isolés (doc gaté « objectifs ») re-fusionnés pour le simulateur ; null si pas d'accès.
  const { data: attObj } = useDocData<AtterrissageSummary>(cfg?.currentFy ? `summaries/atterrissageObjectifs_${cfg.currentFy}` : null);
  const att = attBase ? { ...attBase, ...(attObj || {}), next: { ...(attBase.next || {}), ...(attObj?.next || {}) } } : attBase;
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
          <AtterrissageGauge proba={probaCas} hasObjectif={objectifCas > 0} />
          <div className="grid grid-cols-3 gap-2 mt-2 text-center">
            <div><div className="text-[11px] text-muted">Projeté CAS</div><div className="font-display tabnum text-[17px] leading-tight text-gold">{fmt(projeteCas)}</div></div>
            <div><div className="text-[11px] text-muted">Objectif</div><div className="font-display tabnum">{objectifCas > 0 ? fmt(objectifCas) : "—"}</div></div>
            <div><div className="text-[11px] text-muted">Écart</div><div className={cx("font-display tabnum", ecartCas < 0 ? "text-clay" : "text-emerald")}>{objectifCas > 0 ? fmt(ecartCas) : "—"}</div></div>
          </div>
        </Card>
        <Card title="Atterrissage CAF simulé — facturation">
          <AtterrissageGauge proba={probaCaf} hasObjectif={objectifCaf > 0} />
          <div className="grid grid-cols-3 gap-2 mt-2 text-center">
            <div><div className="text-[11px] text-muted">Projeté CAF</div><div className="font-display tabnum text-[17px] leading-tight text-gold">{fmt(projeteCaf)}</div></div>
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

const parseNum = (s: string) => Number(String(s).replace(",", ".").replace(/\s/g, ""));

// Champ de formulaire compact (saisie commande).
function Field({ label, v, set, placeholder, mode }: { label: string; v: string; set: (s: string) => void; placeholder?: string; mode?: "decimal" | "numeric" }) {
  return (
    <label className="flex flex-col gap-1 text-[13px]">
      <span className="text-muted">{label}</span>
      <input className="field !py-1" value={v} inputMode={mode} placeholder={placeholder} onChange={(e) => set(e.target.value)} aria-label={label} />
    </label>
  );
}

// Saisie d'une NOUVELLE commande (ligne P&L) directement dans l'app — sans passer par l'Excel.
// N° FP + CAS obligatoires ; RAF vide = dérivé (CAS − facturé). createOrder refuse un FP déjà présent.
function OrderForm({ onDone }: { onDone?: () => void }) {
  const [fp, setFp] = useState("");
  const [cas, setCas] = useState("");
  const [client, setClient] = useState("");
  const [affaire, setAffaire] = useState("");
  const [bu, setBu] = useState("");
  const [am, setAm] = useState("");
  const [year, setYear] = useState("");
  const [raf, setRaf] = useState("");
  const submit = async () => {
    const f = fp.trim();
    if (!f) throw new Error("N° FP requis");
    const c = parseNum(cas);
    if (!(c > 0)) throw new Error("CAS (> 0) requis");
    await createOrder({
      fp: f, cas: c, client: client.trim(), designation: affaire.trim(), bu: bu.trim(), am: am.trim(),
      yearPo: year ? Math.trunc(parseNum(year)) : undefined, raf: raf !== "" ? parseNum(raf) : undefined,
    });
    setFp(""); setCas(""); setClient(""); setAffaire(""); setBu(""); setAm(""); setYear(""); setRaf("");
    onDone?.();
  };
  return (
    <div className="mb-3 rounded-lg border border-line bg-panel2 p-3">
      <div className="grid gap-2.5 sm:grid-cols-3">
        <Field label="N° FP (obligatoire)" v={fp} set={setFp} placeholder="FP/2026/13" />
        <Field label="CAS (obligatoire)" v={cas} set={setCas} placeholder="0" mode="decimal" />
        <Field label="RAF (vide = dérivé)" v={raf} set={setRaf} placeholder="auto" mode="decimal" />
        <Field label="Client" v={client} set={setClient} />
        <Field label="Affaire" v={affaire} set={setAffaire} />
        <Field label="BU" v={bu} set={setBu} />
        <Field label="AM" v={am} set={setAm} />
        <Field label="Millésime (année PO)" v={year} set={setYear} placeholder="2026" mode="numeric" />
      </div>
      <div className="mt-2.5 flex justify-end">
        <Busy label="Créer la commande" okMsg="Commande créée (recalcul lancé)" errMsg="Création refusée" fn={submit} />
      </div>
      <Tip>La commande est créée en <b>source manuelle</b>. Au prochain import, une ligne P&L Excel du même FP restera <b>prioritaire</b> (elle écrase la saisie). Le CAS doit être &gt; 0.</Tip>
    </div>
  );
}

// Édition inline d'une commande P&L / manuelle : CAS, RAF, client, AM, année de PO, correction du N° FP.
// Correction d'une commande P&L/manuelle : ouvre une MODALE (formulaire propre) plutôt que d'entasser
// les champs dans une cellule étroite du tableau (rendu illisible / cassé sinon).
function OrderEditor({ row }: { row: Order }) {
  const fp = row.fp!;
  const [open, setOpen] = useState(false);
  const [cas, setCas] = useState("");
  const [raf, setRaf] = useState("");
  const [client, setClient] = useState("");
  const [am, setAm] = useState("");
  const [y, setY] = useState("");
  const [nf, setNf] = useState("");
  const yearMissing = !(row.yearPo && row.yearPo > 0);
  const anyField = cas !== "" || raf !== "" || client.trim() !== "" || am.trim() !== "";
  return (
    <>
      <button className="btn-ghost !px-2.5 !py-1 text-xs" onClick={() => setOpen(true)}>Corriger</button>
      <Modal open={open} onClose={() => setOpen(false)} size="md"
        title={<>Corriger la commande <span className="text-gold">{fp}</span></>}
        actions={<button className="btn-ghost" onClick={() => setOpen(false)}>Fermer</button>}>
        <div className="grid grid-cols-2 gap-3 mt-1">
          <Fld label="CAS"><input className="field !py-1.5" inputMode="decimal" aria-label={`CAS ${fp}`} placeholder="montant" value={cas} onChange={(e) => setCas(e.target.value)} /></Fld>
          <Fld label="RAF"><input className="field !py-1.5" inputMode="decimal" aria-label={`RAF ${fp}`} placeholder="reste à facturer" value={raf} onChange={(e) => setRaf(e.target.value)} /></Fld>
          <Fld label="Client"><input className="field !py-1.5" aria-label={`Client ${fp}`} placeholder="nom du client" value={client} onChange={(e) => setClient(e.target.value)} /></Fld>
          <Fld label="AM"><input className="field !py-1.5" aria-label={`AM ${fp}`} placeholder="commercial" value={am} onChange={(e) => setAm(e.target.value)} /></Fld>
          {yearMissing && <Fld label="Année de PO"><input className="field !py-1.5" aria-label={`Année de PO ${fp}`} placeholder="ex. 2026" value={y} onChange={(e) => setY(e.target.value)} /></Fld>}
          <Fld label="Corriger le N° FP"><input className="field !py-1.5" aria-label={`Corriger le N° FP ${fp}`} placeholder="nouveau N° FP" value={nf} onChange={(e) => setNf(e.target.value)} /></Fld>
        </div>
        <div className="flex gap-2 mt-4 flex-wrap">
          {anyField && <Busy label="Enregistrer" okMsg="Commande mise à jour" fn={() => patchOrder({ fp, cas: cas !== "" ? parseNum(cas) : undefined, raf: raf !== "" ? parseNum(raf) : undefined, client: client.trim() || undefined, am: am.trim() || undefined }).then(() => setOpen(false))} />}
          {yearMissing && y.trim() && <Busy variant="ghost" label="Fixer l'année" okMsg="Année fixée" fn={() => patchOrder({ fp, yearPo: Number(y) || 0 }).then(() => setOpen(false))} />}
          {nf.trim() && <Busy variant="ghost" label="Corriger le FP" okMsg="FP corrigé" fn={() => patchOrder({ fp, newFp: nf }).then(() => setOpen(false))} />}
          {!anyField && !nf.trim() && !(yearMissing && y.trim()) && <span className="text-[12px] text-faint self-center">Renseignez un champ à corriger.</span>}
        </div>
      </Modal>
    </>
  );
}

// Correction INLINE du montant (CAS) d'une commande P&L/manuelle, sans ouvrir la modale « Corriger ».
// Même repli tolérant que le parseur (« 5 000 000 » → 5000000) ; refuse un montant ≤ 0 plutôt que
// d'écrire un CAS nul en silence. Repatche la commande (patchOrder) → recalcul des agrégats derrière.
function OrderCasFixer({ row }: { row: Order }) {
  const [editing, setEditing] = useState(false);
  const [cas, setCas] = useState("");
  if (!editing) {
    return (
      <span className="inline-flex items-center gap-2 justify-end">
        {money(row.cas)}
        <button type="button" onClick={() => { setCas(String(row.cas ?? "")); setEditing(true); }} className="text-gold hover:underline text-[11px]" title="Corriger le montant (CAS)">corriger</button>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 justify-end flex-wrap">
      <input className="field w-28 !py-1 text-xs text-right" inputMode="decimal" autoFocus aria-label={`Corriger le CAS de ${row.fp}`} placeholder="montant" value={cas} onChange={(e) => setCas(e.target.value)} />
      <Busy variant="ghost" label="OK" okMsg="Montant corrigé (recalcul lancé)" errMsg="Correction refusée"
        fn={async () => { const v = parseNum(cas); if (!(v > 0)) throw new Error("saisir un montant > 0"); await patchOrder({ fp: row.fp!, cas: v }); setEditing(false); }} />
      <button type="button" onClick={() => setEditing(false)} className="text-muted hover:text-ink text-[11px]" aria-label="Annuler la correction">✕</button>
    </span>
  );
}

// Fait SORTIR une commande du lot « RAF dérivé (suspect) » → backlog FIABLE. Le RAF de ces lignes est
// calculé CAS − facturé (ligne P&L sans RAF curaté dans l'Excel) et peut être surévalué. Le data-steward
// VALIDE le RAF (le fige comme curaté, défaut = valeur dérivée, éditable) ou SOLDE (RAF = 0, affaire
// livrée). patchOrder écrit le RAF sur la commande P&L (une opp gagnée a toujours une ligne P&L sous-
// jacente) → au recompute, rafSource passe « derive » → « excel » et la ligne quitte le lot suspect.
function RafValidator({ row }: { row: { fp?: string; raf?: number } }) {
  const [editing, setEditing] = useState(false);
  const [raf, setRaf] = useState("");
  if (!editing) {
    return (
      <button type="button" onClick={() => { setRaf(String(row.raf ?? "")); setEditing(true); }}
        className="text-gold hover:underline text-[11px]" title="Valider le RAF et intégrer au backlog fiable">intégrer</button>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 justify-end flex-wrap">
      <input className="field w-24 !py-1 text-xs text-right" inputMode="decimal" autoFocus aria-label={`RAF validé de ${row.fp}`} placeholder="RAF" value={raf} onChange={(e) => setRaf(e.target.value)} />
      <Busy variant="ghost" label="Valider" okMsg="RAF validé — intégré au backlog fiable (recalcul lancé)" errMsg="Validation refusée"
        fn={async () => { const v = parseNum(raf); if (!(v >= 0)) throw new Error("saisir un RAF ≥ 0"); await patchOrder({ fp: row.fp!, raf: v }); setEditing(false); }} />
      <Busy variant="ghost" label="Solder (0)" okMsg="Commande soldée (recalcul lancé)" errMsg="Solde refusé"
        fn={async () => { await patchOrder({ fp: row.fp!, raf: 0 }); setEditing(false); }} />
      <button type="button" onClick={() => setEditing(false)} className="text-muted hover:text-ink text-[11px]" aria-label="Annuler la validation">✕</button>
    </span>
  );
}

// Listes ClickUp par pays (espace « Gestion de Projets ») + libellés d'options des champs
// complémentaires (ex-formulaire). Le back résout les libellés → UUID contre la liste EN DIRECT
// (tolérant à la casse/inclusion), donc ces libellés n'ont qu'un rôle d'IHM.
const CLICKUP_COUNTRY_LISTS = [
  { id: "901215917683", label: "Côte d'Ivoire", pays: "CI" },
  { id: "901215918697", label: "Burkina Faso", pays: "BF" },
  { id: "901215918699", label: "Guinée", pays: "GN" },
];
const OPT_NATURE = ["Livraison uniquement", "Service uniquement", "Livraison + Services", "Maintenance", "Infogérance", "Licence", "Hardware"];
const OPT_DOMAINE = ["Secured IT", "Digital Workspace", "Datacenter Facilities", "Business Data Integration", "Expert & Managed Services", "Modern Network Integration", "Agile Infrastructure  & Cloud"];
const OPT_SECTEUR = ["Autres", "Banques", "Services", "Ministères", "Telco & ISP", "Distribution", "Media et TIC", "Energie et Mines", "Transport et Logistique", "Assurance et Prévoyance", "Autres Services Financiers", "Institutions et Organismes", "Industries et agroalimentaire", "Société d'Etat et Parapublique"];
const OPT_CIRCUIT = ["FastTrack", "Normal", "Urgent"];
const OPT_CATREC = ["Mixte", "Licence", "Service", "Sans Objet"];
const OPT_PRIORITE = ["Urgente", "Haute", "Normale", "Basse"];
const isoToMs = (iso: string) => (iso ? new Date(iso).getTime() || undefined : undefined);

// Pousse la commande vers ClickUp via un MODAL qui remplace l'ancien formulaire ClickUp : liste cible
// (CI/BF/Guinée), données pré-remplies depuis la commande, + champs complémentaires. Ouvre la tâche.
// Synchro du MONTANT (CA Signé) entre la commande et son opportunité liée (même N° FP), dans un sens
// ou l'autre. Opp → Commande crée une SURCHARGE persistante (badge •). Commande → Opp écrit l'opp.
function AmountSyncBtn({ row }: { row: Order }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const run = async (direction: "toOpp" | "toOrder" | "clear") => {
    if (busy || !row.fp) return;
    setBusy(true);
    try {
      const r = await syncOrderAmount(row.fp, direction, row.cas);
      toast(direction === "toOpp" ? `Opportunité alignée sur ${money(r.cas || 0)} — recalcul lancé`
        : direction === "toOrder" ? `Commande surchargée à ${money(r.cas || 0)} depuis l'opp — recalcul lancé`
        : "Surcharge retirée — recalcul lancé", "ok");
      setOpen(false);
    } catch (e: any) {
      toast("Synchro refusée — " + String(e?.message || e?.code || "").replace(/^functions\//, ""), "err");
    } finally { setBusy(false); }
  };
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="btn-ghost !px-2 !py-1 text-xs" title="Synchroniser le montant avec l'opportunité liée">
        Montant ⇄{row.casSource === "override" && <span className="ml-0.5 text-gold" title="CAS surchargé depuis l'opportunité">•</span>}
      </button>
      <Modal open={open} onClose={() => setOpen(false)} size="sm"
        title={<>Montant (CA Signé) — <span className="text-gold">{row.fp}</span></>}
        actions={<button className="btn-ghost" onClick={() => setOpen(false)}>Fermer</button>}>
        <div className="flex flex-col gap-3 text-[13px]">
          <div className="rounded-lg border border-line bg-white/[0.03] px-3 py-2">
            CA Signé actuel : <b className="text-ink">{money(row.cas)}</b>
            {row.casSource === "override" && <div className="mt-1 text-[11px] text-gold">Surchargé depuis l'opportunité (prioritaire, survit aux ré-imports P&L).</div>}
          </div>
          <p className="text-[12px] text-muted">Aligne le montant avec l'<b>opportunité de même N° FP</b> (priorité à l'opp gagnée).</p>
          <div className="flex flex-col gap-2">
            <button type="button" disabled={busy} onClick={() => run("toOpp")} className="btn-ghost !py-1.5 text-xs text-left">Commande → Opportunité <span className="text-faint">· pose le CAS sur l'opp</span></button>
            <button type="button" disabled={busy} onClick={() => run("toOrder")} className="btn-ghost !py-1.5 text-xs text-left">Opportunité → Commande <span className="text-faint">· surcharge le CAS (persistant)</span></button>
            {row.casSource === "override" && <button type="button" disabled={busy} onClick={() => run("clear")} className="btn-ghost !py-1.5 text-xs text-left text-clay">Retirer la surcharge</button>}
          </div>
        </div>
      </Modal>
    </>
  );
}

function ClickupBtn({ row }: { row: Order }) {
  const [open, setOpen] = useState(false);
  const toast = useToast();
  const [listId, setListId] = useState(CLICKUP_COUNTRY_LISTS[0].id);
  const [nature, setNature] = useState("");
  const [domaine, setDomaine] = useState("");
  const [secteur, setSecteur] = useState("");
  const [circuit, setCircuit] = useState("");
  const [catRecurrent, setCatRecurrent] = useState("");
  const [priority, setPriority] = useState("");
  // Dates pré-remplies depuis la commande (déjà remontées de ClickUp le cas échéant).
  const [dateCommande, setDateCommande] = useState(row.dateCommande || "");
  const [dateContractuelle, setDateContractuelle] = useState(row.dateContractuelle || "");
  const [dateFinPrev, setDateFinPrev] = useState(row.dateFinPrev || "");
  const [lieu, setLieu] = useState("");
  const [commentaire, setCommentaire] = useState("");
  const [busy, setBusy] = useState(false);

  const pays = CLICKUP_COUNTRY_LISTS.find((l) => l.id === listId)?.pays;

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const r = await pushOrderToClickup(
        { fp: row.fp, client: row.client, affaire: row.affaire, bu: row.bu, am: row.am, cas: row.cas, facture: row.facture, pm: row.pm },
        { listId, extra: {
          pays, nature: nature || undefined, domaine: domaine || undefined, secteur: secteur || undefined,
          circuit: circuit || undefined, catRecurrent: catRecurrent || undefined, priority: priority || undefined,
          commentaire: commentaire.trim() || undefined, lieu: lieu.trim() || undefined,
          dateCommande: isoToMs(dateCommande), dateContractuelle: isoToMs(dateContractuelle), dateFinPrev: isoToMs(dateFinPrev),
        } },
      );
      toast(`Tâche ClickUp ${r.created ? "créée" : "mise à jour"}${r.assigned ? " et assignée" : " (PM non résolu)"} — ${r.fields} champs posés`, "ok");
      if (r.url) window.open(r.url, "_blank", "noopener");
      setOpen(false);
    } catch (e: any) {
      const detail = String(e?.message || e?.code || "").replace(/^functions\//, "");
      toast(detail ? `ClickUp refusé — ${detail}` : "ClickUp : échec", "err");
    } finally { setBusy(false); }
  };

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="btn-ghost !px-2 !py-1 text-xs" title="Créer / mettre à jour la tâche ClickUp">
        {row.clickupTaskId ? "ClickUp ↗" : "ClickUp"}
      </button>
      <Modal open={open} onClose={() => setOpen(false)} size="md"
        title={<>Tâche ClickUp — <span className="text-gold">{row.fp}</span></>}
        actions={<button className="btn-ghost" onClick={() => setOpen(false)}>Fermer</button>}>
        <div className="text-[12px] text-muted mb-3 rounded-lg bg-white/[0.03] border border-white/5 px-3 py-2">
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            <span><b className="text-ink">{row.client || "—"}</b> · {row.affaire || "sans désignation"}</span>
            <span>BU {row.bu || "—"}</span><span>AM {row.am || "—"}</span>
            <span>CA Signé {money(row.cas)}</span><span>CA Facturé {money(row.facture)}</span>
            <span>PM {row.pm || <i className="text-amber-400">non affecté</i>}</span>
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <Fld label="Liste (pays)">
            <select className="field !py-1.5" value={listId} onChange={(e) => setListId(e.target.value)}>
              {CLICKUP_COUNTRY_LISTS.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
            </select>
          </Fld>
          <Fld label="Nature"><Sel v={nature} set={setNature} opts={OPT_NATURE} ph="—" /></Fld>
          <Fld label="Domaine"><Sel v={domaine} set={setDomaine} opts={OPT_DOMAINE} ph="—" /></Fld>
          <Fld label="Secteur"><Sel v={secteur} set={setSecteur} opts={OPT_SECTEUR} ph="—" /></Fld>
          <Fld label="Circuit"><Sel v={circuit} set={setCircuit} opts={OPT_CIRCUIT} ph="—" /></Fld>
          <Fld label="Cat. récurrent"><Sel v={catRecurrent} set={setCatRecurrent} opts={OPT_CATREC} ph="—" /></Fld>
          <Fld label="Priorité"><Sel v={priority} set={setPriority} opts={OPT_PRIORITE} ph="—" /></Fld>
          <Fld label="Date de commande"><DateField value={dateCommande} onChange={setDateCommande} ariaLabel="Date de commande" /></Fld>
          <Fld label="Date contractuelle"><DateField value={dateContractuelle} onChange={setDateContractuelle} ariaLabel="Date contractuelle" /></Fld>
          <Fld label="Date prév. de fin"><DateField value={dateFinPrev} onChange={setDateFinPrev} ariaLabel="Date prévisionnelle de fin" /></Fld>
          <Fld label="Lieu"><input className="field !py-1.5" value={lieu} onChange={(e) => setLieu(e.target.value)} placeholder="site / ville (optionnel)" /></Fld>
        </div>
        <Fld label="Commentaire"><textarea className="field !py-1.5 mt-3" rows={2} value={commentaire} onChange={(e) => setCommentaire(e.target.value)} placeholder="note libre (optionnel)" /></Fld>
        <div className="flex gap-2 mt-4 items-center flex-wrap">
          <button type="button" className="btn-gold" disabled={busy} onClick={submit}>{busy ? "…" : "Créer / mettre à jour la tâche"}</button>
          {!row.pm && <span className="text-[12px] text-amber-400">PM non affecté — la tâche ne sera pas assignée.</span>}
        </div>
      </Modal>
    </>
  );
}

// Affectation INLINE d'un Project Manager (PMO) à une commande. Overlay persistant (survit au
// recompute / ré-import). Auto-complétion sur les PM déjà affectés (datalist « pm-options »).
function OrderPmFixer({ row }: { row: Order }) {
  const [editing, setEditing] = useState(false);
  const [pm, setPm] = useState("");
  if (!editing) {
    return (
      <span className="inline-flex items-center gap-2">
        {row.pm ? <Badge tone="steel">{row.pm}</Badge> : <span className="text-faint">—</span>}
        <button type="button" onClick={() => { setPm(row.pm || ""); setEditing(true); }} className="text-gold hover:underline text-[11px]" title="Affecter / changer le Project Manager">{row.pm ? "changer" : "affecter"}</button>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 flex-wrap">
      <input list="pm-options" className="field w-36 !py-1 text-xs" autoFocus aria-label={`Project Manager de ${row.fp}`} placeholder="Nom du PM" value={pm} onChange={(e) => setPm(e.target.value)} />
      <Busy variant="ghost" label="OK" okMsg={pm.trim() ? "PM affecté (recalcul lancé)" : "PM retiré (recalcul lancé)"} errMsg="Affectation refusée"
        fn={async () => { await setOrderPm(row.fp!, pm.trim()); setEditing(false); }} />
      <button type="button" onClick={() => setEditing(false)} className="text-muted hover:text-ink text-[11px]" aria-label="Annuler l'affectation">✕</button>
    </span>
  );
}

// Réconciliation : opportunités GAGNÉES (stage 6) portant un N° FP mais SANS ligne P&L → elles ne
// comptent pas en commande (CAS/backlog absents). « Inscrire au P&L » crée la commande depuis l'opp
// (CAS = montant de l'opp), en un clic. Chargé uniquement pour les profils habilités « import ».
function ReconcileWonOpps({ commandeFps }: { commandeFps: Set<string> }) {
  const oppScope = useRecordScope("opportunities");
  const { rows: opps, loading } = useCollectionData<Opportunity>(oppScope.ready ? "opportunities" : null, oppScope.constraints, oppScope.scoped ? "s" : "");
  const won = opps.filter((o) => o.stage === 6 && o.fp && !commandeFps.has(o.fp));
  if (loading || !won.length) return null;
  return (
    <Card title={`Opportunités gagnées sans commande P&L · ${won.length}`}>
      <Table columns={[
        // FP corrigeable en place : les commerciaux saisissent parfois une mauvaise version du N° FP,
        // ce qui empêche le rapprochement avec la commande P&L. La correction repatche l'opp (recalcul).
        colText("FP", (o: Opportunity) => <WonOppFpFixer o={o} />, (o: Opportunity) => o.fp || ""),
        colText("Client", (o: Opportunity) => o.client || "—", (o: Opportunity) => o.client || ""),
        colText("Désignation", (o: Opportunity) => o.designation || "—", (o: Opportunity) => o.designation || ""),
        colText("AM", (o: Opportunity) => o.am || "—", (o: Opportunity) => o.am || ""),
        colNum("Montant", (o: Opportunity) => money(o.amount || 0), (o: Opportunity) => o.amount || 0),
        colText("", (o: Opportunity) => (o.amount && o.amount > 0
          ? <Busy label="Inscrire au P&L" okMsg="Commande créée (recalcul lancé)" errMsg="Inscription refusée" fn={() => createOrder({ fp: o.fp!, cas: o.amount!, client: o.client, am: o.am, bu: o.bu })} />
          : <span className="text-[11px] text-clay">montant manquant</span>), () => 0),
        // Écarter une opp gagnée qu'on ne veut PAS inscrire : passe au statut « Annulé » (stage 9) →
        // quitte cette liste et le pipeline. Un ré-import de la source la rétablit si elle y est gagnée.
        colText("", (o: Opportunity) => (o.id
          ? <DangerBtn label="Annuler" tone="gold" okMsg="Opportunité annulée (recalcul lancé)" errMsg="Annulation refusée"
              confirm={`Annuler l'opportunité gagnée ${o.fp} (${o.client || "—"}) ? Elle passe au statut « Annulé » et quitte cette liste. Un ré-import de la source la rétablira si elle y figure encore comme gagnée.`}
              fn={() => patchOpportunity({ id: o.id!, stage: 9 })} />
          : null), () => 0),
      ]} rows={won} colsKey="won-opps" />
      <Tip>Ces affaires sont <b>gagnées</b> et portent un N° FP mais n'ont pas de ligne au P&L → elles ne comptent pas encore en commande. <b>« Inscrire au P&L »</b> crée la commande depuis l'opportunité (CAS = montant de l'opp). <b>« Annuler »</b> écarte l'opp (statut « Annulé ») si elle ne doit pas devenir une commande. Le <b>N° FP est corrigeable</b> (les versions saisies par les commerciaux sont parfois erronées) : la correction peut suffire à rapprocher l'affaire d'une ligne P&L existante. Au prochain import, une ligne P&L Excel du même FP reste prioritaire.</Tip>
    </Card>
  );
}

// Correction inline du N° FP d'une opp gagnée : les commerciaux saisissent parfois une mauvaise
// version du FP → l'affaire ne se rapproche pas de sa ligne P&L. Repatche l'opp (recalcul derrière) ;
// si le FP corrigé porte déjà une commande, l'affaire quitte cette liste automatiquement.
function WonOppFpFixer({ o }: { o: Opportunity }) {
  const [editing, setEditing] = useState(false);
  const [fp, setFp] = useState(o.fp || "");
  if (!o.id) return <>{o.fp || "—"}</>;
  if (!editing) {
    return (
      <span className="inline-flex items-center gap-2">
        <span>{o.fp || "—"}</span>
        <button type="button" onClick={() => { setFp(o.fp || ""); setEditing(true); }} className="text-gold hover:underline text-[11px]" title="Corriger le N° FP (version erronée)">corriger</button>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 flex-wrap">
      <input className="field w-36 !py-1 text-xs" aria-label={`Corriger le N° FP de ${o.client || o.fp || "l'opportunité"}`} placeholder="FP/2026/…" value={fp} onChange={(e) => setFp(e.target.value)} autoFocus />
      <Busy variant="ghost" label="OK" okMsg="N° FP corrigé (recalcul lancé)" errMsg="Correction refusée"
        fn={async () => { const v = fp.trim(); if (!v) throw new Error("saisir un N° FP"); await patchOpportunity({ id: o.id!, fp: v }); setEditing(false); }} />
      <button type="button" onClick={() => setEditing(false)} className="text-muted hover:text-ink text-[11px]" aria-label="Annuler la correction">✕</button>
    </span>
  );
}

// Liste Commandes — vue fusionnée (fiche affaire > opp gagnée > P&L), matérialisée
// dans summaries/commandes par le recompute.
const SRC_LABEL: Record<string, string> = { fiche: "Fiche", opp_won: "Opp. gagnée", pnl: "P&L", manuel: "Manuelle", legacy: "Legacy" };
// Provenance des données P&L (marge/coût) : saisie manuelle (import P&L Excel) ou fiche affaire.
const PNL_SRC: Record<string, { label: string; tone: "steel" | "gold" }> = {
  manuel: { label: "Manuel", tone: "steel" },
  fiche: { label: "Fiche affaire", tone: "gold" },
};
const pnlBadge = (s?: string | null) => {
  const m = s ? PNL_SRC[s] : null;
  return m ? <Badge tone={m.tone}>{m.label}</Badge> : <span className="text-faint">—</span>;
};
// Bandeau des commandes ANNULÉES (statut « Annulée » persistant, hors agrégats) : listées à part
// avec rétablissement. La liste principale ne les contient plus (le recompute les écarte).
function CancelledOrders() {
  const { data: cxl } = useDocData<CancellationsDoc>("config/cancelOrders");
  const items = cxl?.items || [];
  if (!items.length) return null;
  return (
    <Card title={`Commandes annulées · ${items.length}`}>
      <Table columns={[
        colText("FP", (e: { label?: string; id: string }) => e.label || e.id, (e: any) => e.label || e.id),
        colText("Client", (e: { client?: string }) => e.client || "—", (e: any) => e.client || ""),
        colText("Rétablir", (e: { id: string; label?: string }) => (
          <DangerBtn label="Rétablir" tone="steel" okMsg="Commande rétablie" errMsg="Rétablissement refusé"
            confirm={`Rétablir la commande ${e.label || e.id} ? Elle réintègre le carnet, le CAS et le backlog.`}
            fn={() => setCancellation("orders", e.id, false)} />
        ), () => 0),
      ]} rows={items} />
      <Tip>Ces commandes restent conservées (historique) mais sont <b>exclues de tous les agrégats</b> (carnet, CAS, backlog, rentabilité). L'annulation survit à un ré-import delta.</Tip>
    </Card>
  );
}

// Charge par Project Manager : agrégat serveur (summaries/pms) des commandes affectées — nombre,
// CAS, RAF (backlog). Cliquer une ligne applique le filtre PM transverse (isole les listes sur ce PM).
function PmWorkload() {
  const { data } = useDocData<PmsSummary>("summaries/pms");
  const { f, set } = useFilters();
  const rows = data?.rows || [];
  if (!rows.length) return null;
  const pick = (pm: string) => set({ pm: f.pm === pm ? "" : pm });
  return (
    <Card title={`Charge par Project Manager · ${rows.length}`}>
      <Table colsKey="pm-workload" columns={[
        colText("PM", (r: PmRow) => (
          <button type="button" onClick={() => pick(r.pm)} className={cx("underline decoration-dotted underline-offset-2 hover:text-gold", f.pm === r.pm ? "text-gold" : "text-ink")}
            title={f.pm === r.pm ? "Retirer le filtre PM" : "Filtrer les listes sur ce PM"}>{r.pm}</button>
        ), (r: PmRow) => r.pm),
        colNum("Commandes", (r: PmRow) => r.count.toLocaleString("fr-FR"), (r: PmRow) => r.count),
        colNum("CAS", (r: PmRow) => money(r.cas), (r: PmRow) => r.cas),
        colNum("RAF (backlog)", (r: PmRow) => money(r.raf), (r: PmRow) => r.raf),
      ]} rows={rows} />
      <Tip>Affectez un PM à une commande dans la liste ci-dessous (colonne <b>PM</b>). <b>Cliquez un PM</b> ici pour filtrer toutes les listes sur son périmètre.</Tip>
    </Card>
  );
}

export const OrderList: FC<Props> = () => {
  const { rows: all, loading } = useCommandesRows();
  const { match } = useFilters();
  const rows = all.filter((r) => match(r, ["bu", "am", "client", "pm"]));
  const canImport = useCanImport();
  const canMargin = useCanSeeMargin();
  const canPipeline = useCan("pipeline") !== "none"; // la réconciliation lit les opportunités (droit pipeline)
  const { intent } = useNav();
  const [showNew, setShowNew] = useState(false);
  const commandeFps = useMemo(() => new Set(all.map((r) => r.fp).filter(Boolean) as string[]), [all]);
  // Suggestions d'affectation PM (datalist) = référentiel Admin ∪ PM déjà affectés.
  const pmRef = useProjectManagers();
  const pmOptions = useMemo(() => [...new Set([...pmRef, ...(all.map((r) => r.pm).filter(Boolean) as string[])])].sort((a, b) => a.localeCompare(b)), [all, pmRef]);
  // Panneau déplié : bloc d'ACTIONS groupées (corriger / supprimer / annuler), réservé au droit
  // « import ». Rendu au-dessus de la grille des colonnes secondaires (BU, dates, ClickUp…).
  const orderActions = canImport ? (r: Order) => (
    <div className="rounded-lg bg-ink/[.03] border border-line/60 px-3 py-2.5 flex flex-col gap-2">
      <div className="text-xs font-semibold text-muted">Mettre à jour / supprimer</div>
      <div className="flex flex-wrap items-center gap-3">
        {(r.source === "pnl" || r.source === "manuel") && r.fp
          ? <OrderEditor row={r} />
          : <span className="text-[11px] text-faint">Correction à la source (fiche / opportunité)</span>}
        {r.fp && r.source !== "fiche" && <DangerBtn label="Supprimer la commande" confirm={`Supprimer la commande ${r.fp} (ligne P&L) ? Un futur import delta ne la recréera que si la source la contient encore.`} fn={() => deleteRecord("orders", fpDocId(r.fp!))} />}
        {r.fp && <DangerBtn label="Annuler" tone="gold" okMsg="Commande annulée" errMsg="Annulation refusée"
          confirm={`Annuler la commande ${r.fp} ? Elle sort du carnet, du CAS et du backlog (conservée pour l'historique, rétablissable). L'annulation survit à un ré-import.`}
          fn={() => setCancellation("orders", fpDocId(r.fp!), true, { label: r.fp!, client: r.client })} />}
      </div>
    </div>
  ) : undefined;
  if (loading && !all.length) return <CardSkeleton />;
  if (!all.length) return (
    <div className="flex flex-col gap-2">
      <EmptyState label="Aucune commande. Importez des opportunités (gagnées) ou des fiches affaire, ou créez une commande." action={canImport ? <ImportButton label="Importer un fichier" /> : undefined} />
      {canImport && <Card title="Créer une commande"><OrderForm /></Card>}
      {canImport && canPipeline && <ReconcileWonOpps commandeFps={commandeFps} />}
    </div>
  );
  return (
    <div className="flex flex-col gap-2">
    <FilterNote dims="BU / AM / client / PM" />
    {canImport && canPipeline && <ReconcileWonOpps commandeFps={commandeFps} />}
    {canImport && <CancelledOrders />}
    <PmWorkload />
    <Card title={`Commandes · ${rows.length.toLocaleString("fr-FR")}`} actions={canImport ? <button className="btn-ghost" onClick={() => setShowNew((v) => !v)}>{showNew ? "Fermer" : "+ Nouvelle commande"}</button> : undefined}>
      {showNew && <OrderForm onDone={() => setShowNew(false)} />}
      {/* Suggestions d'auto-complétion partagées par les champs d'affectation PM de chaque ligne. */}
      <datalist id="pm-options">{pmOptions.map((p) => <option key={p} value={p} />)}</datalist>
      <ListView
        rows={rows}
        colsKey="commandes"
        initialSearch={intent?.search}
        expand={orderActions}
        searchKeys={[(r) => r.fp, (r) => r.client, (r) => r.am, (r) => r.pm || "", (r) => r.affaire || ""]}
        columns={[
          colText("FP", (r) => <FpLink fp={r.fp} />, (r) => r.fp),
          colText("Client", (r) => r.client, (r) => r.client),
          colText("Affaire", (r) => r.affaire || "—", (r) => r.affaire || ""),
          det(colText("BU", (r) => buBadge(r.bu), (r) => r.bu)),
          det(colText("AM", (r) => r.am, (r) => r.am)),
          // Affectation à un Project Manager (PMO) — éditable en place pour le droit « import ».
          det(colText("PM", (r: Order) => (canImport && r.fp ? <OrderPmFixer row={r} /> : (r.pm ? <Badge tone="steel">{r.pm}</Badge> : <span className="text-faint">—</span>)), (r: Order) => r.pm || "")),
          // CAS corrigeable EN PLACE (montant de la commande) pour les commandes P&L/manuelles, sans
          // ouvrir la modale : les montants saisis à la source sont parfois erronés. Les commandes de
          // source « fiche »/« opp gagnée » se corrigent à la source (fiche / opportunité).
          colNum("CAS", (r) => (canImport && (r.source === "pnl" || r.source === "manuel") && r.fp
            ? <OrderCasFixer row={r} /> : money(r.cas)), (r) => r.cas),
          colNum("RAF", (r) => money(r.raf), (r) => r.raf),
          // Marges masquées pour les rôles sans accès « Rentabilité » (confidentialité).
          ...(canMargin ? [
            det(colNum("MB", (r: Order) => money(r.mb), (r: Order) => r.mb)),
            det(colNum("%MB", (r: Order) => pct(r.cas ? (r.mb || 0) / r.cas : 0), (r: Order) => (r.cas ? (r.mb || 0) / r.cas : 0))),
            det(colText("P&L", (r: Order) => pnlBadge(r.pnlSource), (r: Order) => r.pnlSource || "")),
          ] : []),
          det(colNum("Année", (r) => r.yearPo || "—", (r) => r.yearPo || 0)),
          det(colText("Source", (r) => SRC_LABEL[r.source || ""] || r.source || "—", (r) => r.source || "")),
          // Synchro inverse ClickUp : statut en ligne principale, dates dans le détail.
          colText("Statut CU", (r) => (r.clickupStatus ? <Badge tone="steel">{r.clickupStatus}</Badge> : <span className="text-faint">—</span>), (r) => r.clickupStatus || ""),
          det(colText("D. commande", (r) => r.dateCommande || "—", (r) => r.dateCommande || "")),
          det(colText("D. contract.", (r) => r.dateContractuelle || "—", (r) => r.dateContractuelle || "")),
          det(colText("D. prév. fin", (r) => r.dateFinPrev || "—", (r) => r.dateFinPrev || "")),
          // Enrichissements ClickUp → app (Lot 4) : avancement (checklists), priorité, blocage, temps passé.
          det(colNum("Avancement", (r) => (r.clickupProgress != null ? `${r.clickupProgress}%` : "—"), (r) => (r.clickupProgress ?? -1))),
          det(colText("Priorité CU", (r) => (r.clickupPriority ? <Badge tone={/urgent/i.test(r.clickupPriority) ? "clay" : "steel"}>{r.clickupPriority}</Badge> : <span className="text-faint">—</span>), (r) => r.clickupPriority || "")),
          det(colText("Blocage", (r) => (r.clickupBlocked ? <Badge tone="clay">bloqué</Badge> : <span className="text-faint">—</span>), (r) => (r.clickupBlocked ? 1 : 0))),
          det(colNum("Temps CU", (r) => (r.clickupTimeSpentH != null ? `${r.clickupTimeSpentH} h` : "—"), (r) => (r.clickupTimeSpentH ?? 0))),
          det(colText("Note ClickUp", (r) => (r.clickupLastComment?.text
            ? <span className="text-[12px]" title={r.clickupLastComment.text}>💬 {r.clickupLastComment.by ? <b>{r.clickupLastComment.by} : </b> : null}{r.clickupLastComment.text.slice(0, 80)}{r.clickupLastComment.text.length > 80 ? "…" : ""}</span>
            : <span className="text-faint">—</span>), (r) => (r.clickupLastComment?.text ? 1 : 0))),
          ...(canImport ? [colText("Montant", (r: Order) => (r.fp ? <AmountSyncBtn row={r} /> : <span className="text-[11px] text-faint">—</span>), (r) => (r.casSource === "override" ? 1 : 0))] : []),
          ...(canImport ? [colText("ClickUp", (r: Order) => (r.fp ? (
            <span className="inline-flex items-center gap-2">
              <ClickupBtn row={r} />
              {r.clickupTaskId && <a href={`https://app.clickup.com/t/${r.clickupTaskId}`} target="_blank" rel="noopener" className="text-[11px] text-emerald hover:underline" title="Ouvrir la tâche ClickUp liée">lié ↗</a>}
            </span>
          ) : <span className="text-[11px] text-faint">—</span>), () => 0)] : []),
        ]}
      />
    </Card>
    </div>
  );
};
