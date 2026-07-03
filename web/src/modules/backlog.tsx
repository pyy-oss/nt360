// Modules pilotage : Suivi Backlog, Prévision (atterrissage CAS/CAF), liste Commandes.
import { useState, type FC } from "react";
import { useDocData } from "../lib/hooks";
import { useCanImport, useCanSeeMargin } from "../lib/rbac";
import { T, fmt, pct } from "../design/tokens";
import { Card, Kpi, Table, Badge, Busy, Tip, EmptyState, ErrorState, CardSkeleton, ListView, colText, colNum, money, cx } from "../design/components";
import { Bars, DonutBU, GroupedBars, Gauge, MultiLine } from "../design/charts";
import { Props, grid4, cols2, objToArr, toDonut, buBadge, ImportButton, FilterNote } from "./_shared";
import { useFilters } from "../lib/filters";
import { patchOrder } from "../lib/writes";
import type { BacklogSummary, PipelineSummary, AtterrissageSummary, PeriodsConfig, CommandesSummary, TrendsSummary, Order } from "../types";

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
            <Kpi label="RAF dérivé (CAS − facturé)" value={fmt(derive)} tone={derivePct > 0.05 ? "clay" : "steel"} sub={`${data.countDerive ?? 0} commandes · ${pct(derivePct)} du total`} />
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
            colText("FP", (t) => t.fp),
            colText("Client", (t) => t.client),
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
        <Table columns={[colText("FP", (t) => t.fp), colText("Client", (t) => t.client), colText("BU", (t) => t.bu), colNum("RAF", (t) => money(t.raf))]} rows={data.top || []} />
      </Card>
      <Tip>Ancré sur l'année fiscale — inchangé quand on change la période.</Tip>
    </div>
  );
};

