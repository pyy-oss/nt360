// Vue ACTUALITÉ : fil de bulletins d'événements clés (opportunités / commandes / facturation /
// backlog / fournisseurs / BC / qualité) + recommandations majeures. Alimentée par summaries/news
// (moteur functions/domain/news, sans marge). Chaque bulletin renvoie vers le module concerné.
import { type FC } from "react";
import { useDocData } from "../lib/hooks";
import { useCan } from "../lib/rbac";
import { useNav } from "../lib/nav";
import { Card, Badge, Tip, EmptyState, CardSkeleton, cx } from "../design/components";
import type { Props } from "./_shared";
import type { NewsSummary, NewsBulletin } from "../types";

const SEV_TONE = { high: "clay", medium: "gold", info: "steel" } as const;
const SEV_LABEL = { high: "Urgent", medium: "À surveiller", info: "Info" } as const;
const DOMAIN_LABEL: Record<string, string> = {
  commandes: "Commandes", facturation: "Facturation", pipeline: "Pipeline",
  backlog: "Backlog", fournisseurs: "Fournisseurs", bc: "Exécution BC", qualite: "Qualité",
};

export const Actualite: FC<Props> = () => {
  const { data, loading } = useDocData<NewsSummary>("summaries/news");
  // Actualité CLOISONNÉE par module (serveur) : chaque volet n'est lu que si le rôle a le droit du module
  // → un rôle « overview » seul ne voit plus créances/DSO, fournisseurs saturés, concentration backlog.
  // Recomposée dans un seul fil, triée par sévérité. Cf. audit P0-C.
  const { data: dFac } = useDocData<NewsSummary>(useCan("facturation") !== "none" ? "summaries/newsFacturation" : null);
  const { data: dFrn } = useDocData<NewsSummary>(useCan("fournisseurs") !== "none" ? "summaries/newsFournisseurs" : null);
  const { data: dBl } = useDocData<NewsSummary>(useCan("backlog") !== "none" ? "summaries/newsBacklog" : null);
  const { data: dBc } = useDocData<NewsSummary>(useCan("bc") !== "none" ? "summaries/newsBc" : null);
  const { data: dPl } = useDocData<NewsSummary>(useCan("pipeline") !== "none" ? "summaries/newsPipeline" : null);
  const { go, canGo } = useNav();
  const parts = [data, dFac, dFrn, dBl, dBc, dPl];
  const rankS: Record<string, number> = { high: 0, medium: 1, info: 2 };
  const bulletins = parts.flatMap((p) => p?.bulletins || []).sort((a, b) => (rankS[a.severity] ?? 3) - (rankS[b.severity] ?? 3));
  const recos = parts.flatMap((p) => p?.recommendations || []).sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99));
  const counts = parts.reduce((acc, p) => ({ high: acc.high + (p?.counts?.high || 0), medium: acc.medium + (p?.counts?.medium || 0), info: acc.info + (p?.counts?.info || 0) }), { high: 0, medium: 0, info: 0 });
  // Chargement : squelette tant que le 1er snapshot n'est pas arrivé — sinon flash d'« aucun événement »
  // (data null au montage) avant l'apparition du fil. Cohérent avec Vue d'ensemble / Finance.
  if (loading && !data) return <CardSkeleton />;
  if (!data || (!bulletins.length && !recos.length)) {
    return <EmptyState label="Aucun événement notable pour l'instant — ou recalcul à lancer (Vue d'ensemble)." />;
  }
  const open = (b: NewsBulletin) => { if (b.module && canGo(b.module)) go(b.module, b.segment ? { segment: b.segment } : undefined); };
  return (
    <div className="flex flex-col gap-4">
      {recos.length > 0 && (
        <Card title="Recommandations majeures">
          <div className="flex flex-col gap-2">
            {recos.map((r, i) => (
              // key={i} : le fil recompose jusqu'à 6 summaries cloisonnés, chacun numérotant sa priorité
              // depuis 1 → les priorités entrent en collision (plusieurs « 1 ») ; l'index de rendu est unique.
              <div key={i} className="flex items-start gap-2 text-[13px]">
                <span className="grid place-items-center w-5 h-5 rounded-full bg-gold/20 text-gold text-[11px] font-bold shrink-0 mt-0.5">{r.priority}</span>
                <span className="text-ink flex-1">{r.text}</span>
                {r.module && canGo(r.module) && <button onClick={() => go(r.module!)} className="text-gold text-xs underline shrink-0 min-h-[32px]">Ouvrir</button>}
              </div>
            ))}
          </div>
          <Tip>Actions prioritaires déduites des signaux ci-dessous (aide à la décision · anticipation du risque · correction de trajectoire).</Tip>
        </Card>
      )}
      <Card
        title={`Fil d'actualité · ${bulletins.length}`}
        actions={counts && (
          <div className="flex gap-1.5 flex-wrap">
            {(["high", "medium", "info"] as const).map((s) => (counts[s] || 0) > 0
              ? <Badge key={s} tone={SEV_TONE[s]}>{counts[s]} {SEV_LABEL[s]}</Badge> : null)}
          </div>
        )}
      >
        <div className="flex flex-col gap-2">
          {bulletins.map((b, i) => {
            const clickable = !!b.module && canGo(b.module);
            return (
              <div key={i} className={cx("rounded-lg border p-3",
                b.severity === "high" ? "border-clay/40 bg-clay/5" : b.severity === "medium" ? "border-gold/40 bg-gold/5" : "border-line")}>
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge tone={SEV_TONE[b.severity]}>{SEV_LABEL[b.severity]}</Badge>
                  <span className="text-[11px] uppercase tracking-wide text-faint">{DOMAIN_LABEL[b.domain] || b.domain}</span>
                  <span className="font-semibold text-ink text-[13px]">{b.title}</span>
                </div>
                {b.detail && <div className="text-[12.5px] text-muted mt-1">{b.detail}</div>}
                {(!!(b.refs && b.refs.length) || b.action || clickable) && (
                  <div className="flex items-center gap-x-2 gap-y-1 flex-wrap mt-1.5">
                    {(b.refs || []).slice(0, 8).map((r, j) => <span key={j} className="rounded bg-panel2 text-faint px-1.5 py-0.5 text-[11px]">{r}</span>)}
                    {b.action && <span className="text-[12px] text-steel">→ {b.action}</span>}
                    {clickable && <button onClick={() => open(b)} className="text-gold text-xs underline min-h-[32px]">Ouvrir</button>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <Tip>Événements détectés automatiquement à partir des agrégats (état courant, sans donnée marge), priorisés par sévérité. Le fil se rafraîchit à chaque recalcul (05:00 ou « Recalculer »).</Tip>
      </Card>
    </div>
  );
};
