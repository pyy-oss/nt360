// 2 — Pipeline (analytique : funnel pondéré) · Opportunités (liste + top + saisie).
import { useState, type FC } from "react";
import { useDocData, useCollectionData } from "../lib/hooks";
import { useCan, useCanImport } from "../lib/rbac";
import { T, fmt, pct } from "../design/tokens";
import { Card, Kpi, Table, Tip, EmptyState, CardSkeleton, Busy, ListView, colText, colNum, money } from "../design/components";
import { AreaTrend, GroupedBars } from "../design/charts";
import { upsertOpportunity, deleteOpportunity } from "../lib/writes";
import { Props, grid4, cols2, objToArr, monthsAsc, STAGE_SHORT, HBars, buBadge, ImportButton, FilterNote } from "./_shared";
import { useFilters } from "../lib/filters";
import type { PipelineSummary, Opportunity, AtterrissageSummary, PeriodsConfig, AmsSummary, OverviewSummary } from "../types";

// Module PIPELINE : synthèse analytique seulement (la saisie et le détail sont dans « Opportunités »).
export const Pipeline: FC<Props> = ({ period }) => {
  // Pipeline de la période : opportunités dont la D Prev tombe dans l'année sélectionnée
  // (écarte les opps obsolètes / non mises à jour). « Tout » = tout le pipeline.
  const { data } = useDocData<PipelineSummary>(`summaries/pipeline_${period}`);
  // Taux de conversion vente (règle de gestion) : calculé une seule fois côté Vue d'ensemble.
  const { data: ov } = useDocData<OverviewSummary>(`summaries/overview_${period}`);
  const { data: cfg } = useDocData<PeriodsConfig>("config/periods");
  const { data: att } = useDocData<AtterrissageSummary>(cfg?.currentFy ? `summaries/atterrissage_${cfg.currentFy}` : null);
  // Pipeline de l'EXERCICE (indépendant du sélecteur de période) pour une couverture cohérente
  // avec l'objectif/réalisé qui sont, eux, ancrés sur l'exercice courant.
  const { data: pfy } = useDocData<PipelineSummary>(cfg?.currentFy ? `summaries/pipeline_${cfg.currentFy}` : null);
  if (!data) return <EmptyState />;
  const funnel = [1, 2, 3, 4, 5].map((s) => ({ name: STAGE_SHORT[s], Brut: data.byStage?.[s]?.amount || 0, "Pondéré": data.byStage?.[s]?.weighted || 0 }));
  // Couverture du reste-à-faire : combien de fois le pipeline pondéré (exercice) couvre l'écart à
  // l'objectif CAS. Numérateur et dénominateur au MÊME périmètre (currentFy). null si pas d'objectif.
  const hasObj = (att?.objectif || 0) > 0;
  const gap = Math.max((att?.objectif || 0) - (att?.realiseCas || 0), 0);
  const coverage = hasObj && gap > 0 ? (pfy?.tot?.weighted || 0) / gap : null;
  const coverageLabel = coverage != null ? `${coverage.toFixed(2)}×` : hasObj ? "atteint" : "—";
  const cb = data.closing?.buckets;
  const closingRows = cb ? [
    { name: "En retard", v: cb.retard?.pond || 0, sub: `${cb.retard?.count || 0} opp.` },
    { name: "Ce mois", v: cb.mois?.pond || 0, sub: `${cb.mois?.count || 0} opp.` },
    { name: "Ce trimestre", v: cb.trim?.pond || 0, sub: `${cb.trim?.count || 0} opp.` },
    { name: "Plus tard", v: cb.plus?.pond || 0, sub: `${cb.plus?.count || 0} opp.` },
    { name: "Sans date", v: cb.sans?.pond || 0, sub: `${cb.sans?.count || 0} opp.` },
  ] : [];
  return (
    <div className="flex flex-col gap-4">
      <div className={grid4}>
        <Kpi label="Actif (brut)" value={fmt(data.tot?.brut)} sub={`${data.tot?.count ?? 0} opp.`} />
        <Kpi label="Pondéré projeté" value={fmt(data.tot?.weighted)} tone="gold" sub={`100 %·≥90 · 20 %·70-90 · 10 %·50-70 — ${data.tot?.countConf ?? 0} opp.`} />
        <Kpi label="Suspendu" value={fmt(data.susp?.brut)} sub={`${data.susp?.count ?? 0} opp.`} tone="clay" />
        <Kpi label="Conversion vente" value={pct(ov?.ratios?.tauxConversionVente)} sub={`gagné ${data.wonCount}/${(data.wonCount || 0) + (data.lostCount || 0)}`} />
      </div>
      <Card title="Funnel pondéré par étape">
        <GroupedBars data={funnel} series={[{ key: "Brut", color: T.steel, name: "Brut" }, { key: "Pondéré", color: T.gold, name: "Pondéré" }]} h={240} size={26} interval={0} />
      </Card>
      <div className={cols2}>
        <Card title="Pondéré par AM"><HBars rows={objToArr(data.byAM).slice(0, 10)} colorFn={() => T.gold} /></Card>
        <Card title="Écoulement mensuel (pondéré)">{Object.keys(data.byMonth || {}).length ? <AreaTrend data={monthsAsc(data.byMonth)} color={T.gold} name="Pondéré" h={200} /> : <EmptyState label="Dates de closing indisponibles." />}</Card>
      </div>
      <Card title="Conversion par commercial (AM)">
        {(data.byAmConv || []).length ? (
          <Table columns={[
            colText("AM", (r) => r.am, (r) => r.am),
            colNum("Actif", (r) => r.activeCount, (r) => r.activeCount),
            colNum("Pondéré", (r) => money(r.weighted), (r) => r.weighted),
            colNum("Gagné", (r) => r.won, (r) => r.won),
            colNum("Perdu", (r) => r.lost, (r) => r.lost),
            colNum("Taux transfo.", (r) => (r.won + r.lost > 0 ? pct(r.conv) : "—"), (r) => r.conv),
          ]} rows={data.byAmConv || []} />
        ) : <EmptyState label="Pas de commercial renseigné." />}
      </Card>

      {data.closing && (
        <>
          <div className={grid4}>
            <Kpi label="Couverture reste-à-faire" value={coverageLabel} tone={coverage == null ? (hasObj ? "emerald" : "steel") : coverage >= 1 ? "emerald" : "clay"} sub="pondéré exercice / (objectif − réalisé CAS)" />
            <Kpi label="En retard de closing" value={fmt(data.closing.staleBrut)} tone="clay" sub={`${data.closing.staleCount ?? 0} opp. · D Prev dépassée`} />
            <Kpi label="À clôturer ce mois" value={fmt(cb?.mois?.pond)} tone="gold" sub={`${cb?.mois?.count ?? 0} opp. (pondéré)`} />
            <Kpi label="À clôturer ce trimestre" value={fmt(cb?.trim?.pond)} sub={`${cb?.trim?.count ?? 0} opp. (pondéré)`} />
          </div>
          <div className={cols2}>
            <Card title="Échéancier du closing (pondéré, par horizon)">
              <HBars rows={closingRows} colorFn={(r) => (r.name === "En retard" ? T.clay : r.name === "Sans date" ? T.faint : T.gold)} />
            </Card>
            <Card title={`Opportunités en retard de closing · ${data.closing.staleCount ?? 0}`}>
              {(data.closing.staleTop || []).length ? (
                <Table columns={[
                  colText("Client", (o) => o.client, (o) => o.client),
                  colText("AM", (o) => o.am, (o) => o.am),
                  colText("Étape", (o) => o.stageLabel || "—", (o) => o.stageLabel || ""),
                  colNum("Pondéré", (o) => money(o.weighted), (o) => o.weighted),
                  colText("D Prev", (o) => o.closingDate || "—", (o) => o.closingDate || ""),
                ]} rows={data.closing.staleTop || []} />
              ) : <EmptyState label="Aucune opportunité en retard de closing." />}
            </Card>
          </div>
          <Tip>Analyse fondée uniquement sur la <b>D Prev</b> (date de clôture prévue) — aucune date de création ou d'étape n'existe en source, donc pas de vélocité/âge inventés. Les opportunités <b>en retard de closing</b> (D Prev déjà dépassée mais toujours actives) sont à <b>requalifier</b> (re-dater ou passer en perdu). La <b>couverture</b> indique combien de fois le pipeline pondéré couvre l'écart à l'objectif : &lt; 1× = objectif non couvert par le seul pipeline certain.</Tip>
        </>
      )}
    </div>
  );
};

