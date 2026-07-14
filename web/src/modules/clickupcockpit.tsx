// Cockpit ClickUp — vue de pilotage CONSOLIDÉE de l'intégration (couverture, avancement BC, retards de
// livraison par PM/statut, échéancier RAF). 100 % lecture : s'abonne aux summaries produits côté serveur
// (clickupHealth / clickupBc / clickupDelays) + config/clickup. Chaque carte dégrade proprement si le
// rôle n'a pas le droit de lire son summary (les règles Firestore restent la source d'autorité).
import { type FC } from "react";
import { useDocData } from "../lib/hooks";
import { useCan } from "../lib/rbac";
import { useNav } from "../lib/nav";
import { fmt, pct, T } from "../design/tokens";
import { Card, Kpi, Badge, Tip } from "../design/components";
import { HBars, Props, grid4 } from "./_shared";
import type { ClickupHealthSummary, ClickupBcSummary, ClickupDelaysSummary } from "../types";

const pill = (on: boolean, onLabel: string, offLabel: string) =>
  on ? <Badge tone="emerald">{onLabel}</Badge> : <Badge tone="steel">{offLabel}</Badge>;

export const ClickupCockpit: FC<Props> = () => {
  const { go, canGo } = useNav();
  // Abonnement gaté par le droit de lecture du summary (mêmes modules que les règles Firestore) → pas
  // d'erreur permission-denied pour un rôle sans accès ; la carte concernée disparaît proprement.
  const { data: cfg } = useDocData<{ enabled?: boolean; webhookActive?: boolean; defaultListId?: string }>("config/clickup");
  const { data: health } = useDocData<ClickupHealthSummary>(useCan("habilitations") !== "none" ? "summaries/clickupHealth" : null);
  const { data: bc } = useDocData<ClickupBcSummary>(useCan("fournisseurs") !== "none" ? "summaries/clickupBc" : null);
  const { data: delays } = useDocData<ClickupDelaysSummary>(useCan("backlog") !== "none" ? "summaries/clickupDelays" : null);

  const enabled = cfg?.enabled !== false;
  const coverage = health?.coverage ?? 0;
  const linked = health?.linked ?? 0;
  const total = health?.commandesTotal ?? 0;
  const orphans = health?.orphanTasks ?? 0;
  const cafGap = health?.cafGapCount ?? 0;
  const overdueProjets = delays?.overdueTotal ?? 0;
  const avgLate = delays?.avgDaysLate ?? 0;
  const bcLinked = bc?.linkedCount ?? 0;
  const bcTotal = bc?.totalBc ?? 0;
  const bcOverdue = bc?.overdueCount ?? 0;

  return (
    <div className="flex flex-col gap-4">
      {/* Bandeau d'état de l'intégration */}
      <Card title="Intégration ClickUp"
        actions={canGo("habilitations") ? <button className="btn-ghost !py-1 text-xs" onClick={() => go("habilitations")}>Configurer</button> : undefined}>
        <div className="flex flex-wrap items-center gap-2 text-[13px]">
          {pill(enabled, "Intégration active", "Désactivée")}
          {pill(!!cfg?.webhookActive, "Temps réel actif", "Temps réel inactif")}
          <span className="text-muted">Les données ci-dessous proviennent des dernières synchronisations ClickUp (tirage quotidien + temps réel).</span>
        </div>
        {!cfg?.webhookActive && enabled && <Tip>Active le <b>temps réel</b> (Habilitations → ClickUp) pour refléter les changements ClickUp en secondes plutôt qu'au tirage quotidien.</Tip>}
      </Card>

      {/* KPI consolidés */}
      <div className={grid4}>
        <Kpi label="Couverture commandes" value={pct((coverage || 0) / 100)} sub={`${fmt(linked)} / ${fmt(total)} liées`} tone={coverage >= 90 ? "emerald" : coverage >= 60 ? "gold" : "clay"} />
        <Kpi label="Tâches orphelines" value={fmt(orphans)} sub="tâches ClickUp sans commande" tone={orphans ? "gold" : "steel"} />
        <Kpi label="Écart CAF" value={fmt(cafGap)} sub="commandes à resynchroniser" tone={cafGap ? "gold" : "steel"} />
        <Kpi label="Projets en retard" value={fmt(overdueProjets)} sub={overdueProjets ? `retard moyen ${avgLate} j` : "livraison à l'heure"} tone={overdueProjets ? "clay" : "emerald"} />
      </div>
      <div className={grid4}>
        <Kpi label="BC liés à ClickUp" value={`${fmt(bcLinked)} / ${fmt(bcTotal)}`} sub="bons de commande" tone="steel" />
        <Kpi label="BC en retard (ETA)" value={fmt(bcOverdue)} sub="ETA dépassée, non livré" tone={bcOverdue ? "clay" : "emerald"} />
      </div>

      {/* Retards de livraison par PM */}
      {(delays?.byPm?.length || 0) > 0 && (
        <Card title="Retard de livraison par Project Manager"
          actions={<button className="btn-ghost !py-1 text-xs" onClick={() => go("backlog")}>Suivi Backlog</button>}>
          <HBars rows={(delays!.byPm || []).slice(0, 12).map((p) => ({ name: p.pm, v: p.overdue, sub: `${p.active} actifs · ${p.avgDaysLate} j moy.` }))} colorFn={() => T.clay} />
        </Card>
      )}

      {/* Répartition par statut ClickUp */}
      {(delays?.byStatus?.length || 0) > 0 && (
        <Card title="Projets synchronisés par statut ClickUp">
          <HBars rows={(delays!.byStatus || []).slice(0, 14).map((s) => ({ name: s.status, v: s.count, sub: s.overdue ? `${s.overdue} en retard` : undefined }))} colorFn={(r: any) => (r.sub ? T.gold : T.steel)} />
        </Card>
      )}

      {/* Échéancier RAF (quand le backlog devrait se facturer selon ClickUp) */}
      {(delays?.rafByMonth?.length || 0) > 0 && (
        <Card title="RAF échéancé par mois (date prév. de fin ClickUp)">
          <HBars rows={(delays!.rafByMonth || []).slice(0, 18).map((m) => ({ name: m.month, v: m.raf, sub: `${m.count} projet(s)` }))} colorFn={() => T.emerald} max={undefined} />
          <Tip>Projection indicative : RAF des projets actifs regroupé par mois de leur date prévisionnelle de fin dans ClickUp.</Tip>
        </Card>
      )}

      {/* BC en retard détaillés — retard = ETA CLICKUP dépassée (état de synchro ClickUp). À distinguer
          du « BC en retard » de l'Exécution BC / des Relances, calculé sur l'ETA de l'app (réelle sinon
          contractuelle) : les comptes peuvent différer si ClickUp n'est pas synchronisé. */}
      {(bc?.overdue?.length || 0) > 0 && (
        <Card title={`Bons de commande en retard (ETA ClickUp) · ${bc!.overdue!.length}`}
          actions={<button className="btn-ghost !py-1 text-xs" onClick={() => go("bc", { segment: "late" })}>Exécution BC</button>}>
          <div className="overflow-x-auto -mx-1">
            <table className="w-full text-sm rtable">
              <thead><tr className="text-muted"><th className="px-3 py-2 text-left font-medium text-xs">N° BC</th><th className="px-3 py-2 text-left font-medium text-xs">Fournisseur</th><th className="px-3 py-2 text-left font-medium text-xs">Statut</th><th className="px-3 py-2 text-left font-medium text-xs">ETA</th></tr></thead>
              <tbody>
                {bc!.overdue!.slice(0, 20).map((r) => (
                  <tr key={r.bcNumber} className="odd:bg-ink/[.03]">
                    <td className="px-3 py-1.5">{r.bcNumber}</td>
                    <td className="px-3 py-1.5">{r.supplier || "—"}</td>
                    <td className="px-3 py-1.5">{r.status ? <Badge tone="steel">{r.status}</Badge> : "—"}</td>
                    <td className="px-3 py-1.5 tabnum">{r.eta || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {!health && !bc && !delays && (
        <Card title="Aucune donnée de synchronisation">
          <p className="text-sm text-muted">Lance une première synchronisation depuis <b>Habilitations → Intégration ClickUp</b> (« Diagnostic qualité », « Synchroniser depuis ClickUp », « Synchroniser les BC ») pour alimenter ce cockpit.</p>
        </Card>
      )}
      <Tip>Vue de pilotage en lecture seule. Les actions (rattacher, pousser, enrichir, activer le temps réel, importer les BC) sont dans <b>Habilitations → Intégration ClickUp</b>.</Tip>
    </div>
  );
};
