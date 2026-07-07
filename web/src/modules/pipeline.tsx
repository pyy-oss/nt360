// 2 — Pipeline (analytique : funnel pondéré) · Opportunités (liste + top + saisie).
import { useState, useEffect, type FC, type ReactNode, type ChangeEvent } from "react";
import { useDocData, useCollectionData } from "../lib/hooks";
import { useCan, useCanImport, useClaims } from "../lib/rbac";
import { T, fmt, pct } from "../design/tokens";
import { Card, Kpi, Table, Badge, Tip, EmptyState, CardSkeleton, Busy, DangerBtn, ListView, Segmented, Modal, useToast, cx, colText, colNum, money } from "../design/components";
import { Select, DateField } from "../design/inputs";
import { AreaTrend, GroupedBars } from "../design/charts";
import { upsertOpportunity, deleteOpportunity, patchOpportunity, deleteRecord, fpDocId, exportOpportunities, importOpportunities, downloadBase64, type OppImportResult } from "../lib/writes";
import { Props, grid4, cols2, objToArr, monthsAsc, STAGE_SHORT, HBars, buBadge, ImportButton, FilterNote, FpLink, buildStageFunnel, useCommandesRows, useBusinessUnits } from "./_shared";
import { useFilters } from "../lib/filters";
import { useNav } from "../lib/nav";
import type { PipelineSummary, Opportunity, AtterrissageSummary, PeriodsConfig, AmsSummary, OverviewSummary, OppFunnelSummary } from "../types";

// Libellés courts d'étape pour le funnel de transitions (from→to).
const stageArrow = (from: number, to: number) => `${from || "•"} → ${to}`;

