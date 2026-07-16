// STAFFING — annuaire des consultants / ressources (Lot 11 « 20/10 DirOps »). Fondation du plan de charge
// (Lot 12) et des KPI d'activité (TACE / intercontrat — Lot 13). Comble l'angle mort « métier ESN » de
// l'évaluation Directeur des Opérations : qui sont les ressources, leur grade, TJM/CJM, compétences, statut.
// Le COÛT (CJM) n'est visible que si l'utilisateur a le droit « rentabilité » (confidentialité serveur).
import { useState, useEffect, useCallback, createContext, useContext, type FC, type ReactNode } from "react";
import { useCan } from "../lib/rbac";
import { Card, Tip, Badge, Busy, DangerBtn, Table, colText, colNum, money, det, cx } from "../design/components";
import { PctLine } from "../design/charts";
import { T } from "../design/tokens";
import { Select } from "../design/inputs";
import { listConsultants, upsertConsultant, deleteConsultant, staffingPlan, upsertAssignment, deleteAssignment, activityKpis, capacityPlan, timesheetKpis, upsertTimesheet, importTimesheets, syncClickupTimesheets, listCandidates, upsertCandidate, deleteCandidate, resourcePnl, preBillingFromCra, taceHistory, type Consultant, type ConsultantGrade, type ConsultantStatus, type StaffingPlan, type Assignment, type ActivityKpis, type CapacityPlan, type TimesheetKpis, type Recruitment, type Candidate, type CandidateStatus, type ResourcePnl, type PreBilling, type PreBillingLine, type TaceTrend } from "../lib/writes";
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

// RÉACTIVITÉ CROISÉE (audit cycle de vie, HAUTE) : les cartes « aval » (P&L, pré-facturation, capacité,
// activité, TACE) dérivent leurs chiffres des CRA / affectations / annuaire. Sans signal partagé, elles
// restaient figées sur leur 1er chargement après une saisie CRA ou une affectation → nombres périmés
// jusqu'à un rechargement manuel. Un `nonce` partagé, incrémenté à chaque mutation (bump), est ajouté aux
// dépendances de chargement des cartes → refresh automatique et cohérent de tout l'écran.
const RefreshCtx = createContext<{ nonce: number; bump: () => void }>({ nonce: 0, bump: () => {} });
const useStaffingRefresh = () => useContext(RefreshCtx);
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
      <label className="flex flex-col gap-0.5"><span className="text-[11px] text-muted">ID ClickUp</span>
        <input className="field !py-1 w-28" value={f.clickupUserId || ""} onChange={(e) => set("clickupUserId", e.target.value)} aria-label="Identifiant utilisateur ClickUp" placeholder="ex. 1234567" /></label>
      <label className="flex flex-col gap-0.5 grow"><span className="text-[11px] text-muted">Compétences (virgules)</span>
        <input className="field !py-1 w-full" value={(f.skills || []).join(", ")} onChange={(e) => set("skills", e.target.value.split(",").map((s) => s.trim()).filter(Boolean))} aria-label="Compétences" placeholder="Java, AWS, DevOps…" /></label>
      <Busy variant="ghost" label={initial.id ? "Enregistrer" : "Ajouter"} okMsg="Consultant enregistré" errMsg="Enregistrement refusé"
        fn={async () => { if (!f.name.trim()) throw new Error("nom requis"); await upsertConsultant({ ...f, id: initial.id }); onDone(); }} />
    </div>
  );
}

