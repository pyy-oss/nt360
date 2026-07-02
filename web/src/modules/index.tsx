// Les 13 modules (parité prototype, BUILD_KIT §2) — refonte UI Forest & Gold :
// primitives + graphes Recharts, lecture temps réel summaries/*, écritures gardées.
import { useState, type FC } from "react";
import { where } from "firebase/firestore";
import {
  AlertTriangle, LayoutDashboard, GitBranch, Target, Receipt, Layers, TrendingUp,
  Percent, FileText, Truck, ClipboardList, Users, Boxes, Search, Shield,
  ListChecks, ShoppingCart, FileSpreadsheet, type LucideIcon,
} from "lucide-react";
import { useDocData, useCollectionData } from "../lib/hooks";
import { useCan } from "../lib/rbac";
import { T, BU_COL, BC_COL, fmt, pct } from "../design/tokens";
import { Card, Kpi, Table, Badge, Tip, EmptyState, KpiSkeletons, CardSkeleton, Busy, Chain, Stage, ListView, colText, colNum, money, cx } from "../design/components";
import { AreaTrend, DonutBU, Bars, GroupedBars, Gauge } from "../design/charts";
import {
  addOpportunity, setBcStatus, upsertCreditLine, upsertObjective,
  updateMatrix, callSetUserRole, callRecompute, callExportReport,
} from "../lib/writes";

type Props = { period: string };
const grid4 = "grid gap-3 grid-cols-2 lg:grid-cols-4";
const cols2 = "grid gap-3 md:grid-cols-2";

const objToArr = (o: Record<string, number> = {}) =>
  Object.entries(o).map(([name, v]) => ({ name, v: Number(v) || 0 })).sort((a, b) => b.v - a.v);
const monthsAsc = (o: Record<string, number> = {}) =>
  Object.entries(o).map(([name, v]) => ({ name, v: Number(v) || 0 })).sort((a, b) => a.name.localeCompare(b.name));
const topArr = (a: { key: string; value: number }[] = []) => a.map((x) => ({ name: x.key, v: x.value }));
const STAGE_SHORT: Record<number, string> = { 1: "Qualif", 2: "Montage", 3: "Transmise", 4: "Négo", 5: "Contrat", 6: "Gagné", 7: "Perdu", 8: "Suspendu", 9: "Annulé" };

// Barres horizontales maison (listes AM / top clients / fournisseurs).
function HBars({ rows, colorFn, max }: { rows: { name: string; v: number; sub?: string }[]; colorFn?: (r: any) => string; max?: number }) {
  if (!rows.length) return <EmptyState />;
  const mx = max ?? Math.max(1, ...rows.map((r) => r.v));
  return (
    <div className="flex flex-col gap-2.5 mt-1">
      {rows.map((r, i) => (
        <div key={i}>
          <div className="flex justify-between text-[12.5px] mb-1">
            <span className="truncate max-w-[220px] text-ink">{r.name}</span>
            <span className="text-muted tabnum">{fmt(r.v)}{r.sub != null && <span className="text-faint"> · {r.sub}</span>}</span>
          </div>
          <div className="h-[7px] rounded bg-panel2">
            <div className="h-full rounded" style={{ width: `${Math.max((r.v / mx) * 100, 1)}%`, background: colorFn ? colorFn(r) : T.emerald }} />
          </div>
        </div>
      ))}
    </div>
  );
}

// Centre d'alertes.
function AlertsBanner() {
  const { data } = useDocData<any>("summaries/alerts");
  const items = data?.items || [];
  if (!items.length) return null;
  const tone: any = { high: "clay", medium: "gold", low: "steel" };
  return (
    <Card title={`Centre d'alertes · ${items.length}`}>
      <div className="flex flex-col gap-2">
        {items.map((a: any, i: number) => (
          <div key={i} className="flex items-center gap-2 text-[13px]">
            <AlertTriangle size={14} className={cx(a.severity === "high" ? "text-clay" : a.severity === "medium" ? "text-gold" : "text-steel")} />
            <span>{a.message}</span>
            <Badge tone={tone[a.severity] || "neutral"}>{a.count}</Badge>
          </div>
        ))}
      </div>
    </Card>
  );
}