// Module PIPELINE : synthèse analytique seulement (la saisie et le détail sont dans « Opportunités »).
export const Pipeline: FC<Props> = ({ period }) => {
  // Pipeline de la période : opportunités dont la D Prev tombe dans l'année sélectionnée
  // (écarte les opps obsolètes / non mises à jour). « Tout » = tout le pipeline.
  const { data, loading } = useDocData<PipelineSummary>(`summaries/pipeline_${period}`);
  // Taux de conversion vente (règle de gestion) : calculé une seule fois côté Vue d'ensemble.
  const { data: ov } = useDocData<OverviewSummary>(`summaries/overview_${period}`);
  const { data: cfg } = useDocData<PeriodsConfig>("config/periods");
  const { data: att } = useDocData<AtterrissageSummary>(cfg?.currentFy ? `summaries/atterrissage_${cfg.currentFy}` : null);
  // Pipeline de l'EXERCICE (indépendant du sélecteur de période) pour une couverture cohérente
  // avec l'objectif/réalisé qui sont, eux, ancrés sur l'exercice courant.
  const { data: pfy } = useDocData<PipelineSummary>(cfg?.currentFy ? `summaries/pipeline_${cfg.currentFy}` : null);
  const { data: funnelC } = useDocData<OppFunnelSummary>("summaries/oppFunnel"); // funnel de conversion réel (Lot C)
  const { go, canGo } = useNav(); // renvoi vers AM 360° (source unique du classement par commercial)
  if (loading && !data) return <CardSkeleton />; // évite le flash « Aucune donnée » avant le 1er snapshot (F4)
  if (!data) return <EmptyState />;
  const funnel = buildStageFunnel(data.byStage);
  // Couverture du reste-à-faire : combien de fois le pipeline pondéré (exercice) couvre l'écart à
  // l'objectif CAS. Numérateur et dénominateur au MÊME périmètre (currentFy). null si pas d'objectif.
  const hasObj = (att?.objectif || 0) > 0;
  const gap = Math.max((att?.objectif || 0) - (att?.realiseCas || 0), 0);
  const coverage = hasObj && gap > 0 ? (pfy?.tot?.weighted || 0) / gap : null;
  const coverageLabel = coverage != null ? `${coverage.toFixed(2)}×` : hasObj ? "atteint" : "—";
  const cb = data.closing?.buckets;
  // Buckets serveur DISJOINTS par horizon : `mois` = clôture ce mois ; `trim` = clôture plus tard
  // DANS le trimestre courant (hors ce mois). L'échéancier (waterfall) les affiche tels quels.
  // Les KPI, eux, sont CUMULATIFS (« ce trimestre » inclut « ce mois ») — sinon le trimestre
  // pourrait afficher moins que le mois, ce qui est incohérent pour une lecture cumulée.
  const moisPond = cb?.mois?.pond || 0, moisCount = cb?.mois?.count || 0;
  const trimCumPond = moisPond + (cb?.trim?.pond || 0);
  const trimCumCount = moisCount + (cb?.trim?.count || 0);
  // Décomposition du pondéré projeté par niveau (Certitudes / Forecast / Pipe) — jamais mélangée.
  // Le sous-libellé du KPI ne liste que les niveaux ACTIFS et leur poids configuré.
  const tiers = data.tierBreakdown || [];
  const projLabel = tiers.filter((t) => t.active).map((t) => `${Math.round(t.weight * 100)} %·${t.band}`).join(" · ") || "aucun niveau actif";
  const closingRows = cb ? [
    { name: "En retard", v: cb.retard?.pond || 0, sub: `${cb.retard?.count || 0} opp.` },
    { name: "Ce mois", v: cb.mois?.pond || 0, sub: `${cb.mois?.count || 0} opp.` },
    { name: "Reste du trimestre", v: cb.trim?.pond || 0, sub: `${cb.trim?.count || 0} opp.` },
    { name: "Plus tard", v: cb.plus?.pond || 0, sub: `${cb.plus?.count || 0} opp.` },
    { name: "Sans date", v: cb.sans?.pond || 0, sub: `${cb.sans?.count || 0} opp.` },
  ] : [];
  return (
    <div className="flex flex-col gap-4">
      <div className={grid4}>
        <Kpi label="Actif (brut)" value={fmt(data.tot?.brut)} sub={`${data.tot?.count ?? 0} opp.`} />
        <Kpi label="Pondéré projeté" value={fmt(data.tot?.weighted)} tone="gold" sub={`${projLabel} — ${data.tot?.countConf ?? 0} opp.`} />
        <Kpi label="Suspendu" value={fmt(data.susp?.brut)} sub={`${data.susp?.count ?? 0} opp.`} tone="clay" />
        <Kpi label="Conversion vente" value={pct(ov?.ratios?.tauxConversionVente)} sub={`gagné ${data.wonCount}/${(data.wonCount || 0) + (data.lostCount || 0)}`} />
      </div>
      {tiers.length > 0 && (
        <Card title="Pondéré projeté — décomposition par niveau (on ne mélange pas)">
          <Table columns={[
            colText("Niveau", (t) => <span>{t.label} <span className="text-faint">{t.band}</span>{!t.active && <span className="ml-1.5 rounded bg-panel2 text-faint px-1.5 py-0.5 text-[11px]">inactif</span>}</span>),
            colNum("Poids", (t) => (t.active ? pct(t.weight) : "—")),
            colNum("Brut", (t) => money(t.brut)),
            colNum("Pondéré", (t) => (t.active ? money(t.pond) : "—")),
            colNum("Opp.", (t) => (t.count ?? 0).toLocaleString("fr-FR")),
          ]} rows={tiers} />
          <Tip>Trois cohortes <b>disjointes</b> par certitude : Certitudes (≥ 90 %) · Forecast (70-90 %) · Pipe (50-70 %). Le <b>Pondéré projeté</b> = somme des niveaux <b>actifs</b> uniquement (on ne mélange pas les niveaux). Poids et activation se règlent dans <b>Habilitations</b> et s'appliquent à toutes les vues et projections.</Tip>
        </Card>
      )}
      <Card title="Funnel pondéré par étape">
        <GroupedBars data={funnel} series={[{ key: "Brut", color: T.steel, name: "Brut" }, { key: "Pondéré", color: T.gold, name: "Pondéré" }]} h={240} size={26} interval={0} />
      </Card>
      <div className={cols2}>
        <Card title="Pondéré par AM"><HBars rows={objToArr(data.byAM).slice(0, 10)} colorFn={() => T.gold} /></Card>
        <Card title="Écoulement mensuel (pondéré)">{Object.keys(data.byMonth || {}).length ? <AreaTrend data={monthsAsc(data.byMonth)} color={T.gold} name="Pondéré" h={200} /> : <EmptyState label="Dates de closing indisponibles." />}</Card>
      </div>
      {/* Le CLASSEMENT par commercial (pondéré / taux de transfo. / R-O …) vit désormais UNIQUEMENT dans
          AM 360° (source unique summaries/ams). Il était ici recalculé depuis un AUTRE agrégat
          (pipeline_${period}.byAmConv) → un même AM pouvait afficher un pondéré/transfo. différent selon
          l'écran. On renvoie vers la source unique ; la distribution « Pondéré par AM » (période) ci-dessus
          reste, elle, une lecture de répartition et non un classement. */}
      {canGo("am360") && (
        <Card title="Performance par commercial (AM)">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <p className="text-[12.5px] text-muted">Le <b>classement complet</b> par commercial (CAS, facturé, backlog, pondéré, taux de transformation, R/O) est dans <b>AM 360°</b> — source unique pour garantir la cohérence des chiffres.</p>
            <button onClick={() => go("am360")} className="btn-ghost !px-3 !py-1.5 text-sm shrink-0">Ouvrir AM 360°</button>
          </div>
        </Card>
      )}

      {data.closing && (
        <>
          <div className={grid4}>
            <Kpi label="Couverture reste-à-faire" value={coverageLabel} tone={coverage == null ? (hasObj ? "emerald" : "steel") : coverage >= 1 ? "emerald" : "clay"} sub="pondéré exercice / (objectif − réalisé CAS)" />
            <Kpi label="En retard de closing" value={fmt(data.closing.staleBrut)} tone="clay" sub={`${data.closing.staleCount ?? 0} opp.${data.closing.avgOverdueDays ? ` · ~${data.closing.avgOverdueDays} j de retard moyen` : " · D Prev dépassée"}`} />
            <Kpi label="À clôturer ce mois" value={fmt(moisPond)} tone="gold" sub={`${moisCount} opp. (pondéré)`} />
            <Kpi label="À clôturer ce trimestre" value={fmt(trimCumPond)} sub={`${trimCumCount} opp. · ce mois inclus`} />
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
          {(data.closing.staleCount ?? 0) > 0 && data.closing.overdueAge && (
            <Card title={`Ancienneté du retard de closing (retard moyen ~${data.closing.avgOverdueDays ?? 0} j)`}>
              <HBars
                rows={[
                  { name: "≤ 30 j", v: data.closing.overdueAge.d30?.brut || 0, sub: `${data.closing.overdueAge.d30?.count || 0} opp.` },
                  { name: "31–90 j", v: data.closing.overdueAge.d90?.brut || 0, sub: `${data.closing.overdueAge.d90?.count || 0} opp.` },
                  { name: "> 90 j", v: data.closing.overdueAge.dPlus?.brut || 0, sub: `${data.closing.overdueAge.dPlus?.count || 0} opp.` },
                ]}
                colorFn={(r) => (r.name === "> 90 j" ? T.clay : r.name === "31–90 j" ? T.gold : T.steel)}
              />
            </Card>
          )}
          <Tip>Analyse fondée uniquement sur la <b>D Prev</b> (date de clôture prévue) — aucune date de création ou d'étape n'existe en source, donc pas de vélocité/âge inventés. L'<b>ancienneté du retard</b> priorise les affaires les plus enlisées (les <b>&gt; 90 j</b> sont les plus à risque, souvent à passer en perdu). Les opportunités <b>en retard de closing</b> (D Prev déjà dépassée mais toujours actives) sont à <b>requalifier</b> (re-dater ou passer en perdu). La <b>couverture</b> indique combien de fois le pipeline pondéré couvre l'écart à l'objectif : &lt; 1× = objectif non couvert par le seul pipeline certain.</Tip>
        </>
      )}
      <Card title="Funnel de conversion — transitions d'étape (réel)">
        {(funnelC?.total ?? 0) > 0 ? (
          <>
            <div className={grid4}>
              <Kpi label="Taux de gain" value={pct(funnelC?.winRate)} tone={(funnelC?.winRate ?? 0) >= 0.5 ? "emerald" : "gold"} sub={`gagné ${funnelC?.won ?? 0} / perdu ${funnelC?.lost ?? 0}`} />
              <Kpi label="Progressions" value={String(funnelC?.advanced ?? 0)} tone="emerald" sub="avancées d'étape" />
              <Kpi label="Reculs" value={String(funnelC?.regressed ?? 0)} tone="clay" sub="retours en arrière" />
              <Kpi label="Transitions" value={String(funnelC?.total ?? 0)} sub="mouvements journalisés" />
            </div>
            <Table columns={[
              colText("Transition", (t) => stageArrow(t.from, t.to), (t) => t.from * 100 + t.to),
              colNum("Occurrences", (t) => t.count, (t) => t.count),
              colNum("Montant", (t) => money(t.amount), (t) => t.amount),
            ]} rows={funnelC?.transitions || []} />
          </>
        ) : <EmptyState label="Le funnel de conversion se construit à partir des changements d'étape (board / édition d'opportunité)." />}
        <Tip>Funnel <b>réel</b> mesuré sur les transitions d'étape journalisées (board Kanban / édition) — la source Excel n'ayant ni date de création ni historique, il se construit <b>à partir de maintenant</b> et gagne en fiabilité avec le temps. <b>Taux de gain</b> = passages en Gagné / (Gagné + Perdu).{funnelC?.truncated ? ` Au-delà de ${(funnelC?.windowSize ?? 0).toLocaleString("fr-FR")} transitions, la mesure porte sur cette FENÊTRE GLISSANTE des plus récentes (les plus anciennes en sortent).` : ""}</Tip>
      </Card>
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
  // Rang par prise de commande (CAS) — classement de performance du leaderboard.
  const rankOf = new Map([...rows].sort((a, b) => b.cas - a.cas).map((r, i) => [r.am, i + 1] as const));
  return (
    <div className="flex flex-col gap-4">
      <Card title="Commercial (Account Manager)">
        <Select className="w-full md:w-80" ariaLabel="Choisir un commercial" value={sel.am} onChange={setAm}
          options={rows.map((r) => ({ value: r.am, label: r.am }))} />
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
          colText("#", (r) => <span className="text-faint tabnum">{rankOf.get(r.am)}</span>, (r) => rankOf.get(r.am) ?? 999),
          colText("AM", (r) => (r.am === sel.am ? <b className="text-gold">{r.am}</b> : r.am), (r) => r.am),
          colNum("CAS", (r) => money(r.cas), (r) => r.cas),
          colNum("Ticket moy.", (r) => (r.orderCount > 0 ? money(r.cas / r.orderCount) : "—"), (r) => (r.orderCount > 0 ? r.cas / r.orderCount : 0)),
          colNum("Facturé", (r) => money(r.facture), (r) => r.facture),
          colNum("Backlog", (r) => money(r.backlog), (r) => r.backlog),
          colNum("Pipeline pond.", (r) => money(r.pipelinePondere), (r) => r.pipelinePondere),
          colNum("Transfo.", (r) => (r.won + r.lost > 0 ? pct(r.conv) : "—"), (r) => r.conv),
          colNum("R/O CAS", (r) => (r.roCas != null ? <span className={cx(r.roCas >= 1 ? "text-emerald" : r.roCas >= 0.7 ? "text-gold" : "text-clay")}>{pct(r.roCas)}</span> : "—"), (r) => r.roCas ?? -1),
        ]} rows={rows} />
      </Card>
      <Tip>Vue par commercial <b>sans marge</b> (la rentabilité par AM reste dans « Rentabilité »). Le <b>facturé</b> est rattaché au commercial via la clé N° FP de ses commandes. Le <b>R/O</b> compare le CAS de l'exercice à l'objectif CAS « commercial » de l'année.</Tip>
    </div>
  );
};