// Cockpit d'activité (Lot 13) : KPI de pilotage DirOps sur les 6 prochains mois — occupation prévisionnelle,
// intercontrat, CA staffé et marge (si droit coût), + palmarès par BU et consultants les moins occupés.
function stat(label: string, value: ReactNode, tone?: string) {
  return <div className="flex flex-col gap-0.5 min-w-[8rem]"><span className="text-[11px] text-muted uppercase tracking-wide">{label}</span><span className={cx("font-display tabnum text-xl leading-tight", tone)}>{value}</span></div>;
}
function ActivityCockpit() {
  const [k, setK] = useState<ActivityKpis | null>(null);
  const [loading, setLoading] = useState(true);
  const { nonce } = useStaffingRefresh();
  useEffect(() => { activityKpis().then(setK).catch(() => setK(null)).finally(() => setLoading(false)); }, [nonce]);
  if (loading) return <Card title="Activité — pilotage (6 mois)"><div className="text-[13px] text-muted py-2">Calcul des KPI…</div></Card>;
  if (!k || !k.global.headcount) return <Card title="Activité — pilotage (6 mois)"><Tip>Renseignez consultants et affectations pour obtenir les KPI d'activité : taux d'occupation, intercontrat, CA staffé prévisionnel.</Tip></Card>;
  const g = k.global;
  const occTone = g.occupancyPct >= 85 ? "text-emerald" : g.occupancyPct >= 70 ? "text-gold" : "text-clay";
  const icTone = g.intercontratPct <= 10 ? "text-emerald" : g.intercontratPct <= 20 ? "text-gold" : "text-clay";
  return (
    <Card title="Activité — pilotage (6 mois)">
      <div className="flex flex-wrap gap-x-8 gap-y-3">
        {stat("Taux d'occupation", `${g.occupancyPct}%`, occTone)}
        {k.occupancyTargetPct != null && stat("Objectif", `${k.occupancyTargetPct}%`, g.occupancyPct >= k.occupancyTargetPct ? "text-emerald" : "text-clay")}
        {stat("Intercontrat", `${g.intercontratPct}%`, icTone)}
        {stat("Effectif actif", `${g.active}/${g.headcount}`)}
        {stat("CA staffé prév.", money(g.revenueForecast))}
        {k.canCost && g.marginForecast != null && stat("Marge prév.", money(g.marginForecast), g.marginForecast >= 0 ? "text-emerald" : "text-clay")}
      </div>
      {!!k.belowTargetCount && <div className="mt-3 text-[13px] rounded px-3 py-2 bg-clay/15 text-clay"><b>{k.belowTargetCount}</b> ressource(s) active(s) <b>sous l'objectif</b> d'occupation → repositionner / avant-vente. Objectifs paramétrables dans Habilitations.</div>}
      {k.byBu.length > 1 && (
        <div className="mt-4 border-t border-hair pt-3">
          <div className="text-[11px] text-muted uppercase tracking-wide mb-1">Par business unit</div>
          <Table columns={[
            colText("BU", (b) => b.bu),
            colNum("Effectif", (b) => `${b.active}/${b.headcount}`, (b) => b.headcount),
            colNum("Occupation", (b) => `${b.occupancyPct}%`, (b) => b.occupancyPct),
            colNum("CA staffé prév.", (b) => money(b.revenueForecast), (b) => b.revenueForecast),
            ...(k.canCost ? [colNum("Marge prév.", (b) => (b.marginForecast != null ? money(b.marginForecast) : "—"), (b) => b.marginForecast ?? 0)] : []),
          ]} rows={k.byBu} />
        </div>
      )}
      <div className="mt-3 border-t border-hair pt-2">
        <div className="text-[11px] text-muted uppercase tracking-wide mb-1">Ressources les moins occupées (à repositionner)</div>
        <Table columns={[
          colText("Consultant", (r) => <span className={cx(r.isBelow && "text-clay")}>{r.name || r.id}</span>, (r) => r.name || ""),
          colText("BU", (r) => r.bu || "—"),
          // Statut TRADUIT (badge) — cohérent avec la table Staffing ; ne pas laisser fuir le code brut (« active »).
          colText("Statut", (r) => { const m = statusMeta(r.status); return <Badge tone={m.tone}>{m.label}</Badge>; }, (r) => r.status || ""),
          colNum("Occupation", (r) => `${r.occupancyPct}%`, (r) => r.occupancyPct),
          colNum("Objectif", (r) => (r.targetPct != null ? `${r.targetPct}%` : "—"), (r) => r.targetPct ?? 0),
          colNum("Mois IC", (r) => String(r.idleMonths), (r) => r.idleMonths),
        ]} rows={k.rows.filter((r) => ["active", "intercontrat"].includes(r.status || "active")).slice(0, 8)} />
      </div>
      <Tip>KPI <b>prévisionnels</b> dérivés du plan de charge (affectations planifiées, ~20 j ouvrés/mois) — pas un CRA réel. Le CA/marge staffés supposent le coût de <b>banc</b> (un actif non staffé coûte). Confidentialité : la marge n'apparaît qu'avec le droit « rentabilité ».</Tip>
    </Card>
  );
}

// Rentabilité par ressource (Lot 17) : P&L par consultant dérivé du CRA — CONFIDENTIEL (droit rentabilité).
// N'est monté que si l'utilisateur a le droit « rentabilité » (sinon la carte n'apparaît pas).
function ResourcePnlCard() {
  const [p, setP] = useState<ResourcePnl | null>(null);
  const [loading, setLoading] = useState(true);
  const { nonce } = useStaffingRefresh();
  useEffect(() => { resourcePnl().then(setP).catch(() => setP(null)).finally(() => setLoading(false)); }, [nonce]);
  if (loading) return <Card title="Rentabilité par ressource (6 mois)"><div className="text-[13px] text-muted py-2">Calcul…</div></Card>;
  if (!p || !p.global.headcount) return <Card title="Rentabilité par ressource (6 mois)"><Tip>Saisissez des CRA (jours facturés) et renseignez TJM/CJM des consultants pour obtenir le P&L par ressource.</Tip></Card>;
  const g = p.global;
  return (
    <Card title="Rentabilité par ressource (6 mois)">
      <div className="flex flex-wrap gap-x-8 gap-y-3">
        {stat("CA réel", money(g.caReal))}
        {g.cost != null && stat("Coût", money(g.cost))}
        {g.margin != null && stat("Marge", money(g.margin), g.margin >= 0 ? "text-emerald" : "text-clay")}
        {g.marginPct != null && stat("Taux de marge", `${g.marginPct}%`, g.marginPct >= 20 ? "text-emerald" : g.marginPct >= 0 ? "text-gold" : "text-clay")}
        {stat("Jours facturés", String(g.billedDays))}
      </div>
      {p.byGrade.length > 1 && (
        <div className="mt-4 border-t border-hair pt-3">
          <div className="text-[11px] text-muted uppercase tracking-wide mb-1">Par grade</div>
          <Table columns={[
            colText("Grade", (b) => b.key),
            colNum("Effectif", (b) => String(b.headcount), (b) => b.headcount),
            colNum("CA réel", (b) => money(b.caReal), (b) => b.caReal),
            colNum("Marge", (b) => (b.margin != null ? money(b.margin) : "—"), (b) => b.margin ?? 0),
            colNum("Taux", (b) => (b.marginPct != null ? `${b.marginPct}%` : "—"), (b) => b.marginPct ?? 0),
          ]} rows={p.byGrade} />
        </div>
      )}
      <div className="mt-3 border-t border-hair pt-2">
        <div className="text-[11px] text-muted uppercase tracking-wide mb-1">Par consultant (marge décroissante)</div>
        <Table columns={[
          // « à définir » signale un TJM/CJM manquant : sinon le consultant apparaît en perte (ou CA nul)
          // sans explication et tire la marge globale vers le bas silencieusement.
          det(colText("Consultant", (r) => (
            <span className="inline-flex items-center gap-1.5">
              {r.name || r.id}
              {r.missingTjm && <Badge tone="gold">TJM à définir</Badge>}
              {r.missingCjm && <Badge tone="steel">CJM à définir</Badge>}
            </span>
          ), (r) => r.name || "")),
          colText("Grade", (r) => r.grade || "—"),
          colText("BU", (r) => r.bu || "—"),
          colNum("J. fact.", (r) => String(r.billedDays), (r) => r.billedDays),
          colNum("CA réel", (r) => (r.missingTjm ? "—" : money(r.caReal)), (r) => r.caReal),
          colNum("Marge", (r) => (r.margin != null ? money(r.margin) : "—"), (r) => r.margin ?? 0),
          colNum("Taux", (r) => (r.marginPct != null ? `${r.marginPct}%` : "—"), (r) => r.marginPct ?? 0),
        ]} rows={p.rows} />
      </div>
      <Tip>CA réel = jours <b>facturés</b> (CRA) × TJM — <b>taux contractualisé</b> de l'affectation couvrant chaque mois en priorité (identique à la <b>Pré-facturation</b>), à défaut le TJM cible. Coût = jours ouvrés × CJM (coût de banc inclus). « <span className="text-gold">TJM/CJM à définir</span> » = donnée manquante à compléter dans l'<b>annuaire</b>. Donnée <b>confidentielle</b> — droit « rentabilité ».</Tip>
    </Card>
  );
}

