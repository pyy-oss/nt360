// REPORTING SELF-SERVICE (Lot 6 « niveau Salesforce ») — constructeur de rapport sur les opportunités :
// l'utilisateur choisit un REGROUPEMENT, une MESURE et des FILTRES, obtient un tableau + un graphique à
// barres, exporte en CSV, et SAUVEGARDE la définition (partagée). Comble l'écart #6 (aucun reporting
// self-service). L'exécution est cadrée par la sécurité par enregistrement (périmètre visible).
import { useState, useEffect, useCallback, type FC } from "react";
import { useCan } from "../lib/rbac";
import { Card, Tip, Badge, Busy, Table, colText, colNum, money, cx, useToast } from "../design/components";
import { Select } from "../design/inputs";
import { runReport, saveReport, listReports, deleteReport, type ReportDef, type ReportResult, type ReportGroupBy, type ReportMeasure, type SavedReport } from "../lib/writes";
import type { Props } from "./_shared";

const GROUP_OPTS: { value: ReportGroupBy; label: string }[] = [
  { value: "bu", label: "Business Unit" }, { value: "am", label: "Account Manager" }, { value: "stage", label: "Étape" },
  { value: "client", label: "Client" }, { value: "forecastCategory", label: "Catégorie de prévision" },
];
const MEASURE_OPTS: { value: ReportMeasure; label: string }[] = [
  { value: "count", label: "Nombre d'opportunités" }, { value: "amount", label: "Σ Montant" }, { value: "weighted", label: "Σ Pondéré" },
];
const STAGE_OPTS = [{ value: "", label: "Toutes étapes" }, ...[1, 2, 3, 4, 5, 6, 7].map((s) => ({ value: String(s), label: `Étape ${s}` }))];