// Module OPPORTUNITÉS : top pondéré + liste détaillée + saisie.
const DEFAULT_PROBA: Record<number, number> = { 1: 0.1, 2: 0.25, 3: 0.4, 4: 0.6, 5: 0.8, 8: 0.05 };
const EMPTY_OPP = { id: "", client: "", am: "", bu: "ICT", fp: "", amount: "", stage: "1", probability: "", closingDate: "", mbPrev: "", dr: "non", nextStep: "", nextStepDate: "", lostReason: "", patch: false };

// « Mon pipeline » : rapprochement SOUPLE entre l'AM stocké (import : MAJ / nom de famille) et l'identité
// connectée (displayName : nom complet). Égalité stricte échouait en silence (cf. audit). On matche sur
// inclusion OU token commun ≥ 3 car. (le nom de famille), insensible à la casse/aux accents.
const _normAm = (s: string) => (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
const amMatch = (a: string, b: string) => {
  const na = _normAm(a), nb = _normAm(b);
  if (!na || !nb) return false;
  if (na === nb || na.includes(nb) || nb.includes(na)) return true;
  const ta = new Set(na.split(/\s+/).filter((t) => t.length >= 3));
  return nb.split(/\s+/).some((t) => t.length >= 3 && ta.has(t));
};

// Auto-perte par âge — MIROIR de domain/oppLifecycle.js (règle source LIVE : Âge ≥ 366 j ET IdC ≤ 90 %
// ⇒ perdue). Utilisé pour exclure les opps périmées des vues pipeline, en cohérence avec les agrégats
// (qui les excluent aussi). Âge inconnu → jamais exclue. Garder les deux implémentations synchronisées.
const isAgedLost = (o: Opportunity): boolean => {
  if ((o.source || "") !== "salesData") return false; // MIROIR EXACT du back : ne vise QUE la source LIVE
  const stage = Number(o.stage) || 0;
  if (stage < 1 || stage > 5) return false;
  const age = Number(o.ageDays);
  if (!Number.isFinite(age) || age < 366) return false;
  return Number(o.probability) <= 0.9;
};

// Import / export EN MASSE des opportunités (Lot 9). Export = modèle round-trip .xlsx (toutes les opps) ;
// on l'édite hors-ligne (ex. combler les motifs de perte), puis on le ré-importe. Ré-import en DEUX temps
// comme le dédoublonnage : Analyser (aperçu dry-run, n'écrit rien) → Appliquer. Rapprochement Opp ID → N° FP →
// création `saisie` ; seuls les champs RENSEIGNÉS sont mis à jour (jamais l'identité, jamais d'effacement).
const errText = (e: any) => String(e?.message || e?.code || "").replace(/^functions\//, "");
function OppBulkExcel() {
  const toast = useToast();
  const [busyExport, setBusyExport] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<OppImportResult | null>(null);
  const [phase, setPhase] = useState<"" | "analyse" | "apply">("");

  const doExport = async () => {
    setBusyExport(true);
    try {
      const r = await exportOpportunities();
      downloadBase64(r.filename, r.fileB64);
      toast(`Export de ${r.count.toLocaleString("fr-FR")} opportunité(s)`, "ok");
    } catch (e: any) { toast(`Export refusé — ${errText(e)}`, "err"); }
    finally { setBusyExport(false); }
  };
  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; e.target.value = ""; // autorise le ré-import du même fichier
    if (!f) return;
    setFile(f); setPhase("analyse"); setPreview(null);
    try { setPreview(await importOpportunities(f, false)); }
    catch (e: any) { toast(`Analyse refusée — ${errText(e)}`, "err"); setFile(null); }
    finally { setPhase(""); }
  };
  const doApply = async () => {
    if (!file) return;
    setPhase("apply");
    try {
      const r = await importOpportunities(file, true);
      toast(`Appliqué : ${r.updated} mise(s) à jour · ${r.created} création(s)${r.skipped ? ` · ${r.skipped} inchangée(s)` : ""}`, "ok");
      setPreview(null); setFile(null);
    } catch (e: any) { toast(`Application refusée — ${errText(e)}`, "err"); }
    finally { setPhase(""); }
  };
  const close = () => { if (phase !== "apply") { setPreview(null); setFile(null); } };

  const p = preview;
  return (
    <Card title="Import / mise à jour en masse (Excel)">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-[12.5px] text-muted">
          Exportez le modèle, complétez-le hors-ligne (motifs de perte, étape, montant, IdC, prochaine action…),
          puis ré-importez : rapprochement par <b>Opp ID</b> puis <b>N° FP</b>, mise à jour des seuls champs renseignés,
          création des lignes nouvelles. <b>Aperçu avant application.</b>
        </p>
        <div className="flex items-center gap-2 shrink-0">
          <button onClick={doExport} disabled={busyExport} className="btn-ghost !px-3 !py-1.5 text-sm">
            {busyExport ? "Export…" : "Exporter le modèle"}
          </button>
          <label className={cx("btn-gold !px-3 !py-1.5 text-sm cursor-pointer", phase === "analyse" && "opacity-60 pointer-events-none")}>
            {phase === "analyse" ? "Analyse…" : "Importer / mettre à jour"}
            <input type="file" accept=".xlsx,.xls,.csv" className="sr-only" onChange={onFile} disabled={phase !== ""} aria-label="Choisir le fichier Excel des opportunités à importer" />
          </label>
        </div>
      </div>

      <Modal open={!!p} onClose={close} size="md" title="Aperçu de l'import — opportunités"
        actions={
          <>
            <button onClick={close} disabled={phase === "apply"} className="btn-ghost !px-3 !py-1.5 text-sm">Annuler</button>
            <button onClick={doApply} disabled={phase === "apply" || !p || (p.updated + p.created === 0)} className="btn-gold !px-3 !py-1.5 text-sm">
              {phase === "apply" ? "Application…" : `Appliquer ${p?.updated ?? 0} maj / ${p?.created ?? 0} créations`}
            </button>
          </>
        }>
        {p && (
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded-lg border border-line bg-panel2/40 py-2"><div className="font-display text-xl tabnum text-gold">{p.updated}</div><div className="text-[11px] text-muted">mise(s) à jour</div></div>
              <div className="rounded-lg border border-line bg-panel2/40 py-2"><div className="font-display text-xl tabnum text-emerald">{p.created}</div><div className="text-[11px] text-muted">création(s)</div></div>
              <div className="rounded-lg border border-line bg-panel2/40 py-2"><div className="font-display text-xl tabnum text-faint">{p.skipped}</div><div className="text-[11px] text-muted">inchangée(s)</div></div>
            </div>
            {(p.updated + p.created === 0) && <div className="text-[12px] text-clay">Aucune modification détectée — le fichier est identique aux données actuelles.</div>}
            {!!p.samples?.update.length && (
              <details open className="text-[12px]">
                <summary className="cursor-pointer select-none text-muted hover:text-ink">Mises à jour (aperçu {Math.min(p.samples.update.length, 50)}{p.updated > 50 ? ` / ${p.updated}` : ""})</summary>
                <ul className="mt-1.5 flex flex-col gap-1 max-h-52 overflow-auto">
                  {p.samples.update.map((s) => (
                    <li key={`u${s.line}`} className="flex items-center gap-2 text-muted">
                      <span className="text-faint tabnum w-10 shrink-0">L{s.line}</span>
                      <span className="truncate text-ink">{s.client || s.id}</span>
                      <span className="text-faint truncate">· {(s.changed || []).join(", ")}{s.matchBy === "fp" ? " · via FP" : ""}</span>
                    </li>
                  ))}
                </ul>
              </details>
            )}
            {!!p.samples?.create.length && (
              <details className="text-[12px]">
                <summary className="cursor-pointer select-none text-muted hover:text-ink">Créations (aperçu {Math.min(p.samples.create.length, 50)}{p.created > 50 ? ` / ${p.created}` : ""})</summary>
                <ul className="mt-1.5 flex flex-col gap-1 max-h-52 overflow-auto">
                  {p.samples.create.map((s) => (
                    <li key={`c${s.line}`} className="flex items-center gap-2 text-muted">
                      <span className="text-faint tabnum w-10 shrink-0">L{s.line}</span>
                      <span className="truncate text-ink">{s.client}</span>
                      {s.fp && <span className="text-faint">· {s.fp}</span>}
                    </li>
                  ))}
                </ul>
              </details>
            )}
            {!!p.samples?.skip.length && (
              <details className="text-[12px]">
                <summary className="cursor-pointer select-none text-faint hover:text-ink">Lignes inchangées / ignorées (aperçu {Math.min(p.samples.skip.length, 50)})</summary>
                <ul className="mt-1.5 flex flex-col gap-1 max-h-40 overflow-auto">
                  {p.samples.skip.map((s) => (
                    <li key={`s${s.line}`} className="flex items-center gap-2 text-faint">
                      <span className="tabnum w-10 shrink-0">L{s.line}</span>
                      <span className="truncate">{s.reason}</span>
                    </li>
                  ))}
                </ul>
              </details>
            )}
            <div className="text-[11px] text-faint">Rapprochement Opp ID → N° FP → création (source « saisie »). L'identité (Opp ID, N° FP) et les champs laissés vides ne sont jamais modifiés. Action tracée + recalcul des agrégats.</div>
          </div>
        )}
      </Modal>
    </Card>
  );
}

export const OppList: FC<Props> = () => {
  const { rows: allRows, loading } = useCollectionData<Opportunity>("opportunities");
  const { match } = useFilters();
  const canWrite = useCan("pipeline") === "write";
  const canImport = useCanImport();
  const { intent } = useNav();
  const { user } = useClaims(); // identité de l'utilisateur connecté → pré-remplit l'AM d'une nouvelle opp + « Mon pipeline »
  const meAm = (user?.displayName || user?.email || "").trim();
  const [mine, setMine] = useState(false); // « Mes opportunités » : filtre owner = utilisateur connecté (client-side)
  // « Mon pipeline » : match souple sur l'AM (insensible à la casse/espaces). Filtre transverse appliqué ensuite.
  // Les opps FANTÔMES (stale : retirées de LIVE, cf. audit intégral I2) sont exclues de la vue pipeline
  // pour rester cohérent avec les KPI/agrégats (qui les excluent) ; elles sont signalées en Qualité des données.
  const rows = allRows.filter((r) => !r.stale && !isAgedLost(r) && match(r, ["bu", "am", "client"]) && (!mine || amMatch(r.am || "", meAm)));
  // Flag « intégré au P&L » : FP des commandes (vue matérialisée). Le hook DOIT rester au-dessus
  // de tout retour anticipé (skeleton), sinon le nombre de hooks varie entre rendus → React #310.
  const { rows: cmd } = useCommandesRows();
  const [f, setF] = useState({ ...EMPTY_OPP });
  const [open, setOpen] = useState(false); // saisie/édition d'opportunité en MODALE
  // Filtre STATUT (étape du pipeline) local à la liste — complète le filtre transverse (BU/AM/client)
  // et la recherche. Actives = étapes 1..5 (en cours), puis Gagnées/Perdues/Suspendues/Annulées.
  const [seg, setSeg] = useState<"all" | "active" | "won" | "lost" | "susp" | "cxl">("all");
  const bus = useBusinessUnits(); // référentiel BU (Admin) pour le sélecteur de saisie d'opportunité
  const prefill = (o: Opportunity, patch: boolean) => { setF({
    id: o.oppId || o.id || "", client: o.client || "", am: o.am || "", bu: o.bu || "AUTRE", fp: o.fp || "",
    amount: String(o.amount ?? ""), stage: String(o.stage ?? "1"), probability: String(o.probability ?? ""), closingDate: o.closingDate || "",
    mbPrev: o.mbPrev != null ? String(o.mbPrev) : "", dr: o.dr ? "oui" : "non",
    nextStep: o.nextStep || "", nextStepDate: o.nextStepDate || "", lostReason: o.lostReason || "", patch,
  }); setOpen(true); };
  const editOpp = (o: Opportunity) => prefill(o, false); // opp SAISIE → édition complète (upsert)
  const fixOpp = (o: Opportunity) => prefill(o, true);   // opp IMPORTÉE → correction (patch, source conservée)
  // Nouvelle opportunité : AM pré-rempli avec l'identité connectée (éditable), reste vierge.
  const openNew = () => { setF({ ...EMPTY_OPP, am: meAm }); setOpen(true); };
  // Changer d'étape pré-remplit la proba par défaut de l'étape si elle est vide (évite un pondéré à 0).
  const setStage = (s: string) => setF((prev) => ({ ...prev, stage: s, probability: prev.probability || String(DEFAULT_PROBA[Number(s)] ?? "") }));
  if (loading && !allRows.length) return <CardSkeleton />;
  const top = [...rows].sort((a, b) => (b.weighted || 0) - (a.weighted || 0)).slice(0, 10);
  // Certitudes = opportunités ACTIVES (étapes 1..5) quasi-certaines (IdC ≥ 90 %), pas encore signées.
  const certitudes = rows
    .filter((o) => (o.stage || 0) >= 1 && (o.stage || 0) <= 5 && (o.probability || 0) >= 0.9)
    .sort((a, b) => (b.weighted || 0) - (a.weighted || 0));
  const certTotal = certitudes.reduce((s, o) => s + (o.weighted || 0), 0);
  const today = new Date().toISOString().slice(0, 10);
  // Prochaines actions commerciales échéancées (opps ACTIVES avec date d'action), triées par échéance.
  const actions = rows.filter((o) => o.nextStepDate && (o.stage || 0) >= 1 && (o.stage || 0) <= 5)
    .sort((a, b) => (a.nextStepDate || "").localeCompare(b.nextStepDate || ""));
  // Motifs de perte (opps PERDUES, étape 7) regroupés — analytique win/loss.
  const lostByReason = (() => {
    const m = new Map<string, { count: number; amount: number }>();
    rows.filter((o) => o.stage === 7).forEach((o) => {
      const k = (o.lostReason || "").trim() || "(non renseigné)";
      const e = m.get(k) || { count: 0, amount: 0 };
      e.count++; e.amount += (o.amount || 0); m.set(k, e);
    });
    return [...m.entries()].map(([reason, v]) => ({ reason, ...v })).sort((a, b) => b.amount - a.amount);
  })();
  // Flag « intégré au P&L » : une opp dont le N° FP porte déjà une commande (au carnet). Les FP des
  // commandes viennent de la vue matérialisée (chargée plus haut — accès overview, sinon flag masqué).
  const bookedFps = new Set((cmd || []).map((c) => c.fp).filter(Boolean) as string[]);
  const isBooked = (o: Opportunity) => !!(o.fp && (bookedFps.has(o.fp) || bookedFps.has(fpDocId(o.fp))));
  const pnlFlag = (o: Opportunity): ReactNode =>
    isBooked(o) ? <Badge tone="emerald">au P&L</Badge>
      : o.stage === 6 && o.fp ? <Badge tone="clay">hors P&L</Badge> // gagnée mais pas encore inscrite
        : <span className="text-faint">—</span>;
  // Buckets de statut par étape (1..5 actives, 6 gagnée, 7 perdue, 8 suspendue, 9 annulée).
  const segOf = (s: number) => (s >= 1 && s <= 5 ? "active" : s === 6 ? "won" : s === 7 ? "lost" : s === 8 ? "susp" : s === 9 ? "cxl" : "active");
  const segCount = (k: string) => rows.filter((o) => segOf(o.stage || 0) === k).length;
  const shownOpps = seg === "all" ? rows : rows.filter((o) => segOf(o.stage || 0) === seg);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <FilterNote dims="BU / AM / client" />
        <div className="flex items-center gap-2 shrink-0">
          {meAm && <button onClick={() => setMine((m) => !m)} className={cx("btn-ghost !px-3 !py-1.5 text-sm", mine && "!text-gold !border-gold/50")} title="Filtrer sur mes opportunités (AM = moi)">{mine ? "Mon pipeline ✓" : "Mon pipeline"}</button>}
          {canWrite && <button onClick={openNew} className="btn-gold !px-3 !py-1.5 text-sm">+ Ajouter une opportunité</button>}
        </div>
      </div>
      {mine && !rows.length && (
        <div className="rounded-lg border border-gold/40 bg-gold/5 px-3 py-2 text-[12.5px] text-muted">
          Aucune opportunité ne correspond à votre nom d'AM (« <b className="text-ink">{meAm}</b> »). Vérifiez l'orthographe côté import (souvent en majuscules / nom de famille), ou désactivez <b>Mon pipeline</b>.
        </div>
      )}
      {canWrite && (
        <Modal open={open} onClose={() => setOpen(false)} size="md"
          title={f.patch ? "Actualiser l'opportunité importée" : f.id ? "Modifier l'opportunité (saisie)" : "Ajouter une opportunité (saisie)"}
          actions={
            <>
              <button onClick={() => setOpen(false)} className="btn-ghost !px-3 !py-1.5 text-sm">Annuler</button>
              <Busy label={f.patch ? "Actualiser" : f.id ? "Enregistrer" : "Ajouter"} okMsg="Opportunité enregistrée"
                fn={async () => {
                  if (f.patch) {
                    await patchOpportunity({ id: f.id, fp: f.fp.trim() || undefined, closingDate: f.closingDate || null, amount: Number(f.amount) || 0, stage: Number(f.stage), am: f.am, bu: f.bu, probability: f.probability !== "" ? Number(f.probability) : undefined, nextStep: f.nextStep, nextStepDate: f.nextStepDate || null, lostReason: f.lostReason });
                  } else {
                    await upsertOpportunity({ id: f.id || undefined, client: f.client, am: f.am, bu: f.bu, fp: f.fp || undefined, amount: Number(f.amount) || 0, stage: Number(f.stage), probability: Number(f.probability) || 0, closingDate: f.closingDate || undefined, mbPrev: f.mbPrev !== "" ? Number(f.mbPrev) : undefined, dr: f.dr === "oui", nextStep: f.nextStep, nextStepDate: f.nextStepDate || null, lostReason: f.lostReason });
                  }
                  setOpen(false); setF({ ...EMPTY_OPP });
                }} />
            </>
          }>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            {/* En correction d'opp importée, le client vient de la source (non modifiable) ; on l'affiche en lecture. */}
            <label className="flex flex-col gap-1 text-[11px] text-muted">Client
              <input data-autofocus className="field" aria-label="Client" placeholder="Client" value={f.client} disabled={f.patch} onChange={(e) => setF({ ...f, client: e.target.value })} /></label>
            <label className="flex flex-col gap-1 text-[11px] text-muted">Account Manager
              <input className="field" aria-label="Account Manager" placeholder="AM" value={f.am} onChange={(e) => setF({ ...f, am: e.target.value })} /></label>
            <label className="flex flex-col gap-1 text-[11px] text-muted">N° FP
              <input className="field" aria-label="N° FP" placeholder="N° FP (FP/2026/…)" value={f.fp} onChange={(e) => setF({ ...f, fp: e.target.value })} /></label>
            <label className="flex flex-col gap-1 text-[11px] text-muted">Business Unit
              <Select ariaLabel="Business Unit" value={f.bu} onChange={(v) => setF({ ...f, bu: v })} options={bus.map((b) => ({ value: b, label: b }))} /></label>
            <label className="flex flex-col gap-1 text-[11px] text-muted">Montant
              <input className="field" aria-label="Montant" placeholder="Montant" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></label>
            <label className="flex flex-col gap-1 text-[11px] text-muted">Étape
              <Select ariaLabel="Étape du pipeline" value={f.stage} onChange={setStage} options={[1, 2, 3, 4, 5, 6, 7, 8, 9].map((s) => ({ value: String(s), label: `${s} · ${STAGE_SHORT[s]}` }))} /></label>
            {/* Proba = IdC : éditable aussi en correction (la projection pondère par palier d'IdC). */}
            <label className="flex flex-col gap-1 text-[11px] text-muted">Probabilité (0 à 1)
              <input className="field" aria-label="Probabilité (0 à 1)" placeholder="Proba 0..1" value={f.probability} onChange={(e) => setF({ ...f, probability: e.target.value })} /></label>
            {/* MB prévisionnel : % de marge brute PRÉVISIONNELLE (prévision commerciale, non confidentielle). */}
            <label className="flex flex-col gap-1 text-[11px] text-muted">MB prévisionnel (%)
              <input className="field" aria-label="MB prévisionnel en pourcentage" placeholder="MB prév. %" value={f.mbPrev} onChange={(e) => setF({ ...f, mbPrev: e.target.value })} /></label>
            {/* DR (Deal Registration / demande de remise) — Oui / Non. */}
            <label className="flex flex-col gap-1 text-[11px] text-muted">DR
              <Select ariaLabel="DR (Oui / Non)" value={f.dr} onChange={(v) => setF({ ...f, dr: v })} options={[{ value: "non", label: "Non" }, { value: "oui", label: "Oui" }]} /></label>
            <label className="flex flex-col gap-1 text-[11px] text-muted">D Prev
              <DateField ariaLabel="Date de clôture prévue" value={f.closingDate} onChange={(v) => setF({ ...f, closingDate: v })} placeholder="D Prev" /></label>
            {/* Suivi commercial (Lot B) : prochaine action + échéance (date maîtrisée → relances honnêtes). */}
            <label className="flex flex-col gap-1 text-[11px] text-muted sm:col-span-2">Prochaine action
              <input className="field" aria-label="Prochaine action commerciale" placeholder="Ex. relancer DAF, envoyer proposition…" value={f.nextStep} onChange={(e) => setF({ ...f, nextStep: e.target.value })} /></label>
            <label className="flex flex-col gap-1 text-[11px] text-muted">Échéance action
              <DateField ariaLabel="Échéance de la prochaine action" value={f.nextStepDate} onChange={(v) => setF({ ...f, nextStepDate: v })} placeholder="jj/mm/aaaa" /></label>
            {/* Motif de perte : pertinent uniquement pour une opp Perdue (étape 7) → analytique win/loss. */}
            {Number(f.stage) === 7 && (
              <label className="flex flex-col gap-1 text-[11px] text-muted">Motif de perte
                <input className="field" aria-label="Motif de perte" placeholder="Ex. prix, délai, concurrent…" value={f.lostReason} onChange={(e) => setF({ ...f, lostReason: e.target.value })} /></label>
            )}
          </div>
          {Number(f.stage) === 6 && !f.fp.trim() && <div className="text-[11px] text-clay mt-2">Une opportunité gagnée sans N° FP ne pourra pas devenir commande (CAS/backlog).</div>}
        </Modal>
      )}
      {actions.length > 0 && (
        <Card title={`Prochaines actions commerciales · ${actions.length}`}>
          <Table columns={[
            colText("Échéance", (o) => { const late = (o.nextStepDate || "") < today; return <span className={late ? "text-clay" : "text-ink"}>{o.nextStepDate}{late ? " · retard" : ""}</span>; }, (o) => o.nextStepDate || ""),
            colText("Client", (o) => o.client, (o) => o.client),
            colText("Action", (o) => o.nextStep || "—"),
            colText("Étape", (o) => o.stageLabel || o.stage, (o) => o.stage),
            colText("AM", (o) => o.am, (o) => o.am),
            ...(canWrite ? [colText("", (o: Opportunity) => <button onClick={() => (o.source === "saisie" ? editOpp(o) : fixOpp(o))} className="text-gold hover:underline text-xs">Éditer</button>)] : []),
          ]} rows={actions.slice(0, 25)} />
          <Tip>Actions commerciales datées à mener sur les opportunités actives. Les <b className="text-clay">en retard</b> (échéance dépassée) sont prioritaires. Renseignées via la fiche opportunité (« Prochaine action » + échéance).</Tip>
        </Card>
      )}
      {lostByReason.length > 0 && (
        <Card title={`Motifs de perte · ${lostByReason.reduce((s, r) => s + r.count, 0)} opp. perdue(s)`}>
          <Table columns={[
            colText("Motif", (r) => r.reason, (r) => r.reason),
            colNum("Opp.", (r) => r.count, (r) => r.count),
            colNum("Montant perdu", (r) => money(r.amount), (r) => r.amount),
          ]} rows={lostByReason} />
          <Tip>Analyse win/loss : volumes et montants perdus par motif (saisi au passage en « Perdu »). Éclaire les corrections de prix / délai / positionnement concurrentiel.</Tip>
        </Card>
      )}
      <Card title={`Certitudes (IdC ≥ 90 %) · ${certitudes.length} opp. · ${fmt(certTotal)} pondéré`}>
        {certitudes.length ? (
          <Table columns={[
            colText("Client", (o) => o.client, (o) => o.client),
            colText("Désignation", (o) => o.designation || "—", (o) => o.designation || ""),
            colText("AM", (o) => o.am, (o) => o.am),
            colText("BU", (o) => buBadge(o.bu), (o) => o.bu), colNum("Montant", (o) => money(o.amount), (o) => o.amount),
            colNum("Proba", (o) => pct(o.probability), (o) => o.probability),
            colNum("Pondéré", (o) => money(o.weighted), (o) => o.weighted),
            colText("Closing (D Prev)", (o) => o.closingDate || "—", (o) => o.closingDate || ""),
            colText("P&L", (o: Opportunity) => pnlFlag(o), () => 0),
          ]} rows={certitudes} />
        ) : <EmptyState label="Aucune opportunité IdC ≥ 90 %." />}
      </Card>
      <Card title="Top opportunités (pondéré)">
        <Table columns={[
          colText("Client", (o) => o.client), colText("Désignation", (o) => o.designation || "—"), colText("AM", (o) => o.am),
          colNum("Montant", (o) => money(o.amount)), colNum("Pondéré", (o) => money(o.weighted)),
          colText("P&L", (o: Opportunity) => pnlFlag(o)),
        ]} rows={top} empty="Aucune opportunité." />
      </Card>
      {canWrite && <OppBulkExcel />}
      <Card title={`Toutes les opportunités · ${shownOpps.length.toLocaleString("fr-FR")}`} actions={
        <div className="flex items-center gap-2 flex-wrap justify-end">
          <Segmented value={seg} onChange={setSeg} ariaLabel="Filtrer par statut d'opportunité" options={[
            { value: "all", label: "Toutes", count: rows.length },
            { value: "active", label: "Actives", count: segCount("active") },
            { value: "won", label: "Gagnées", count: segCount("won") },
            { value: "lost", label: "Perdues", count: segCount("lost") },
            { value: "susp", label: "Suspendues", count: segCount("susp") },
            { value: "cxl", label: "Annulées", count: segCount("cxl") },
          ]} />
          {canImport && <ImportButton label="Importer (LIVE / Sales)" />}
        </div>}>
        <ListView
          rows={shownOpps}
          colsKey="opps"
          initialSearch={intent?.search}
          searchKeys={[(r) => r.client, (r) => r.designation || "", (r) => r.am, (r) => r.fp, (r) => r.stageLabel]}
          columns={[
            colText("FP", (r) => <FpLink fp={r.fp} />, (r) => r.fp || ""),
            colText("Client", (r) => r.client, (r) => r.client),
            colText("Désignation", (r) => r.designation || "—", (r) => r.designation || ""),
            colText("AM", (r) => r.am, (r) => r.am),
            colText("BU", (r) => buBadge(r.bu), (r) => r.bu),
            colNum("Montant", (r) => money(r.amount), (r) => r.amount),
            colText("Étape", (r) => r.stageLabel || r.stage, (r) => r.stage),
            colNum("Proba", (r) => pct(r.probability), (r) => r.probability),
            colNum("Pondéré", (r) => money(r.weighted), (r) => r.weighted),
            // MB prévisionnel (%) + DR — saisis dans la fiche, désormais RÉAFFICHÉS (cf. audit : champs write-only).
            colNum("MB prév.", (r: Opportunity) => (r.mbPrev != null ? `${r.mbPrev} %` : "—"), (r: Opportunity) => (r.mbPrev ?? -1)),
            colText("DR", (r: Opportunity) => (r.dr ? <Badge tone="steel">Oui</Badge> : <span className="text-faint">—</span>), (r: Opportunity) => (r.dr ? 1 : 0)),
            colText("Closing", (r) => r.closingDate || "—", (r) => r.closingDate || ""),
            colText("P&L", (r: Opportunity) => pnlFlag(r), (r: Opportunity) => (isBooked(r) ? 2 : r.stage === 6 ? 1 : 0)),
            ...(canWrite ? [colText("", (r: Opportunity) => (r.source === "saisie" ? (
              <span className="inline-flex gap-2">
                <button onClick={() => editOpp(r)} className="text-gold hover:underline text-xs">Éditer</button>
                {/* DangerBtn (confirmation) comme la suppression d'opp importée — parité + anti-mis-clic (cf. audit). */}
                <DangerBtn label="Suppr." confirm={`Supprimer définitivement l'opportunité saisie ${r.client || r.fp || r.oppId || r.id} ? Action tracée (auditLog), non annulable.`} fn={() => deleteOpportunity(r.oppId || r.id || "")} />
              </span>
            ) : (
              <span className="inline-flex gap-2 items-center">
                <button onClick={() => fixOpp(r)} className="text-gold hover:underline text-xs" title="Actualiser N° FP / D Prev / montant / étape (opp importée)">Actualiser</button>
                <DangerBtn label="Suppr." confirm={`Supprimer l'opportunité importée ${r.client || r.fp || r.oppId || r.id} ? Un futur import delta ne la recréera que si la source la contient encore.`} fn={() => deleteRecord("opportunities", r.oppId || r.id || "")} />
              </span>
            )))] : []),
          ]}
        />
      </Card>
    </div>
  );
};