// Module AM 360° : pilotage par commercial (CAS/CAF/backlog/pipeline/conversion/R-O), sans marge.
export const Am360: FC<Props> = () => {
  const { data } = useDocData<AmsSummary>("summaries/ams");
  const rows = data?.rows || [];
  const [am, setAm] = useState<string>("");
  if (!rows.length) return <EmptyState label="Aucun commercial renseigné (importer Pipeline / Commandes)." />;
  const sel = rows.find((r) => r.am === am) || rows[0];
  return (
    <div className="flex flex-col gap-4">
      <Card title="Commercial (Account Manager)">
        <select className="field w-full md:w-80" aria-label="Choisir un commercial" value={sel.am} onChange={(e) => setAm(e.target.value)}>
          {rows.map((r) => <option key={r.am} value={r.am}>{r.am}</option>)}
        </select>
      </Card>
      <div className={grid4}>
        <Kpi label="Prise de commande (CAS)" value={fmt(sel.cas)} tone="steel" sub={`${sel.orderCount} commande(s)`} />
        <Kpi label="Facturé (CAF)" value={fmt(sel.facture)} tone="emerald" />
        <Kpi label="Backlog (RAF)" value={fmt(sel.backlog)} tone="clay" />
        <Kpi label={`R/O CAS ${data?.fy ?? ""}`} value={sel.roCas != null ? pct(sel.roCas) : "—"} tone="gold" sub={sel.targetCas > 0 ? `objectif ${fmt(sel.targetCas)}` : "pas d'objectif AM"} />
      </div>
      <div className={grid4}>
        <Kpi label="Pipeline pondéré" value={fmt(sel.pipelinePondere)} tone="gold" sub={`${sel.activeCount} opp. active(s)`} />
        <Kpi label="Gagné / Perdu" value={`${sel.won} / ${sel.lost}`} sub="opportunités" />
        <Kpi label="Taux de transfo." value={sel.won + sel.lost > 0 ? pct(sel.conv) : "—"} />
        <Kpi label="CAS exercice" value={fmt(sel.casFy)} sub={`année ${data?.fy ?? ""}`} />
      </div>
      <Card title="Classement des commerciaux">
        <Table columns={[
          colText("AM", (r) => (r.am === sel.am ? <b className="text-gold">{r.am}</b> : r.am), (r) => r.am),
          colNum("CAS", (r) => money(r.cas), (r) => r.cas),
          colNum("Facturé", (r) => money(r.facture), (r) => r.facture),
          colNum("Backlog", (r) => money(r.backlog), (r) => r.backlog),
          colNum("Pipeline pond.", (r) => money(r.pipelinePondere), (r) => r.pipelinePondere),
          colNum("Transfo.", (r) => (r.won + r.lost > 0 ? pct(r.conv) : "—"), (r) => r.conv),
          colNum("R/O CAS", (r) => (r.roCas != null ? pct(r.roCas) : "—"), (r) => r.roCas ?? -1),
        ]} rows={rows} />
      </Card>
      <Tip>Vue par commercial <b>sans marge</b> (la rentabilité par AM reste dans « Rentabilité »). Le <b>facturé</b> est rattaché au commercial via la clé N° FP de ses commandes. Le <b>R/O</b> compare le CAS de l'exercice à l'objectif CAS « commercial » de l'année.</Tip>
    </div>
  );
};