// 1 — Vue d'ensemble
const Overview: FC<Props> = ({ period }) => {
  const { data, loading } = useDocData<any>(`summaries/overview_${period}`);
  const { data: cfg } = useDocData<any>("config/periods");
  const { data: att } = useDocData<any>(cfg?.currentFy ? `summaries/atterrissage_${cfg.currentFy}` : null);
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

// 2 — Pipeline
const Pipeline: FC<Props> = () => {
  const { data } = useDocData<any>("summaries/pipeline");
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
            <Kpi label="Conversion" value={pct(data.conv)} sub={`${data.wonCount}/${data.wonCount + data.lostCount}`} />
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
            <input className="field" placeholder="Client" value={f.client} onChange={(e) => setF({ ...f, client: e.target.value })} />
            <input className="field" placeholder="AM" value={f.am} onChange={(e) => setF({ ...f, am: e.target.value })} />
            <select className="field" value={f.bu} onChange={(e) => setF({ ...f, bu: e.target.value })}>{["ICT", "CLOUD", "FORMATION", "AUTRE"].map((b) => <option key={b}>{b}</option>)}</select>
            <input className="field w-28" placeholder="Montant" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} />
            <select className="field" value={f.stage} onChange={(e) => setF({ ...f, stage: e.target.value })}>{[1, 2, 3, 4, 5, 6, 7, 8, 9].map((s) => <option key={s} value={s}>{s} · {STAGE_SHORT[s]}</option>)}</select>
            <input className="field w-28" placeholder="Proba 0..1" value={f.probability} onChange={(e) => setF({ ...f, probability: e.target.value })} />
            <input className="field" type="date" value={f.closingDate} onChange={(e) => setF({ ...f, closingDate: e.target.value })} />
            <Busy label="Ajouter" fn={() => addOpportunity({ client: f.client, am: f.am, bu: f.bu, amount: Number(f.amount) || 0, stage: Number(f.stage), probability: Number(f.probability) || 0, closingDate: f.closingDate || undefined })} />
          </div>
        </Card>
      )}
    </div>
  );
};

// 3 — Objectifs / R-O
const Objectifs: FC<Props> = ({ period }) => {
  const { rows } = useCollectionData<any>("objectives");
  const { data: ov } = useDocData<any>(`summaries/overview_${period}`);
  const canWrite = useCan("objectifs") === "write";
  const realiseCas = ov?.commandes || 0;
  const [o, setO] = useState({ fiscalYear: "", scope: "global", scopeValue: "all", targetCas: "", targetInvoiced: "", targetMargin: "" });
  return (
    <div className="flex flex-col gap-4">
      <Card title="Objectifs annuels & Réalisé / Objectif">
        <Table
          columns={[
            colText("Périmètre", (x) => `${x.fiscalYear} ${x.scope || ""} ${x.scopeValue || ""}`.trim()),
            colNum("Cible CAS", (x) => money(x.targetCas)), colNum("Cible Facturé", (x) => money(x.targetInvoiced)),
            colNum("Cible Marge", (x) => money(x.targetMargin)),
            // R/O = réalisé de la période SÉLECTIONNÉE / cible de la MÊME année (sinon "—",
            // pour ne pas comparer un réalisé période à une cible d'une autre année).
            colNum("R/O CAS", (x) => (x.targetCas > 0 && String(x.fiscalYear) === String(period)) ? <Badge tone={realiseCas / x.targetCas >= 1 ? "emerald" : "gold"}>{pct(realiseCas / x.targetCas)}</Badge> : "—"),
          ]}
          rows={rows}
        />
        <Tip>Réalisé CAS de la période {period} : {fmt(realiseCas)} · Facturé : {fmt(ov?.facture)} · Marge : {fmt(ov?.mb)}. Le R/O n'est affiché que pour l'objectif de l'année sélectionnée.</Tip>
      </Card>
      {canWrite && (
        <Card title="Ajouter / mettre à jour un objectif">
          <div className="flex flex-wrap gap-2 items-center">
            <input className="field w-24" placeholder="Année" value={o.fiscalYear} onChange={(e) => setO({ ...o, fiscalYear: e.target.value })} />
            <input className="field" placeholder="Scope" value={o.scope} onChange={(e) => setO({ ...o, scope: e.target.value })} />
            <input className="field" placeholder="Valeur" value={o.scopeValue} onChange={(e) => setO({ ...o, scopeValue: e.target.value })} />
            <input className="field w-32" placeholder="Cible CAS" value={o.targetCas} onChange={(e) => setO({ ...o, targetCas: e.target.value })} />
            <input className="field w-32" placeholder="Cible Facturé" value={o.targetInvoiced} onChange={(e) => setO({ ...o, targetInvoiced: e.target.value })} />
            <input className="field w-32" placeholder="Cible Marge" value={o.targetMargin} onChange={(e) => setO({ ...o, targetMargin: e.target.value })} />
            <Busy label="Enregistrer" fn={() => upsertObjective({ fiscalYear: Number(o.fiscalYear) || 0, scope: o.scope, scopeValue: o.scopeValue, targetCas: Number(o.targetCas) || 0, targetInvoiced: Number(o.targetInvoiced) || 0, targetMargin: Number(o.targetMargin) || 0 })} />
          </div>
        </Card>
      )}
    </div>
  );
};

