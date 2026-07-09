// STAFFING — annuaire des consultants / ressources (Lot 11 « 20/10 DirOps »). Fondation du plan de charge
// (Lot 12) et des KPI d'activité (TACE / intercontrat — Lot 13). Comble l'angle mort « métier ESN » de
// l'évaluation Directeur des Opérations : qui sont les ressources, leur grade, TJM/CJM, compétences, statut.
// Le COÛT (CJM) n'est visible que si l'utilisateur a le droit « rentabilité » (confidentialité serveur).
import { useState, useEffect, useCallback, type FC } from "react";
import { useCan } from "../lib/rbac";
import { Card, Tip, Badge, Busy, DangerBtn, Table, colText, colNum, money, cx } from "../design/components";
import { Select } from "../design/inputs";
import { listConsultants, upsertConsultant, deleteConsultant, staffingPlan, upsertAssignment, deleteAssignment, type Consultant, type ConsultantGrade, type ConsultantStatus, type StaffingPlan, type Assignment } from "../lib/writes";
import type { Props } from "./_shared";

const monthLabel = (ym: string) => { const [y, m] = ym.split("-"); return `${["janv","févr","mars","avr","mai","juin","juil","août","sept","oct","nov","déc"][Number(m) - 1]}. ${y.slice(2)}`; };
const loadTone = (pct: number, active: boolean) => pct > 100 ? "bg-clay/25 text-clay" : pct >= 80 ? "bg-emerald/20 text-emerald" : pct > 0 ? "bg-panel2 text-ink" : active ? "bg-gold/15 text-gold" : "text-muted";

const GRADES: { value: ConsultantGrade; label: string }[] = [
  { value: "junior", label: "Junior" }, { value: "confirme", label: "Confirmé" },
  { value: "senior", label: "Senior" }, { value: "expert", label: "Expert" }, { value: "manager", label: "Manager" },
];
const STATUSES: { value: ConsultantStatus; label: string; tone: "emerald" | "gold" | "steel" | "clay" }[] = [
  { value: "active", label: "Staffé", tone: "emerald" },
  { value: "intercontrat", label: "Intercontrat", tone: "gold" },
  { value: "conge", label: "Congé", tone: "steel" },
  { value: "inactive", label: "Sorti", tone: "clay" },
];
const statusMeta = (s?: string) => STATUSES.find((x) => x.value === s) || STATUSES[0];
const gradeLabel = (g?: string) => GRADES.find((x) => x.value === g)?.label || g || "—";
const EMPTY: Consultant = { name: "", email: "", grade: "confirme", bu: "", tjmTarget: null, cjm: null, skills: [], status: "active", startDate: null };

function ConsultantForm({ initial, canCost, onDone }: { initial: Consultant; canCost: boolean; onDone: () => void }) {
  const [f, setF] = useState<Consultant>(initial);
  const set = (k: keyof Consultant, v: unknown) => setF((p) => ({ ...p, [k]: v }));
  const numOrNull = (s: string) => (s.trim() === "" ? null : Number(s));
  return (
    <div className="flex flex-wrap items-end gap-2 text-[13px]">
      <label className="flex flex-col gap-0.5"><span className="text-[11px] text-muted">Nom</span>
        <input className="field !py-1 w-44" value={f.name} onChange={(e) => set("name", e.target.value)} aria-label="Nom du consultant" /></label>
      <label className="flex flex-col gap-0.5"><span className="text-[11px] text-muted">Grade</span>
        <Select ariaLabel="Grade" className="!py-1 w-32" value={f.grade || "confirme"} onChange={(v) => set("grade", v)} options={GRADES} /></label>
      <label className="flex flex-col gap-0.5"><span className="text-[11px] text-muted">BU</span>
        <input className="field !py-1 w-28" value={f.bu || ""} onChange={(e) => set("bu", e.target.value)} aria-label="Business unit" /></label>
      <label className="flex flex-col gap-0.5"><span className="text-[11px] text-muted">Statut</span>
        <Select ariaLabel="Statut" className="!py-1 w-32" value={f.status || "active"} onChange={(v) => set("status", v)} options={STATUSES} /></label>
      <label className="flex flex-col gap-0.5"><span className="text-[11px] text-muted">TJM cible</span>
        <input className="field !py-1 w-24" type="number" value={f.tjmTarget ?? ""} onChange={(e) => set("tjmTarget", numOrNull(e.target.value))} aria-label="TJM cible" /></label>
      {canCost && <label className="flex flex-col gap-0.5"><span className="text-[11px] text-muted">CJM (coût)</span>
        <input className="field !py-1 w-24" type="number" value={f.cjm ?? ""} onChange={(e) => set("cjm", numOrNull(e.target.value))} aria-label="Coût jour moyen" /></label>}
      <label className="flex flex-col gap-0.5 grow"><span className="text-[11px] text-muted">Compétences (virgules)</span>
        <input className="field !py-1 w-full" value={(f.skills || []).join(", ")} onChange={(e) => set("skills", e.target.value.split(",").map((s) => s.trim()).filter(Boolean))} aria-label="Compétences" placeholder="Java, AWS, DevOps…" /></label>
      <Busy variant="ghost" label={initial.id ? "Enregistrer" : "Ajouter"} okMsg="Consultant enregistré" errMsg="Enregistrement refusé"
        fn={async () => { if (!f.name.trim()) throw new Error("nom requis"); await upsertConsultant({ ...f, id: initial.id }); onDone(); }} />
    </div>
  );
}

