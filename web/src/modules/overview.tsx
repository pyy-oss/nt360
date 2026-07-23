// 1 — Cockpit décisionnel : atterrissage exercice (décision n°1) + chaîne de valeur
// non additive + KPIs de pilotage (marge, cash) + alertes actionnables + tendance.
import { useState, useMemo, type FC } from "react";
import { useDocData, useCollectionData } from "../lib/hooks";
import { useCanExport, useCanSeeMargin, useClaims, useCan } from "../lib/rbac";
import { useFilters } from "../lib/filters";
import { mergeAtterrissageObjectifs } from "../lib/atterrissage";
import { useRecordScope } from "../lib/scope";
import { T, fmt, pct } from "../design/tokens";
import { Kpi, Card, Tip, EmptyState, KpiSkeletons, CardSkeleton, Busy, Chain, Stage, cx } from "../design/components";
import { MultiLine } from "../design/charts";
import { callRecompute, callExportReport } from "../lib/writes";
import { Props, cols2, AlertsBanner, useObjectives, roBadge, AtterrissageGauge, relTime, useCommandesRows } from "./_shared";
import { computeFilteredOverview } from "./overviewCalc";
import { useClientKey } from "../lib/clientName";
import { normalizeTiers, type ProjectionConfig } from "../lib/projection";
import type { OverviewSummary, AtterrissageSummary, PeriodsConfig, TrendsSummary, Opportunity, Invoice, RentabiliteSummary, CancellationsDoc } from "../types";

// Bloc « atterrissage » : jauge du TAUX D'ATTEINTE (projeté / objectif, plafonné à 100 %) + Réalisé /
// Projeté / Objectif / Écart, avec le R/O (Réalisé / Objectif) mis en avant dans le coin. Ce n'est PAS
// une probabilité statistique : c'est un ratio d'atteinte de l'objectif — libellé en conséquence.
function Landing({ title, proba, realise, projete, objectif, ecart, sub, retard, retardCount, reporte, reporteMarge, undated, undatedCount, undatedLabel }: {
  title: string; proba: number; realise?: number; projete?: number; objectif?: number; ecart?: number; sub: string;
  retard?: number; retardCount?: number; reporte?: number; reporteMarge?: number;
  undated?: number; undatedCount?: number; undatedLabel?: string;
}) {
  const hasObj = (objectif || 0) > 0;
  return (
    <Card title={title} actions={hasObj ? <span className="inline-flex items-center gap-1.5 text-[11px] text-muted">R/O {roBadge(realise, objectif)}</span> : undefined}>
      <AtterrissageGauge proba={proba} hasObjectif={hasObj} h={170} />
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-2 text-center">
        <div><div className="text-[11px] text-muted">Réalisé</div><div className="font-display tabnum">{fmt(realise)}</div></div>
        <div><div className="text-[11px] text-muted">Projeté</div><div className="font-display tabnum text-[17px] leading-tight text-gold">{fmt(projete)}</div></div>
        <div><div className="text-[11px] text-muted">Objectif</div><div className="font-display tabnum">{hasObj ? fmt(objectif) : "—"}</div></div>
        <div><div className="text-[11px] text-muted">Écart</div><div className={cx("font-display tabnum", (ecart || 0) < 0 ? "text-clay" : "text-emerald")}>{hasObj ? fmt(ecart) : "—"}</div></div>
      </div>
      <div className="text-[11px] text-faint text-center mt-2">{sub}</div>
      {(retard || 0) > 0 && (
        <div className="text-[11px] text-clay text-center mt-1" title="Ces opportunités sont comptées dans le projeté (D Prev dans l'exercice) mais leur date de clôture prévue est déjà dépassée — elles apparaissent « en retard de closing » côté Pipeline.">
          dont {fmt(retard)}{(retardCount || 0) > 0 ? ` (${retardCount} opp.)` : ""} à requalifier — D Prev dépassée
        </div>
      )}
      {(reporte || 0) > 0 && (
        <div className="text-[11px] text-steel text-center mt-1" title="RAF explicitement reporté sur l'exercice suivant (facturation décalée) — EXCLU de ce projeté CAF. La marge suit au prorata.">
          hors {fmt(reporte)} reporté sur N+1{(reporteMarge || 0) > 0 ? ` · marge ${fmt(reporteMarge)}` : ""} (exclu du projeté)
        </div>
      )}
      {(undated || 0) > 0 && (
        <div className="text-[11px] text-clay text-center mt-1" title="Signé/facturé sans année/date attribuable à l'exercice → EXCLU du réalisé et donc du R/O. À dater pour fiabiliser l'assiette (le R/O est alors opposable).">
          assiette opposable — hors {fmt(undated)} {undatedLabel} ({undatedCount}) à dater
        </div>
      )}
    </Card>
  );
}