// 4 — Facturation
const Facturation: FC<Props> = ({ period }) => {
  const { data } = useDocData<any>(`summaries/facturation_${period}`);
  if (!data) return <EmptyState />;
  return (
    <div className="flex flex-col gap-4">
      <div className={grid4}><Kpi label="Facturé (période)" value={fmt(data.total)} tone="emerald" sub={`${data.count} factures`} /></div>
      <Card title="Tendance mensuelle"><AreaTrend data={monthsAsc(data.monthly)} color={T.emerald} name="Facturé" /></Card>
      <div className={cols2}>
        <Card title="Mix BU"><DonutBU data={objToArr(data.byBu).map((x) => ({ name: x.name, value: x.v }))} /></Card>
        <Card title="Top clients"><HBars rows={topArr(data.topClients).slice(0, 10)} colorFn={() => T.emerald} /></Card>
      </div>
    </div>
  );
};

// 5 — Suivi Backlog
const Backlog: FC<Props> = () => {
  const { data } = useDocData<any>("summaries/backlog_fy");
  if (!data) return <EmptyState />;
  return (
    <div className="flex flex-col gap-4">
      <div className={grid4}><Kpi label={`Backlog FY ${data.fy || ""}`} value={fmt(data.total)} tone="steel" sub={`${data.count} commandes`} /></div>
      <div className={cols2}>
        <Card title="Par millésime"><Bars data={objToArr(data.byVintage)} color={T.clay} name="Backlog" /></Card>
        <Card title="Par domaine"><DonutBU data={objToArr(data.byBu).map((x) => ({ name: x.name, value: x.v }))} /></Card>
      </div>
      <Card title="Top commandes ouvertes">
        <Table columns={[colText("FP", (t) => t.fp), colText("Client", (t) => t.client), colText("BU", (t) => t.bu), colNum("RAF", (t) => money(t.raf))]} rows={data.top || []} />
      </Card>
      <Tip>Ancré sur l'année fiscale — inchangé quand on change la période.</Tip>
    </div>
  );
};

