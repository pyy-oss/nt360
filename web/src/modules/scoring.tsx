// SCORING IA EXPLICABLE (Lot 5b « niveau Salesforce ») — classe les opportunités OUVERTES par
// probabilité de gain (score 0..100 + bande hot/warm/cold), avec les FACTEURS qui expliquent chaque
// score (modèle additif transparent, domain/scoring.js). Comble l'écart #5 (aucune IA prédictive). Le
// périmètre suit la sécurité par enregistrement (Lot 2). Rebond vers le pipeline via le filtre client.
import { useState, useEffect, useCallback, type FC } from "react";
import { useNav } from "../lib/nav";
import { Card, Tip, Badge, Table, Segmented, colText, colNum, raw, money, cx } from "../design/components";
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
  const [calib, setCalib] = useState<{ calibrated: boolean; sample?: number; baseWinRate?: number } | undefined>();
  const [filter, setFilter] = useState<"all" | "hot" | "warm" | "cold">("all");
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setLoading(true);
    try { const r = await scoreOpportunities(); setRows(r.rows); setBands(r.bands); setScoped(r.scoped); setCalib(r.calib); }
    catch { setRows([]); } finally { setLoading(false); }
  }, []);
  useEffect(() => { load().catch(() => {}); }, [load]);
  const shown = filter === "all" ? rows : rows.filter((r) => r.band === filter);
  return (
    <div className="flex flex-col gap-4">
      <Card title="Scoring IA — probabilité de gain" actions={
        <div className="flex items-center gap-1.5 flex-wrap justify-end">
          <Segmented value={filter} onChange={setFilter} ariaLabel="Filtrer par bande de score" options={[
            { value: "all", label: "Tout", count: rows.length },
            { value: "hot", label: "Chaud", count: bands.hot },
            { value: "warm", label: "Tiède", count: bands.warm },
            { value: "cold", label: "Froid", count: bands.cold },
          ]} />
          {scoped && <Badge tone="steel">mon périmètre</Badge>}
          {calib?.calibrated
            ? <span title={`Base = taux de gain observé (${calib.baseWinRate}%) sur ${calib.sample} opportunités fermées`}><Badge tone="emerald">calibré · {calib.baseWinRate}% · n={calib.sample}</Badge></span>
            : calib && <span title="Historique insuffisant pour calibrer — modèle heuristique"><Badge tone="steel">heuristique</Badge></span>}
        </div>}>
        {loading ? <div className="text-[13px] text-muted py-2">Calcul du score…</div> : !rows.length ? (
          <Tip>Aucune opportunité ouverte à scorer dans votre périmètre.</Tip>
        ) : (
          <>
            <Table columns={[
              colText("Client", (o: ScoredOpp) => (
                canGo("opplist") ? <button type="button" className="text-gold hover:underline" onClick={() => go("opplist", { search: o.client || "" })}>{o.client || "—"}</button> : (o.client || "—")
              ), (o: ScoredOpp) => o.client || ""),
              colText("Commercial", (o: ScoredOpp) => o.am || "—"),
              colNum("Montant", (o: ScoredOpp) => money(o.amount), (o: ScoredOpp) => o.amount),
              colNum("Étape", (o: ScoredOpp) => `${o.stage}/6`, (o: ScoredOpp) => o.stage),
              colText("Score", (o: ScoredOpp) => <span className="inline-flex items-center gap-2"><ScoreBadge score={o.score} band={o.band} /><span className="text-[11px] text-muted">{bandLabel[o.band]}</span></span>, (o: ScoredOpp) => o.score),
              // Top 3 facteurs EN LIGNE (chips) + « +N ». Contenu riche → `raw` (jamais coincé dans `.cell-txt`
              // qui écrêterait les 2e/3e chips et le « +N ») ; le survol donne la liste complète.
              raw(colText("Principaux facteurs", (o: ScoredOpp) => (
                <span className="inline-flex flex-wrap items-center gap-1" title={o.factors.map((f) => `${f.label} ${f.impact >= 0 ? "+" : ""}${f.impact}`).join(" · ")}>
                  {o.factors.slice(0, 3).map((f, i) => (
                    <span key={i} className={cx("rounded px-1.5 py-0.5 text-[10px] whitespace-nowrap", f.impact >= 0 ? "bg-emerald/15 text-emerald" : "bg-clay/15 text-clay")}>{f.label} {f.impact >= 0 ? "+" : ""}{f.impact}</span>
                  ))}
                  {o.factors.length > 3 && <span className="text-[10px] text-faint">+{o.factors.length - 3}</span>}
                </span>
              ), (o: ScoredOpp) => o.factors.map((f) => f.label).join(" "))),
            ]} rows={shown} colsKey="scoring" />
            <Tip>Score <b>explicable</b> (0–100) : modèle additif transparent — étape, indice de confiance, catégorie de prévision, prochaine action, DR, dormance, marge. Chaque badge de facteur montre sa contribution (± points). Concentrez l'effort sur les opportunités <b>chaudes</b> à fort montant ; requalifiez les <b>froides</b>.</Tip>
          </>
        )}
      </Card>
    </div>
  );
};
