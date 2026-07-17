// PRÉVISION COMMERCIALE GOUVERNABLE (Lot 5 « niveau Salesforce ») — roll-up des catégories de prévision
// (Commit / Best Case / Pipeline / Closed) posées par les commerciaux, sur le périmètre VISIBLE de
// l'utilisateur (sécurité par enregistrement, Lot 2), avec atteinte de l'objectif CAS (quota). Comble
// l'écart #5 de l'audit (prévision non gouvernable : la probabilité d'étape décidait seule).
import { useState, useEffect, useCallback, type FC } from "react";
import { Card, Tip, Badge, Table, colText, colNum, money, cx } from "../design/components";
import { forecastRollup, type ForecastRollup, type ForecastAmRow } from "../lib/writes";
import { useDocData } from "../lib/hooks";
import { frDate } from "../lib/format";
import type { OppSlippageSummary } from "../types";
import type { Props } from "./_shared";

function Bar({ label, value, max, tone, sub }: { label: string; value: number; max: number; tone: string; sub?: string }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between text-[13px]"><span className="font-medium">{label}</span><span className="tabnum">{money(value)}{sub ? <span className="text-[11px] text-muted"> · {sub}</span> : null}</span></div>
      <div className="h-2.5 rounded bg-panel2 overflow-hidden"><div className={cx("h-full rounded", tone)} style={{ width: `${pct}%` }} /></div>
    </div>
  );
}