// ── COCKPIT COMMERCIAL : cockpit de pilotage (KPI de tête + échelle de prévision Commit/Best/Pipeline
// + top commerciaux + funnel), chaque tuile renvoyant vers la vue de détail. 100 % agrégats existants,
// aucun back. Sans marge (cloisonnement « rentabilité »).
export const CommercialCockpit: FC<Props> = ({ period }) => {
  const { data } = useDocData<PipelineSummary>(`summaries/pipeline_${period}`);
  const { data: ov } = useDocData<OverviewSummary>(`summaries/overview_${period}`);
  const { data: ams } = useDocData<AmsSummary>("summaries/ams");
  const { data: cfg } = useDocData<PeriodsConfig>("config/periods");
  const { data: att } = useDocData<AtterrissageSummary>(cfg?.currentFy ? `summaries/atterrissage_${cfg.currentFy}` : null);
  const { data: pfy } = useDocData<PipelineSummary>(cfg?.currentFy ? `summaries/pipeline_${cfg.currentFy}` : null);
  const { go, canGo } = useNav();
  if (!data) return <EmptyState label="Cockpit indisponible — importer le pipeline puis recalculer (Vue d'ensemble)." />;
  const tiers = data.tierBreakdown || [];
  const tierPond = (k: string) => tiers.find((t) => t.key === k && t.active)?.pond || 0;
  const commit = tierPond("certitudes");
  const best = commit + tierPond("forecast");
  const pipe = data.tot?.weighted || 0; // Σ niveaux ACTIFS (échelle cumulée)
  const objectif = att?.objectif || 0;
  const gap = Math.max(objectif - (att?.realiseCas || 0), 0);
  const coverage = objectif > 0 && gap > 0 ? (pfy?.tot?.weighted || 0) / gap : null;
  const topAm = [...(ams?.rows || [])].sort((a, b) => b.pipelinePondere - a.pipelinePondere).slice(0, 5);
  const funnel = buildStageFunnel(data.byStage);
  // Pipeline COMPLET NON PONDÉRÉ : somme des montants BRUTS de toutes les phases actives (1→5) — le
  // pendant « brut » du Pondéré projeté (montants réels, sans pondération par l'IdC). = Σ des barres
  // « Brut » du funnel.
  const brutPhases = [1, 2, 3, 4, 5].reduce((s, st) => s + (data.byStage?.[st]?.amount || 0), 0);
  const jump = (id: string) => { if (canGo(id)) go(id); };
  const ladder = [
    { label: "Commit", band: "Certitudes ≥ 90 %", v: commit, color: T.emerald },
    { label: "Best-case", band: "+ Forecast", v: best, color: T.gold },
    { label: "Pipeline", band: "+ Pipe", v: pipe, color: T.steel },
  ];
  const maxLadder = Math.max(pipe, objectif, 1);
  return (
    <div className="flex flex-col gap-4">
      <div className={grid4}>
        <button onClick={() => jump("pipeline")} className="text-left w-full"><Kpi label="Pondéré projeté" value={fmt(pipe)} tone="gold" sub={`${data.tot?.countConf ?? 0} opp. · voir Pipeline`} /></button>
        <button onClick={() => jump("opplist")} className="text-left w-full"><Kpi label="Pipeline brut (non pondéré)" value={fmt(brutPhases)} tone="steel" sub="toutes phases 1→5 · voir la liste" /></button>
        <button onClick={() => jump("pipeline")} className="text-left w-full"><Kpi label="Conversion vente" value={pct(ov?.ratios?.tauxConversionVente)} sub={`gagné ${data.wonCount ?? 0}/${(data.wonCount || 0) + (data.lostCount || 0)}`} /></button>
        <Kpi label="Couverture reste-à-faire" value={coverage != null ? `${coverage.toFixed(2)}×` : objectif > 0 ? "atteint" : "—"} tone={coverage == null ? (objectif > 0 ? "emerald" : "steel") : coverage >= 1 ? "emerald" : "clay"} sub="pondéré / (objectif − réalisé)" />
        <button onClick={() => jump("opplist")} className="text-left w-full"><Kpi label="En retard de closing" value={fmt(data.closing?.staleBrut)} tone="clay" sub={`${data.closing?.staleCount ?? 0} opp. · à requalifier`} /></button>
      </div>
      <Card title="Prévision — Commit / Best-case / Pipeline">
        <div className="flex flex-col gap-2.5">
          {ladder.map((l) => (
            <div key={l.label} className="flex items-center gap-3">
              <div className="w-28 shrink-0"><span className="text-[12px] font-semibold text-ink">{l.label}</span><div className="text-[10px] text-faint">{l.band}</div></div>
              <div className="flex-1 h-5 rounded bg-panel2 overflow-hidden"><div className="h-full rounded transition-[width]" style={{ width: `${Math.min(100, (l.v / maxLadder) * 100)}%`, background: l.color }} /></div>
              <div className="w-28 text-right font-display tabnum text-[13px]">{fmt(l.v)}</div>
            </div>
          ))}
          {objectif > 0 && (
            <div className="flex items-center gap-3 pt-1.5 border-t border-line/60">
              <div className="w-28 shrink-0 text-[12px] text-muted">Objectif CAS</div>
              <div className="flex-1 text-[11px] text-faint">écart {fmt(att?.ecart || 0)} · réalisé {fmt(att?.realiseCas)}</div>
              <div className="w-28 text-right font-display tabnum text-[13px] text-gold">{fmt(objectif)}</div>
            </div>
          )}
        </div>
        <Tip>Échelle <b>cumulée</b> de prévision : <b>Commit</b> = quasi-certain (≥ 90 %) · <b>Best-case</b> ajoute le Forecast · <b>Pipeline</b> ajoute le Pipe. Confrontée à l'objectif CAS de l'exercice. Poids/paliers réglés dans Habilitations.</Tip>
      </Card>
      <div className={cols2}>
        <Card title="Top commerciaux (pipeline pondéré)" actions={canGo("am360") ? <button onClick={() => jump("am360")} className="text-gold text-xs underline">AM 360°</button> : undefined}>
          {topAm.length ? <Table columns={[
            colText("AM", (r) => r.am, (r) => r.am),
            colNum("Pondéré", (r) => money(r.pipelinePondere), (r) => r.pipelinePondere),
            colNum("Actif", (r) => r.activeCount, (r) => r.activeCount),
            colNum("Transfo.", (r) => (r.won + r.lost > 0 ? pct(r.conv) : "—"), (r) => r.conv),
            colNum("R/O", (r) => (r.roCas != null ? pct(r.roCas) : "—"), (r) => r.roCas ?? -1),
          ]} rows={topAm} /> : <EmptyState label="Aucun commercial renseigné." />}
        </Card>
        <Card title="Funnel pondéré par étape" actions={canGo("pipeline") ? <button onClick={() => jump("pipeline")} className="text-gold text-xs underline">Analyse</button> : undefined}>
          <GroupedBars data={funnel} series={[{ key: "Brut", color: T.steel, name: "Brut" }, { key: "Pondéré", color: T.gold, name: "Pondéré" }]} h={200} size={22} interval={0} />
        </Card>
      </div>
      <Tip>Cockpit de pilotage commercial — pondéré, prévision, conversion, couverture, top AM. Chaque tuile ouvre la vue détaillée. Rafraîchi à chaque recalcul.</Tip>
    </div>
  );
};