// 6 — Prévision (ancrée FY, cohérente avec l'atterrissage)
export const Prevision: FC<Props> = () => {
  const { data: bl } = useDocData<BacklogSummary>("summaries/backlog_fy");
  const { data: pl } = useDocData<PipelineSummary>("summaries/pipeline");
  const { data: cfg } = useDocData<PeriodsConfig>("config/periods");
  const { data: att } = useDocData<AtterrissageSummary>(cfg?.currentFy ? `summaries/atterrissage_${cfg.currentFy}` : null);
  const { data: trends } = useDocData<TrendsSummary>("summaries/trends");
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
        <Kpi label="Projeté CAF (FY)" value={fmt(cafProjete)} tone="gold" sub="Facturé + Backlog + Pipeline projeté" />
      </div>
      {att && (
        <>
          <div className={cols2}>
            <Card title={`Atterrissage CAS ${att.fy} — prise de commande`}>
              <Gauge value={att.probaAtteinte || 0} color={(att.ecart || 0) < 0 ? T.clay : T.emerald} />
              <div className="grid grid-cols-3 gap-2 mt-2 text-center">
                <div><div className="text-[11px] text-muted">Projeté CAS</div><div className="font-display tabnum">{fmt(att.projete)}</div></div>
                <div><div className="text-[11px] text-muted">Objectif</div><div className="font-display tabnum">{(att.objectif || 0) > 0 ? fmt(att.objectif) : "—"}</div></div>
                <div><div className="text-[11px] text-muted">Écart</div><div className={cx("font-display tabnum", (att.ecart || 0) < 0 ? "text-clay" : "text-emerald")}>{(att.objectif || 0) > 0 ? fmt(att.ecart) : "—"}</div></div>
              </div>
            </Card>
            <Card title={`Atterrissage CAF ${att.fy} — facturation`}>
              <Gauge value={att.probaAtteinteCaf || 0} color={(att.ecartCaf || 0) < 0 ? T.clay : T.emerald} />
              <div className="grid grid-cols-3 gap-2 mt-2 text-center">
                <div><div className="text-[11px] text-muted">Projeté CAF</div><div className="font-display tabnum">{fmt(att.cafProjete)}</div></div>
                <div><div className="text-[11px] text-muted">Objectif</div><div className="font-display tabnum">{(att.objectifCaf || 0) > 0 ? fmt(att.objectifCaf) : "—"}</div></div>
                <div><div className="text-[11px] text-muted">Écart</div><div className={cx("font-display tabnum", (att.ecartCaf || 0) < 0 ? "text-clay" : "text-emerald")}>{(att.objectifCaf || 0) > 0 ? fmt(att.ecartCaf) : "—"}</div></div>
              </div>
            </Card>
          </div>
          <Card title="Facturation N vs N-1">
            <GroupedBars data={[{ name: `FY ${(att.fy || 0) - 1}`, Facturé: att.factureN1 }, { name: `FY ${att.fy}`, Facturé: att.factureN }]} series={[{ key: "Facturé", color: T.emerald, name: "Facturé" }]} h={220} size={54} />
            <Tip>Croissance : <span className={(att.croissanceFacture || 0) >= 0 ? "text-emerald" : "text-clay"}>{pct(att.croissanceFacture)}</span></Tip>
          </Card>
        </>
      )}
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
// le Projeté CAS/CAF et la probabilité d'atteinte de l'objectif. 100 % client (aucune écriture).
const M = 1_000_000;
export const Simulateur: FC<Props> = () => {
  const { data: cfg } = useDocData<PeriodsConfig>("config/periods");
  const { data: att } = useDocData<AtterrissageSummary>(cfg?.currentFy ? `summaries/atterrissage_${cfg.currentFy}` : null);
  const [addPipe, setAddPipe] = useState(0);   // pipeline pondéré additionnel (FCFA)
  const [realiz, setRealiz] = useState(100);   // taux de réalisation du pipeline (%)
  const [objOverride, setObjOverride] = useState<string>(""); // objectif CAS simulé (M FCFA), vide = réel
  if (!att) return <EmptyState label="Atterrissage indisponible — importer données & objectifs, puis recalculer." />;

  const realiseCas = att.realiseCas || 0;
  const backlog = att.backlog || 0;
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
          <div className="grid grid-cols-3 gap-2 mt-2 text-center">
            <div><div className="text-[11px] text-muted">Projeté CAS</div><div className="font-display tabnum">{fmt(projeteCas)}</div></div>
            <div><div className="text-[11px] text-muted">Objectif</div><div className="font-display tabnum">{objectifCas > 0 ? fmt(objectifCas) : "—"}</div></div>
            <div><div className="text-[11px] text-muted">Écart</div><div className={cx("font-display tabnum", ecartCas < 0 ? "text-clay" : "text-emerald")}>{objectifCas > 0 ? fmt(ecartCas) : "—"}</div></div>
          </div>
        </Card>
        <Card title="Atterrissage CAF simulé — facturation">
          <Gauge value={probaCaf} color={ecartCaf < 0 ? T.clay : T.emerald} />
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
  const { data, loading } = useDocData<CommandesSummary>("summaries/commandes");
  const { match } = useFilters();
  const all = data?.rows || [];
  const rows = all.filter((r) => match(r, ["bu", "am", "client"]));
  const canImport = useCanImport();
  const canMargin = useCanSeeMargin();
  if (loading && !data) return <CardSkeleton />;
  if (!all.length) return <EmptyState label="Aucune commande. Importez des opportunités (gagnées) ou des fiches affaire." action={canImport ? <ImportButton label="Importer un fichier" /> : undefined} />;
  return (
    <div className="flex flex-col gap-2">
    <FilterNote dims="BU / AM / client" />
    <Card title={`Commandes · ${rows.length.toLocaleString("fr-FR")}`}>
      <ListView
        rows={rows}
        searchKeys={[(r) => r.fp, (r) => r.client, (r) => r.am, (r) => r.affaire || ""]}
        columns={[
          colText("FP", (r) => r.fp, (r) => r.fp),
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