export const SalesForecast: FC<Props> = ({ period }) => {
  const [r, setR] = useState<ForecastRollup | null>(null);
  const [loading, setLoading] = useState(true);
  // Glissement des deals (temps réel) : summaries/oppSlippage, dérivé du journal des changements de D Prev.
  const { data: slip } = useDocData<OppSlippageSummary>("summaries/oppSlippage");
  // Filtre la prévision sur l'EXERCICE sélectionné (sinon la carte affichait le cumul toutes années).
  const load = useCallback(async () => {
    setLoading(true);
    try { setR(await forecastRollup(period)); } catch { setR(null); } finally { setLoading(false); }
  }, [period]);
  useEffect(() => { load().catch(() => {}); }, [load]);
  // Échelle des barres = max(pipeline, quota) → le quota reste lisible même si le pipe le dépasse.
  const max = r ? Math.max(r.pipeline, r.quota, 1) : 1;
  const pctAtt = (v?: number) => (v != null ? `${Math.round(v * 100)}%` : "—");
  // Colonnes de la ventilation par commercial (cumulatif : Pipeline ⊇ Best Case ⊇ Commit ⊇ Gagné).
  const amCols = [
    colText("Commercial", (a: ForecastAmRow) => a.am, (a: ForecastAmRow) => a.am),
    colNum("Gagné", (a: ForecastAmRow) => money(a.closed), (a: ForecastAmRow) => a.closed),
    colNum("Commit", (a: ForecastAmRow) => money(a.commit), (a: ForecastAmRow) => a.commit),
    colNum("Best Case", (a: ForecastAmRow) => money(a.bestCase), (a: ForecastAmRow) => a.bestCase),
    colNum("Pipeline", (a: ForecastAmRow) => money(a.pipeline), (a: ForecastAmRow) => a.pipeline),
  ];
  type SlipItem = NonNullable<OppSlippageSummary["items"]>[number];
  const slipCols = [
    colText("Client", (s: SlipItem) => s.client || "—", (s: SlipItem) => s.client || ""),
    colText("Commercial", (s: SlipItem) => s.am || "—", (s: SlipItem) => s.am || ""),
    colNum("Montant", (s: SlipItem) => money(s.amount), (s: SlipItem) => s.amount),
    colText("De", (s: SlipItem) => frDate(s.fromDate), (s: SlipItem) => s.fromDate),
    colText("À", (s: SlipItem) => frDate(s.toDate), (s: SlipItem) => s.toDate),
    colNum("Glissement", (s: SlipItem) => <span className="text-clay">{`+${s.days} j`}</span>, (s: SlipItem) => s.days),
  ];
  return (
    <div className="flex flex-col gap-4">
      <Card title="Prévision commerciale — engagement BRUT (gouverné)" actions={r ? <Badge tone={r.scoped ? "steel" : "gold"}>{r.scoped ? "mon périmètre" : "global"}</Badge> : undefined}>
        {loading ? <div className="text-[13px] text-muted py-2">Chargement…</div> : !r ? <Tip>Prévision indisponible.</Tip> : (
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap gap-x-8 gap-y-2">
              <div><div className="text-[11px] text-muted">Exercice</div><div className="font-display text-lg">{r.allPeriods ? "Tout" : r.fiscalYear}</div></div>
              <div><div className="text-[11px] text-muted">Quota (objectif CAS)</div><div className="font-display tabnum text-lg">{r.quota ? money(r.quota) : "—"}</div></div>
              <div><div className="text-[11px] text-muted">Gagné / quota</div><div className="font-display tabnum text-lg">{pctAtt(r.attainment?.closed)}</div></div>
              <div><div className="text-[11px] text-muted">Commit / quota</div><div className="font-display tabnum text-lg">{pctAtt(r.attainment?.commit)}</div></div>
              <div><div className="text-[11px] text-muted">Best Case / quota</div><div className="font-display tabnum text-lg">{pctAtt(r.attainment?.bestCase)}</div></div>
              {/* Écart au quota = objectif CAS − RÉALISÉ (gagné), même grandeur que l'« écart »
                  d'atterrissage au périmètre prévision. Distinct du « Reste à trouver » du CODIR
                  (objectif − projeté PONDÉRÉ). « — » si pas de quota (objectif non défini). */}
              <div><div className="text-[11px] text-muted">Écart au quota</div><div className="font-display tabnum text-lg">{r.quota ? money(Math.max(r.quota - r.closed, 0)) : "—"}</div></div>
            </div>
            <div className="flex flex-col gap-3">
              <Bar label="Closed (gagné)" value={r.closed} max={max} tone="bg-emerald" sub={`${r.counts.closed} cmd.`} />
              <Bar label="Commit" value={r.commit} max={max} tone="bg-gold" sub={`+${r.counts.commit} engagées`} />
              <Bar label="Best Case" value={r.bestCase} max={max} tone="bg-steel" sub={`+${r.counts.bestCase}`} />
              <Bar label="Pipeline" value={r.pipeline} max={max} tone="bg-ink/40" sub={`+${r.counts.pipeline}`} />
            </div>
            <Tip>Montants <b>BRUTS</b> (non pondérés), par catégorie d'engagement posée par le commercial — <b>à ne pas confondre</b> avec le <b>Pondéré projeté</b> par certitude d'IdC du <b>Cockpit commercial</b> (qui, lui, pondère chaque opp par son palier de confiance et fait foi pour la projection). <b>Closed (gagné)</b> = carnet de commandes de l'exercice (CAS, millésime de la commande) — même source que la Vue d'ensemble ; les opportunités déjà au carnet en sont exclues (aucun double-compte). Les paliers <b>cumulatifs</b> au-dessus (Commit ⊆ Best Case ⊆ Pipeline) ajoutent les opportunités <b>ouvertes</b> selon leur catégorie : par défaut dérivée de l'étape (<b>5-Contractualisation → Commit</b>, <b>4-Négociation → Best Case</b>, <b>1-3 → Pipeline</b>), surchargeable dans la fiche. Le quota est l'objectif CAS de l'exercice (Objectifs).</Tip>
          </div>
        )}
      </Card>

      {r && r.byAm && r.byAm.length > 0 && (
        <Card title={`Prévision par commercial · ${r.byAm.length}`}>
          <Tip>Le <b>forecast review</b> : Commit / Best Case / Pipeline (montants <b>BRUTS cumulatifs</b>, Pipeline ⊇ Best Case ⊇ Commit ⊇ Gagné) de <b>chaque commercial</b>, sur l'exercice sélectionné. Même assiette que la prévision globale ci-dessus — trié par pipeline décroissant.</Tip>
          <Table columns={amCols} rows={r.byAm} colsKey="forecast-by-am" />
        </Card>
      )}

      {slip && (slip.slipCount ?? 0) + (slip.pullCount ?? 0) > 0 && (
        <Card title="Glissement des deals (D Prev)">
          <Tip>Combien de pipeline a vu sa <b>date de clôture repoussée</b> (glissement) — le vrai signal de fiabilité d'un forecast. Mesuré sur le <b>mouvement NET</b> de chaque opp (première → dernière D Prev journalisée) ; se construit à partir de maintenant, comme le funnel.{slip.truncated ? ` Fenêtre glissante des ${(slip.windowSize ?? 0).toLocaleString("fr-FR")} derniers changements.` : ""}</Tip>
          <div className="flex flex-wrap gap-x-8 gap-y-2 mb-3">
            <div><div className="text-[11px] text-muted">Glissé (montant)</div><div className="font-display tabnum text-lg text-clay">{money(slip.slipAmount ?? 0)}</div></div>
            <div><div className="text-[11px] text-muted">Deals glissés</div><div className="font-display tabnum text-lg">{slip.slipCount ?? 0}</div></div>
            <div><div className="text-[11px] text-muted">Glissement moyen</div><div className="font-display tabnum text-lg">{slip.avgSlipDays ?? 0} j</div></div>
            <div><div className="text-[11px] text-muted">Avancés (pull-in)</div><div className="font-display tabnum text-lg text-emerald">{money(slip.pullAmount ?? 0)} · {slip.pullCount ?? 0}</div></div>
            <div><div className="text-[11px] text-muted">dont Commit</div><div className="font-display tabnum text-lg text-clay">{money(slip.byCategory?.commit ?? 0)}</div></div>
          </div>
          {(slip.items?.length ?? 0) > 0 && <Table columns={slipCols} rows={slip.items || []} colsKey="forecast-slippage" />}
        </Card>
      )}
    </div>
  );
};