// 6 — Prévision (ancrée FY, cohérente avec l'atterrissage)
const Prevision: FC<Props> = () => {
  const { data: bl } = useDocData<any>("summaries/backlog_fy");
  const { data: pl } = useDocData<any>("summaries/pipeline");
  const { data: cfg } = useDocData<any>("config/periods");
  const { data: att } = useDocData<any>(cfg?.currentFy ? `summaries/atterrissage_${cfg.currentFy}` : null);
  if (!bl && !pl && !att) return <EmptyState />;
  // Ancré sur l'année fiscale courante (une seule vérité = l'atterrissage) :
  // Pipeline de PROJECTION = 100 % du CA (IdC ≥ 90 %) + 20 % (70 %≤IdC<90 %), fenêtré sur D Prev.
  const realiseCas = att?.realiseCas || 0;
  const backlog = bl?.total || 0;
  const pond = att?.pipelinePondere ?? 0; // pipeline de projection (tiéré, fenêtre D Prev)
  const projete = att?.projete ?? (realiseCas + pond);
  const factureN = att?.factureN || 0;
  const cafProjete = att?.cafProjete ?? (factureN + backlog + pond); // facturé + backlog + pipeline projeté
  const fy = att?.fy || cfg?.currentFy;
  return (
    <div className="flex flex-col gap-4">
      <div className={grid4}>
        <Kpi label={`Réalisé CAS (FY ${fy || ""})`} value={fmt(realiseCas)} tone="emerald" />
        <Kpi label="Backlog écoulable (RAF)" value={fmt(backlog)} tone="steel" />
        <Kpi label="Pipeline projeté" value={fmt(pond)} tone="gold" sub="100 %≥90 · 20 %≥70 · fenêtre FY" />
        <Kpi label="Projeté CAS (FY)" value={fmt(projete)} sub="réalisé + pipeline projeté" />
      </div>
      <div className={grid4}>
        <Kpi label={`Facturé réalisé (FY ${fy || ""})`} value={fmt(factureN)} tone="emerald" />
        <Kpi label="Backlog à facturer (RAF)" value={fmt(backlog)} tone="steel" />
        <Kpi label="Pipeline projeté" value={fmt(pond)} tone="gold" sub="100 %≥90 · 20 %≥70 · fenêtre FY" />
        <Kpi label="Projeté CAF (FY)" value={fmt(cafProjete)} tone="gold" sub="facturé + backlog + pipeline projeté" />
      </div>
      {att && (
        <>
          <div className={cols2}>
            <Card title={`Atterrissage CAS ${att.fy} — prise de commande`}>
              <Gauge value={att.probaAtteinte} color={att.ecart < 0 ? T.clay : T.emerald} />
              <div className="grid grid-cols-3 gap-2 mt-2 text-center">
                <div><div className="text-[11px] text-muted">Projeté CAS</div><div className="font-display tabnum">{fmt(att.projete)}</div></div>
                <div><div className="text-[11px] text-muted">Objectif</div><div className="font-display tabnum">{att.objectif > 0 ? fmt(att.objectif) : "—"}</div></div>
                <div><div className="text-[11px] text-muted">Écart</div><div className={cx("font-display tabnum", att.ecart < 0 ? "text-clay" : "text-emerald")}>{att.objectif > 0 ? fmt(att.ecart) : "—"}</div></div>
              </div>
            </Card>
            <Card title={`Atterrissage CAF ${att.fy} — facturation`}>
              <Gauge value={att.probaAtteinteCaf} color={att.ecartCaf < 0 ? T.clay : T.emerald} />
              <div className="grid grid-cols-3 gap-2 mt-2 text-center">
                <div><div className="text-[11px] text-muted">Projeté CAF</div><div className="font-display tabnum">{fmt(att.cafProjete)}</div></div>
                <div><div className="text-[11px] text-muted">Objectif</div><div className="font-display tabnum">{att.objectifCaf > 0 ? fmt(att.objectifCaf) : "—"}</div></div>
                <div><div className="text-[11px] text-muted">Écart</div><div className={cx("font-display tabnum", att.ecartCaf < 0 ? "text-clay" : "text-emerald")}>{att.objectifCaf > 0 ? fmt(att.ecartCaf) : "—"}</div></div>
              </div>
            </Card>
          </div>
          <Card title="Facturation N vs N-1">
            <GroupedBars data={[{ name: `FY ${att.fy - 1}`, Facturé: att.factureN1 }, { name: `FY ${att.fy}`, Facturé: att.factureN }]} series={[{ key: "Facturé", color: T.emerald, name: "Facturé" }]} h={220} size={54} />
            <Tip>Croissance : <span className={att.croissanceFacture >= 0 ? "text-emerald" : "text-clay"}>{pct(att.croissanceFacture)}</span></Tip>
          </Card>
        </>
      )}
      <Tip><b>Pipeline projeté</b> (logique de projection moyen terme) = 100 % du CA des opportunités IdC ≥ 90 % + 20 % du CA des IdC ≥ 70 % (&lt; 90 %), <b>uniquement</b> celles dont la clôture prévue (D Prev) tombe entre aujourd'hui et fin {fy} — les projections obsolètes (D Prev passée) ou prévues en {fy ? Number(fy) + 1 : "N+1"}+ sont exclues. <b>Projeté CAS</b> = Réalisé CAS + pipeline projeté. <b>Projeté CAF</b> = Facturé réalisé + Backlog (RAF) + pipeline projeté (le backlog y entre, sans double compte).</Tip>
    </div>
  );
};

// 7 — Rentabilité
const Rentabilite: FC<Props> = ({ period }) => {
  const { data } = useDocData<any>(`summaries/rentabilite_${period}`);
  if (!data) return <EmptyState />;
  return (
    <div className="flex flex-col gap-4">
      <div className={grid4}>
        <Kpi label="Marge brute" value={fmt(data.mb)} tone="gold" />
        <Kpi label="CAS" value={fmt(data.cas)} />
        <Kpi label="%MB" value={pct(data.pmb)} />
      </div>
      <Card title="CAS vs MB par domaine">
        <GroupedBars data={(data.byBu || []).map((b: any) => ({ name: b.bu, CAS: b.cas, MB: b.mb }))} series={[{ key: "CAS", color: T.steel, name: "CAS" }, { key: "MB", color: T.plum, name: "MB" }]} />
      </Card>
      <Card title="Top clients (marge)"><HBars rows={topArr(data.topClients).slice(0, 10)} colorFn={() => T.gold} /></Card>
    </div>
  );
};

