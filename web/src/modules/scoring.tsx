// SCORING IA EXPLICABLE (Lot 5b « niveau Salesforce ») — classe les opportunités OUVERTES par
// probabilité de gain (score 0..100 + bande hot/warm/cold), avec les FACTEURS qui expliquent chaque
// score (modèle additif transparent, domain/scoring.js). Comble l'écart #5 (aucune IA prédictive). Le
// périmètre suit la sécurité par enregistrement (Lot 2). Rebond vers le pipeline via le filtre client.
import { useState, useEffect, useCallback, type FC } from "react";
import { useNav } from "../lib/nav";
import { Card, Tip, Badge, Table, colText, colNum, money, cx } from "../design/components";
import { scoreOpportunities, type ScoredOpp } from "../lib/writes";
import type { Props } from "./_shared";

const bandLabel: Record<string, string> = { hot: "chaud", warm: "tiède", cold: "froid" };

function ScoreBadge({ score, band }: { score: number; band: string }) {
  return <span className={cx("inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-semibold tabnum",
    band === "hot" ? "bg-emerald text-bg" : band === "warm" ? "bg-gold text-bg" : "bg-panel2 text-muted")}>{score}</span>;
}

export const Scoring: FC<Props> = () => {
  const { go, canGo } = useNav();
  const [rows, setRows] = useState<ScoredOpp[]>([]);
  const [bands, setBands] = useState<{ hot: number; warm: number; cold: number }>({ hot: 0, warm: 0, cold: 0 });
  const [scoped, setScoped] = useState(false);
  const [filter, setFilter] = useState<"all" | "hot" | "warm" | "cold">("all");
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setLoading(true);
    try { const r = await scoreOpportunities(); setRows(r.rows); setBands(r.bands); setScoped(r.scoped); }
    catch { setRows([]); } finally { setLoading(false); }
  }, []);
  useEffect(() => { load().catch(() => {}); }, [load]);
  const shown = filter === "all" ? rows : rows.filter((r) => r.band === filter);
  const chip = (b: "all" | "hot" | "warm" | "cold", label: string, n?: number) => (
    <button type="button" onClick={() => setFilter(b)} className={cx("rounded px-2 py-1 text-xs", filter === b ? "bg-gold text-bg" : "bg-panel2 text-muted hover:text-ink")}>{label}{n != null ? ` · ${n}` : ""}</button>
  );
  return (
    <div className="flex flex-col gap-4">
      <Card title="Scoring IA — probabilité de gain" actions={
        <div className="flex items-center gap-1.5">
          {chip("all", "Tout", rows.length)}{chip("hot", "Chaud", bands.hot)}{chip("warm", "Tiède", bands.warm)}{chip("cold", "Froid", bands.cold)}
          {scoped && <Badge tone="steel">mon périmètre</Badge>}
        </div>}>
        {loading ? <div className="text-[13px] text-muted py-2">Calcul du score…</div> : !rows.length ? (
          <Tip>Aucune opportunité ouverte à scorer dans votre périmètre.</Tip>
        ) : (
          <>
            <Table columns={[
              colText("Client", (o: ScoredOpp) => (
                canGo("opplist") ? <button type="button" className="text-gold hover:underline" onClick={() => go("opplist", { search: o.client || "" })}>{o.client || "—"}</button> : (o.client || "—")
              ), (o: ScoredOpp) => o.client || ""),
              colText("AM", (o: ScoredOpp) => o.am || "—"),
              colNum("Montant", (o: ScoredOpp) => money(o.amount), (o: ScoredOpp) => o.amount),
              colNum("Étape", (o: ScoredOpp) => `${o.stage}/6`, (o: ScoredOpp) => o.stage),
              colText("Score", (o: ScoredOpp) => <span className="inline-flex items-center gap-2"><ScoreBadge score={o.score} band={o.band} /><span className="text-[11px] text-muted">{bandLabel[o.band]}</span></span>, (o: ScoredOpp) => o.score),
              colText("Principaux facteurs", (o: ScoredOpp) => (
                <span className="inline-flex flex-wrap gap-1">{o.factors.map((f, i) => (
                  <span key={i} className={cx("rounded px-1.5 py-0.5 text-[10px]", f.impact >= 0 ? "bg-emerald/15 text-emerald" : "bg-clay/15 text-clay")}>{f.label} {f.impact >= 0 ? "+" : ""}{f.impact}</span>
                ))}</span>
              ), (o: ScoredOpp) => o.factors.map((f) => f.label).join(" ")),
            ]} rows={shown} />
            <Tip>Score <b>explicable</b> (0–100) : modèle additif transparent — étape, indice de confiance, catégorie de prévision, prochaine action, DR, dormance, marge. Chaque badge de facteur montre sa contribution (± points). Concentrez l'effort sur les opportunités <b>chaudes</b> à fort montant ; requalifiez les <b>froides</b>.</Tip>
          </>
        )}
      </Card>
    </div>
  );
};