// Module OPPORTUNITÉS : top pondéré + liste détaillée + saisie.
const DEFAULT_PROBA: Record<number, number> = { 1: 0.1, 2: 0.25, 3: 0.4, 4: 0.6, 5: 0.8, 8: 0.05 };
const EMPTY_OPP = { id: "", client: "", am: "", bu: "ICT", fp: "", amount: "", stage: "1", probability: "", closingDate: "" };

export const OppList: FC<Props> = () => {
  const { rows: allRows, loading } = useCollectionData<Opportunity>("opportunities");
  const { match } = useFilters();
  const rows = allRows.filter((r) => match(r, ["bu", "am", "client"]));
  const canWrite = useCan("pipeline") === "write";
  const canImport = useCanImport();
  const [f, setF] = useState({ ...EMPTY_OPP });
  const editOpp = (o: Opportunity) => setF({
    id: o.oppId || o.id || "", client: o.client || "", am: o.am || "", bu: o.bu || "AUTRE", fp: o.fp || "",
    amount: String(o.amount ?? ""), stage: String(o.stage ?? "1"), probability: String(o.probability ?? ""), closingDate: o.closingDate || "",
  });
  // Changer d'étape pré-remplit la proba par défaut de l'étape si elle est vide (évite un pondéré à 0).
  const setStage = (s: string) => setF((prev) => ({ ...prev, stage: s, probability: prev.probability || String(DEFAULT_PROBA[Number(s)] ?? "") }));
  if (loading && !allRows.length) return <CardSkeleton />;
  const top = [...rows].sort((a, b) => (b.weighted || 0) - (a.weighted || 0)).slice(0, 10);
  // Certitudes = opportunités ACTIVES (étapes 1..5) quasi-certaines (IdC ≥ 90 %), pas encore signées.
  const certitudes = rows
    .filter((o) => (o.stage || 0) >= 1 && (o.stage || 0) <= 5 && (o.probability || 0) >= 0.9)
    .sort((a, b) => (b.weighted || 0) - (a.weighted || 0));
  const certTotal = certitudes.reduce((s, o) => s + (o.weighted || 0), 0);
  return (
    <div className="flex flex-col gap-4">
      <FilterNote dims="BU / AM / client" />
      {canWrite && (
        <Card title={f.id ? "Modifier l'opportunité (saisie)" : "Ajouter une opportunité (saisie)"} actions={f.id ? <button onClick={() => setF({ ...EMPTY_OPP })} className="btn-ghost !px-2.5 !py-1 text-xs">Nouvelle</button> : undefined}>
          <div className="flex flex-wrap gap-2 items-center">
            <input className="field" aria-label="Client" placeholder="Client" value={f.client} onChange={(e) => setF({ ...f, client: e.target.value })} />
            <input className="field" aria-label="Account Manager" placeholder="AM" value={f.am} onChange={(e) => setF({ ...f, am: e.target.value })} />
            <input className="field w-36" aria-label="N° FP" placeholder="N° FP (FP/2026/…)" value={f.fp} onChange={(e) => setF({ ...f, fp: e.target.value })} />
            <select aria-label="Business Unit" className="field" value={f.bu} onChange={(e) => setF({ ...f, bu: e.target.value })}>{["ICT", "CLOUD", "FORMATION", "AUTRE"].map((b) => <option key={b}>{b}</option>)}</select>
            <input className="field w-28" aria-label="Montant" placeholder="Montant" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} />
            <select aria-label="Étape du pipeline" className="field" value={f.stage} onChange={(e) => setStage(e.target.value)}>{[1, 2, 3, 4, 5, 6, 7, 8, 9].map((s) => <option key={s} value={s}>{s} · {STAGE_SHORT[s]}</option>)}</select>
            <input className="field w-28" aria-label="Probabilité (0 à 1)" placeholder="Proba 0..1" value={f.probability} onChange={(e) => setF({ ...f, probability: e.target.value })} />
            <input className="field" aria-label="Date de clôture prévue" type="date" value={f.closingDate} onChange={(e) => setF({ ...f, closingDate: e.target.value })} />
            <Busy label={f.id ? "Enregistrer" : "Ajouter"} okMsg="Opportunité enregistrée"
              fn={async () => { await upsertOpportunity({ id: f.id || undefined, client: f.client, am: f.am, bu: f.bu, fp: f.fp || undefined, amount: Number(f.amount) || 0, stage: Number(f.stage), probability: Number(f.probability) || 0, closingDate: f.closingDate || undefined }); setF({ ...EMPTY_OPP }); }} />
          </div>
          {Number(f.stage) === 6 && !f.fp.trim() && <div className="text-[11px] text-clay mt-2">Une opportunité gagnée sans N° FP ne pourra pas devenir commande (CAS/backlog).</div>}
        </Card>
      )}
      <Card title={`Certitudes (IdC ≥ 90 %) · ${certitudes.length} opp. · ${fmt(certTotal)} pondéré`}>
        {certitudes.length ? (
          <Table columns={[
            colText("Client", (o) => o.client, (o) => o.client), colText("AM", (o) => o.am, (o) => o.am),
            colText("BU", (o) => buBadge(o.bu), (o) => o.bu), colNum("Montant", (o) => money(o.amount), (o) => o.amount),
            colNum("Proba", (o) => pct(o.probability), (o) => o.probability),
            colNum("Pondéré", (o) => money(o.weighted), (o) => o.weighted),
            colText("Closing (D Prev)", (o) => o.closingDate || "—", (o) => o.closingDate || ""),
          ]} rows={certitudes} />
        ) : <EmptyState label="Aucune opportunité IdC ≥ 90 %." />}
      </Card>
      <Card title="Top opportunités (pondéré)">
        <Table columns={[
          colText("Client", (o) => o.client), colText("AM", (o) => o.am),
          colNum("Montant", (o) => money(o.amount)), colNum("Pondéré", (o) => money(o.weighted)),
        ]} rows={top} empty="Aucune opportunité." />
      </Card>
      <Card title={`Toutes les opportunités · ${rows.length.toLocaleString("fr-FR")}`} actions={canImport ? <ImportButton label="Importer (LIVE / Sales)" /> : undefined}>
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
            ...(canWrite ? [colText("", (r: Opportunity) => (r.source === "saisie" ? (
              <span className="inline-flex gap-2">
                <button onClick={() => { editOpp(r); window.scrollTo({ top: 0, behavior: "smooth" }); }} className="text-gold hover:underline text-xs">Éditer</button>
                <Busy variant="ghost" label="Suppr." okMsg="Supprimée" fn={() => deleteOpportunity(r.oppId || r.id || "")} />
              </span>
            ) : <span className="text-[11px] text-faint">import</span>))] : []),
          ]}
        />
      </Card>
    </div>
  );
};