// 8 — P&L Projet
const PnlProjet: FC<Props> = () => {
  const { rows } = useCollectionData<any>("projectSheets");
  return (
    <Card title="Fiches affaire — coût / vente / marge">
      <Table columns={[
        colText("FP", (r) => r.fp, (r) => r.fp), colText("Client", (r) => r.client, (r) => r.client), colText("Affaire", (r) => r.affaire),
        colNum("Revient", (r) => money(r.costTotal), (r) => r.costTotal), colNum("Vente", (r) => money(r.saleTotal), (r) => r.saleTotal),
        colNum("Marge", (r) => money(r.margin), (r) => r.margin), colNum("%MB", (r) => pct(r.marginPct), (r) => r.marginPct),
      ]} rows={rows} />
      <Tip>Contrôle vente vs CAS de la commande ; coût par type/fournisseur via les lignes BC.</Tip>
    </Card>
  );
};

// 9 — Crédit Fournisseurs
const Fournisseurs: FC<Props> = () => {
  const { data } = useDocData<any>("summaries/suppliers");
  const canWrite = useCan("fournisseurs") === "write";
  if (!data) return <EmptyState />;
  const badge: any = { saturation: "clay", tension: "gold", ok: "emerald" };
  const cols = [
    colText("Fournisseur", (s: any) => s.name, (s: any) => s.name), colNum("Expo.", (s: any) => money(s.expo), (s: any) => s.expo),
    colNum("Ouvert", (s: any) => money(s.open), (s: any) => s.open), colNum("Encours", (s: any) => money(s.encours), (s: any) => s.encours),
    colNum("Couverture", (s: any) => money(s.coverage), (s: any) => s.coverage), colNum("État", (s: any) => <Badge tone={badge[s.state]}>{s.state}</Badge>, (s: any) => s.state),
    ...(canWrite ? [colNum("Ligne crédit", (s: any) => <CreditEditor name={s.name} authorized={s.authorized} outstanding={s.encours} />)] : []),
  ];
  return (
    <div className="flex flex-col gap-4">
      <div className={grid4}>
        <Kpi label="Exposition totale" value={fmt(data.totalExpo)} />
        <Kpi label="Achat comm. ouvertes" value={fmt(data.openTotal)} tone="steel" />
        <Kpi label="Encours" value={fmt(data.encoursTotal)} />
      </div>
      <Card title="Top exposition"><HBars rows={(data.bySupplier || []).slice(0, 8).map((s: any) => ({ name: s.name, v: s.expo }))} colorFn={() => T.steel} /></Card>
      <Card title="Par fournisseur"><Table columns={cols} rows={data.bySupplier || []} /></Card>
    </div>
  );
};
function CreditEditor({ name, authorized, outstanding }: { name: string; authorized: number; outstanding: number }) {
  const [a, setA] = useState(String(authorized || ""));
  const [o, setO] = useState(String(outstanding || ""));
  return (
    <span className="inline-flex gap-1.5 items-center">
      <input className="field w-24 !py-1" value={a} onChange={(e) => setA(e.target.value)} placeholder="autorisé" />
      <input className="field w-24 !py-1" value={o} onChange={(e) => setO(e.target.value)} placeholder="encours" />
      <Busy label="OK" fn={() => upsertCreditLine(name, { authorized: Number(a) || 0, outstanding: Number(o) || 0 })} />
    </span>
  );
}

