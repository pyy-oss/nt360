// PRÉVISION COMMERCIALE GOUVERNABLE (Lot 5 « niveau Salesforce ») — roll-up des catégories de prévision
// (Commit / Best Case / Pipeline / Closed) posées par les commerciaux, sur le périmètre VISIBLE de
// l'utilisateur (sécurité par enregistrement, Lot 2), avec atteinte de l'objectif CAS (quota). Comble
// l'écart #5 de l'audit (prévision non gouvernable : la probabilité d'étape décidait seule).
import { useState, useEffect, useCallback, type FC } from "react";
import { Card, Tip, Badge, money, cx } from "../design/components";
import { forecastRollup, type ForecastRollup } from "../lib/writes";
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

export const SalesForecast: FC<Props> = () => {
  const [r, setR] = useState<ForecastRollup | null>(null);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setLoading(true);
    try { setR(await forecastRollup()); } catch { setR(null); } finally { setLoading(false); }
  }, []);
  useEffect(() => { load().catch(() => {}); }, [load]);
  // Échelle des barres = max(pipeline, quota) → le quota reste lisible même si le pipe le dépasse.
  const max = r ? Math.max(r.pipeline, r.quota, 1) : 1;
  const pctAtt = (v?: number) => (v != null ? `${Math.round(v * 100)}%` : "—");
  return (
    <div className="flex flex-col gap-4">
      <Card title="Prévision commerciale (gouvernée)" actions={r ? <Badge tone={r.scoped ? "steel" : "gold"}>{r.scoped ? "mon périmètre" : "global"}</Badge> : undefined}>
        {loading ? <div className="text-[13px] text-muted py-2">Chargement…</div> : !r ? <Tip>Prévision indisponible.</Tip> : (
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap gap-x-8 gap-y-2">
              <div><div className="text-[11px] text-muted">Exercice</div><div className="font-display text-lg">{r.fiscalYear}</div></div>
              <div><div className="text-[11px] text-muted">Quota (objectif CAS)</div><div className="font-display tabnum text-lg">{r.quota ? money(r.quota) : "—"}</div></div>
              <div><div className="text-[11px] text-muted">Gagné / quota</div><div className="font-display tabnum text-lg">{pctAtt(r.attainment?.closed)}</div></div>
              <div><div className="text-[11px] text-muted">Commit / quota</div><div className="font-display tabnum text-lg">{pctAtt(r.attainment?.commit)}</div></div>
            </div>
            <div className="flex flex-col gap-3">
              <Bar label="Closed (gagné)" value={r.closed} max={max} tone="bg-emerald" sub={`${r.counts.closed} opp.`} />
              <Bar label="Commit" value={r.commit} max={max} tone="bg-gold" sub={`+${r.counts.commit} engagées`} />
              <Bar label="Best Case" value={r.bestCase} max={max} tone="bg-steel" sub={`+${r.counts.bestCase}`} />
              <Bar label="Pipeline" value={r.pipeline} max={max} tone="bg-ink/40" sub={`+${r.counts.pipeline}`} />
            </div>
            <Tip>Catégories <b>cumulatives</b> (Pipeline ⊇ Best Case ⊇ Commit ⊇ Closed) posées par le commercial dans la fiche opportunité — indépendantes de l'étape. La direction et les managers voient le roll-up de leur <b>hiérarchie</b> ; un commercial voit son périmètre. Le quota est l'objectif CAS de l'exercice (paramétré dans Objectifs).</Tip>
          </div>
        )}
      </Card>
    </div>
  );
};