// Plan de charge : grille consultant × mois (allocation cumulée %), + saisie d'affectation. Détecte la
// sur-charge (>100 %) et l'intercontrat (actif non staffé) — le pilotage d'activité du DirOps.
function PlanDeCharge({ canWrite }: { canWrite: boolean }) {
  const [plan, setPlan] = useState<StaffingPlan | null>(null);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [f, setF] = useState<Assignment>({ consultantId: "", startMonth: "", endMonth: "", allocationPct: 100, projectFp: "", label: "", tjmBilled: null });
  const load = useCallback(async () => { setLoading(true); try { setPlan(await staffingPlan()); } catch { setPlan(null); } finally { setLoading(false); } }, []);
  useEffect(() => { load().catch(() => {}); }, [load]);
  const set = (k: keyof Assignment, v: unknown) => setF((p) => ({ ...p, [k]: v }));
  if (loading) return <Card title="Plan de charge"><div className="text-[13px] text-muted py-2">Chargement…</div></Card>;
  if (!plan || !plan.consultants.length) return <Card title="Plan de charge"><Tip>Ajoutez des consultants puis affectez-les à des missions pour visualiser le plan de charge (charge par mois, sur-charge, intercontrat).</Tip></Card>;
  const consuls = plan.consultants;
  const nameById = (id: string) => consuls.find((c) => c.id === id)?.name || id;
  const overN = plan.flags.over.length, idleN = new Set(plan.flags.idle.map((x) => x.id)).size;
  return (
    <Card title="Plan de charge" actions={
      <div className="flex items-center gap-1.5">
        {overN > 0 && <Badge tone="clay">{overN} sur-charge(s)</Badge>}
        {idleN > 0 && <Badge tone="gold">{idleN} en intercontrat</Badge>}
        {canWrite && <button type="button" className="btn-ghost !px-2 !py-1 text-xs" onClick={() => setAdding(!adding)}>{adding ? "Fermer" : "+ Affectation"}</button>}
      </div>}>
      {canWrite && adding && (
        <div className="flex flex-wrap items-end gap-2 text-[13px] border-b border-hair pb-3 mb-3">
          <label className="flex flex-col gap-0.5"><span className="text-[11px] text-muted">Consultant</span>
            <Select ariaLabel="Consultant" className="!py-1 w-44" value={f.consultantId} onChange={(v) => set("consultantId", v)} options={[{ value: "", label: "—" }, ...consuls.map((c) => ({ value: c.id, label: c.name || c.id }))]} /></label>
          <label className="flex flex-col gap-0.5"><span className="text-[11px] text-muted">Projet (FP)</span>
            <input className="field !py-1 w-28" value={f.projectFp || ""} onChange={(e) => set("projectFp", e.target.value)} aria-label="Projet FP" placeholder="FP/26/…" /></label>
          <label className="flex flex-col gap-0.5 grow"><span className="text-[11px] text-muted">Mission</span>
            <input className="field !py-1 w-full" value={f.label || ""} onChange={(e) => set("label", e.target.value)} aria-label="Libellé mission" placeholder="client / mission" /></label>
          <label className="flex flex-col gap-0.5"><span className="text-[11px] text-muted">Début</span>
            <input className="field !py-1 w-28" type="month" value={f.startMonth} onChange={(e) => set("startMonth", e.target.value)} aria-label="Mois de début" /></label>
          <label className="flex flex-col gap-0.5"><span className="text-[11px] text-muted">Fin</span>
            <input className="field !py-1 w-28" type="month" value={f.endMonth} onChange={(e) => set("endMonth", e.target.value)} aria-label="Mois de fin" /></label>
          <label className="flex flex-col gap-0.5"><span className="text-[11px] text-muted">Alloc. %</span>
            <input className="field !py-1 w-20" type="number" value={f.allocationPct} onChange={(e) => set("allocationPct", Number(e.target.value))} aria-label="Allocation %" /></label>
          <label className="flex flex-col gap-0.5"><span className="text-[11px] text-muted">TJM facturé</span>
            <input className="field !py-1 w-24" type="number" value={f.tjmBilled ?? ""} onChange={(e) => set("tjmBilled", e.target.value === "" ? null : Number(e.target.value))} aria-label="TJM facturé" /></label>
          <Busy variant="ghost" label="Affecter" okMsg="Affectation enregistrée" errMsg="Enregistrement refusé"
            fn={async () => { if (!f.consultantId) throw new Error("consultant requis"); if (!f.startMonth || !f.endMonth) throw new Error("période requise"); await upsertAssignment(f); setF({ consultantId: "", startMonth: "", endMonth: "", allocationPct: 100, projectFp: "", label: "", tjmBilled: null }); setAdding(false); load(); }} />
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="text-[12px] border-collapse">
          <thead><tr><th className="text-left px-2 py-1 sticky left-0 bg-bg">Consultant</th>{plan.months.map((m) => <th key={m} className="px-2 py-1 text-center tabnum whitespace-nowrap">{monthLabel(m)}</th>)}</tr></thead>
          <tbody>
            {consuls.map((c) => {
              const active = (c.status || "active") === "active";
              return (
                <tr key={c.id} className="border-t border-hair">
                  <td className="px-2 py-1 sticky left-0 bg-bg whitespace-nowrap">{c.name || c.id}{c.bu ? <span className="text-[10px] text-muted"> · {c.bu}</span> : null}</td>
                  {plan.months.map((m) => { const pct = (plan.byConsultant[c.id] && plan.byConsultant[c.id][m]) || 0; return (
                    <td key={m} className={cx("px-2 py-1 text-center tabnum rounded", loadTone(pct, active))}>{pct > 0 ? `${pct}%` : (active ? "IC" : "—")}</td>
                  ); })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {plan.assignments.length > 0 && (
        <div className="mt-3 border-t border-hair pt-2">
          <div className="text-[11px] text-muted uppercase tracking-wide mb-1">Affectations</div>
          <Table columns={[
            colText("Consultant", (a: Assignment) => nameById(a.consultantId)),
            colText("Mission", (a: Assignment) => a.label || a.projectFp || "—"),
            colText("Période", (a: Assignment) => `${monthLabel(a.startMonth)} → ${monthLabel(a.endMonth)}`),
            colNum("Alloc.", (a: Assignment) => `${a.allocationPct}%`, (a: Assignment) => a.allocationPct),
            colNum("TJM", (a: Assignment) => (a.tjmBilled != null ? money(a.tjmBilled) : "—"), (a: Assignment) => a.tjmBilled ?? 0),
            ...(canWrite ? [colText("", (a: Assignment) => <DangerBtn label="Suppr." okMsg="Affectation supprimée" errMsg="Suppression refusée" confirm="Supprimer cette affectation ?" fn={async () => { await deleteAssignment(a.id!); await load(); }} />)] : []),
          ]} rows={plan.assignments} />
        </div>
      )}
      <Tip>Vert = staffé (≥80 %), rouge = <b>sur-charge</b> (&gt;100 %), <b>IC</b> = intercontrat (actif non staffé). Le plan de charge alimentera les KPI d'activité (TACE) et le rapprochement capacité ⇄ pipeline (lots suivants).</Tip>
    </Card>
  );
}

export const Staffing: FC<Props> = () => {
  const canWrite = useCan("pipeline") === "write";
  const [rows, setRows] = useState<Consultant[]>([]);
  const [canCost, setCanCost] = useState(false);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<string | null>(null); // id en édition, ou "new"
  const load = useCallback(async () => {
    setLoading(true);
    try { const r = await listConsultants(); setRows(r.rows); setCanCost(r.canCost); }
    catch { setRows([]); } finally { setLoading(false); }
  }, []);
  useEffect(() => { load().catch(() => {}); }, [load]);

  const counts = STATUSES.map((s) => ({ ...s, n: rows.filter((r) => (r.status || "active") === s.value).length }));
  const avgTjm = (() => { const v = rows.map((r) => r.tjmTarget).filter((x): x is number => typeof x === "number"); return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : null; })();

  return (
    <div className="flex flex-col gap-4">
      <Card title="Staffing — ressources" actions={
        <div className="flex items-center gap-1.5">
          {counts.map((c) => <Badge key={c.value} tone={c.tone}>{c.label} · {c.n}</Badge>)}
          {canWrite && <button type="button" className="btn-ghost !px-2 !py-1 text-xs" onClick={() => setEditing(editing === "new" ? null : "new")}>{editing === "new" ? "Fermer" : "+ Consultant"}</button>}
        </div>}>
        {canWrite && editing === "new" && (
          <div className="border-b border-hair pb-3 mb-3"><ConsultantForm initial={EMPTY} canCost={canCost} onDone={() => { setEditing(null); load(); }} /></div>
        )}
        {loading ? <div className="text-[13px] text-muted py-2">Chargement…</div> : !rows.length ? (
          <Tip>Aucun consultant. Renseignez vos ressources (grade, BU, TJM/CJM, compétences, statut) pour piloter le <b>plan de charge</b> et les <b>KPI d'activité</b> (TACE, intercontrat) à venir. Le <b>coût (CJM)</b> n'est visible qu'avec le droit « rentabilité ».</Tip>
        ) : (
          <>
            <Table columns={[
              colText("Nom", (c: Consultant) => c.name, (c: Consultant) => c.name),
              colText("Grade", (c: Consultant) => gradeLabel(c.grade)),
              colText("BU", (c: Consultant) => c.bu || "—"),
              colText("Statut", (c: Consultant) => { const m = statusMeta(c.status); return <Badge tone={m.tone}>{m.label}</Badge>; }, (c: Consultant) => c.status || ""),
              colNum("TJM cible", (c: Consultant) => (c.tjmTarget != null ? money(c.tjmTarget) : "—"), (c: Consultant) => c.tjmTarget ?? 0),
              ...(canCost ? [colNum("CJM", (c: Consultant) => (c.cjm != null ? money(c.cjm) : "—"), (c: Consultant) => c.cjm ?? 0),
                colNum("Marge/j", (c: Consultant) => (c.tjmTarget != null && c.cjm != null ? money(c.tjmTarget - c.cjm) : "—"), (c: Consultant) => (c.tjmTarget != null && c.cjm != null ? c.tjmTarget - c.cjm : 0))] : []),
              colText("Compétences", (c: Consultant) => (c.skills && c.skills.length ? c.skills.join(", ") : "—")),
              ...(canWrite ? [colText("", (c: Consultant) => (
                <span className="inline-flex gap-2">
                  <button type="button" className="text-gold hover:underline text-[11px]" onClick={() => setEditing(editing === c.id ? null : c.id!)}>{editing === c.id ? "fermer" : "éditer"}</button>
                  <DangerBtn label="Suppr." okMsg="Consultant supprimé" errMsg="Suppression refusée" confirm={`Supprimer « ${c.name} » ?`} fn={async () => { await deleteConsultant(c.id!); await load(); }} />
                </span>
              ))] : []),
            ]} rows={rows} />
            {canWrite && rows.map((c) => editing === c.id && (
              <div key={`edit-${c.id}`} className={cx("border-t border-hair pt-2 mt-2")}><ConsultantForm initial={c} canCost={canCost} onDone={() => { setEditing(null); load(); }} /></div>
            ))}
            {avgTjm != null && <div className="mt-2 text-[11px] text-muted">TJM cible moyen : <b>{money(avgTjm)}</b> · {rows.length} ressource(s){!canCost && " — coût (CJM) masqué (droit « rentabilité » requis)"}</div>}
          </>
        )}
      </Card>
      <PlanDeCharge canWrite={canWrite} />
    </div>
  );
};