// Historisation TACE + tendance (Lot 22) : courbe MENSUELLE du TACE constaté (congés exclus) + occupation,
// dérivée des CRA à la demande (pas de snapshot périmé). Sort du « chiffre unique » : on voit si le TACE
// progresse ou se dégrade, avec une pente (régression linéaire) et l'écart au mois précédent.
const dirMeta = (d: string) => d === "up" ? { tone: "emerald" as const, label: "en hausse" } : d === "down" ? { tone: "clay" as const, label: "en baisse" } : { tone: "steel" as const, label: "stable" };
const taceTone = (v: number | null) => v == null ? undefined : v >= 80 ? "text-emerald" : v >= 70 ? "text-gold" : "text-clay";
function TaceTrendCard() {
  const [d, setD] = useState<TaceTrend | null>(null);
  const [loading, setLoading] = useState(true);
  const { nonce } = useStaffingRefresh();
  useEffect(() => { taceHistory().then(setD).catch(() => setD(null)).finally(() => setLoading(false)); }, [nonce]);
  if (loading) return <Card title="Tendance TACE (12 mois)"><div className="text-[13px] text-muted py-2">Calcul…</div></Card>;
  if (!d || !d.summary.points) return <Card title="Tendance TACE (12 mois)"><Tip>Saisissez des CRA sur plusieurs mois pour visualiser la <b>tendance</b> du TACE (Taux d'Activité Congés Exclus) et détecter une dérive avant qu'elle ne pèse sur la marge.</Tip></Card>;
  const s = d.summary;
  const m = dirMeta(s.direction);
  const chart = d.series.map((p) => ({ name: monthLabel(p.month), TACE: p.tacePct, Occupation: p.occupancyPct }));
  return (
    <Card title="Tendance TACE (12 mois)" actions={
      <Badge tone={m.tone}>{m.label}{s.slope != null && s.slope !== 0 ? ` · ${s.slope > 0 ? "+" : ""}${s.slope} pt/mois` : ""}</Badge>}>
      <div className="flex flex-wrap gap-x-8 gap-y-3">
        {stat("TACE dernier mois", s.latest != null ? `${s.latest}%` : "—", taceTone(s.latest))}
        {stat("Moyenne période", s.avg != null ? `${s.avg}%` : "—")}
        {s.delta != null && stat("Δ vs mois préc.", `${s.delta > 0 ? "+" : ""}${s.delta} pt`, s.delta >= 0 ? "text-emerald" : "text-clay")}
        {stat("Mois renseignés", String(s.points))}
      </div>
      <PctLine data={chart} series={[{ key: "TACE", color: T.emerald, name: "TACE" }, { key: "Occupation", color: T.gold, name: "Occupation" }]} />
      <Tip>TACE = jours <b>facturés</b> ÷ jours ouvrables (<b>congés exclus</b>). Occupation = (facturés + internes) ÷ jours ouvrés. Courbe <b>dérivée des CRA à la demande</b> : corriger un CRA passé met à jour la tendance (pas de snapshot figé). La <b>pente</b> = régression linéaire sur les mois renseignés — au-delà de ±1 pt/mois, on parle de tendance.</Tip>
    </Card>
  );
}

// Pré-facturation depuis le CRA (Lot 21) : proposition de facturation mensuelle = jours FACTURÉS × TJM
// (taux d'affectation prioritaire, sinon TJM cible). LECTURE SEULE — ne crée aucune facture ; c'est un
// cadrage exportable (CSV) pour transmettre à la compta et ne rien oublier de facturer. Confidentiel
// (TJM/CA par ressource) → même porte que le P&L (droit « rentabilité »).
const tjmSourceLabel = (s: string) => (s === "assignment" ? "affectation" : s === "target" ? "cible" : "—");
function PreFacturation() {
  const [p, setP] = useState<PreBilling | null>(null);
  const [loading, setLoading] = useState(true);
  const { nonce } = useStaffingRefresh();
  useEffect(() => { preBillingFromCra().then(setP).catch(() => setP(null)).finally(() => setLoading(false)); }, [nonce]);
  if (loading) return <Card title="Pré-facturation (CRA → à facturer)"><div className="text-[13px] text-muted py-2">Calcul…</div></Card>;
  if (!p || !p.global.lines) return <Card title="Pré-facturation (CRA → à facturer)"><Tip>Saisissez des CRA avec des <b>jours facturés</b> et renseignez le TJM (annuaire ou affectation) : nt360 propose ici le <b>montant HT à facturer</b> par consultant/BU/mois, exportable pour la compta.</Tip></Card>;
  const g = p.global;
  return (
    <Card title="Pré-facturation (CRA → à facturer)">
      <div className="flex flex-wrap gap-x-8 gap-y-3">
        {stat("À facturer (HT)", money(g.amountHt), "text-emerald")}
        {stat("Jours facturés", String(g.billedDays))}
        {stat("Lignes", String(g.lines))}
        {g.missingTjm > 0 && stat("Sans TJM", String(g.missingTjm), "text-clay")}
      </div>
      {p.byBu.length > 1 && (
        <div className="mt-4 border-t border-hair pt-3">
          <div className="text-[11px] text-muted uppercase tracking-wide mb-1">Par BU</div>
          <Table columns={[
            colText("BU", (b) => b.key),
            colNum("Jours", (b) => String(b.billedDays), (b) => b.billedDays),
            colNum("À facturer (HT)", (b) => money(b.amountHt), (b) => b.amountHt),
          ]} rows={p.byBu} />
        </div>
      )}
      {p.byMonth.length > 1 && (
        <div className="mt-3 border-t border-hair pt-2">
          <div className="text-[11px] text-muted uppercase tracking-wide mb-1">Par mois</div>
          <Table columns={[
            colText("Mois", (b) => monthLabel(b.key)),
            colNum("Jours", (b) => String(b.billedDays), (b) => b.billedDays),
            colNum("À facturer (HT)", (b) => money(b.amountHt), (b) => b.amountHt),
          ]} rows={p.byMonth} />
        </div>
      )}
      <div className="mt-3 border-t border-hair pt-2">
        <div className="text-[11px] text-muted uppercase tracking-wide mb-1">Détail (à transmettre à la facturation)</div>
        <Table colsKey="prefac-lines" columns={[
          colText("Mois", (r: PreBillingLine) => monthLabel(r.month), (r: PreBillingLine) => r.month),
          colText("Consultant", (r: PreBillingLine) => r.name),
          colText("BU", (r: PreBillingLine) => r.bu || "—"),
          colText("Mission (FP)", (r: PreBillingLine) => r.projectFp || "—"),
          colNum("Jours fact.", (r: PreBillingLine) => String(r.billedDays), (r: PreBillingLine) => r.billedDays),
          colNum("TJM", (r: PreBillingLine) => (r.tjm != null ? money(r.tjm) : <Badge tone="clay">à définir</Badge>), (r: PreBillingLine) => r.tjm ?? 0),
          colText("Source TJM", (r: PreBillingLine) => (r.ambiguousRate ? <Badge tone="gold">cible (taux ambigu)</Badge> : tjmSourceLabel(r.tjmSource))),
          colNum("À facturer (HT)", (r: PreBillingLine) => money(r.amountHt), (r: PreBillingLine) => r.amountHt),
        ]} rows={p.lines} />
      </div>
      <Tip>Montant HT = jours <b>facturés</b> (CRA) × TJM. Le TJM retenu est celui de l'<b>affectation</b> (taux contractualisé) s'il est connu et non ambigu, sinon le <b>TJM cible</b> de l'annuaire. Vue <b>lecture seule</b> : aucune facture n'est créée — exportez le détail (bouton CSV) pour la compta. Les lignes « à définir » n'ont pas de TJM : à tarifer avant facturation.</Tip>
    </Card>
  );
}

// Vivier / recrutement (Lot 16) : pipeline de candidats rattaché au gap de capacité (Lot 14). Ferme la
// boucle « capacité ⇄ pipeline ⇄ recrutement » — le DirOps voit si le vivier couvre le besoin par BU.
const CAND_STATUS: { value: CandidateStatus; label: string; tone: "steel" | "gold" | "emerald" | "clay" }[] = [
  { value: "sourced", label: "Sourcé", tone: "steel" }, { value: "interview", label: "Entretien", tone: "gold" },
  { value: "offer", label: "Offre", tone: "emerald" }, { value: "hired", label: "Recruté", tone: "emerald" }, { value: "rejected", label: "Écarté", tone: "clay" },
];
const candMeta = (s?: string) => CAND_STATUS.find((x) => x.value === s) || CAND_STATUS[0];
function Vivier({ canWrite }: { canWrite: boolean }) {
  const [r, setR] = useState<Recruitment | null>(null);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [f, setF] = useState<Candidate>({ name: "", gradeTarget: "confirme", bu: "", status: "sourced", skills: [], tjmTarget: null, expectedStartMonth: null, source: "" });
  const load = useCallback(async () => { setLoading(true); try { setR(await listCandidates()); } catch { setR(null); } finally { setLoading(false); } }, []);
  useEffect(() => { load().catch(() => {}); }, [load]);
  const setk = (k: keyof Candidate, v: unknown) => setF((p) => ({ ...p, [k]: v }));
  if (loading) return <Card title="Vivier — recrutement"><div className="text-[13px] text-muted py-2">Chargement…</div></Card>;
  return (
    <Card title="Vivier — recrutement" actions={
      <div className="flex flex-wrap items-center justify-end gap-1.5">
        {r && CAND_STATUS.slice(0, 3).map((s) => <Badge key={s.value} tone={s.tone}>{s.label} · {r.counts[s.value]}</Badge>)}
        {canWrite && <button type="button" className="btn-ghost !px-2 !py-1 text-xs" onClick={() => setAdding(!adding)}>{adding ? "Fermer" : "+ Candidat"}</button>}
      </div>}>
      {canWrite && adding && (
        <div className="flex flex-wrap items-end gap-2 text-[13px] border-b border-hair pb-3 mb-3">
          <label className="flex flex-col gap-0.5"><span className="text-[11px] text-muted">Nom</span>
            <input className="field !py-1 w-40" value={f.name} onChange={(e) => setk("name", e.target.value)} aria-label="Nom du candidat" /></label>
          <label className="flex flex-col gap-0.5"><span className="text-[11px] text-muted">Grade visé</span>
            <Select ariaLabel="Grade visé" className="!py-1 w-32" value={f.gradeTarget || "confirme"} onChange={(v) => setk("gradeTarget", v)} options={GRADES} /></label>
          <label className="flex flex-col gap-0.5"><span className="text-[11px] text-muted">BU</span>
            <input className="field !py-1 w-24" value={f.bu || ""} onChange={(e) => setk("bu", e.target.value)} aria-label="BU visée" /></label>
          <label className="flex flex-col gap-0.5"><span className="text-[11px] text-muted">Statut</span>
            <Select ariaLabel="Statut candidat" className="!py-1 w-32" value={f.status || "sourced"} onChange={(v) => setk("status", v)} options={CAND_STATUS} /></label>
          <label className="flex flex-col gap-0.5"><span className="text-[11px] text-muted">TJM visé</span>
            <input className="field !py-1 w-24" type="number" value={f.tjmTarget ?? ""} onChange={(e) => setk("tjmTarget", e.target.value === "" ? null : Number(e.target.value))} aria-label="TJM visé" /></label>
          <label className="flex flex-col gap-0.5 grow"><span className="text-[11px] text-muted">Compétences</span>
            <input className="field !py-1 w-full" value={(f.skills || []).join(", ")} onChange={(e) => setk("skills", e.target.value.split(",").map((s) => s.trim()).filter(Boolean))} aria-label="Compétences" placeholder="Java, AWS…" /></label>
          <Busy variant="ghost" label="Ajouter" okMsg="Candidat enregistré" errMsg="Enregistrement refusé"
            fn={async () => { if (!f.name.trim()) throw new Error("nom requis"); await upsertCandidate(f); setF({ name: "", gradeTarget: "confirme", bu: "", status: "sourced", skills: [], tjmTarget: null, expectedStartMonth: null, source: "" }); setAdding(false); load(); }} />
        </div>
      )}
      {!r || !r.rows.length ? (
        <Tip>Aucun candidat. Alimentez le vivier quand une BU est en <b>sous-capacité</b> (cf. « Capacité ⇄ pipeline ») : chaque candidat contribue à la <b>capacité future attendue</b> (pondérée par l'avancement : offre &gt; entretien &gt; sourcé).</Tip>
      ) : (
        <>
          {r.byBu.length > 0 && (
            <div className="mb-3">
              <div className="text-[11px] text-muted uppercase tracking-wide mb-1">Capacité future attendue par BU (embauches pondérées)</div>
              <Table columns={[
                colText("BU", (b) => b.bu),
                colNum("En cours", (b) => String(b.active), (b) => b.active),
                colNum("Embauches attendues", (b) => b.expectedHires.toFixed(1), (b) => b.expectedHires),
              ]} rows={r.byBu} />
            </div>
          )}
          <Table columns={[
            colText("Candidat", (c: Candidate) => c.name, (c: Candidate) => c.name || ""),
            colText("Grade visé", (c: Candidate) => c.gradeTarget || "—"),
            colText("BU", (c: Candidate) => c.bu || "—"),
            colText("Statut", (c: Candidate) => { const m = candMeta(c.status); return <Badge tone={m.tone}>{m.label}</Badge>; }, (c: Candidate) => c.status || ""),
            colText("Compétences", (c: Candidate) => (c.skills && c.skills.length ? c.skills.join(", ") : "—")),
            ...(canWrite ? [colText("", (c: Candidate) => (
              <span className="inline-flex gap-2">
                {c.status !== "hired" && c.status !== "rejected" && <Busy variant="ghost" label="→ suivant" okMsg="Statut avancé" errMsg="Refusé" fn={async () => { const order: CandidateStatus[] = ["sourced", "interview", "offer", "hired"]; const next = order[Math.min(order.length - 1, order.indexOf((c.status as CandidateStatus) || "sourced") + 1)]; await upsertCandidate({ ...c, status: next }); await load(); }} />}
                <DangerBtn label="Suppr." okMsg="Candidat supprimé" errMsg="Suppression refusée" confirm={`Supprimer « ${c.name} » ?`} fn={async () => { await deleteCandidate(c.id!); await load(); }} />
              </span>
            ))] : []),
          ]} rows={r.rows} />
        </>
      )}
      <Tip>Le vivier ferme la boucle : une BU en <b>sous-capacité</b> (Lot 14) se traite ici. La <b>capacité future attendue</b> = Σ candidats pondérés par leur avancement (offre 0,7 · entretien 0,3 · sourcé 0,1) → à rapprocher du gap en ETP.</Tip>
    </Card>
  );
}

// CRA / temps constaté (Lot 15) : TACE et occupation RÉELS (mesurés), comparés au prévisionnel du plan.
// Sort du « tout prévisionnel » — le DirOps pilote sur des faits, pas seulement des plans.
function ConstatCra({ consultants, canWrite }: { consultants: Consultant[]; canWrite: boolean }) {
  const [k, setK] = useState<TimesheetKpis | null>(null);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [importPaste, setImportPaste] = useState<string | null>(null);
  const [f, setF] = useState({ consultantId: "", month: "", billedDays: "", leaveDays: "", internalDays: "" });
  const { nonce, bump } = useStaffingRefresh();
  const load = useCallback(async () => { setLoading(true); try { setK(await timesheetKpis()); } catch { setK(null); } finally { setLoading(false); } }, []);
  // nonce : recharge aussi quand une affectation/annuaire change ailleurs (occupation prévue dérivée).
  useEffect(() => { load().catch(() => {}); }, [load, nonce]);
  if (loading) return <Card title="CRA — activité constatée (6 mois)"><div className="text-[13px] text-muted py-2">Chargement…</div></Card>;
  const g = k?.global;
  const delta = g ? g.occupancyPct - (k!.plannedOccupancyPct || 0) : 0;
  return (
    <Card title="CRA — activité constatée (6 mois)" actions={canWrite && (
      <div className="flex flex-wrap items-center justify-end gap-1.5">
        <Busy variant="ghost" label="Synchroniser ClickUp" okMsg="Jours facturés synchronisés" errMsg="Synchro ClickUp indisponible"
          fn={async () => { const r = await syncClickupTimesheets(); await load(); bump(); if (!r.upserts) throw new Error(`Aucune entrée exploitable (${r.entries} entrée(s) ClickUp, ${r.mapped} consultant(s) mappé(s)). Renseignez l'« ID ClickUp » des consultants.`); }} />
        <button type="button" className="btn-ghost !px-2 !py-1 text-xs" onClick={() => { setImportPaste(importPaste == null ? "" : null); setAdding(false); }}>{importPaste != null ? "Fermer" : "Importer (coller)"}</button>
        <button type="button" className="btn-ghost !px-2 !py-1 text-xs" onClick={() => { setAdding(!adding); setImportPaste(null); }}>{adding ? "Fermer" : "+ Saisie CRA"}</button>
      </div>)}>
      {canWrite && importPaste != null && (
        <div className="border-b border-hair pb-3 mb-3 flex flex-col gap-2">
          <div className="text-[11px] text-muted">Collez un tableau (depuis ClickUp/Excel) — une ligne par CRA : <code>Nom · AAAA-MM · jours facturés · congés · internes</code> (séparateur tabulation, « ; » ou « , »).</div>
          <textarea className="field !py-1 w-full font-mono text-[12px]" rows={5} value={importPaste} onChange={(e) => setImportPaste(e.target.value)} aria-label="Coller les CRA"
            placeholder={"Alice\t2026-01\t18\t2\t0\nBob\t2026-01\t20\t0\t0"} />
          <div className="flex items-center gap-2">
            <Busy variant="ghost" label="Importer" okMsg="CRA importés" errMsg="Import refusé"
              fn={async () => { const r = await importTimesheets(importPaste || ""); setImportPaste(null); await load(); bump(); if (r.errorCount) throw new Error(`${r.imported} importé(s), ${r.errorCount} erreur(s) — ex. : ${r.errors[0]?.reason || ""}`); }} />
            <span className="text-[11px] text-muted">Résout les noms contre l'annuaire ; ré-import = mise à jour (1 CRA par consultant×mois).</span>
          </div>
        </div>
      )}
      {canWrite && adding && (
        <div className="flex flex-wrap items-end gap-2 text-[13px] border-b border-hair pb-3 mb-3">
          <label className="flex flex-col gap-0.5"><span className="text-[11px] text-muted">Consultant</span>
            <Select ariaLabel="Consultant CRA" className="!py-1 w-44" value={f.consultantId} onChange={(v) => setF({ ...f, consultantId: v })} options={[{ value: "", label: "—" }, ...consultants.map((c) => ({ value: c.id!, label: c.name }))]} /></label>
          <label className="flex flex-col gap-0.5"><span className="text-[11px] text-muted">Mois</span>
            <input className="field !py-1 w-28" type="month" value={f.month} onChange={(e) => setF({ ...f, month: e.target.value })} aria-label="Mois du CRA" /></label>
          <label className="flex flex-col gap-0.5"><span className="text-[11px] text-muted">J. facturés</span>
            <input className="field !py-1 w-20" type="number" value={f.billedDays} onChange={(e) => setF({ ...f, billedDays: e.target.value })} aria-label="Jours facturés" /></label>
          <label className="flex flex-col gap-0.5"><span className="text-[11px] text-muted">J. congés</span>
            <input className="field !py-1 w-20" type="number" value={f.leaveDays} onChange={(e) => setF({ ...f, leaveDays: e.target.value })} aria-label="Jours de congé" /></label>
          <label className="flex flex-col gap-0.5"><span className="text-[11px] text-muted">J. internes</span>
            <input className="field !py-1 w-20" type="number" value={f.internalDays} onChange={(e) => setF({ ...f, internalDays: e.target.value })} aria-label="Jours internes" /></label>
          <Busy variant="ghost" label="Enregistrer" okMsg="CRA enregistré" errMsg="Enregistrement refusé"
            fn={async () => { if (!f.consultantId) throw new Error("consultant requis"); if (!f.month) throw new Error("mois requis"); await upsertTimesheet({ consultantId: f.consultantId, month: f.month, billedDays: Number(f.billedDays) || 0, leaveDays: Number(f.leaveDays) || 0, internalDays: Number(f.internalDays) || 0 }); setF({ consultantId: "", month: "", billedDays: "", leaveDays: "", internalDays: "" }); setAdding(false); load(); bump(); }} />
        </div>
      )}
      {!g || !g.reportedConsultants ? (
        <Tip>Aucun CRA saisi sur la période. Saisissez les jours <b>facturés / congés / internes</b> par consultant et par mois pour obtenir le <b>TACE constaté</b> et le comparer au prévisionnel du plan de charge.</Tip>
      ) : (
        <>
          <div className="flex flex-wrap gap-x-8 gap-y-3">
            {stat("TACE constaté", `${g.tacePct}%`, g.tacePct >= 85 ? "text-emerald" : g.tacePct >= 70 ? "text-gold" : "text-clay")}
            {stat("Occupation constatée", `${g.occupancyPct}%`)}
            {stat("Occupation prévue", `${k!.plannedOccupancyPct}%`)}
            {stat("Écart réel − prévu", `${delta > 0 ? "+" : ""}${delta} pts`, delta >= 0 ? "text-emerald" : "text-clay")}
            {stat("Consultants renseignés", String(g.reportedConsultants))}
          </div>
          <div className="mt-3 border-t border-hair pt-2">
            <Table columns={[
              colText("Consultant", (r) => r.name),
              colNum("J. facturés", (r) => String(r.billedDays), (r) => r.billedDays),
              colNum("J. congés", (r) => String(r.leaveDays), (r) => r.leaveDays),
              colNum("J. internes", (r) => String(r.internalDays), (r) => r.internalDays),
              colNum("TACE", (r) => `${r.tacePct}%`, (r) => r.tacePct),
              colNum("Occupation", (r) => `${r.occupancyPct}%`, (r) => r.occupancyPct),
            ]} rows={k!.rows} />
          </div>
        </>
      )}
      <Tip>TACE = jours <b>facturés</b> ÷ jours ouvrables (congés exclus). Le constaté (mesuré) est comparé à l'occupation <b>prévue</b> du plan de charge → un écart négatif signale une dérive à corriger (avant-vente, repositionnement).</Tip>
    </Card>
  );
}

// Capacité ⇄ pipeline (Lot 14) : ai-je la capacité de délivrance pour honorer le pipeline qui va closer ?
// Gap négatif = besoin de recrutement ; positif = banc à risque. En jours-homme et équivalents ETP.
function CapacityPipeline() {
  const [c, setC] = useState<CapacityPlan | null>(null);
  const [loading, setLoading] = useState(true);
  const { nonce } = useStaffingRefresh();
  useEffect(() => { capacityPlan().then(setC).catch(() => setC(null)).finally(() => setLoading(false)); }, [nonce]);
  if (loading) return <Card title="Capacité ⇄ pipeline (6 mois)"><div className="text-[13px] text-muted py-2">Calcul…</div></Card>;
  if (!c) return <Card title="Capacité ⇄ pipeline (6 mois)"><Tip>Renseignez consultants, affectations et opportunités ouvertes pour rapprocher la capacité de délivrance du pipeline à venir.</Tip></Card>;
  const under = c.gapDays < 0;
  const gapTone = under ? "text-clay" : c.gapDays === 0 ? "text-ink" : "text-emerald";
  return (
    <Card title="Capacité ⇄ pipeline (6 mois)">
      <div className="flex flex-wrap gap-x-8 gap-y-3">
        {stat("Capacité dispo.", `${c.capacityDays} j`)}
        {stat("Demande pipeline", `${c.demandDays} j`)}
        {stat("Écart", `${c.gapDays > 0 ? "+" : ""}${c.gapDays} j`, gapTone)}
        {stat("Équivalent ETP", `${c.fteGap > 0 ? "+" : ""}${c.fteGap}`, gapTone)}
        {stat("Opps ouvertes", String(c.openOppCount))}
      </div>
      <div className={cx("mt-3 text-[13px] rounded px-3 py-2", under ? "bg-clay/15 text-clay" : "bg-emerald/15 text-emerald")}>
        {under
          ? <><b>Sous-capacité</b> : ~{Math.abs(c.fteGap)} ETP manquant(s) pour délivrer le pipeline pondéré → anticiper le <b>recrutement</b> / la sous-traitance.</>
          : <>✓ <b>Capacité suffisante</b> : ~{c.fteGap} ETP disponible(s) au-delà du pipeline pondéré → risque de <b>banc</b>, pousser l'avant-vente.</>}
      </div>
      {c.byBu.length > 1 && (
        <div className="mt-3 border-t border-hair pt-2">
          <div className="text-[11px] text-muted uppercase tracking-wide mb-1">Par business unit (jours-homme)</div>
          <Table columns={[
            colText("BU", (b) => b.bu),
            colNum("Capacité", (b) => `${b.capacityDays} j`, (b) => b.capacityDays),
            colNum("Demande", (b) => `${b.demandDays} j`, (b) => b.demandDays),
            colNum("Écart", (b) => `${b.gapDays > 0 ? "+" : ""}${b.gapDays} j`, (b) => b.gapDays),
            colNum("ETP", (b) => `${b.fteGap > 0 ? "+" : ""}${b.fteGap}`, (b) => b.fteGap),
          ]} rows={c.byBu} />
        </div>
      )}
      <Tip>Demande = Σ du <b>pipeline pondéré</b> (projection <b>tiérée</b> par palier d'IdC — Certitudes/Forecast/Pipe, réglée en Habilitations) des opportunités ouvertes ÷ TJM moyen ({money(c.tjm)}). Capacité = jours-homme <b>non staffés</b> des actifs. Rapprochement <b>prévisionnel</b> — respecte votre périmètre de visibilité sur le pipeline.</Tip>
    </Card>
  );
}

// Plan de charge : grille consultant × mois (allocation cumulée %), + saisie d'affectation. Détecte la
// sur-charge (>100 %) et l'intercontrat (actif non staffé) — le pilotage d'activité du DirOps.
function PlanDeCharge({ canWrite }: { canWrite: boolean }) {
  const [plan, setPlan] = useState<StaffingPlan | null>(null);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [f, setF] = useState<Assignment>({ consultantId: "", startMonth: "", endMonth: "", allocationPct: 100, projectFp: "", label: "", tjmBilled: null });
  const { nonce, bump } = useStaffingRefresh();
  const load = useCallback(async () => { setLoading(true); try { setPlan(await staffingPlan()); } catch { setPlan(null); } finally { setLoading(false); } }, []);
  useEffect(() => { load().catch(() => {}); }, [load, nonce]);
  const set = (k: keyof Assignment, v: unknown) => setF((p) => ({ ...p, [k]: v }));
  if (loading) return <Card title="Plan de charge"><div className="text-[13px] text-muted py-2">Chargement…</div></Card>;
  if (!plan || !plan.consultants.length) return <Card title="Plan de charge"><Tip>Ajoutez des consultants puis affectez-les à des missions pour visualiser le plan de charge (charge par mois, sur-charge, intercontrat).</Tip></Card>;
  const consuls = plan.consultants;
  const nameById = (id: string) => consuls.find((c) => c.id === id)?.name || id;
  const overN = plan.flags.over.length, idleN = new Set(plan.flags.idle.map((x) => x.id)).size;
  return (
    <Card title="Plan de charge" actions={
      <div className="flex flex-wrap items-center justify-end gap-1.5">
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
            fn={async () => { if (!f.consultantId) throw new Error("consultant requis"); if (!f.startMonth || !f.endMonth) throw new Error("période requise"); await upsertAssignment(f); setF({ consultantId: "", startMonth: "", endMonth: "", allocationPct: 100, projectFp: "", label: "", tjmBilled: null }); setAdding(false); load(); bump(); }} />
        </div>
      )}
      {/* Matrice consultant × mois : le défilement horizontal (inévitable pour N mois) est CONTENU —
          hauteur bornée + entête de mois collée en haut + colonne Consultant collée à gauche (ombre de
          séparation) pour rester lisible pendant le scroll. */}
      <div className="relative overflow-auto max-h-[70vh] rounded-lg border border-line/60">
        <table className="text-[12px] border-collapse w-max min-w-full">
          <thead><tr>
            <th className="text-left px-2 py-1.5 sticky left-0 top-0 z-20 bg-panel shadow-[2px_0_0_rgb(var(--line))]">Consultant</th>
            {plan.months.map((m) => <th key={m} className="px-2 py-1.5 text-center tabnum whitespace-nowrap sticky top-0 z-10 bg-panel">{monthLabel(m)}</th>)}
          </tr></thead>
          <tbody>
            {consuls.map((c) => {
              // « En activité » = staffé OU au banc (intercontrat) : les deux affichent « IC » quand 0 %
              // (le banc EST de l'intercontrat) ; seuls congés/sortis affichent « — ».
              const active = ["active", "intercontrat"].includes(c.status || "active");
              return (
                <tr key={c.id} className="border-t border-hair">
                  <td className="px-2 py-1 sticky left-0 z-10 bg-bg whitespace-nowrap shadow-[2px_0_0_rgb(var(--line)/0.6)]">{c.name || c.id}{c.bu ? <span className="text-[10px] text-muted"> · {c.bu}</span> : null}</td>
                  {plan.months.map((m) => { const pct = (plan.byConsultant[c.id] && plan.byConsultant[c.id][m]) || 0; return (
                    <td key={m} className={cx("px-2 py-1 text-center tabnum", loadTone(pct, active))}>{pct > 0 ? `${pct}%` : (active ? "IC" : "—")}</td>
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
            ...(canWrite ? [colText("", (a: Assignment) => <DangerBtn label="Suppr." okMsg="Affectation supprimée" errMsg="Suppression refusée" confirm="Supprimer cette affectation ?" fn={async () => { await deleteAssignment(a.id!); await load(); bump(); }} />)] : []),
          ]} rows={plan.assignments} />
        </div>
      )}
      <Tip>Vert = staffé (≥80 %), rouge = <b>sur-charge</b> (&gt;100 %), <b>IC</b> = intercontrat (actif non staffé). Le plan de charge alimentera les KPI d'activité (TACE) et le rapprochement capacité ⇄ pipeline (lots suivants).</Tip>
    </Card>
  );
}

export const Staffing: FC<Props> = () => {
  const canWrite = useCan("pipeline") === "write";
  const canMargin = useCan("rentabilite") !== "none"; // P&L par ressource = confidentiel
  const [rows, setRows] = useState<Consultant[]>([]);
  const [canCost, setCanCost] = useState(false);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<string | null>(null); // id en édition, ou "new"
  // Signal de rafraîchissement partagé (voir RefreshCtx) : incrémenté par les cartes filles à chaque mutation
  // (CRA, affectation, annuaire) → les cartes aval se rechargent au lieu de rester figées sur le 1er snapshot.
  const [nonce, setNonce] = useState(0);
  const bump = useCallback(() => setNonce((n) => n + 1), []);
  const load = useCallback(async () => {
    setLoading(true);
    try { const r = await listConsultants(); setRows(r.rows); setCanCost(r.canCost); }
    catch { setRows([]); } finally { setLoading(false); }
  }, []);
  useEffect(() => { load().catch(() => {}); }, [load, nonce]);

  const counts = STATUSES.map((s) => ({ ...s, n: rows.filter((r) => (r.status || "active") === s.value).length }));
  const avgTjm = (() => { const v = rows.map((r) => r.tjmTarget).filter((x): x is number => typeof x === "number"); return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : null; })();

  return (
    <RefreshCtx.Provider value={{ nonce, bump }}>
    <div className="flex flex-col gap-4">
      <ActivityCockpit />
      {canMargin && <ResourcePnlCard />}
      {canMargin && <PreFacturation />}
      <CapacityPipeline />
      <Vivier canWrite={canWrite} />
      <ConstatCra consultants={rows} canWrite={canWrite} />
      <TaceTrendCard />
      <Card title="Staffing — ressources" actions={
        <div className="flex flex-wrap items-center justify-end gap-1.5">
          {counts.map((c) => <Badge key={c.value} tone={c.tone}>{c.label} · {c.n}</Badge>)}
          {canWrite && <button type="button" className="btn-ghost !px-2 !py-1 text-xs" onClick={() => setEditing(editing === "new" ? null : "new")}>{editing === "new" ? "Fermer" : "+ Consultant"}</button>}
        </div>}>
        {canWrite && editing === "new" && (
          <div className="border-b border-hair pb-3 mb-3"><ConsultantForm initial={EMPTY} canCost={canCost} onDone={() => { setEditing(null); load(); bump(); }} /></div>
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
              det(colText("Compétences", (c: Consultant) => (c.skills && c.skills.length ? c.skills.join(", ") : "—"))),
              ...(canWrite ? [colText("", (c: Consultant) => (
                <span className="inline-flex gap-2">
                  <button type="button" className="text-gold hover:underline text-[11px]" onClick={() => setEditing(editing === c.id ? null : c.id!)}>{editing === c.id ? "fermer" : "éditer"}</button>
                  <DangerBtn label="Suppr." okMsg="Consultant supprimé" errMsg="Suppression refusée" confirm={`Supprimer « ${c.name} » ?`} fn={async () => { await deleteConsultant(c.id!); await load(); bump(); }} />
                </span>
              ))] : []),
            ]} rows={rows} colsKey="staffing-consultants" />
            {canWrite && rows.map((c) => editing === c.id && (
              <div key={`edit-${c.id}`} className={cx("border-t border-hair pt-2 mt-2")}><ConsultantForm initial={c} canCost={canCost} onDone={() => { setEditing(null); load(); bump(); }} /></div>
            ))}
            {avgTjm != null && <div className="mt-2 text-[11px] text-muted">TJM cible moyen : <b>{money(avgTjm)}</b> · {rows.length} ressource(s){!canCost && " — coût (CJM) masqué (droit « rentabilité » requis)"}</div>}
          </>
        )}
      </Card>
      <PlanDeCharge canWrite={canWrite} />
    </div>
    </RefreshCtx.Provider>
  );
};