function toCsv(res: ReportResult): string {
  const head = ["Groupe", "Nombre", "Montant", "Pondéré"].join(";");
  const lines = res.rows.map((r) => [r.key, r.count, Math.round(r.amount), Math.round(r.weighted)].join(";"));
  const tot = ["TOTAL", res.totals.count, Math.round(res.totals.amount), Math.round(res.totals.weighted)].join(";");
  return [head, ...lines, tot].join("\n");
}
function downloadCsv(name: string, csv: string) {
  const url = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a"); a.href = url; a.download = `${name}.csv`; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const Reports: FC<Props> = () => {
  const canWrite = useCan("pipeline") === "write";
  const toast = useToast();
  const [groupBy, setGroupBy] = useState<ReportGroupBy>("bu");
  const [measure, setMeasure] = useState<ReportMeasure>("amount");
  const [bu, setBu] = useState("");
  const [stage, setStage] = useState("");
  const [minAmount, setMinAmount] = useState("");
  const [openOnly, setOpenOnly] = useState(true);
  const [res, setRes] = useState<ReportResult | null>(null);
  const [saved, setSaved] = useState<SavedReport[]>([]);
  const [name, setName] = useState("");

  const buildDef = useCallback((): ReportDef => ({ groupBy, measure, filters: { bu: bu.trim() || null, stage: stage ? Number(stage) : null, minAmount: minAmount.trim() ? Number(minAmount) : null, openOnly } }), [groupBy, measure, bu, stage, minAmount, openOnly]);
  const run = async () => { setRes(await runReport(buildDef())); };
  const loadSaved = useCallback(async () => { try { const r = await listReports(); setSaved(r.reports); } catch { setSaved([]); } }, []);
  useEffect(() => { loadSaved().catch(() => {}); }, [loadSaved]);

  const applyDef = (d: ReportDef) => {
    setGroupBy(d.groupBy); setMeasure(d.measure);
    setBu(d.filters?.bu || ""); setStage(d.filters?.stage != null ? String(d.filters.stage) : "");
    setMinAmount(d.filters?.minAmount != null ? String(d.filters.minAmount) : ""); setOpenOnly(d.filters?.openOnly !== false);
  };
  const max = res ? Math.max(1, ...res.rows.map((r) => r[measure])) : 1;
  const fmtMeasure = (r: { count: number; amount: number; weighted: number }) => measure === "count" ? String(r.count) : money(measure === "amount" ? r.amount : r.weighted);

  return (
    <div className="flex flex-col gap-4">
      <Card title="Rapport — constructeur" actions={
        <div className="flex flex-wrap items-center gap-2">
          <Busy variant="ghost" label="Appliquer" okMsg="Rapport calculé" errMsg="Échec" fn={run} />
          {res && <button type="button" className="btn-ghost !py-1 text-xs" onClick={() => downloadCsv(`rapport_${groupBy}_${measure}`, toCsv(res))}>Export CSV</button>}
        </div>}>
        <div className="flex flex-wrap items-end gap-2 text-[13px]">
          <label className="flex flex-col gap-0.5"><span className="text-[11px] text-muted">Regrouper par</span>
            <Select ariaLabel="Regrouper par" className="!py-1 w-44" value={groupBy} onChange={(v) => setGroupBy(v as ReportGroupBy)} options={GROUP_OPTS} /></label>
          <label className="flex flex-col gap-0.5"><span className="text-[11px] text-muted">Mesure</span>
            <Select ariaLabel="Mesure" className="!py-1 w-44" value={measure} onChange={(v) => setMeasure(v as ReportMeasure)} options={MEASURE_OPTS} /></label>
          <label className="flex flex-col gap-0.5"><span className="text-[11px] text-muted">BU</span>
            <input className="field !py-1 w-24" value={bu} onChange={(e) => setBu(e.target.value)} aria-label="Filtre BU" placeholder="ICT…" /></label>
          <label className="flex flex-col gap-0.5"><span className="text-[11px] text-muted">Étape</span>
            <Select ariaLabel="Filtre étape" className="!py-1 w-32" value={stage} onChange={setStage} options={STAGE_OPTS} /></label>
          <label className="flex flex-col gap-0.5"><span className="text-[11px] text-muted">Montant min</span>
            <input className="field !py-1 w-28" inputMode="numeric" value={minAmount} onChange={(e) => setMinAmount(e.target.value)} aria-label="Montant minimum" /></label>
          <label className="flex items-center gap-1.5 pb-1.5 text-[12px]"><input type="checkbox" checked={openOnly} onChange={(e) => setOpenOnly(e.target.checked)} aria-label="Ouvertes seulement" /> ouvertes seulement</label>
        </div>
      </Card>

      {res && (
        <Card title="Résultat" actions={<Badge tone="steel">{res.totals.count} opp. · {money(res.totals.amount)}</Badge>}>
          {/* Aperçu visuel : Top 20 par la mesure choisie (le tableau ci-dessous liste TOUS les groupes,
              paginés) — l'aperçu est explicitement borné, plus de troncature silencieuse. */}
          {res.rows.length > 20 && <div className="text-[11px] uppercase tracking-wider text-faint mb-2">Aperçu · top 20 sur {res.rows.length}</div>}
          <div className="flex flex-col gap-2 mb-3">
            {res.rows.slice(0, 20).map((r) => (
              <div key={r.key} className="flex items-center gap-2 text-[13px]">
                <div className="w-40 truncate" title={r.key}>{r.key}</div>
                <div className="grow h-2.5 rounded bg-panel2 overflow-hidden"><div className="h-full rounded bg-gold" style={{ width: `${(r[measure] / max) * 100}%` }} /></div>
                <div className={cx("w-28 text-right tabnum")}>{fmtMeasure(r)}</div>
              </div>
            ))}
          </div>
          <Table columns={[
            colText(GROUP_OPTS.find((g) => g.value === groupBy)?.label || "Groupe", (r: { key: string }) => r.key),
            colNum("Nb", (r: { count: number }) => r.count, (r: { count: number }) => r.count),
            colNum("Montant", (r: { amount: number }) => money(r.amount), (r: { amount: number }) => r.amount),
            colNum("Pondéré", (r: { weighted: number }) => money(r.weighted), (r: { weighted: number }) => r.weighted),
          ]} rows={res.rows} />
        </Card>
      )}

      <Card title="Rapports sauvegardés" actions={canWrite ? (
        <div className="flex flex-wrap items-center justify-end gap-2">
          <input className="field !py-1 w-full sm:w-40 text-xs" value={name} onChange={(e) => setName(e.target.value)} aria-label="Nom du rapport" placeholder="Nom du rapport…" />
          <Busy variant="ghost" label="Sauvegarder" okMsg="Rapport sauvegardé" errMsg="Échec" fn={async () => { if (!name.trim()) throw new Error("nom requis"); await saveReport(name.trim(), buildDef()); setName(""); await loadSaved(); }} />
        </div>) : undefined}>
        {saved.length ? (
          <div className="flex flex-col">
            {saved.map((s) => (
              <div key={s.id} className="flex items-center justify-between gap-2 border-t border-hair py-2 text-[13px]">
                <button type="button" className="text-gold hover:underline text-left" onClick={() => { applyDef(s.def); toast(`« ${s.name} » chargé — cliquez Appliquer`); }}>{s.name}</button>
                <span className="inline-flex items-center gap-2 text-[11px] text-muted">
                  {GROUP_OPTS.find((g) => g.value === s.def.groupBy)?.label} · {MEASURE_OPTS.find((m) => m.value === s.def.measure)?.label}
                  {canWrite && <button type="button" className="text-clay hover:underline" onClick={async () => { await deleteReport(s.id); await loadSaved(); }}>suppr.</button>}
                </span>
              </div>
            ))}
          </div>
        ) : <Tip>Aucun rapport sauvegardé. Construisez un rapport ci-dessus puis sauvegardez-le pour le réutiliser (définitions partagées entre commerciaux ; l'exécution reste cadrée par le périmètre de chacun).</Tip>}
      </Card>
    </div>
  );
};