export const Overview: FC<Props> = ({ period }) => {
  const { data, loading } = useDocData<OverviewSummary>(`summaries/overview_${period}`);
  const { data: cfg } = useDocData<PeriodsConfig>("config/periods");
  const { data: attBase } = useDocData<AtterrissageSummary>(cfg?.currentFy ? `summaries/atterrissage_${cfg.currentFy}` : null);
  // Objectifs annuels ISOLÉS dans un doc gaté « objectifs » (cf. audit RBAC) : re-fusionnés ici pour
  // l'affichage. Un rôle sans droit « objectifs » (ex. commercial) reçoit null → objectif/écart undefined
  // → « — » (les jauges masquent la cible). Fusion PROFONDE de `next` (garde le report public).
  const { data: attObj } = useDocData<AtterrissageSummary>(cfg?.currentFy ? `summaries/atterrissageObjectifs_${cfg.currentFy}` : null);
  const att = mergeAtterrissageObjectifs(attBase, attObj); // SOURCE UNIQUE (parité CODIR/Cockpit — audit métier)
  const { data: trends } = useDocData<TrendsSummary>("summaries/trends");
  const objGlobal = useObjectives(period).get("global", "all"); // R/O global (si objectif de l'année sélectionnée)
  const isDirection = useClaims().role === "direction"; // le callable recompute est direction-only
  const canExport = useCanExport();
  const [url, setUrl] = useState<string | null>(null);
  // Filtre transverse : quand un BU/AM/client est sélectionné, on RECALCULE la chaîne & les KPI
  // par périmètre côté client (les collections dégradent proprement à vide si l'accès manque).
  const { f, match } = useFilters();
  // Ce cockpit n'HONORE que BU/AM/Client (opps & factures ne portent pas de dimension PM fiable — la
  // ventiler filtrerait les commandes mais pas les opps/CAF → nouvelle divergence). Un filtre PM-SEUL
  // ne « recalcule » donc rien ici : on le traite comme inactif (chiffres globaux, SANS bandeau « vue
  // recalculée » trompeur) plutôt que d'afficher du global sous une étiquette de périmètre (audit métier).
  const active = !!(f.bu || f.am || f.client);
  // Les collections brutes ne sont abonnées QUE si un filtre est actif (le recalcul par périmètre en
  // a besoin) — sinon la Vue d'ensemble (page la plus vue) n'ouvre aucun listener plein-collection.
  const { rows: cmdRows } = useCommandesRows(active);
  // Cloisonnement : n'ouvrir les collections brutes que si le rôle a le droit du module concerné
  // (pipeline pour les opportunités, facturation pour les factures) — sinon un rôle sans ce droit
  // déclenchait une lecture permission-denied et fuitait hors de son périmètre. Cf. audit P0-C.
  const canPipe = useCan("pipeline") !== "none";
  const canFac = useCan("facturation") !== "none";
  const oppScope = useRecordScope("opportunities"); // cadrage propriétaire+hiérarchie sous OWD « private »
  const { rows: allOpps, truncated: oppsTrunc } = useCollectionData<Opportunity>(active && canPipe && oppScope.ready ? "opportunities" : null, oppScope.constraints, oppScope.scoped ? "s" : "");
  const { rows: allInvoices, truncated: invTrunc } = useCollectionData<Invoice>(active && canFac ? "invoices" : null);
  // Overlay des factures ANNULÉES : le serveur les EXCLUT des agrégats (aggregate.js splice) ; sans la
  // même exclusion ici, le CAF de la vue FILTRÉE inclut les annulées → supérieur à l'agrégat serveur et
  // à la liste Factures (qui les exclut aussi, finance.tsx). Miroir de finance.tsx.
  const { data: cxlInv } = useDocData<CancellationsDoc>(active && canFac ? "config/cancelInvoices" : null);
  // Marge agrégée isolée dans overviewMargin_* (accès « Rentabilité ») : lue seulement hors filtre et
  // si le rôle a le droit marge ; en vue filtrée elle vient du recalcul (cmdRows a la marge fusionnée).
  const canMargin = useCanSeeMargin();
  const { data: ovMargin } = useDocData<{ mb?: number; pmb?: number }>(canMargin && !active ? `summaries/overviewMargin_${period}` : null);
  // Perspective FACTURÉ de la marge (marge reconnue au prorata du facturé, plafonnée au CAS) : hors
  // filtre depuis l'agrégat Rentabilité (gaté « rentabilite ») ; en vue filtrée depuis le recalcul.
  const { data: rentab } = useDocData<RentabiliteSummary>(canMargin && !active ? `summaries/rentabilite_${period}` : null);
  // Marge reportée sur N+1 (isolée, gatée « rentabilite ») — pour le caveat de l'atterrissage CAF.
  const { data: attMargin } = useDocData<{ reporteMarge?: number }>(canMargin && cfg?.currentFy ? `summaries/atterrissageMargin_${cfg.currentFy}` : null);
  // Niveaux de projection configurés (Certitudes/Forecast/Pipe) : appliqués au recalcul filtré pour
  // rester cohérent avec les agrégats serveur (mêmes poids/activation).
  const { data: projCfg } = useDocData<ProjectionConfig>("config/projection");
  const projTiers = useMemo(() => normalizeTiers(projCfg || undefined), [projCfg]);
  // Overlay de réconciliation N° FP (config/fpAliases) : passé au recalcul filtré pour redirriger le FP des
  // opps/factures brutes vers le FP du P&L, EN MIROIR du recompute serveur (sinon la Vue d'ensemble filtrée
  // diverge de l'agrégat — double-compte pipeline, factures aliasées non rattachées).
  const { data: fpAliases } = useDocData<{ map?: Record<string, string> }>(active ? "config/fpAliases" : null);
  // Résolveur de nom client canonique (miroir serveur) — aligne le filtre client sur les clés de clients_all.
  const clientKey = useClientKey();
  const fy = att?.fy || cfg?.currentFy;
  // Dérivations lourdes MÉMOÏSÉES (patron finance.tsx) — placées AVANT les early-returns (règle des hooks,
  // gardée par l'ESLint CI). `match`/`clientKey`/`projTiers` sont stables → computeFilteredOverview ne
  // re-tourne qu'à changement réel d'entrée (sinon recalcul complet à CHAQUE render en vue filtrée).
  const cancelledInv = useMemo(() => new Set((cxlInv?.items || []).map((e) => e.id)), [cxlInv]);
  const liveInvoices = useMemo(() => (cancelledInv.size ? allInvoices.filter((i) => !cancelledInv.has(i.id!)) : allInvoices), [allInvoices, cancelledInv]);
  const excludeDormant = (projCfg as { excludeDormant?: boolean } | null)?.excludeDormant !== false;
  const filtered = useMemo(
    () => (active ? computeFilteredOverview(cmdRows, liveInvoices, allOpps, period, match, projTiers, fpAliases?.map, clientKey, Number(fy) || undefined, excludeDormant) : null),
    [active, cmdRows, liveInvoices, allOpps, period, match, projTiers, fpAliases, clientKey, fy, excludeDormant]
  );
  const points = useMemo(() => (trends?.points || []).map((p) => ({
    name: p.date, "Projeté CAS": p.projeteCas || 0, "Réalisé CAS": p.casReel || 0, "Facturé": p.caf || 0, Backlog: p.backlog || 0,
  })), [trends]);
  const fresh = cfg?.lastRecomputeAt ? relTime(cfg.lastRecomputeAt) : "";
  const actions = (
    <div className="flex flex-wrap gap-2 items-center justify-end">
      {fresh && <span className="text-[11px] text-faint mr-1" title="Recompute planifié chaque jour à 05:00 ; « Recalculer » force la mise à jour.">Données à jour {fresh}</span>}
      {isDirection && <Busy variant="ghost" label="Recalculer" fn={callRecompute} okMsg="Agrégats recalculés" />}
      {canExport && <Busy variant="ghost" label="Export CODIR" fn={async () => { const r = await callExportReport(period); setUrl(r.url || null); }} okMsg="Export généré" />}
      {url && <a className="text-gold text-xs underline" href={url} target="_blank" rel="noreferrer">Télécharger</a>}
    </div>
  );
  if (loading && !data) return <div className="flex flex-col gap-4"><KpiSkeletons n={4} /><CardSkeleton h={120} /></div>;
  if (!data) return <div className="flex flex-col gap-3"><div className="flex justify-end">{actions}</div><AlertsBanner /><EmptyState /></div>;

  // `filtered`/`points`/`fy` sont dérivés & mémoïsés en amont (avant les early-returns). Vue par périmètre
  // si le filtre est actif, sinon l'agrégat serveur ; factures annulées déjà retirées (parité finance.tsx).
  const v = filtered ?? data;
  const filterLabel = [f.bu, f.am, f.client].filter(Boolean).join(" · ");
  // Marge : recalcul filtré (cmdRows) si filtre actif, sinon doc marge gated (undefined si non autorisé).
  const margeMb = active ? filtered?.mb : ovMargin?.mb;
  const margePmb = active ? filtered?.ratios.pmb : ovMargin?.pmb;
  // Perspective Facturé : marge reconnue sur le facturé (CAF) et son %MB.
  const margeFacMb = active ? filtered?.factureMb : rentab?.perspectives?.facture?.mb;
  const margeFacPmb = active ? filtered?.facturePmb : rentab?.perspectives?.facture?.pmb;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">{actions}</div>

      {active && (
        <div className="rounded-lg border border-gold/40 bg-gold/10 px-3 py-2 text-[12px] text-muted">
          Vue recalculée pour le périmètre <b className="text-ink">{filterLabel}</b> : chaîne de valeur & KPI ci-dessous filtrés. L'<b>atterrissage</b> et la <b>trajectoire</b> restent globaux (projection d'exercice).
          {/* Cap de sécurité des abonnements (hooks.ts) : au-delà, le recalcul filtré SOUS-COMPTE vs le
              serveur qui lit tout — jamais de troncature silencieuse (audit 40 axes, axe 35). */}
          {(oppsTrunc || invTrunc) && <div className="mt-1 text-clay">⚠ Données d'entrée tronquées (cap de sécurité) — les chiffres filtrés peuvent sous-compter ; fiez-vous à la vue globale.</div>}
        </div>
      )}

      {/* DÉCISION N°1 — Atterrissage de l'exercice : allons-nous atteindre l'objectif ? */}
      {att ? (
        <div className={cols2}>
          <Landing title={`Atterrissage CAS ${fy || ""} — prise de commande`} proba={att.probaAtteinte || 0}
            realise={att.realiseCas} projete={att.projete} objectif={att.objectif} ecart={att.ecart}
            retard={att.pipelineRetard} retardCount={att.pipelineRetardCount}
            undated={att.realiseCasUndated} undatedCount={att.realiseCasUndatedCount} undatedLabel="commandes sans année de PO"
            sub="Réalisé CAS + pipeline pondéré (certitudes glissantes)" />
          <Landing title={`Atterrissage CAF ${fy || ""} — facturation`} proba={att.probaAtteinteCaf || 0}
            realise={att.factureN} projete={att.cafProjete} objectif={att.objectifCaf} ecart={att.ecartCaf}
            retard={att.pipelineRetard} retardCount={att.pipelineRetardCount} reporte={att.reporteCaf} reporteMarge={attMargin?.reporteMarge}
            undated={att.factureNUndated} undatedCount={att.factureNUndatedCount} undatedLabel="factures non datées"
            sub="Facturé + backlog + pipeline pondéré" />
        </div>
      ) : (
        <Card title="Atterrissage de l'exercice"><EmptyState label="Atterrissage indisponible — importer données & objectifs, puis recalculer." /></Card>
      )}

      {/* Chaîne de valeur (non additive) — filtrée par périmètre si le filtre est actif. */}
      <Chain>
        <Stage idx={1} label="Certitudes" accent={T.gold} value={fmt(v.certitudes)} sub="pondéré IdC ≥ 90 % · D Prev période" />
        <Stage idx={2} label="Commandes · CAS" accent={T.steel} value={fmt(v.commandes)} sub="prise de commande" />
        <Stage idx={3} label="Facturé · CAF" accent={T.emerald} value={fmt(v.facture)} sub="figé sur l'exercice" />
        <Stage idx={4} label="Encaissé" accent={T.emerald} value={fmt(v.encaisse)} sub={`${pct(v.ratios?.tauxEncaissement)} du facturé`} />
        <Stage idx={5} label="Backlog · RAF" accent={T.clay} value={fmt(v.backlog)} sub={v.backlogCount ? `${v.backlogCount} commandes · glissant` : "glissant"} />
      </Chain>

      {/* Marge — 2 perspectives sur leur propre ligne (bases CAS/CAF déjà dans la chaîne ci-dessus,
          non répétées ici pour éviter le double affichage). */}
      {canMargin && (
        <div className={cols2}>
          <Kpi label="Marge brute (commande)" value={fmt(margeMb)} tone="gold" sub={`%MB ${pct(margePmb)} · marge P&L / CAS${!active && objGlobal?.targetMargin ? ` · R/O ${pct((margeMb || 0) / objGlobal.targetMargin)} vs objectif` : ""}`} />
          <Kpi label="Marge brute (facturé)" value={fmt(margeFacMb)} tone="gold" sub={`%MB ${pct(margeFacPmb)} · marge reconnue / CAF`} />
        </div>
      )}
      {/* KPIs de pilotage opérationnels : facturation N (croissance), taux de facturation, conversion. */}
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-3">
        <Kpi label="Facturé (FY)" value={att ? fmt(att.factureN) : "—"} tone="emerald" delta={att?.croissanceFacture} sub={att ? "vs N-1 · global" : "atterrissage indispo."} />
        <Kpi label="Taux de facturation" value={pct(v.ratios?.tauxFacturation)} sub="Facturé / (Facturé + Backlog)" />
        <Kpi label="Taux d'encaissement" value={pct(v.ratios?.tauxEncaissement)} sub="Encaissé / Facturé (drapeau payé)" />
        {/* PROJETÉE (valeur) = Cmd / (Cmd + pipeline pondéré + perdu) — pipeline escompté au dénominateur,
            donc PAS un win rate ; ne pas comparer à la bande ESN 15-25 % (le vrai win rate est au Cockpit commercial). */}
        <Kpi label="Conversion (projetée)" value={pct(v.ratios?.tauxConversionVente)} sub="Cmd / (Cmd + pondéré + perdu) — projeté, ≠ win rate" />
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

      {/* Alertes actionnables — ce qui bloque / à arbitrer, déplacé en BAS du cockpit (après la
          chaîne de valeur, la marge, les KPI et la trajectoire) pour laisser la lecture décisionnelle
          en tête. */}
      <AlertsBanner />

      <Tip><b>Grandeurs non additives</b> (CAS ≠ Facturé + Backlog). <b>CAS</b> = prise de commande (figée sur l'année de PO). <b>CAF</b> = facturation, seule grandeur figée sur l'exercice. <b>Encaissé</b> = factures de la période marquées payées (drapeau compta, rattaché à la date de facture — le suivi fin du cash vit dans Créances/DSO). <b>Backlog</b> (RAF) est <b>glissant</b> (toutes les commandes ouvertes). <b>Certitudes</b> = pondéré ≥ 90 % des opportunités dont la <b>D Prev</b> tombe dans la période sélectionnée. L'<b>atterrissage</b> combine réalisé + pipeline pondéré pour projeter la fin d'exercice.</Tip>
    </div>
  );
};
