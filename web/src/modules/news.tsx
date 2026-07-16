// Vue ACTUALITÉ : fil de bulletins d'événements clés (opportunités / commandes / facturation /
// backlog / fournisseurs / BC / qualité) + recommandations majeures. Alimentée par summaries/news
// (moteur functions/domain/news, sans marge). Chaque bulletin renvoie vers le module concerné.
import { useState, type FC } from "react";
import { useDocData } from "../lib/hooks";
import { useCan, useClaims } from "../lib/rbac";
import { useNav } from "../lib/nav";
import { Card, Badge, Tip, EmptyState, CardSkeleton, Busy, cx } from "../design/components";
import { curateNewsNow } from "../lib/writes";
import type { Props } from "./_shared";
import type { NewsSummary, NewsBulletin, NewsCuration } from "../types";

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
  // Curation LLM (scores de pertinence par TYPE de bulletin) — lue toujours (module overview) ; absente
  // (secret non configuré / jamais exécutée) → tout est affiché tel quel (dégradation gracieuse).
  const { data: cur } = useDocData<NewsCuration>("summaries/newsCuration");
  const isDirection = useClaims().role === "direction";
  const [showAll, setShowAll] = useState(false);
  // Pagination du fil : on n'affiche qu'une fenêtre, étendue par « Voir plus » (zéro liste interminable).
  const [limit, setLimit] = useState(20);
  const parts = [data, dFac, dFrn, dBl, dBc, dPl];
  const rankS: Record<string, number> = { high: 0, medium: 1, info: 2 };
  const relOf = (b: NewsBulletin) => cur?.scores?.[b.id]?.relevance ?? 50; // non curé → neutre (affiché)
  // Type jugé peu pertinent par la curation → DÉMOTÉ (masqué derrière « voir tout »), SAUF sévérité
  // « high » qui n'est JAMAIS masquée (un signal urgent prime sur le score de pertinence du type).
  const isMuted = (b: NewsBulletin) => { const s = cur?.scores?.[b.id]; return !!s && s.keep === false && b.severity !== "high"; };
  const bulletins = parts.flatMap((p) => p?.bulletins || []).sort((a, b) => (rankS[a.severity] ?? 3) - (rankS[b.severity] ?? 3) || relOf(b) - relOf(a));
  const mutedCount = bulletins.filter(isMuted).length;
  const shown = showAll ? bulletins : bulletins.filter((b) => !isMuted(b));
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
                {r.module && canGo(r.module) && <button onClick={() => go(r.module!)} className="text-gold text-xs underline shrink-0 min-h-[36px] inline-flex items-center">Ouvrir</button>}
              </div>
            ))}
          </div>
          <Tip>Actions prioritaires déduites des signaux ci-dessous (aide à la décision · anticipation du risque · correction de trajectoire).</Tip>
        </Card>
      )}
      <Card
        title={`Fil d'actualité · ${shown.length}`}
        actions={
          <div className="flex items-center gap-1.5 flex-wrap justify-end">
            {(["high", "medium", "info"] as const).map((s) => (counts[s] || 0) > 0
              ? <Badge key={s} tone={SEV_TONE[s]}>{counts[s]} {SEV_LABEL[s]}</Badge> : null)}
            {/* Rafraîchir la curation LLM (Direction) — score la pertinence des types de bulletins. */}
            {isDirection && <Busy label="Curer" variant="ghost" okMsg="Curation relancée" errMsg="Curation indisponible" fn={curateNewsNow} />}
          </div>
        }
      >
        <div className="flex flex-col gap-2">
          {shown.slice(0, limit).map((b, i) => {
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
                    {clickable && <button onClick={() => open(b)} className="text-gold text-xs underline min-h-[36px] inline-flex items-center">Ouvrir</button>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        {shown.length > limit && (
          <button onClick={() => setLimit((l) => l + 20)} className="mt-1 btn-ghost !py-1.5 text-xs self-center">
            Voir plus · {shown.length - limit} restant{shown.length - limit > 1 ? "s" : ""}
          </button>
        )}
        {mutedCount > 0 && (
          <button onClick={() => setShowAll((v) => !v)} className="mt-1 text-[12px] text-faint hover:text-ink underline underline-offset-2 self-start">
            {showAll ? "Masquer les signaux moins pertinents" : `Afficher ${mutedCount} signal${mutedCount > 1 ? "aux" : ""} moins pertinent${mutedCount > 1 ? "s" : ""}`}
          </button>
        )}
        <Tip>Événements détectés automatiquement à partir des agrégats (état courant, sans donnée marge), priorisés par sévérité{cur?.scores ? " puis par pertinence (curation IA)" : ""}. Le fil se rafraîchit à chaque recalcul (05:00 ou « Recalculer »){cur?.scores ? " ; la curation IA (05:30) score la pertinence des types de signaux pour reléguer le bruit — les signaux urgents ne sont jamais masqués" : ""}.</Tip>
      </Card>
    </div>
  );
};
