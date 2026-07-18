// Module « Partenariats & Certifications » (par_). Derrière le drapeau config/parFeature (App masque
// l'onglet si éteint) et gouverné par le droit `partenariats`. Réutilise les primitives design, les
// écritures callable et les formats de l'ERP (FCFA entier via money, date JJ/MM/AAAA via frDate). Le CA
// est DÉRIVÉ des BC fournisseurs (summaries/par_ca) — aucune saisie. Aucune valeur en dur (tons/libellés
// via lib/parLabels). Composant LAZY → callables inline (hors chunk d'entrée).
import { useEffect, useMemo, useState, type FC, type ReactNode } from "react";
import { Plus } from "lucide-react";
import { httpsCallable } from "firebase/functions";
import { functions } from "../lib/firebase";
import { useCan, useCanSeeMargin } from "../lib/rbac";
import { useCollectionData, useDocData } from "../lib/hooks";
import { Card, Tip, Badge, Busy, DangerBtn, Table, colText, colNum, Kpi, money, EmptyState, Modal, Segmented, useToast } from "../design/components";
import { Select, DateField } from "../design/inputs";
import { frDate } from "../lib/format";
import { ExportBtn } from "../design/bulk";
import { buildPartnerPayload, partnerToForm, bpAchievement, PAR_LEVELS, BP_AXES, EMPTY_BP, type PartnerFormState, type BpForm } from "../lib/parPartnerForm";
import { PARTNER_PRESETS, buildPartnerPreset } from "../lib/parPartnerPresets";
import { fmt, pct, T } from "../design/tokens";
import { MultiLine } from "../design/charts";
import {
  PARTNERSHIP_STATUS_LABEL, partnershipTone, CERT_STATUS_LABEL, certStatusTone,
  ALERT_BUCKET_LABEL, alertBucketTone, ASSIGNMENT_STATUS_LABEL, assignmentTone,
  relanceBucketLabel, relanceBucketTone, VALIDATION_STATUS_LABEL, validationTone, BP_AXIS_LABEL, label,
} from "../lib/parLabels";
import type { Props } from "./_shared";

// Appel callable INLINE (module lazy) — évite d'alourdir writes.ts (budget bundle).
const callFn = <T,>(name: string, payload: unknown) => httpsCallable(functions, name)(payload).then((r) => r.data as T);

type CatalogEntry = { id: string; code?: string; name: string; competencyId: string; level: string; validityMonths: number };
type BusinessPlan = Partial<Record<"pipelineBp" | "pipelineYtd" | "bookingBp" | "bookingYtd" | "certBp" | "certYtd" | "growthBp" | "growthYtd", number>>;
type Partner = { id: string; name: string; programName?: string; status?: string; renewalDate?: string; validationStatus?: string; businessPlan?: BusinessPlan; tiers?: { id: string; name: string; rank: number }[]; competencies?: { id: string; name: string }[]; certificationCatalog?: CatalogEntry[]; requirements?: { tierId: string; certIdOrCompetencyId: string; minCount: number }[] };
type Certif = { id: string; consultantId: string; consultantName?: string; consultantBu?: string; partnerId: string; certificationCatalogId: string; certName?: string; certCode?: string; status: string; obtainedDate: string; expiryDate?: string };
type Assign = { id: string; consultantId: string; consultantName?: string; partnerId: string; certificationCatalogId: string; cert?: string; targetDate: string; status: string; clickupTaskId?: string; clickupUrl?: string };
type CaSummary = { byPartner?: { partnerId: string; name: string; revenueXof: number; bcCount: number }[]; unmapped?: { supplier: string; revenueXof: number; bcCount: number }[]; totalXof?: number; asOf?: string } | null;
type QuotaSummary = { partners?: { partnerId: string; name: string; status: string; coverage: { tierId: string; target: string; minCount: number; holders: number; ok: boolean }[]; gaps: { target: string; minCount: number; holders: number }[] }[] } | null;
type AlertSummary = { items?: { id: string; consultantName?: string; partnerId: string; certName?: string; expiryDate: string; daysLeft: number; bucket: string }[]; counts?: Record<string, number>; total?: number } | null;
type RelanceSummary = { items?: { id: string; consultantName?: string; partnerId: string; cert?: string; targetDate: string; daysLeft: number; bucket: string; effectiveStatus?: string }[]; counts?: { total: number; late: number } } | null;
type QuotaHistory = { days?: { date: string; conformes: number; aRisque: number; nonConformes: number; total: number; aRenouveler: number; expirees: number }[] } | null;
type ConsultantLite = { id: string; name: string; bu?: string };

const Field: FC<{ label: string; children: ReactNode }> = ({ label, children }) => (
  <label className="flex flex-col gap-1"><span className="text-[11px] text-muted">{label}</span>{children}</label>
);