// ── BOARD KANBAN : colonnes par étape (1→5 actives), changement d'étape RAPIDE (patchOpportunity),
// cartes en retard (D Prev dépassée) flaggées. Lit la collection opportunities en direct. Filtrable.
const BOARD_STAGES = [1, 2, 3, 4, 5];
const BOARD_PAGE = 30; // cartes affichées par colonne avant « Voir plus » (une colonne peut porter des centaines d'opps)

// Colonne du board : PAGINÉE par révélation incrémentale (« Voir plus ») — sans quoi une étape à
// plusieurs centaines d'opps (ex. Qualification) rendait autant de cartes d'un coup (coût + illisibilité).
// L'en-tête garde le compte RÉEL (total colonne) ; le pas revient à BOARD_PAGE quand le filtre change.
function BoardColumn({ stage, col, canWrite, movingId, move, today }: {
  stage: number; col: Opportunity[]; canWrite: boolean; movingId: string | null;
  move: (o: Opportunity, v: string) => void; today: string;
}) {
  const [shown, setShown] = useState(BOARD_PAGE);
  useEffect(() => { setShown(BOARD_PAGE); }, [col.length]); // filtre appliqué (taille de colonne change) → repart au 1er lot
  const tot = col.reduce((sum, r) => sum + (r.weighted || 0), 0);
  const rest = col.length - shown;
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-line bg-panel2/40 p-2 min-h-[120px]">
      <div className="flex items-center justify-between px-1">
        <span className="text-[12px] font-semibold text-ink">{stage} · {STAGE_SHORT[stage]}</span>
        <span className="text-[11px] text-faint tabnum">{col.length} · {fmt(tot)}</span>
      </div>
      {col.slice(0, shown).map((o) => {
        const overdue = !!(o.closingDate && o.closingDate.slice(0, 10) < today);
        return (
          <div key={o.oppId || o.id} className={cx("rounded-lg border p-2 bg-panel", overdue ? "border-clay/40" : "border-line")}>
            <div className="text-[12px] font-semibold text-ink truncate" title={o.client || ""}>{o.client || "—"}</div>
            {o.designation && <div className="text-[11px] text-muted truncate" title={o.designation}>{o.designation}</div>}
            <div className="flex items-center gap-1.5 flex-wrap mt-1 text-[11px]">
              <span className="font-display tabnum text-ink">{fmt(o.amount)}</span>
              <span className="text-faint">· pond. {fmt(o.weighted)}</span>
              {o.am && <span className="text-faint truncate max-w-[90px]">· {o.am}</span>}
            </div>
            <div className="flex items-center justify-between gap-1.5 mt-1.5">
              <span className={cx("text-[10px]", overdue ? "text-clay" : "text-faint")}>{o.closingDate ? (overdue ? `retard · ${o.closingDate.slice(0, 10)}` : o.closingDate.slice(0, 10)) : "sans date"}</span>
              {canWrite && (
                <Select ariaLabel={`Changer l'étape de ${o.client || "l'opportunité"}`} className="!py-0.5 !px-1.5 text-[11px] w-[92px]" value={String(o.stage)} disabled={movingId === (o.oppId || o.id)}
                  onChange={(v) => move(o, v)} options={[1, 2, 3, 4, 5, 6, 7, 9].map((st) => ({ value: String(st), label: `${st}·${STAGE_SHORT[st]}` }))} />
              )}
            </div>
          </div>
        );
      })}
      {!col.length && <div className="text-[11px] text-faint px-1 py-3 text-center">—</div>}
      {rest > 0 && (
        <button onClick={() => setShown((n) => n + BOARD_PAGE)} className="mt-0.5 rounded-lg border border-line hover:border-gold/50 hover:bg-panel2 text-[11px] text-gold px-1 py-1.5 text-center transition-colors">
          Voir {Math.min(BOARD_PAGE, rest)} de plus <span className="text-faint">· {rest} restante{rest > 1 ? "s" : ""}</span>
        </button>
      )}
    </div>
  );
}