// 10 — Exécution BC
const BC_STAGES = ["a_emettre", "emis", "livre", "facture", "solde"];
const BC: FC<Props> = () => {
  const { rows } = useCollectionData<any>("bcLines");
  const canWrite = useCan("bc") === "write";
  const byStatus: Record<string, number> = {};
  for (const r of rows) byStatus[r.status || "a_emettre"] = (byStatus[r.status || "a_emettre"] || 0) + 1;
  const solde = byStatus["solde"] || 0;
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 grid-cols-2 md:grid-cols-5">
        {BC_STAGES.map((s) => (
          <div key={s} className="card p-4">
            <div className="text-xs text-muted capitalize">{s.replace("_", " ")}</div>
            <div className="font-display text-2xl tabnum mt-1" style={{ color: BC_COL[s] }}>{byStatus[s] || 0}</div>
          </div>
        ))}
      </div>
      <div className={grid4}><Kpi label="Taux d'exécution (soldé)" value={pct(rows.length ? solde / rows.length : 0)} tone="emerald" /></div>
      <Card title="Lignes BC">
        <Table columns={[
          colText("FP", (r) => r.fp), colText("Fournisseur", (r) => r.supplier), colText("Type", (r) => r.expenseType),
          colNum("XOF", (r) => money(r.amountXof)),
          colNum("Statut", (r) => canWrite ? <StatusSelect id={r.id} status={r.status || "a_emettre"} /> : <Badge>{r.status || "a_emettre"}</Badge>),
        ]} rows={rows.slice(0, 200)} />
      </Card>
    </div>
  );
};
function StatusSelect({ id, status }: { id: string; status: string }) {
  const [s, setS] = useState(status);
  return (
    <select className="field !py-1" value={s} onChange={async (e) => { const v = e.target.value; setS(v); try { await setBcStatus(id, v); } catch { setS(status); } }}>
      {BC_STAGES.map((x) => <option key={x} value={x}>{x}</option>)}
    </select>
  );
}

// 11/12 — Clients / Domaines
function EntityView({ period, kind }: Props & { kind: "clients" | "domaines" }) {
  const { data } = useDocData<any>(`summaries/${kind}_${period}`);
  if (!data) return <EmptyState />;
  const rows = data.rows || [];
  return (
    <div className="flex flex-col gap-4">
      <Card title={kind === "clients" ? "CAS par client (top 10)" : "CAS par domaine"}>
        <HBars rows={rows.slice(0, 10).map((r: any) => ({ name: r.key, v: r.cas }))} colorFn={(r) => (kind === "domaines" ? (BU_COL[r.name] || T.faint) : T.gold)} />
      </Card>
      <Card title={kind === "clients" ? "Clients" : "Domaines (BU)"}>
        <Table columns={[
          colText(kind === "clients" ? "Client" : "BU", (r) => r.key, (r) => r.key),
          colNum("CAS", (r) => money(r.cas), (r) => r.cas), colNum("Facturé", (r) => money(r.facture), (r) => r.facture),
          colNum("Backlog", (r) => money(r.backlog), (r) => r.backlog), colNum("Marge", (r) => money(r.mb), (r) => r.mb), colNum("%MB", (r) => pct(r.pmb), (r) => r.pmb),
        ]} rows={rows} />
      </Card>
    </div>
  );
}

// FP 360°
const Fp360: FC<Props> = () => {
  const [q, setQ] = useState("");
  const fp = q.trim().toUpperCase();
  const cons = [where("fp", "==", fp || "__none__")];
  const { rows: orders } = useCollectionData<any>("orders", cons);
  const { rows: invoices } = useCollectionData<any>("invoices", cons);
  const { rows: sheets } = useCollectionData<any>("projectSheets", cons);
  const { rows: bc } = useCollectionData<any>("bcLines", cons);
  const { rows: opps } = useCollectionData<any>("opportunities", cons);
  const o = orders[0];
  return (
    <div className="flex flex-col gap-4">
      <Card title="Recherche par N° FP">
        <input className="field w-full md:w-96" placeholder="FP/2026/13542" value={q} onChange={(e) => setQ(e.target.value)} />
      </Card>
      {fp && (o ? (
        <>
          <div className={grid4}>
            <Kpi label="Client" value={o.client || "—"} />
            <Kpi label="CAS" value={fmt(o.cas)} />
            <Kpi label="RAF" value={fmt(o.raf)} tone="steel" />
            <Kpi label="MB" value={fmt(o.mb)} sub={o.bu} tone="gold" />
          </div>
          <Card title={`Factures · ${invoices.length}`}><Table columns={[colText("Numéro", (i) => i.numero), colText("Date", (i) => i.date), colNum("Montant HT", (i) => money(i.amountHt))]} rows={invoices} /></Card>
          <Card title="Fiche projet"><Table columns={[colText("Affaire", (s) => s.affaire), colNum("Revient", (s) => money(s.costTotal)), colNum("Vente", (s) => money(s.saleTotal)), colNum("Marge", (s) => money(s.margin)), colNum("%MB", (s) => pct(s.marginPct))]} rows={sheets} /></Card>
          <Card title={`Lignes BC · ${bc.length}`}><Table columns={[colText("Fournisseur", (b) => b.supplier), colText("Type", (b) => b.expenseType), colNum("XOF", (b) => money(b.amountXof)), colText("Statut", (b) => b.status)]} rows={bc} /></Card>
          <Card title={`Opportunités · ${opps.length}`}><Table columns={[colText("Client", (x) => x.client), colText("AM", (x) => x.am), colNum("Montant", (x) => money(x.amount)), colText("Étape", (x) => x.stageLabel || x.stage)]} rows={opps} /></Card>
        </>
      ) : <EmptyState label={`Aucune commande pour ${fp}.`} />)}
    </div>
  );
};