export const Partenariats: FC<Props> = () => {
  const canWrite = useCan("partenariats") === "write";
  // Le CA constructeur (par_ca) est CONFIDENTIEL — même cloisonnement que la marge (droit `rentabilite`,
  // ADR-P07). Sans ce droit on NE S'ABONNE PAS à summaries/par_ca (sinon permission-denied par les rules)
  // et le KPI + la carte CA sont masqués — comme MB/%MB ailleurs (useCanSeeMargin).
  const canSeeCa = useCanSeeMargin();
  const [tab, setTab] = useState<"dash" | "certifs" | "assigns" | "config" | "ia">("dash");

  // Lectures temps réel (onSnapshot) — gatées par les rules (drapeau + droit).
  const { rows: partners } = useCollectionData<Partner>("par_partners");
  const { rows: certifs } = useCollectionData<Certif>("par_certifications");
  const { rows: assigns } = useCollectionData<Assign>("par_assignments");
  const { data: ca } = useDocData<CaSummary>(canSeeCa ? "summaries/par_ca" : null);
  const { data: quotas } = useDocData<QuotaSummary>("summaries/par_quotas");
  const { data: alerts } = useDocData<AlertSummary>("summaries/par_alerts");
  const { data: relances } = useDocData<RelanceSummary>("summaries/par_relances");
  const { data: history } = useDocData<QuotaHistory>("summaries/par_quotasHistory");
  const { data: mapDoc } = useDocData<{ map?: Record<string, string> }>("config/parPartnerMap");

  const partnerName = useMemo(() => { const m: Record<string, string> = {}; for (const p of partners || []) m[p.id] = p.name; return m; }, [partners]);
  const partnerOpts = useMemo(() => (partners || []).map((p) => ({ value: p.id, label: p.name })), [partners]);

  return (
    <div className="space-y-4">
      <Segmented
        value={tab} onChange={setTab}
        options={[
          { value: "dash", label: "Tableau de bord" },
          { value: "certifs", label: "Certifications", count: certifs?.length },
          { value: "assigns", label: "Assignations", count: assigns?.length },
          { value: "config", label: "Paramétrage" },
          { value: "ia", label: "IA & QBR" },
        ]}
      />

      {tab === "dash" && <Dashboard ca={ca} canSeeCa={canSeeCa} quotas={quotas} alerts={alerts} relances={relances} history={history} partners={partners || []} partnerName={partnerName} />}
      {tab === "certifs" && <CertifsTab certifs={certifs || []} partners={partners || []} partnerName={partnerName} partnerOpts={partnerOpts} canWrite={canWrite} />}
      {tab === "assigns" && <AssignsTab assigns={assigns || []} partners={partners || []} partnerName={partnerName} partnerOpts={partnerOpts} canWrite={canWrite} />}
      {tab === "config" && <ConfigTab partners={partners || []} partnerOpts={partnerOpts} mapDoc={mapDoc} ca={ca} canWrite={canWrite} />}
      {tab === "ia" && <IaTab partnerOpts={partnerOpts} />}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────── IA & QBR
type PlanItem = { priorite: string; partenaire: string; titre: string; constat: string; actions: string[]; impact: string };
const PRIO_TONE: Record<string, "clay" | "gold" | "steel"> = { haute: "clay", moyenne: "gold", basse: "steel" };
const PRIO_LABEL: Record<string, string> = { haute: "Haute", moyenne: "Moyenne", basse: "Basse" };

const IaTab: FC<{ partnerOpts: { value: string; label: string }[] }> = ({ partnerOpts }) => {
  const toast = useToast();
  const [plan, setPlan] = useState<PlanItem[] | null>(null);
  const [planBusy, setPlanBusy] = useState(false);
  const [partnerId, setPartnerId] = useState("");
  const [periode, setPeriode] = useState("");
  const [qbr, setQbr] = useState<{ qbr: any; snapshot: any } | null>(null);
  const [qbrBusy, setQbrBusy] = useState(false);

  const genPlan = async () => {
    if (planBusy) return; setPlanBusy(true);
    try { const r = await callFn<{ plan: PlanItem[] }>("generateParActionPlan", {}); setPlan(r.plan || []); }
    catch (e: any) { toast(`Échec — ${String(e?.message || e?.code || "").replace(/^functions\//, "") || "action refusée"}`, "err"); }
    finally { setPlanBusy(false); }
  };
  const genQbr = async () => {
    if (qbrBusy || !partnerId) return; setQbrBusy(true);
    try { const r = await callFn<{ qbr: any; snapshot: any }>("generateParQbr", { partnerId, periode }); setQbr({ qbr: r.qbr, snapshot: r.snapshot }); }
    catch (e: any) { toast(`Échec — ${String(e?.message || e?.code || "").replace(/^functions\//, "") || "action refusée"}`, "err"); }
    finally { setQbrBusy(false); }
  };
  const exportPptx = async () => {
    if (!qbr) return;
    try { const { exportParQbrPptx } = await import("../lib/parQbrPptx"); await exportParQbrPptx(qbr.qbr, qbr.snapshot); }
    catch { toast("Export PowerPoint impossible", "err"); }
  };

  return (
    <div className="space-y-4">
      <Card title="Plan d'action business (IA)" actions={<button className="btn" disabled={planBusy} onClick={genPlan}>{planBusy ? "Génération…" : "Générer le plan"}</button>}>
        <Tip>Génère, à partir des données du module (statuts, quotas, CA, retards), un plan d'action priorisé — combler les quotas, accélérer le CA, sécuriser les niveaux avant audit. Recommandations proposées par l'IA, à valider.</Tip>
        {plan == null ? <div className="text-[12px] text-faint py-4">Cliquez « Générer le plan » pour obtenir des recommandations.</div> : plan.length === 0 ? <EmptyState label="Aucune recommandation générée." /> : (
          <div className="space-y-2 mt-1">
            {plan.map((it, i) => (
              <div key={i} className="rounded-lg border border-line p-3">
                <div className="flex items-center gap-2 mb-1">
                  <Badge tone={PRIO_TONE[it.priorite] || "steel"}>{PRIO_LABEL[it.priorite] || it.priorite}</Badge>
                  <span className="font-semibold text-[13px]">{it.titre}</span>
                  {it.partenaire && <span className="text-[11px] text-muted">· {it.partenaire}</span>}
                </div>
                {it.constat && <div className="text-[12px] text-muted mb-1">{it.constat}</div>}
                {!!(it.actions || []).length && <ul className="list-disc pl-5 text-[12px] space-y-0.5">{it.actions.map((a, j) => <li key={j}>{a}</li>)}</ul>}
                {it.impact && <div className="text-[11px] text-emerald mt-1">Impact : {it.impact}</div>}
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card title="Revue trimestrielle (QBR) par partenaire">
        <Tip>Synthèse de revue trimestrielle générée par l'IA, exportable en PowerPoint de marque (montants FCFA).</Tip>
        <div className="flex flex-wrap items-end gap-2 mb-2">
          <div className="w-56"><Field label="Constructeur"><Select value={partnerId} onChange={setPartnerId} options={partnerOpts} placeholder="Choisir…" /></Field></div>
          <div className="w-40"><Field label="Période"><input className="field" value={periode} placeholder="ex. T3 2026" onChange={(e) => setPeriode(e.target.value)} /></Field></div>
          <button className="btn" disabled={qbrBusy || !partnerId} onClick={genQbr}>{qbrBusy ? "Génération…" : "Générer la QBR"}</button>
          {qbr && <button className="btn-ghost" onClick={exportPptx}>Exporter en PowerPoint</button>}
        </div>
        {qbr && (
          <div className="rounded-lg border border-line p-3 space-y-2 text-[12px]">
            <div className="font-semibold text-[14px]">{qbr.qbr.titre}</div>
            {qbr.qbr.synthese_executive && <div className="italic text-muted">{qbr.qbr.synthese_executive}</div>}
            <QbrList title="Points forts" tone="text-emerald" items={qbr.qbr.points_forts} />
            {qbr.qbr.statut_certifications && <div><span className="text-gold font-semibold">Certifications :</span> {qbr.qbr.statut_certifications}</div>}
            <QbrList title="Points d'attention" tone="text-clay" items={qbr.qbr.points_attention} />
            <QbrList title="Engagements Neurones" tone="text-emerald" items={qbr.qbr.engagements_neurones} />
            <QbrList title="Demandes au constructeur" tone="text-gold" items={qbr.qbr.demandes_constructeur} />
          </div>
        )}
      </Card>
    </div>
  );
};

const QbrList: FC<{ title: string; tone: string; items?: string[] }> = ({ title, tone, items }) => (
  !items || !items.length ? null : (
    <div><span className={`${tone} font-semibold`}>{title} :</span>
      <ul className="list-disc pl-5 space-y-0.5 mt-0.5">{items.map((t, i) => <li key={i}>{t}</li>)}</ul>
    </div>
  )
);

// ─────────────────────────────────────────────────────────────────────── Tableau de bord
const Dashboard: FC<{ ca: CaSummary; canSeeCa: boolean; quotas: QuotaSummary; alerts: AlertSummary; relances: RelanceSummary; history: QuotaHistory; partners: Partner[]; partnerName: Record<string, string> }> = ({ ca, canSeeCa, quotas, alerts, relances, history, partners, partnerName }) => {
  const alertItems = alerts?.items || [];
  const relanceItems = relances?.items || [];
  const quotaPartners = quotas?.partners || [];
  const nonConf = quotaPartners.filter((p) => p.status === "non_compliant" || p.status === "at_risk").length;
  // Tendance de conformité (Lot P3) : historique quotidien de la couverture des quotas (30 derniers jours).
  const trend = (history?.days || []).slice(-30).map((d) => ({ name: (d.date || "").slice(5), Conformes: d.conformes, "À risque": d.aRisque, "Non conformes": d.nonConformes }));
  // Plan d'affaires : partenaires portant un BP saisi, avec taux d'atteinte par axe + global (miroir du
  // tableau direction). On ne re-calcule rien d'autre : bpAchievement est le miroir exact du backend.
  const bpRows = partners
    .filter((p) => p.businessPlan && Object.keys(p.businessPlan).length)
    .map((p) => ({ p, a: bpAchievement(p.businessPlan) }))
    .sort((x, y) => (x.a.global ?? -1) - (y.a.global ?? -1)); // les moins avancés en tête (à traiter)
  const bpTone = (r: number | null) => (r == null ? "neutral" : r >= 1 ? "emerald" : r >= 0.8 ? "gold" : "clay");
  const bpCol = (ax: typeof BP_AXES[number]) => colNum(BP_AXIS_LABEL[ax], (r: typeof bpRows[number]) => pct(r.a[ax]), (r: typeof bpRows[number]) => r.a[ax] ?? -1);
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi label="Partenaires" value={String(partners.length)} sub="référentiel" />
        {/* CA constructeur = donnée confidentielle (droit `rentabilite`) — masquée sinon (ADR-P07). */}
        {canSeeCa && <Kpi label="CA constructeurs (dérivé BC)" value={fmt(ca?.totalXof || 0)} sub={`${(ca?.byPartner || []).length} partenaire(s)`} tone="emerald" />}
        <Kpi label="Certifs à renouveler" value={String(alerts?.total || 0)} sub={`${alerts?.counts?.expired || 0} expirée(s)`} tone={(alerts?.total || 0) > 0 ? "gold" : "ink"} />
        <Kpi label="Partenariats à risque" value={String(nonConf)} sub={`${relances?.counts?.late || 0} relance(s) en retard`} tone={nonConf > 0 ? "clay" : "ink"} />
      </div>

      {!!bpRows.length && (
        <Card title="Plan d'affaires par partenaire" actions={<ExportBtn name="plan-affaires-partenaires" cols={[
          { header: "Partenaire", render: (r: typeof bpRows[number]) => r.p.name },
          { header: "Statut", render: (r: typeof bpRows[number]) => r.p.status || "" },
          ...BP_AXES.map((ax) => ({ header: BP_AXIS_LABEL[ax], render: (r: typeof bpRows[number]) => pct(r.a[ax]) })),
          { header: "% global", render: (r: typeof bpRows[number]) => pct(r.a.global) },
          { header: "Échéance", render: (r: typeof bpRows[number]) => r.p.renewalDate ? frDate(r.p.renewalDate) : "" },
          { header: "Validation", render: (r: typeof bpRows[number]) => label(VALIDATION_STATUS_LABEL, r.p.validationStatus) },
        ]} rows={bpRows} />}>
          <Tip>Objectif (BP) vs réalisé (YTD) par axe — <b>% d'atteinte</b> (100 % = objectif tenu). Miroir du tableau de pilotage direction : reflète ce qui est saisi sur chaque partenaire (Paramétrage → Éditer).</Tip>
          <Table
            columns={[
              colText("Partenaire", (r) => r.p.name),
              colText("Statut", (r) => r.p.status || "—"),
              bpCol("pipeline"), bpCol("booking"), bpCol("cert"), bpCol("growth"),
              colNum("% global", (r) => <Badge tone={bpTone(r.a.global)}>{pct(r.a.global)}</Badge>, (r) => r.a.global ?? -1),
              colText("Échéance", (r) => r.p.renewalDate ? frDate(r.p.renewalDate) : "—"),
              colText("Validation", (r) => <Badge tone={validationTone(r.p.validationStatus)}>{label(VALIDATION_STATUS_LABEL, r.p.validationStatus)}</Badge>, (r) => r.p.validationStatus || ""),
            ]}
            rows={bpRows} rowKey={(r) => r.p.id} empty="Aucun plan d'affaires saisi."
          />
        </Card>
      )}

      {canSeeCa && (
      <Card title="CA par constructeur — dérivé des BC fournisseurs">
        <Tip>Le chiffre d'affaires par partenaire est <b>dérivé des bons de commande fournisseurs</b> (aucune saisie), en rapprochant le fournisseur du constructeur (Paramétrage). Montants en FCFA.</Tip>
        <Table
          columns={[colText("Constructeur", (r) => r.name), colNum("CA (FCFA)", (r) => money(r.revenueXof)), colNum("BC", (r) => String(r.bcCount))]}
          rows={ca?.byPartner || []} rowKey={(r) => r.partnerId} empty="Aucun CA constructeur — renseignez la correspondance fournisseur → constructeur dans Paramétrage."
        />
        {!!(ca?.unmapped || []).length && (
          <div className="mt-2 text-[12px] text-gold">
            {(ca!.unmapped!).length} fournisseur(s) BC non rattaché(s) à un constructeur (à mapper en Paramétrage) — ex. {(ca!.unmapped!).slice(0, 3).map((u) => u.supplier).join(", ")}.
          </div>
        )}
      </Card>
      )}

      <Card title="Conformité des quotas de certification" actions={<ExportBtn name="conformite-quotas" cols={[
        { header: "Constructeur", render: (r: any) => r.name },
        { header: "Statut", render: (r: any) => label(PARTNERSHIP_STATUS_LABEL, r.status) },
        { header: "Exigences couvertes", render: (r: any) => `${(r.coverage || []).filter((c: any) => c.ok).length}/${(r.coverage || []).length}` },
        { header: "Écarts", render: (r: any) => (r.gaps || []).map((g: any) => `${g.target} (${g.holders}/${g.minCount})`).join(" | ") },
      ]} rows={quotaPartners} />}>
        <Table
          columns={[
            colText("Constructeur", (r) => r.name),
            colText("Statut", (r) => <Badge tone={partnershipTone(r.status)}>{label(PARTNERSHIP_STATUS_LABEL, r.status)}</Badge>),
            colText("Exigences couvertes", (r) => `${(r.coverage || []).filter((c: any) => c.ok).length}/${(r.coverage || []).length}`),
            colText("Écarts", (r) => (r.gaps || []).length ? (r.gaps as any[]).map((g) => `${g.target} (${g.holders}/${g.minCount})`).join(", ") : "—"),
          ]}
          rows={quotaPartners} rowKey={(r) => r.partnerId} empty="Aucun quota évalué — ajoutez des exigences au référentiel et des certifications."
        />
      </Card>

      {trend.length >= 2 && (
        <Card title="Tendance de conformité des partenariats (30 j)">
          <Tip>Évolution quotidienne du nombre de partenariats conformes, à risque et non conformes (historisé à chaque recalcul).</Tip>
          <MultiLine
            data={trend}
            series={[{ key: "Conformes", color: T.emerald, name: "Conformes" }, { key: "À risque", color: T.gold, name: "À risque" }, { key: "Non conformes", color: T.clay, name: "Non conformes" }]}
          />
        </Card>
      )}

      <div className="grid lg:grid-cols-2 gap-4">
        <Card title="Renouvellements de certifications (≤ 90 j)">
          <Table
            columns={[
              colText("Ingénieur", (r) => r.consultantName || "—"),
              colText("Constructeur", (r) => partnerName[r.partnerId] || r.partnerId),
              colText("Certification", (r) => r.certName || "—"),
              colText("Échéance", (r) => frDate(r.expiryDate)),
              colText("Urgence", (r) => <Badge tone={alertBucketTone(r.bucket)}>{label(ALERT_BUCKET_LABEL, r.bucket)}</Badge>),
            ]}
            rows={alertItems} rowKey={(r) => r.id} pageSize={10} empty="Aucune certification à renouveler sous 90 jours."
          />
        </Card>
        <Card title="Relances d'assignations (J-30/14/7)">
          <Table
            columns={[
              colText("Ingénieur", (r) => r.consultantName || "—"),
              colText("Constructeur", (r) => partnerName[r.partnerId] || r.partnerId),
              colText("Certif visée", (r) => r.cert || "—"),
              colText("Cible", (r) => frDate(r.targetDate)),
              colText("État", (r) => <Badge tone={relanceBucketTone(r.bucket)}>{relanceBucketLabel(r.bucket)}</Badge>),
            ]}
            rows={relanceItems} rowKey={(r) => r.id} pageSize={10} empty="Aucune assignation en retard ou proche de l'échéance."
          />
        </Card>
      </div>
    </div>
  );
};

// Sélecteur d'ingénieur (consultants callable-only : chargés via listConsultants, pas onSnapshot).
function useConsultants(active: boolean) {
  const [rows, setRows] = useState<ConsultantLite[]>([]);
  useEffect(() => {
    if (!active) return;
    let alive = true;
    callFn<{ rows: ConsultantLite[] }>("listConsultants", {}).then((r) => { if (alive) setRows(r.rows || []); }).catch(() => {});
    return () => { alive = false; };
  }, [active]);
  return rows;
}

// ─────────────────────────────────────────────────────────────────────── Certifications
const CertifsTab: FC<{ certifs: Certif[]; partners: Partner[]; partnerName: Record<string, string>; partnerOpts: { value: string; label: string }[]; canWrite: boolean }> = ({ certifs, partners, partnerName, partnerOpts, canWrite }) => {
  // undefined = formulaire fermé ; null = nouvelle certif ; Certif = édition d'une existante.
  const [edit, setEdit] = useState<Certif | null | undefined>(undefined);
  const exportCols = [
    { header: "Ingénieur", render: (r: Certif) => r.consultantName || r.consultantId },
    { header: "BU", render: (r: Certif) => r.consultantBu || "" },
    { header: "Constructeur", render: (r: Certif) => partnerName[r.partnerId] || r.partnerId },
    { header: "Certification", render: (r: Certif) => r.certName || r.certificationCatalogId },
    { header: "Obtenue", render: (r: Certif) => frDate(r.obtainedDate) },
    { header: "Expiration", render: (r: Certif) => r.expiryDate ? frDate(r.expiryDate) : "" },
    { header: "Statut", render: (r: Certif) => label(CERT_STATUS_LABEL, r.status) },
  ];
  return (
    <Card title="Certifications des ingénieurs" actions={<div className="flex items-center gap-2"><ExportBtn name="certifications" cols={exportCols} rows={certifs} />{canWrite && <button className="btn" onClick={() => setEdit(null)}><Plus size={14} /> Ajouter</button>}</div>}>
      <Table
        columns={[
          colText("Ingénieur", (r) => r.consultantName || r.consultantId),
          colText("BU", (r) => r.consultantBu || "—"),
          colText("Constructeur", (r) => partnerName[r.partnerId] || r.partnerId),
          colText("Certification", (r) => r.certName || r.certificationCatalogId),
          colText("Obtenue", (r) => frDate(r.obtainedDate)),
          colText("Expire", (r) => r.expiryDate ? frDate(r.expiryDate) : "—"),
          colText("Statut", (r) => <Badge tone={certStatusTone(r.status)}>{label(CERT_STATUS_LABEL, r.status)}</Badge>),
          // Actions par ligne (écriture seulement) : réviser la date d'obtention ou retirer la certif.
          ...(canWrite ? [colText("", (r) => (
            <span className="inline-flex items-center gap-2">
              <button className="btn-ghost text-[11px]" onClick={() => setEdit(r)}>Éditer</button>
              <DangerBtn label="Suppr." confirm={`Supprimer la certification « ${r.certName || r.certificationCatalogId} » de ${r.consultantName || r.consultantId} ?`} fn={() => callFn("deleteParCertification", { id: r.id })} okMsg="Certification supprimée" />
            </span>
          ))] : []),
        ]}
        rows={certifs} rowKey={(r) => r.id} searchKeys={[(r) => r.consultantName, (r) => r.certName, (r) => r.partnerId]}
        empty="Aucune certification enregistrée."
      />
      {edit !== undefined && <CertifForm partners={partners} partnerOpts={partnerOpts} edit={edit} onClose={() => setEdit(undefined)} />}
    </Card>
  );
};

const CertifForm: FC<{ partners: Partner[]; partnerOpts: { value: string; label: string }[]; edit?: Certif | null; onClose: () => void }> = ({ partners, partnerOpts, edit, onClose }) => {
  const consultants = useConsultants(true);
  const [consultantId, setConsultantId] = useState(edit?.consultantId || "");
  const [partnerId, setPartnerId] = useState(edit?.partnerId || "");
  const [catalogId, setCatalogId] = useState(edit?.certificationCatalogId || "");
  const [obtainedDate, setObtainedDate] = useState(edit?.obtainedDate || "");
  const catalog = useMemo(() => (partners.find((p) => p.id === partnerId)?.certificationCatalog) || [], [partners, partnerId]);
  const valid = !!(consultantId && partnerId && catalogId && obtainedDate);
  // En édition, l'id est dérivé (consultant × catalogue) : on verrouille ces clés, seule la date d'obtention change.
  const submit = async () => { await callFn("upsertParCertification", { consultantId, partnerId, certificationCatalogId: catalogId, obtainedDate }); onClose(); };
  return (
    <Modal open title={edit ? "Modifier la certification" : "Ajouter une certification"} size="form" onClose={onClose} actions={<Busy label="Enregistrer" fn={submit} okMsg="Certification enregistrée" />}>
      <div className="grid sm:grid-cols-2 gap-3">
        <Field label="Ingénieur (consultant)"><Select value={consultantId} onChange={setConsultantId} options={consultants.map((c) => ({ value: c.id, label: c.name }))} placeholder="Choisir…" disabled={!!edit} /></Field>
        <Field label="Constructeur"><Select value={partnerId} onChange={(v) => { setPartnerId(v); setCatalogId(""); }} options={partnerOpts} placeholder="Choisir…" disabled={!!edit} /></Field>
        <Field label="Certification (catalogue)"><Select value={catalogId} onChange={setCatalogId} options={catalog.map((e) => ({ value: e.id, label: e.name }))} placeholder={partnerId ? "Choisir…" : "Choisir un constructeur d'abord"} disabled={!!edit} /></Field>
        <Field label="Date d'obtention"><DateField value={obtainedDate} onChange={setObtainedDate} /></Field>
      </div>
      <Tip>La date d'expiration et le statut sont <b>calculés</b> à partir de la validité du catalogue — jamais saisis.{edit ? <span className="block text-muted mt-1">Ingénieur et certification ne se modifient pas ; supprimez pour recréer.</span> : null}{!valid && <span className="block text-gold mt-1">Renseignez les quatre champs.</span>}</Tip>
    </Modal>
  );
};

// ─────────────────────────────────────────────────────────────────────── Assignations
// Statuts pilotables À LA MAIN dans le cycle de vie. « en_retard » est DÉRIVÉ (calculé des relances par
// l'échéance, domain/parAssignment) : jamais posé manuellement — on l'exclut du sélecteur.
const MANUAL_ASSIGN_STATUSES = ["a_planifier", "planifie", "en_formation", "obtenu"] as const;

// Sélecteur de statut inline (cycle de vie de l'assignation). Reprend le retour toast des autres écritures.
const AssignStatusCell: FC<{ a: Assign }> = ({ a }) => {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const change = async (status: string) => {
    if (status === a.status || busy) return;
    setBusy(true);
    try { await callFn("setParAssignmentStatus", { id: a.id, status }); toast("Statut mis à jour", "ok"); }
    catch (e: any) { const d = String(e?.message || e?.code || "").replace(/^functions\//, ""); toast(d ? `Changement refusé — ${d}` : "Changement refusé", "err"); }
    finally { setBusy(false); }
  };
  return <div className="w-40"><Select value={MANUAL_ASSIGN_STATUSES.includes(a.status as typeof MANUAL_ASSIGN_STATUSES[number]) ? a.status : ""} onChange={change} options={MANUAL_ASSIGN_STATUSES.map((s) => ({ value: s, label: label(ASSIGNMENT_STATUS_LABEL, s) }))} ariaLabel="Statut de l'assignation" placeholder={label(ASSIGNMENT_STATUS_LABEL, a.status)} disabled={busy} /></div>;
};

const AssignsTab: FC<{ assigns: Assign[]; partners: Partner[]; partnerName: Record<string, string>; partnerOpts: { value: string; label: string }[]; canWrite: boolean }> = ({ assigns, partners, partnerName, partnerOpts, canWrite }) => {
  // undefined = formulaire fermé ; null = nouvelle assignation ; Assign = édition d'une existante.
  const [edit, setEdit] = useState<Assign | null | undefined>(undefined);
  const exportCols = [
    { header: "Ingénieur", render: (r: Assign) => r.consultantName || r.consultantId },
    { header: "Constructeur", render: (r: Assign) => partnerName[r.partnerId] || r.partnerId },
    { header: "Certif visée", render: (r: Assign) => r.cert || r.certificationCatalogId },
    { header: "Échéance", render: (r: Assign) => frDate(r.targetDate) },
    { header: "Statut", render: (r: Assign) => label(ASSIGNMENT_STATUS_LABEL, r.status) },
    { header: "Lien ClickUp", render: (r: Assign) => r.clickupUrl || "" },
  ];
  return (
    <Card title="Assignations de certification" actions={<div className="flex items-center gap-2"><ExportBtn name="assignations-certification" cols={exportCols} rows={assigns} />{canWrite && <button className="btn" onClick={() => setEdit(null)}><Plus size={14} /> Ajouter</button>}</div>}>
      <Tip>Affecter à un ingénieur l'obtention d'une certification à une échéance ; les relances (J-30/14/7) et les retards apparaissent au Tableau de bord.</Tip>
      <Table
        columns={[
          colText("Ingénieur", (r) => r.consultantName || r.consultantId),
          colText("Constructeur", (r) => partnerName[r.partnerId] || r.partnerId),
          colText("Certif visée", (r) => r.cert || r.certificationCatalogId),
          colText("Échéance", (r) => frDate(r.targetDate)),
          // Écriture : le statut se pilote via le sélecteur (cycle de vie) ; lecture seule : badge.
          canWrite
            ? colText("Statut", (r) => <AssignStatusCell a={r} />, (r) => r.status)
            : colText("Statut", (r) => <Badge tone={assignmentTone(r.status)}>{label(ASSIGNMENT_STATUS_LABEL, r.status)}</Badge>),
          colText("ClickUp", (r) => (
            <span className="inline-flex items-center gap-2">
              {r.clickupUrl && <a href={r.clickupUrl} target="_blank" rel="noreferrer" className="text-[11px] text-emerald hover:underline">Ouvrir la tâche</a>}
              {canWrite && <Busy label={r.clickupTaskId ? "Resynchroniser" : "Pousser vers ClickUp"} variant="ghost" fn={() => callFn("pushParAssignmentToClickup", { id: r.id })} okMsg={r.clickupTaskId ? "Tâche mise à jour" : "Tâche ClickUp créée"} />}
              {!r.clickupUrl && !canWrite && <span className="text-faint">—</span>}
            </span>
          )),
          ...(canWrite ? [colText("", (r) => (
            <span className="inline-flex items-center gap-2">
              <button className="btn-ghost text-[11px]" onClick={() => setEdit(r)}>Éditer</button>
              <DangerBtn label="Suppr." confirm={`Supprimer l'assignation « ${r.cert || r.certificationCatalogId} » de ${r.consultantName || r.consultantId} ?`} fn={() => callFn("deleteParAssignment", { id: r.id })} okMsg="Assignation supprimée" />
            </span>
          ))] : []),
        ]}
        rows={assigns} rowKey={(r) => r.id} searchKeys={[(r) => r.consultantName, (r) => r.cert, (r) => r.partnerId]}
        empty="Aucune assignation."
      />
      {edit !== undefined && <AssignForm partners={partners} partnerOpts={partnerOpts} edit={edit} onClose={() => setEdit(undefined)} />}
    </Card>
  );
};

const AssignForm: FC<{ partners: Partner[]; partnerOpts: { value: string; label: string }[]; edit?: Assign | null; onClose: () => void }> = ({ partners, partnerOpts, edit, onClose }) => {
  const consultants = useConsultants(true);
  const [consultantId, setConsultantId] = useState(edit?.consultantId || "");
  const [partnerId, setPartnerId] = useState(edit?.partnerId || "");
  const [catalogId, setCatalogId] = useState(edit?.certificationCatalogId || "");
  const [targetDate, setTargetDate] = useState(edit?.targetDate || "");
  const catalog = useMemo(() => (partners.find((p) => p.id === partnerId)?.certificationCatalog) || [], [partners, partnerId]);
  const valid = !!(consultantId && partnerId && catalogId && targetDate);
  // En édition, l'id est dérivé (consultant × catalogue) : on verrouille ces clés, seule l'échéance change.
  const submit = async () => { await callFn("upsertParAssignment", { consultantId, partnerId, certificationCatalogId: catalogId, targetDate }); onClose(); };
  return (
    <Modal open title={edit ? "Modifier l'assignation" : "Ajouter une assignation"} size="form" onClose={onClose} actions={<Busy label="Enregistrer" fn={submit} okMsg="Assignation enregistrée" />}>
      <div className="grid sm:grid-cols-2 gap-3">
        <Field label="Ingénieur (consultant)"><Select value={consultantId} onChange={setConsultantId} options={consultants.map((c) => ({ value: c.id, label: c.name }))} placeholder="Choisir…" disabled={!!edit} /></Field>
        <Field label="Constructeur"><Select value={partnerId} onChange={(v) => { setPartnerId(v); setCatalogId(""); }} options={partnerOpts} placeholder="Choisir…" disabled={!!edit} /></Field>
        <Field label="Certification à obtenir"><Select value={catalogId} onChange={setCatalogId} options={catalog.map((e) => ({ value: e.id, label: e.name }))} placeholder={partnerId ? "Choisir…" : "Choisir un constructeur d'abord"} disabled={!!edit} /></Field>
        <Field label="Échéance cible"><DateField value={targetDate} onChange={setTargetDate} /></Field>
      </div>
      {edit ? <Tip>Ingénieur et certification ne se modifient pas ; supprimez pour recréer. Le statut se pilote depuis le tableau.</Tip> : !valid ? <Tip>Renseignez les quatre champs.</Tip> : null}
    </Modal>
  );
};

// ─────────────────────────────────────────────────────────────────────── Paramétrage (mapping fournisseur → constructeur)
const ConfigTab: FC<{ partners: Partner[]; partnerOpts: { value: string; label: string }[]; mapDoc: { map?: Record<string, string> } | null; ca: CaSummary; canWrite: boolean }> = ({ partners, partnerOpts, mapDoc, ca, canWrite }) => {
  const [rows, setRows] = useState<{ supplier: string; partnerId: string }[]>([]);
  // undefined = formulaire fermé ; null = nouveau partenaire ; Partner = édition d'un existant.
  const [edit, setEdit] = useState<Partner | null | undefined>(undefined);
  useEffect(() => { setRows(Object.entries(mapDoc?.map || {}).map(([supplier, partnerId]) => ({ supplier, partnerId }))); }, [mapDoc]);
  const unmapped = ca?.unmapped || [];
  const save = async () => {
    const map: Record<string, string> = {};
    for (const r of rows) if (r.supplier.trim() && r.partnerId) map[r.supplier.trim().toUpperCase()] = r.partnerId;
    await callFn("setParPartnerMap", { map });
  };
  return (
    <div className="space-y-4">
      <Card title="Correspondance fournisseur → constructeur" actions={canWrite ? <Busy label="Enregistrer" fn={save} okMsg="Correspondance enregistrée" /> : undefined}>
        <Tip>Le CA par constructeur est dérivé des BC fournisseurs. Reliez ici chaque <b>nom de fournisseur</b> (tel qu'il figure sur les BC) au <b>constructeur</b> correspondant. Non renseigné ⇒ le BC n'est pas compté.</Tip>
        <div className="space-y-2">
          {rows.map((r, i) => (
            <div key={i} className="flex items-center gap-2">
              <input className="field flex-1" value={r.supplier} disabled={!canWrite} placeholder="Nom fournisseur (BC)" onChange={(e) => setRows((rs) => rs.map((x, j) => j === i ? { ...x, supplier: e.target.value } : x))} />
              <span className="text-faint">→</span>
              <div className="w-56"><Select value={r.partnerId} onChange={(v) => setRows((rs) => rs.map((x, j) => j === i ? { ...x, partnerId: v } : x))} options={partnerOpts} placeholder="Constructeur…" /></div>
              {canWrite && <button className="btn-ghost text-clay text-[11px]" onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}>Retirer</button>}
            </div>
          ))}
          {canWrite && <button className="btn-ghost text-[12px]" onClick={() => setRows((rs) => [...rs, { supplier: "", partnerId: "" }])}><Plus size={13} /> Ajouter une correspondance</button>}
          {!rows.length && !canWrite && <EmptyState label="Aucun mapping fournisseur défini." />}
        </div>
        {!!unmapped.length && (
          <div className="mt-3">
            <div className="text-[12px] text-muted mb-1">Fournisseurs BC non encore rattachés (à mapper) :</div>
            <div className="flex flex-wrap gap-1">
              {unmapped.slice(0, 12).map((u) => (
                <button key={u.supplier} className="text-[11px] px-2 py-0.5 rounded-md bg-panel2 text-muted hover:text-ink" disabled={!canWrite}
                  onClick={() => setRows((rs) => rs.some((x) => x.supplier.toUpperCase() === u.supplier) ? rs : [...rs, { supplier: u.supplier, partnerId: "" }])}>
                  {u.supplier} ({fmt(u.revenueXof)})
                </button>
              ))}
            </div>
          </div>
        )}
      </Card>

      <Card title="Référentiel des partenaires" actions={canWrite ? <button className="btn" onClick={() => setEdit(null)}><Plus size={14} /> Nouveau partenaire</button> : undefined}>
        <Tip>Un <b>partenaire</b> = un constructeur (Dell, Cisco, Fortinet…) avec ses <b>niveaux</b>, ses <b>compétences</b>, son <b>catalogue de certifications</b> et ses <b>exigences de quota</b> (les objectifs : par niveau, combien d'ingénieurs certifiés sur quelle cible). Ces exigences alimentent la conformité des quotas et les partenariats à risque du tableau de bord.</Tip>
        <Table
          columns={[
            colText("Constructeur", (r) => r.name),
            colText("Programme", (r) => r.programName || "—"),
            colNum("Niveaux", (r) => String((r.tiers || []).length)),
            colNum("Certifs au catalogue", (r) => String((r.certificationCatalog || []).length)),
            colNum("Exigences", (r) => String((r.requirements || []).length)),
            ...(canWrite ? [colText("", (r) => <button className="btn-ghost text-[11px]" onClick={() => setEdit(r)}>Éditer</button>)] : []),
          ]}
          rows={partners} rowKey={(r) => r.id}
          empty="Aucun partenaire — créez le premier constructeur avec « Nouveau partenaire »."
        />
      </Card>
      {edit !== undefined && <PartnerForm initial={edit} onClose={() => setEdit(undefined)} />}
    </div>
  );
};

// Clé locale stable pour relier les lignes du formulaire (niveau/compétence/certif) à leurs références
// (catalogue → compétence, exigence → niveau + cible) indépendamment des libellés saisis. Compteur simple
// (côté navigateur, hors rendu) — jamais persisté : au submit, buildPartnerPayload remappe vers les slugs.
let _pk = 0;
const nk = () => "k" + (++_pk);

// Formulaire de RÉFÉRENTIEL partenaire (création + édition). Réutilise les primitives du module (Modal,
// Field, Select, Busy) ; ne fait AUCUN calcul métier — il prépare l'entrée (buildPartnerPayload, pur/testé)
// et laisse le backend upsertParPartner valider et trancher (intégrité référentielle, slugs, validité).
const PartnerForm: FC<{ initial: Partner | null; onClose: () => void }> = ({ initial, onClose }) => {
  const [f, setF] = useState<PartnerFormState>(() => initial
    ? partnerToForm(initial)
    : { name: "", programName: "", status: "", renewalDate: "", validationStatus: "", bp: { ...EMPTY_BP }, tiers: [], comps: [], certs: [], reqs: [] });
  const set = (patch: Partial<PartnerFormState>) => setF((s) => ({ ...s, ...patch }));
  const setBp = (k: keyof BpForm, v: string) => setF((s) => ({ ...s, bp: { ...s.bp, [k]: v } }));
  const compOpts = f.comps.filter((c) => c.name.trim()).map((c) => ({ value: c.k, label: c.name }));
  const tierOpts = f.tiers.filter((t) => t.name.trim()).map((t) => ({ value: t.k, label: t.name }));
  // Cibles d'une exigence : une compétence (couverture agrégée) OU une certification précise du catalogue.
  const targetOpts = [
    ...f.comps.filter((c) => c.name.trim()).map((c) => ({ value: "comp:" + c.k, label: "Compétence · " + c.name })),
    ...f.certs.filter((c) => c.name.trim()).map((c) => ({ value: "cert:" + c.k, label: "Certif · " + c.name })),
  ];
  const submit = async () => {
    const built = buildPartnerPayload(f);
    if (!built.ok) throw new Error(built.error); // remonté par Busy (toast)
    await callFn("upsertParPartner", built.value);
    onClose();
  };
  return (
    <Modal open title={initial ? `Éditer ${initial.name}` : "Nouveau partenaire"} size="form" onClose={onClose}
      actions={<Busy label="Enregistrer" fn={submit} okMsg="Partenaire enregistré" />}>
      <div className="space-y-4">
        {/* Modèles constructeurs : pré-remplissent tout le référentiel (évite la page blanche et les listes
            déroulantes vides des exigences). Réservé à la création — on ne clobbère pas un partenaire édité. */}
        {!initial && (
          <div className="flex items-center gap-2 flex-wrap rounded-lg border border-line p-2">
            <span className="text-[11px] text-muted">Partir d'un modèle :</span>
            {PARTNER_PRESETS.map((p) => (
              <button key={p.id} type="button" className="btn-ghost text-[11px]" onClick={() => setF(buildPartnerPreset(p.id, nk))}>{p.label}</button>
            ))}
          </div>
        )}
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="Constructeur (nom)"><input className="field" value={f.name} placeholder="Ex. Fortinet" onChange={(e) => set({ name: e.target.value })} /></Field>
          <Field label="Programme"><input className="field" value={f.programName} placeholder="Ex. Engage (optionnel)" onChange={(e) => set({ programName: e.target.value })} /></Field>
        </div>

        {/* Statut courant + plan d'affaires (objectif BP vs réalisé YTD par axe) — miroir du tableau de bord
            direction Partners_Status_Tracking. Montants en FCFA entiers via le champ numérique (pas de décimale). */}
        <div className="space-y-2 rounded-lg border border-line p-3">
          <span className="text-[11px] font-semibold text-muted">Statut & plan d'affaires</span>
          <div className="grid sm:grid-cols-3 gap-3">
            <Field label="Statut actuel"><input className="field" value={f.status} placeholder="Ex. Platinum, Silver…" onChange={(e) => set({ status: e.target.value })} /></Field>
            <Field label="Échéance de renouvellement"><DateField value={f.renewalDate} onChange={(v) => set({ renewalDate: v })} /></Field>
            <Field label="Validation du plan"><Select value={f.validationStatus} onChange={(v) => set({ validationStatus: v })} options={[{ value: "", label: "—" }, ...Object.entries(VALIDATION_STATUS_LABEL).map(([value, l]) => ({ value, label: l }))]} placeholder="—" /></Field>
          </div>
          <div className="grid sm:grid-cols-2 gap-x-4 gap-y-2">
            {BP_AXES.map((ax) => (
              <div key={ax} className="flex items-center gap-2">
                <span className="w-28 text-[12px] text-muted">{BP_AXIS_LABEL[ax]}</span>
                <input className="field tabnum flex-1" type="number" value={f.bp[`${ax}Bp`]} placeholder="Objectif" aria-label={`Objectif ${BP_AXIS_LABEL[ax]}`} onChange={(e) => setBp(`${ax}Bp`, e.target.value)} />
                <span className="text-faint text-[11px]">vs</span>
                <input className="field tabnum flex-1" type="number" value={f.bp[`${ax}Ytd`]} placeholder="Réalisé" aria-label={`Réalisé ${BP_AXIS_LABEL[ax]}`} onChange={(e) => setBp(`${ax}Ytd`, e.target.value)} />
              </div>
            ))}
          </div>
          <Tip>Objectif (BP) vs réalisé (YTD) par axe. Pipeline &amp; Booking en <b>FCFA</b> ; Certifications en nombre ; Croissance en %. Le <b>% d'atteinte</b> par axe et global apparaît au Tableau de bord.</Tip>
        </div>

        <FormBlock title="Niveaux" onAdd={() => set({ tiers: [...f.tiers, { k: nk(), name: "", rank: "" }] })}>
          {f.tiers.map((t, i) => (
            <div key={t.k} className="flex items-center gap-2">
              <input className="field flex-1" value={t.name} placeholder="Libellé (ex. Gold)" onChange={(e) => set({ tiers: f.tiers.map((x, j) => j === i ? { ...x, name: e.target.value } : x) })} />
              <input className="field w-24" type="number" value={t.rank} placeholder="Rang" onChange={(e) => set({ tiers: f.tiers.map((x, j) => j === i ? { ...x, rank: e.target.value } : x) })} />
              <button className="btn-ghost text-clay text-[11px]" onClick={() => set({ tiers: f.tiers.filter((_, j) => j !== i) })}>Retirer</button>
            </div>
          ))}
        </FormBlock>

        <FormBlock title="Compétences" onAdd={() => set({ comps: [...f.comps, { k: nk(), name: "" }] })}>
          {f.comps.map((c, i) => (
            <div key={c.k} className="flex items-center gap-2">
              <input className="field flex-1" value={c.name} placeholder="Libellé (ex. Sécurité réseau)" onChange={(e) => set({ comps: f.comps.map((x, j) => j === i ? { ...x, name: e.target.value } : x) })} />
              <button className="btn-ghost text-clay text-[11px]" onClick={() => set({ comps: f.comps.filter((_, j) => j !== i) })}>Retirer</button>
            </div>
          ))}
        </FormBlock>

        <FormBlock title="Catalogue de certifications" onAdd={() => set({ certs: [...f.certs, { k: nk(), name: "", code: "", compK: "", level: "professional", validityMonths: "" }] })}>
          {f.certs.map((c, i) => (
            <div key={c.k} className="grid sm:grid-cols-5 gap-2 items-center rounded-lg border border-line p-2">
              <input className="field" value={c.code} placeholder="Code (NSE7)" onChange={(e) => set({ certs: f.certs.map((x, j) => j === i ? { ...x, code: e.target.value } : x) })} />
              <input className="field sm:col-span-2" value={c.name} placeholder="Libellé (NSE 7)" onChange={(e) => set({ certs: f.certs.map((x, j) => j === i ? { ...x, name: e.target.value } : x) })} />
              <Select value={c.compK} onChange={(v) => set({ certs: f.certs.map((x, j) => j === i ? { ...x, compK: v } : x) })} options={compOpts} placeholder="Compétence…" />
              <div className="flex items-center gap-2">
                <Select value={c.level} onChange={(v) => set({ certs: f.certs.map((x, j) => j === i ? { ...x, level: v } : x) })} options={PAR_LEVELS} />
                <input className="field w-20" type="number" value={c.validityMonths} placeholder="mois" onChange={(e) => set({ certs: f.certs.map((x, j) => j === i ? { ...x, validityMonths: e.target.value } : x) })} />
                <button className="btn-ghost text-clay text-[11px]" onClick={() => set({ certs: f.certs.filter((_, j) => j !== i) })}>Retirer</button>
              </div>
            </div>
          ))}
        </FormBlock>

        <FormBlock title="Exigences de quota (objectifs)" onAdd={() => set({ reqs: [...f.reqs, { k: nk(), tierK: "", targetK: "", minCount: "" }] })}>
          {/* Une exigence référence un niveau + une cible : sans niveaux ni compétences/certifs, ses listes
              déroulantes seraient vides — on le dit plutôt que de laisser un menu vide sans explication. */}
          {f.reqs.length > 0 && (!tierOpts.length || !targetOpts.length) && (
            <Tip>Ajoutez d'abord un <b>niveau</b> et au moins une <b>compétence</b> ou <b>certification</b> ci-dessus — ou repartez d'un modèle constructeur en haut du formulaire.</Tip>
          )}
          {f.reqs.map((r, i) => (
            <div key={r.k} className="flex items-center gap-2 flex-wrap">
              <div className="w-40"><Select value={r.tierK} onChange={(v) => set({ reqs: f.reqs.map((x, j) => j === i ? { ...x, tierK: v } : x) })} options={tierOpts} placeholder="Niveau…" /></div>
              <span className="text-faint text-[11px]">exige</span>
              <input className="field w-16" type="number" value={r.minCount} placeholder="min" onChange={(e) => set({ reqs: f.reqs.map((x, j) => j === i ? { ...x, minCount: e.target.value } : x) })} />
              <span className="text-faint text-[11px]">ingénieur(s) sur</span>
              <div className="flex-1 min-w-[180px]"><Select value={r.targetK} onChange={(v) => set({ reqs: f.reqs.map((x, j) => j === i ? { ...x, targetK: v } : x) })} options={targetOpts} placeholder="Cible (compétence/certif)…" /></div>
              <button className="btn-ghost text-clay text-[11px]" onClick={() => set({ reqs: f.reqs.filter((_, j) => j !== i) })}>Retirer</button>
            </div>
          ))}
        </FormBlock>

        <Tip>L'identifiant technique de chaque niveau/compétence/certification est <b>dérivé du libellé</b> (comme les codes de l'ERP). Les <b>exigences</b> sont les <b>objectifs du business plan</b> : pour tenir un niveau, un minimum d'ingénieurs certifiés sur une compétence ou une certification. La <b>date d'expiration</b> des certifs sera dérivée de la <b>validité (mois)</b> saisie ici — jamais ailleurs.</Tip>
      </div>
    </Modal>
  );
};

// Section repliable d'une liste éditable (niveaux/compétences/…) : en-tête + bouton « Ajouter ». Réutilise
// l'idiome des lignes de correspondance fournisseur ci-dessus (input + Retirer + Ajouter).
const FormBlock: FC<{ title: string; onAdd: () => void; children: ReactNode }> = ({ title, onAdd, children }) => (
  <div className="space-y-2">
    <div className="flex items-center justify-between">
      <span className="text-[12px] font-semibold text-muted">{title}</span>
      <button className="btn-ghost text-[12px]" onClick={onAdd}><Plus size={13} /> Ajouter</button>
    </div>
    {children}
  </div>
);