export const PipelineBoard: FC<Props> = () => {
  const { rows: allRows, loading } = useCollectionData<Opportunity>("opportunities");
  const { match } = useFilters();
  const canWrite = useCan("pipeline") === "write";
  const toast = useToast();
  const [movingId, setMovingId] = useState<string | null>(null); // carte en cours de changement d'étape (verrou in-flight)
  const today = new Date().toISOString().slice(0, 10);
  const move = async (o: Opportunity, v: string) => {
    const id = o.oppId || o.id || "";
    const to = Number(v);
    setMovingId(id); // désactive le select pendant l'appel → pas de double-changement (from périmé)
    try {
      await patchOpportunity({ id, stage: to });
      // Passage en Gagné (6) sans N° FP : la carte quitte le board ET ne deviendra jamais commande (CAS) →
      // on AVERTIT au lieu d'un succès muet (cf. audit ; parité avec l'avertissement de la fiche).
      if (to === 6 && !o.fp) toast("Gagnée sans N° FP — ne deviendra pas commande. Renseignez le FP dans Opportunités.", "err");
      else toast("Étape mise à jour", "ok");
    } catch { toast("Changement d'étape refusé", "err"); }
    finally { setMovingId(null); }
  };
  if (loading && !allRows.length) return <CardSkeleton />;
  // Exclut les opps FANTÔMES (stale : retirées de LIVE, cf. audit intégral I2) → le board reste cohérent
  // avec les KPI/agrégats (qui les excluent) ; elles sont signalées en Qualité des données.
  const rows = allRows.filter((r) => !r.stale && !isAgedLost(r) && match(r, ["bu", "am", "client"]) && (r.stage || 0) >= 1 && (r.stage || 0) <= 5);
  const byStage = (s: number) => rows.filter((r) => (r.stage || 0) === s).sort((a, b) => (b.weighted || 0) - (a.weighted || 0));
  return (
    <div className="flex flex-col gap-3">
      <FilterNote dims="BU / AM / client" />
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2.5">
        {BOARD_STAGES.map((s) => (
          <BoardColumn key={s} stage={s} col={byStage(s)} canWrite={canWrite} movingId={movingId} move={move} today={today} />
        ))}
      </div>
      <Tip>Pilotage visuel des deals actifs (étapes 1→5). Chaque colonne affiche les opportunités <b>les plus pondérées d'abord</b> ; « <b>Voir plus</b> » révèle la suite (le compte total reste affiché en tête). Changer l'étape d'une carte met à jour l'opportunité et relance le recalcul. Cartes en <b className="text-clay">retard</b> = D Prev dépassée (à requalifier). Filtrable par BU/AM/client. Passer une carte en <b>6 (Gagné)</b> / 7 / 9 la sort du board.</Tip>
    </div>
  );
};