// --- Listes détaillées (drill-down collections) ---
const buTone: any = { ICT: "emerald", CLOUD: "steel", FORMATION: "gold", AUTRE: "neutral" };
const buBadge = (bu: string) => <Badge tone={buTone[bu] || "neutral"}>{bu || "—"}</Badge>;

const OppList: FC<Props> = () => {
  const { rows, loading } = useCollectionData<any>("opportunities");
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

const OrderList: FC<Props> = () => {
  const { rows, loading } = useCollectionData<any>("orders");
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

const InvoiceList: FC<Props> = () => {
  const { rows, loading } = useCollectionData<any>("invoices");
  const [f, setF] = useState<"all" | "linked" | "orphan">("all");
  if (loading && !rows.length) return <CardSkeleton />;
  const orphan = rows.filter((r) => r.linked !== true);
  const orphanAmt = orphan.reduce((s, r) => s + (r.amountHt || 0), 0);
  const filtered = f === "all" ? rows : f === "orphan" ? orphan : rows.filter((r) => r.linked === true);
  const seg = (id: typeof f, label: string, n?: number) => (
    <button onClick={() => setF(id)} className={cx("rounded-md px-2.5 py-1 text-xs font-semibold transition-colors", f === id ? "bg-gold text-bg" : "bg-panel2 text-muted hover:text-ink")}>
      {label}{n != null && <span className="ml-1 opacity-70">{n.toLocaleString("fr-FR")}</span>}
    </button>
  );
  return (
    <div className="flex flex-col gap-3">
      {orphan.length > 0 && (
        <div className={grid4}>
          <Kpi label="Factures non rattachées" value={orphan.length.toLocaleString("fr-FR")} tone="clay" sub={`${fmt(orphanAmt)} FCFA`} />
        </div>
      )}
      <Card title={`Factures · ${rows.length.toLocaleString("fr-FR")}`} actions={<div className="flex gap-1.5">{seg("all", "Toutes")}{seg("linked", "Rattachées")}{seg("orphan", "Non rattachées", orphan.length)}</div>}>
        <ListView
          rows={filtered}
          searchKeys={[(r) => r.numero, (r) => r.fp, (r) => r.client]}
          columns={[
            colText("Numéro", (r) => r.numero, (r) => r.numero),
            colText("FP", (r) => r.fp || "—", (r) => r.fp || ""),
            colText("Client", (r) => r.client, (r) => r.client),
            colText("BU", (r) => buBadge(r.bu), (r) => r.bu),
            colText("Rattach.", (r) => (r.linked !== true ? <Badge tone="clay">non</Badge> : <Badge tone="emerald">oui</Badge>), (r) => (r.linked !== true ? 0 : 1)),
            colText("Date", (r) => r.date || "—", (r) => r.date || ""),
            colNum("Montant HT", (r) => money(r.amountHt), (r) => r.amountHt),
            colText("Statut", (r) => r.paymentStatus || "—", (r) => r.paymentStatus || ""),
          ]}
        />
      </Card>
    </div>
  );
};

// 13 — Habilitations
const Habilitations: FC<Props> = () => {
  const { data } = useDocData<any>("config/permissions");
  const { rows: users } = useCollectionData<any>("users");
  const canWrite = useCan("habilitations") === "write";
  const [draft, setDraft] = useState<Record<string, Record<string, string>> | null>(null);
  const matrix = draft || data?.matrix || {};
  const roles = Object.keys(matrix);
  const modules = roles.length ? Object.keys(matrix[roles[0]]) : [];
  const cyc: any = { none: "read", read: "write", write: "none" };
  const glyph: any = { write: "W", read: "R", none: "–" };
  const tone: any = { write: "bg-emerald text-bg", read: "bg-steel text-bg", none: "bg-panel2 text-muted" };
  const setCell = (r: string, m: string) => { const b = JSON.parse(JSON.stringify(matrix)); b[r][m] = cyc[b[r][m]] || "read"; setDraft(b); };
  return (
    <div className="flex flex-col gap-4">
      <Card title="Matrice droits (profil × module)" actions={canWrite && draft ? <div className="flex gap-2"><Busy label="Enregistrer" fn={async () => { await updateMatrix(draft); setDraft(null); }} /><button className="btn-ghost" onClick={() => setDraft(null)}>Annuler</button></div> : undefined}>
        <div className="overflow-x-auto">
          <table className="text-xs">
            <thead><tr><th className="px-2 py-1 text-left text-muted">Module</th>{roles.map((r) => <th key={r} className="px-2 py-1 text-muted font-medium">{r}</th>)}</tr></thead>
            <tbody>
              {modules.map((m) => (
                <tr key={m}>
                  <td className="px-2 py-1">{m}</td>
                  {roles.map((r) => (
                    <td key={r} className="px-1 py-1 text-center">
                      <button disabled={!canWrite} onClick={() => canWrite && setCell(r, m)} className={cx("w-7 h-6 rounded font-semibold", tone[matrix[r][m]] || "bg-panel2", canWrite && "hover:opacity-80")}>{glyph[matrix[r][m]] ?? "–"}</button>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <Card title="Utilisateurs & rôles">
        <Table columns={[
          colText("Email", (u) => u.email), colText("Nom", (u) => u.name),
          colText("Actif", (u) => u.active ? <Badge tone="emerald">oui</Badge> : <Badge tone="clay">non</Badge>),
          ...(canWrite ? [colNum("Rôle", (u: any) => <RoleSetter uid={u.id} />)] : []),
        ]} rows={users} />
        <Tip>Le rôle est un custom claim posé via la Cloud Function setUserRole (auditée).</Tip>
      </Card>
    </div>
  );
};
function RoleSetter({ uid }: { uid: string }) {
  const [role, setRole] = useState("lecture");
  return (
    <span className="inline-flex gap-1.5">
      <select className="field !py-1" value={role} onChange={(e) => setRole(e.target.value)}>
        {["direction", "commercial_dir", "commercial", "pmo", "achats", "lecture"].map((r) => <option key={r}>{r}</option>)}
      </select>
      <Busy label="Poser" fn={() => callSetUserRole(uid, role)} />
    </span>
  );
}

// Registre : id navigation unique + clé permission RBAC + libellé + icône + composant.
export const MODULES: { id: string; key: string; label: string; icon: LucideIcon; Component: FC<Props> }[] = [
  { id: "overview", key: "overview", label: "Vue d'ensemble", icon: LayoutDashboard, Component: Overview },
  { id: "pipeline", key: "pipeline", label: "Pipeline", icon: GitBranch, Component: Pipeline },
  { id: "opplist", key: "pipeline", label: "Opportunités", icon: ListChecks, Component: OppList },
  { id: "objectifs", key: "objectifs", label: "Objectifs / R-O", icon: Target, Component: Objectifs },
  { id: "facturation", key: "facturation", label: "Facturation", icon: Receipt, Component: Facturation },
  { id: "invoicelist", key: "facturation", label: "Factures", icon: FileSpreadsheet, Component: InvoiceList },
  { id: "backlog", key: "backlog", label: "Suivi Backlog", icon: Layers, Component: Backlog },
  { id: "orderlist", key: "overview", label: "Commandes", icon: ShoppingCart, Component: OrderList },
  { id: "prevision", key: "prevision", label: "Prévision", icon: TrendingUp, Component: Prevision },
  { id: "rentabilite", key: "rentabilite", label: "Rentabilité (P&L)", icon: Percent, Component: Rentabilite },
  { id: "pnlprojet", key: "pnlprojet", label: "P&L Projet", icon: FileText, Component: PnlProjet },
  { id: "fournisseurs", key: "fournisseurs", label: "Crédit Fournisseurs", icon: Truck, Component: Fournisseurs },
  { id: "bc", key: "bc", label: "Exécution BC", icon: ClipboardList, Component: BC },
  { id: "clients", key: "clients", label: "Clients", icon: Users, Component: (p) => <EntityView {...p} kind="clients" /> },
  { id: "domaines", key: "domaines", label: "Domaines", icon: Boxes, Component: (p) => <EntityView {...p} kind="domaines" /> },
  { id: "fp360", key: "overview", label: "FP 360°", icon: Search, Component: Fp360 },
  { id: "habilitations", key: "habilitations", label: "Habilitations", icon: Shield, Component: Habilitations },
];
