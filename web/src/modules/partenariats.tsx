// Module « Partenariats & Certifications » (par_). Derrière le drapeau config/parFeature (App masque
// l'onglet si éteint) et gouverné par le droit `partenariats`. Réutilise les primitives design, les
// écritures callable et les formats de l'ERP (FCFA entier via money, date JJ/MM/AAAA via frDate). Le CA
// est DÉRIVÉ des BC fournisseurs (summaries/par_ca) — aucune saisie. Aucune valeur en dur (tons/libellés
// via lib/parLabels). Composant LAZY → callables inline (hors chunk d'entrée).
import { useEffect, useMemo, useState, type FC, type ReactNode } from "react";
import { Plus, Sparkles } from "lucide-react";
import { httpsCallable } from "firebase/functions";
import { functions } from "../lib/firebase";
import { useCan, useCanSeeMargin } from "../lib/rbac";
import { useCollectionData, useDocData, DEFAULT_SUB_CAP } from "../lib/hooks";
import { Card, Tip, Badge, Busy, DangerBtn, Table, colText, colNum, Eyebrow, money, EmptyState, ErrorState, CardSkeleton, TruncationNote, Modal, Segmented, useToast, useConfirm } from "../design/components";
import { Select, DateField } from "../design/inputs";
import { frDate } from "../lib/format";
import { ExportBtn } from "../design/bulk";
import { buildPartnerPayload, partnerToForm, bpAchievement, PAR_LEVELS, BP_AXES, EMPTY_BP, FR_MONTHS, fiscalMonthsLabel, type PartnerFormState, type BpForm } from "../lib/parPartnerForm";
import { PARTNER_PRESETS, buildPartnerPreset } from "../lib/parPartnerPresets";
import { tierProgress } from "../lib/parTier";
import { trainingPlan } from "../lib/parTraining";
import { byEngineer } from "../lib/parEngineer";
import { fmt, pct, T } from "../design/tokens";
import { MultiLine } from "../design/charts";
import {
  PARTNERSHIP_STATUS_LABEL, partnershipTone, CERT_STATUS_LABEL, certStatusTone,
  ALERT_BUCKET_LABEL, alertBucketTone, ASSIGNMENT_STATUS_LABEL, assignmentTone,
  relanceBucketLabel, relanceBucketTone, VALIDATION_STATUS_LABEL, validationTone, BP_AXIS_LABEL, label,
} from "../lib/parLabels";
import type { Props } from "./_shared";
// Types de la QBR (import type : effacé à la compilation — pptxgenjs reste chargé à la demande).
import type { ParQbr, ParQbrSnapshot } from "../lib/parQbrPptx";

// Appel callable INLINE (module lazy) — évite d'alourdir writes.ts (budget bundle). `timeout` optionnel :
// les callables LONGS (IA, imports, recompute — 300 s côté serveur) dépasseraient les 70 s par défaut du
// SDK et remonteraient un faux « deadline-exceeded » alors que le serveur finit son travail (convention
// writes.ts : timeout client aligné sur le serveur).
const callFn = <T,>(name: string, payload: unknown, timeout?: number) => httpsCallable(functions, name, timeout ? { timeout } : undefined)(payload).then((r) => r.data as T);

type CatalogEntry = { id: string; code?: string; name: string; competencyId: string; level: string; validityMonths: number };
type BusinessPlan = Partial<Record<"pipelineBp" | "pipelineYtd" | "bookingBp" | "bookingYtd" | "certBp" | "certYtd" | "growthBp" | "growthYtd", number>>;
type Partner = { id: string; name: string; programName?: string; status?: string; renewalDate?: string; validationStatus?: string; businessPlan?: BusinessPlan; caDeclaredXof?: number; fiscalStartMonth?: number; tiers?: { id: string; name: string; rank: number }[]; competencies?: { id: string; name: string }[]; certificationCatalog?: CatalogEntry[]; requirements?: { tierId: string; certIdOrCompetencyId: string; minCount: number }[] };
type Certif = { id: string; consultantId: string; consultantName?: string; consultantBu?: string; partnerId: string; certificationCatalogId: string; certName?: string; certCode?: string; status: string; obtainedDate: string; expiryDate?: string };
type Assign = { id: string; consultantId: string; consultantName?: string; partnerId: string; certificationCatalogId: string; cert?: string; targetDate: string; status: string; clickupTaskId?: string; clickupUrl?: string };
type CaSummary = { byPartner?: { partnerId: string; name: string; revenueXof: number; bcXof?: number; declaredXof?: number; bcCount: number; source?: "bc" | "declare" }[]; unmapped?: { supplier: string; revenueXof: number; bcCount: number }[]; unmappedCount?: number; declaredRawXof?: number; totalXof?: number; bcXof?: number; declaredXof?: number; exerciseYear?: number; offExerciseXof?: number; offExerciseCount?: number; asOf?: string } | null;
type CaHistory = { days?: { date: string; totalXof: number; bcXof: number; declaredXof: number }[] } | null;
type QuotaSummary = { partners?: { partnerId: string; name: string; status: string; coverage: { tierId: string; target: string; minCount: number; holders: number; ok: boolean }[]; gaps: { target: string; minCount: number; holders: number }[] }[]; asOf?: string } | null;
type AlertSummary = { items?: { id: string; consultantName?: string; partnerId: string; certName?: string; expiryDate: string; daysLeft: number; bucket: string }[]; counts?: Record<string, number>; total?: number; partnerRenewals?: { id: string; partnerId: string; name: string; renewalDate: string; daysLeft: number; bucket: string }[]; partnerRenewalTotal?: number } | null;
type RelanceSummary = { items?: { id: string; consultantName?: string; partnerId: string; cert?: string; targetDate: string; daysLeft: number; bucket: string; effectiveStatus?: string }[]; counts?: { total: number; late: number } } | null;
type PipelineSummary = { partners?: { partnerId: string; name: string; openXof: number; openWeightedXof: number; openCount: number; wonXof: number; wonCount: number }[]; totalOpenXof?: number; totalWonXof?: number; exerciseYear?: number } | null;
type QuotaHistory = { days?: { date: string; conformes: number; aRisque: number; nonConformes: number; total: number; aRenouveler: number; expirees: number }[] } | null;
type ConsultantLite = { id: string; name: string; bu?: string };

const Field: FC<{ label: string; children: ReactNode }> = ({ label, children }) => (
  <label className="flex flex-col gap-1"><span className="text-[11px] text-muted">{label}</span>{children}</label>
);

// Section de formulaire premium — en-tête `Eyebrow` (capitales espacées) + aide courte + conteneur bordé.
// Refonte Paramétrage (ADR-P13) : donne au modal d'édition une hiérarchie lisible (Identité / Statut & plan /
// CA & exercice / Catalogue / Exigences), au lieu d'un empilement plat. Réutilise Eyebrow + tokens.
const FormSection: FC<{ title: string; hint?: ReactNode; children: ReactNode }> = ({ title, hint, children }) => (
  <div className="rounded-lg border border-line p-3 space-y-3">
    <div><Eyebrow>{title}</Eyebrow>{hint && <p className="text-[11px] text-faint mt-1">{hint}</p>}</div>
    {children}
  </div>
);


export const Partenariats: FC<Props> = () => {
  const canWrite = useCan("partenariats") === "write";
  // Le CA constructeur (par_ca) est CONFIDENTIEL — même cloisonnement que la marge (droit `rentabilite`,
  // ADR-P07). Sans ce droit on NE S'ABONNE PAS à summaries/par_ca (sinon permission-denied par les rules)
  // et le KPI + la carte CA sont masqués — comme MB/%MB ailleurs (useCanSeeMargin).
  const canSeeCa = useCanSeeMargin();
  const [tab, setTab] = useState<"dash" | "certifs" | "assigns" | "engineers" | "config" | "ia">("dash");
  // Édition d'un partenaire depuis une vue read-only (Plan d'affaires / Conformité) : on bascule sur
  // Paramétrage et on demande l'ouverture du formulaire pour ce partnerId (consommé par ConfigTab).
  const [editPartnerId, setEditPartnerId] = useState<string | null>(null);
  const goEditPartner = (id: string) => { setEditPartnerId(id); setTab("config"); };

  // Lectures temps réel (onSnapshot) — gatées par les rules (drapeau + droit). loading/error/truncated
  // exposés (audit partenariats) : un refus de droit ou une panne ne doit pas ressembler à « module vide »,
  // et une collection tronquée au cap d'abonnement doit se signaler (TruncationNote), jamais silencieuse.
  const { rows: partners, loading: partnersLoading, error: partnersError, truncated: partnersTrunc } = useCollectionData<Partner>("par_partners");
  const { rows: certifs, loading: certifsLoading, error: certifsError, truncated: certifsTrunc } = useCollectionData<Certif>("par_certifications");
  const { rows: assigns, loading: assignsLoading, error: assignsError, truncated: assignsTrunc } = useCollectionData<Assign>("par_assignments");
  const { data: ca } = useDocData<CaSummary>(canSeeCa ? "summaries/par_ca" : null);
  const { data: caHistory } = useDocData<CaHistory>(canSeeCa ? "summaries/par_caHistory" : null);
  const { data: quotas } = useDocData<QuotaSummary>("summaries/par_quotas");
  const { data: alerts } = useDocData<AlertSummary>("summaries/par_alerts");
  const { data: relances } = useDocData<RelanceSummary>("summaries/par_relances");
  const { data: history } = useDocData<QuotaHistory>("summaries/par_quotasHistory");
  const { data: parPipeline } = useDocData<PipelineSummary>("summaries/par_pipeline");
  const { data: mapDoc } = useDocData<{ map?: Record<string, string | Record<string, number>> }>("config/parPartnerMap");

  const partnerName = useMemo(() => { const m: Record<string, string> = {}; for (const p of partners || []) m[p.id] = p.name; return m; }, [partners]);
  const partnerOpts = useMemo(() => (partners || []).map((p) => ({ value: p.id, label: p.name })), [partners]);

  // Onboarding (PA5) : module activé mais référentiel VIDE — on guide vers la création plutôt que de laisser
  // un tableau de bord à zéro sans indice (leçon du formulaire de référentiel : la complétude se mesure au
  // parcours). N'apparaît qu'en écriture et quand aucun partenaire n'existe.
  const empty = (partners || []).length === 0;
  // Gardes de chargement/erreur (audit partenariats) : sans elles, un refus de droit ou une panne réseau
  // rendait le module comme « vide » (onboarding à tort), et le premier rendu flashait des tableaux à zéro.
  const loadError = partnersError || certifsError || assignsError;
  const parLoading = partnersLoading || certifsLoading || assignsLoading;
  return (
    <div className="space-y-4">
      <Segmented
        value={tab} onChange={setTab} ariaLabel="Sections du module Partenariats"
        options={[
          { value: "dash", label: "Tableau de bord" },
          { value: "certifs", label: "Certifications", count: certifs?.length },
          { value: "assigns", label: "Assignations", count: assigns?.length },
          { value: "engineers", label: "Ingénieurs" },
          { value: "config", label: "Paramétrage" },
          { value: "ia", label: "IA & QBR" },
        ]}
      />
      {loadError && <ErrorState error={loadError} />}
      {!loadError && parLoading && <CardSkeleton />}
      <TruncationNote show={partnersTrunc || certifsTrunc || assignsTrunc} cap={DEFAULT_SUB_CAP} />

      {!loadError && !parLoading && empty && canWrite && (
        <Card title="Démarrer le module Partenariats">
          <Tip>Le module est <b>activé mais vide</b>. Le plus rapide : ouvrez <b>Paramétrage</b> et cliquez <b>« Importer les 20 partenaires de référence »</b> — le référentiel se remplit d'un coup avec vos données (statut, plan d'affaires, certifications, exigences de quota). Sinon, créez un constructeur à la main avec <b>« Nouveau partenaire »</b> (ou en <b>partant d'un modèle</b>). Ajoutez ensuite les <b>certifications</b> de vos ingénieurs et leurs <b>assignations</b> — le tableau de bord se remplit tout seul.</Tip>
          <button className="btn mt-2" onClick={() => setTab("config")}><Plus size={14} /> Créer un partenaire</button>
        </Card>
      )}

      {!loadError && !parLoading && <>
        {tab === "dash" && <Dashboard ca={ca} caHistory={caHistory} pipeline={parPipeline} canSeeCa={canSeeCa} canWrite={canWrite} onEditPartner={goEditPartner} quotas={quotas} alerts={alerts} relances={relances} history={history} partners={partners || []} certifs={certifs || []} assigns={assigns || []} partnerName={partnerName} />}
        {tab === "certifs" && <CertifsTab certifs={certifs || []} partners={partners || []} partnerName={partnerName} partnerOpts={partnerOpts} canWrite={canWrite} />}
        {tab === "assigns" && <AssignsTab assigns={assigns || []} partners={partners || []} partnerName={partnerName} partnerOpts={partnerOpts} canWrite={canWrite} />}
        {tab === "engineers" && <EngineersTab certifs={certifs || []} assigns={assigns || []} partnerName={partnerName} />}
        {tab === "config" && <ConfigTab partners={partners || []} certifs={certifs || []} assigns={assigns || []} partnerOpts={partnerOpts} mapDoc={mapDoc} ca={ca} canWrite={canWrite} openEditId={editPartnerId} onConsumedEdit={() => setEditPartnerId(null)} />}
        {tab === "ia" && <IaTab partnerOpts={partnerOpts} />}
      </>}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────── Ingénieurs (vue par consultant)
// Pivote certifs (détenues) + assignations (à obtenir) par ingénieur — parcours de certification d'un coup
// d'œil (PA5). Regroupement PUR (lib/parEngineer) ; aucun re-calcul (mêmes lignes que les onglets dédiés).
const EngineersTab: FC<{ certifs: Certif[]; assigns: Assign[]; partnerName: Record<string, string> }> = ({ certifs, assigns, partnerName }) => {
  const rows = useMemo(() => byEngineer(certifs, assigns), [certifs, assigns]);
  const certList = (r: typeof rows[number]) => r.certs.map((c) => `${c.certName || c.certificationCatalogId} (${partnerName[c.partnerId] || c.partnerId})`).join(", ");
  const assignList = (r: typeof rows[number]) => r.assigns.map((a) => `${a.cert || a.certificationCatalogId} (${partnerName[a.partnerId] || a.partnerId})`).join(", ");
  const exportCols = [
    { header: "Ingénieur", render: (r: typeof rows[number]) => r.consultantName },
    { header: "BU", render: (r: typeof rows[number]) => r.consultantBu },
    { header: "Certifs détenues", render: (r: typeof rows[number]) => String(r.certCount) },
    { header: "Dont valides", render: (r: typeof rows[number]) => String(r.activeCerts) },
    { header: "Assignations en cours", render: (r: typeof rows[number]) => String(r.assignCount) },
    { header: "Certifications", render: certList },
    { header: "À obtenir", render: assignList },
  ];
  return (
    <Card title={`Certifications par ingénieur${rows.length ? ` · ${rows.length}` : ""}`} actions={<ExportBtn name="certifs-par-ingenieur" cols={exportCols} rows={rows} />}>
      <Tip>Le parcours de certification de chaque ingénieur : ce qu'il <b>détient</b> (dont combien encore valides) et ce qui lui est <b>assigné</b> à obtenir. Pivot des onglets Certifications et Assignations — mêmes données.</Tip>
      <Table
        columns={[
          colText("Ingénieur", (r) => r.consultantName),
          colText("BU", (r) => r.consultantBu || "—"),
          // Détenues VALIDES / total : jauge de fraîcheur des certifs de l'ingénieur (même grammaire que le tableau de bord).
          colNum("Certifs valides", (r) => r.certCount ? <MiniBar ratio={r.activeCerts / r.certCount} label={`${r.activeCerts}/${r.certCount}`} /> : <span className="text-faint">—</span>, (r) => r.certCount),
          colNum("Assignations", (r) => String(r.assignCount), (r) => r.assignCount),
          colText("Certifications", (r) => certList(r) || "—"),
          colText("À obtenir", (r) => assignList(r) || "—"),
        ]}
        rows={rows} rowKey={(r) => r.consultantId} pageSize={12} searchKeys={[(r) => r.consultantName, (r) => r.consultantBu]}
        empty="Aucune certification ni assignation enregistrée."
      />
    </Card>
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
  const [planPartnerId, setPlanPartnerId] = useState(""); // "" = tous les partenaires (défaut)
  const [partnerId, setPartnerId] = useState("");
  const [periode, setPeriode] = useState("");
  const [qbr, setQbr] = useState<{ qbr: ParQbr; snapshot: ParQbrSnapshot } | null>(null);
  const [qbrBusy, setQbrBusy] = useState(false);

  const genPlan = async () => {
    if (planBusy) return; setPlanBusy(true);
    try { const r = await callFn<{ plan: PlanItem[] }>("generateParActionPlan", { partnerId: planPartnerId || undefined }, 300_000); setPlan(r.plan || []); }
    catch (e: any) { toast(`Échec — ${String(e?.message || e?.code || "").replace(/^functions\//, "") || "action refusée"}`, "err"); }
    finally { setPlanBusy(false); }
  };
  const genQbr = async () => {
    if (qbrBusy || !partnerId) return; setQbrBusy(true);
    try { const r = await callFn<{ qbr: ParQbr; snapshot: ParQbrSnapshot }>("generateParQbr", { partnerId, periode }, 300_000); setQbr({ qbr: r.qbr, snapshot: r.snapshot }); }
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
      <Card title="Plan d'action business (IA)" actions={
        <div className="flex items-center gap-2">
          {/* Portée : tous les partenaires (défaut) ou un partenaire ciblé — même liste que la QBR. */}
          <div className="w-52"><Select value={planPartnerId} onChange={setPlanPartnerId} options={[{ value: "", label: "Tous les partenaires" }, ...partnerOpts]} ariaLabel="Portée du plan (partenaire)" /></div>
          <button className="btn" disabled={planBusy} onClick={genPlan}>{planBusy ? "Génération…" : "Générer le plan"}</button>
        </div>}>
        <Tip>Génère, à partir des données du module (statuts, quotas, CA, retards), un plan d'action priorisé — combler les quotas, accélérer le CA, sécuriser les niveaux avant audit. Choisissez <b>un partenaire</b> pour un plan ciblé, ou <b>Tous les partenaires</b>. Recommandations proposées par l'IA, à valider.</Tip>
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
            {(qbr.snapshot?.exercice_fiscal || qbr.snapshot?.ca_dont_bc_fcfa || qbr.snapshot?.ca_dont_declare_fcfa) ? (
              <div className="text-[11px] text-faint flex flex-wrap gap-x-3 gap-y-0.5">
                {qbr.snapshot?.exercice_fiscal && <span>Exercice : {qbr.snapshot.exercice_fiscal}</span>}
                {(qbr.snapshot?.ca_dont_bc_fcfa || qbr.snapshot?.ca_dont_declare_fcfa) ? <span>CA : dont BC {fmt(qbr.snapshot.ca_dont_bc_fcfa || 0)} · déclaré {fmt(qbr.snapshot.ca_dont_declare_fcfa || 0)}</span> : null}
              </div>
            ) : null}
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
// Pastille de légende (rond de couleur + libellé) — même grammaire que les légendes CODIR.
const Dot: FC<{ color: string; label: ReactNode }> = ({ color, label }) => (
  <span className="inline-flex items-center gap-1.5 text-faint tabnum">
    <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: color }} />{label}
  </span>
);

// Couleur de trajectoire selon le taux d'atteinte (miroir des tons Kpi : tenu / proche / en retard).
const ratioColor = (r: number | null): string => (r == null ? T.faint : r >= 1 ? T.emerald : r >= 0.8 ? T.gold : T.clay);

// Mini-barre de trajectoire (0..1, barre bornée à 100 % ; le libellé garde le % réel qui peut dépasser).
// Cellule de tableau premium — remplace un % brut par une jauge lisible d'un coup d'œil. Tokens uniquement.
const MiniBar: FC<{ ratio: number | null; color?: string; label?: ReactNode }> = ({ ratio, color, label }) => {
  const w = ratio == null ? 0 : Math.max(0, Math.min(1, ratio));
  const c = color || ratioColor(ratio);
  return (
    <span className="inline-flex items-center gap-2 min-w-[96px]">
      <span className="relative h-1.5 flex-1 overflow-hidden rounded-full" style={{ backgroundColor: T.panel2 }}>
        <span className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${w * 100}%`, backgroundColor: c }} />
      </span>
      <span className="tabnum text-[11px] w-9 text-right" style={{ color: ratio == null ? undefined : c }}>{label ?? (ratio == null ? "—" : pct(ratio))}</span>
    </span>
  );
};

// HERO du cockpit partenariats — vocabulaire premium CODIR (grand nombre `font-display`, barre de couverture
// segmentée, tuiles-stats en capitales espacées). Tout par tokens `T.*` (aucune couleur en dur). Remplace la
// grille de KPI plate en fusionnant : focus sur la CONFORMITÉ (la métrique de pilotage) + stats de tête.
type QuotaRow = NonNullable<QuotaSummary>["partners"] extends (infer R)[] | undefined ? R : never;
const HeroBand: FC<{ partners: Partner[]; ca: CaSummary; canSeeCa: boolean; alerts: AlertSummary; relances: RelanceSummary; quotaPartners: QuotaRow[]; asOf?: string }> = ({ partners, ca, canSeeCa, alerts, relances, quotaPartners, asOf }) => {
  const conformes = quotaPartners.filter((p) => p.status === "on_track").length;
  const aRisque = quotaPartners.filter((p) => p.status === "at_risk").length;
  const nonConformes = quotaPartners.filter((p) => p.status === "non_compliant").length;
  const nonEval = quotaPartners.filter((p) => p.status === "non_evalue").length;
  const evalues = conformes + aRisque + nonConformes;
  const ratio = evalues ? conformes / evalues : null; // 0..1, sur les partenaires ÉVALUÉS (exclut non évalués)
  const seg = (n: number, color: string) => (evalues && n ? <span style={{ width: `${(n / evalues) * 100}%`, backgroundColor: color }} /> : null);
  const risque = aRisque + nonConformes;
  const stats: { label: string; value: string; color?: string }[] = [
    { label: "Partenaires", value: String(partners.length) },
    ...(canSeeCa ? [{ label: `CA constructeurs ${ca?.exerciseYear || ""}`.trim(), value: ca == null ? "\u2014" : fmt(ca.totalXof || 0), color: T.emerald }] : []),
    { label: "Certifs à renouveler", value: alerts == null ? "\u2014" : String(alerts.total || 0), color: (alerts?.total || 0) > 0 ? T.gold : undefined },
    { label: "Partenariats à risque", value: String(risque), color: risque > 0 ? T.clay : undefined },
  ];
  return (
    <section className="card p-4 sm:p-5 animate-fade-in">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Eyebrow>Cockpit partenariats</Eyebrow>
          <div className="mt-1.5 flex items-end gap-2">
            <span className="font-display leading-none tabnum text-[34px] sm:text-[40px]" style={{ color: ratioColor(ratio) }}>{ratio == null ? "—" : pct(ratio)}</span>
            <span className="mb-1 text-[12px] text-muted">conformité des quotas{evalues ? ` · ${conformes}/${evalues}` : ""}</span>
          </div>
        </div>
        {asOf && <span className="text-[11px] text-faint tabnum">à jour au {frDate(asOf)}</span>}
      </div>

      {/* Barre de couverture segmentée (conformes / à risque / non conformes) — proportionnelle aux évalués. */}
      <div className="mt-3 flex h-2 w-full overflow-hidden rounded-full" style={{ backgroundColor: T.panel2 }}>
        {seg(conformes, T.emerald)}{seg(aRisque, T.gold)}{seg(nonConformes, T.clay)}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px]">
        <Dot color={T.emerald} label={`${conformes} conformes`} />
        <Dot color={T.gold} label={`${aRisque} à risque`} />
        <Dot color={T.clay} label={`${nonConformes} non conformes`} />
        {!!nonEval && <span className="text-faint tabnum">· {nonEval} non évalués</span>}
        {!!(relances?.counts?.late) && <span className="text-clay tabnum">· {relances.counts.late} relance(s) en retard</span>}
      </div>

      {/* Tuiles-stats de tête (capitales espacées, grand chiffre `font-display`). */}
      <div className="mt-4 grid grid-cols-2 gap-4 border-t pt-4 sm:grid-cols-4" style={{ borderColor: T.line }}>
        {stats.map((s) => (
          <div key={s.label} className="min-w-0">
            <div className="truncate text-[10px] font-semibold uppercase tracking-wide text-faint" title={s.label}>{s.label}</div>
            <div className="font-display tabnum text-[20px] sm:text-[22px] leading-none mt-1.5" style={{ color: s.color || "rgb(var(--ink))" }}>{s.value}</div>
          </div>
        ))}
      </div>
    </section>
  );
};

const Dashboard: FC<{ ca: CaSummary; caHistory: CaHistory; pipeline: PipelineSummary; canSeeCa: boolean; canWrite: boolean; onEditPartner: (id: string) => void; quotas: QuotaSummary; alerts: AlertSummary; relances: RelanceSummary; history: QuotaHistory; partners: Partner[]; certifs: Certif[]; assigns: Assign[]; partnerName: Record<string, string> }> = ({ ca, caHistory, pipeline, canSeeCa, canWrite, onEditPartner, quotas, alerts, relances, history, partners, certifs, assigns, partnerName }) => {
  // Action de ligne « Éditer le partenaire » depuis une vue read-only → bascule Paramétrage + ouvre le formulaire.
  const editCol = (id: (r: any) => string) => colText("", (r: any) => <button className="btn-ghost text-[11px]" onClick={() => onEditPartner(id(r))}>Éditer</button>);
  // Mémoïsés (identité stable) : ces tableaux sont des DÉPENDANCES de useMemo plus bas (compareRows,
  // trainRows) — le repli `|| []` recréé à chaque rendu invaliderait les mémos en boucle (eslint react-hooks).
  const alertItems = useMemo(() => alerts?.items || [], [alerts]);
  const relanceItems = relances?.items || [];
  const quotaPartners = useMemo(() => quotas?.partners || [], [quotas]);
  // Tendance de conformité (Lot P3) : historique quotidien de la couverture des quotas (30 derniers jours).
  const trend = (history?.days || []).slice(-30).map((d) => ({ name: (d.date || "").slice(5), Conformes: d.conformes, "À risque": d.aRisque, "Non conformes": d.nonConformes }));
  // Plan d'affaires : partenaires portant un BP saisi, avec taux d'atteinte par axe + global (miroir du
  // tableau direction). On ne re-calcule rien d'autre : bpAchievement est le miroir exact du backend.
  const bpRows = partners
    .filter((p) => p.businessPlan && Object.keys(p.businessPlan).length)
    .map((p) => ({ p, a: bpAchievement(p.businessPlan) }))
    .sort((x, y) => (x.a.global ?? -1) - (y.a.global ?? -1)); // les moins avancés en tête (à traiter)
  // Niveau de partenariat tenu / prochain (PA2) : dérivé de la couverture des quotas + des rangs de niveaux
  // du référentiel. Aucun re-calcul de couverture — on interprète les `ok` du summary (parité preservée).
  const tiersByPartner = new Map(partners.map((p) => [p.id, p.tiers || []]));
  const tp = (r: { partnerId: string; coverage?: { tierId: string; target: string; minCount: number; holders: number; ok: boolean }[] }) =>
    tierProgress(tiersByPartner.get(r.partnerId), r.coverage);
  const bpCol = (ax: typeof BP_AXES[number]) => colNum(BP_AXIS_LABEL[ax], (r: typeof bpRows[number]) => <MiniBar ratio={r.a[ax]} />, (r: typeof bpRows[number]) => r.a[ax] ?? -1);
  // Écart statut DÉCLARÉ (fiche partenaire, texte libre : « Silver », « Expert »…) vs niveau CALCULÉ
  // (tierProgress sur la couverture des quotas) — PAR-P4. Comparaison insensible casse/espaces : un badge
  // signale la divergence (statut affiché au constructeur non soutenu par les certifs, ou l'inverse).
  const declaredById = useMemo(() => new Map(partners.map((p) => [p.id, (p.status || "").trim()])), [partners]);
  const normLvl = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
  // Renouvellements du PARTENARIAT (renewalDate, J-90/60/30 — partnerRenewalWatch au recompute).
  const partnerRenewals = alerts?.partnerRenewals || [];
  // Comparatif inter-constructeurs (PAR-P4) : jointure FRONT des états déjà calculés (CA, conformité,
  // niveau tenu, certifs valides, renouvellements) — aucune re-dérivation, uniquement une mise côte à côte
  // pour arbitrer où investir (quel partenariat rapporte, lequel coûte en conformité).
  const compareRows = useMemo(() => {
    const caBy = new Map((ca?.byPartner || []).map((g) => [g.partnerId, g]));
    const quotaBy = new Map(quotaPartners.map((q) => [q.partnerId, q]));
    const renewBy = new Map<string, number>();
    for (const a of alertItems) renewBy.set(a.partnerId, (renewBy.get(a.partnerId) || 0) + 1);
    const certBy = new Map<string, { ok: number; tot: number }>();
    for (const c of certifs) { const e = certBy.get(c.partnerId) || { ok: 0, tot: 0 }; e.tot++; if (c.status === "active") e.ok++; certBy.set(c.partnerId, e); }
    return partners.map((p) => {
      const q = quotaBy.get(p.id);
      return {
        partnerId: p.id, name: p.name,
        caXof: caBy.get(p.id)?.revenueXof || 0, caSource: caBy.get(p.id)?.source,
        quotaStatus: q?.status || "non_evalue",
        achieved: q ? tierProgress(p.tiers, q.coverage).achieved?.name || null : null,
        certOk: certBy.get(p.id)?.ok || 0, certTot: certBy.get(p.id)?.tot || 0,
        renouv: renewBy.get(p.id) || 0,
      };
    }).sort((a, b) => b.caXof - a.caXof || a.name.localeCompare(b.name));
  }, [partners, ca, quotaPartners, alertItems, certifs]);
  // Plan de formation (PA+ Lot 3) : transforme les écarts de quota en assignations proposées. PUR (parTraining),
  // aucune re-dérivation de la conformité — on lit la couverture du summary.
  const trainRows = useMemo(() => trainingPlan(quotaPartners, partners, certifs, assigns), [quotaPartners, partners, certifs, assigns]);
  const td90 = () => new Date(Date.now() + 90 * 864e5).toISOString().slice(0, 10); // échéance par défaut, éditable
  return (
    <div className="space-y-4">
      <HeroBand partners={partners} ca={ca} canSeeCa={canSeeCa} alerts={alerts} relances={relances} quotaPartners={quotaPartners} asOf={quotas?.asOf} />


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
              colNum("% global", (r) => <MiniBar ratio={r.a.global} />, (r) => r.a.global ?? -1),
              colText("Échéance", (r) => r.p.renewalDate ? frDate(r.p.renewalDate) : "—"),
              colText("Validation", (r) => <Badge tone={validationTone(r.p.validationStatus)}>{label(VALIDATION_STATUS_LABEL, r.p.validationStatus)}</Badge>, (r) => r.p.validationStatus || ""),
              ...(canWrite ? [editCol((r) => r.p.id)] : []),
            ]}
            rows={bpRows} rowKey={(r) => r.p.id} empty="Aucun plan d'affaires saisi."
          />
        </Card>
      )}

      {canSeeCa && (
      <Card title="CA par constructeur — BC dérivé + déclaratif">
        <Tip>Le chiffre d'affaires par partenaire <b>mélange</b> le <b>dérivé des bons de commande fournisseurs</b> (via la correspondance fournisseur→constructeur, Paramétrage) et le <b>CA réalisé déclaré</b> sur la fiche partenaire (repli = booking YTD du plan d'affaires). Règle : le <b>BC prime</b> dès qu'il existe, le déclaratif comble sinon — jamais additionnés. Montants en FCFA.</Tip>
        <Table
          columns={[
            colText("Constructeur", (r) => r.name, (r) => r.name),
            colNum("CA retenu (FCFA)", (r) => money(r.revenueXof), (r) => r.revenueXof),
            // Écart BC vs déclaré PAR LIGNE (PAR-P4) : les deux mesures coexistent sur la fiche — les voir
            // côte à côte révèle un déclaratif surestimé (ou un mapping BC incomplet), au lieu d'un seul
            // chiffre « retenu » qui masque la divergence.
            colNum("dont BC", (r) => (r.bcXof || 0) > 0 ? money(r.bcXof!) : <span className="text-faint">—</span>, (r) => r.bcXof || 0),
            colNum("dont déclaré", (r) => (r.declaredXof || 0) > 0 ? money(r.declaredXof!) : <span className="text-faint">—</span>, (r) => r.declaredXof || 0),
            colNum("Écart BC−déclaré", (r) => {
              if (!((r.bcXof || 0) > 0 && (r.declaredXof || 0) > 0)) return <span className="text-faint">—</span>;
              const d = (r.bcXof || 0) - (r.declaredXof || 0);
              return <span className="tabnum" style={{ color: d < 0 ? T.clay : T.emerald }}>{d > 0 ? "+" : ""}{money(d)}</span>;
            }, (r) => ((r.bcXof || 0) > 0 && (r.declaredXof || 0) > 0) ? (r.bcXof || 0) - (r.declaredXof || 0) : 0),
            colText("Source", (r) => <Badge tone={r.source === "bc" ? "emerald" : "gold"}>{r.source === "bc" ? "BC" : "Déclaré"}</Badge>, (r) => r.source || ""),
            colNum("BC", (r) => String(r.bcCount), (r) => r.bcCount),
          ]}
          rows={ca?.byPartner || []} rowKey={(r) => r.partnerId} empty="Aucun CA — ni BC rattaché, ni CA déclaré/booking YTD sur les fiches partenaires."
        />
        {/* Ventilation BC dérivé vs déclaratif (fait voir où le réel a pris le relais du repli). */}
        {!!(ca?.totalXof) && (
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px]">
            <Dot color={T.emerald} label={<>BC dérivé <b className="tabnum">{money(ca?.bcXof || 0)}</b></>} />
            <Dot color={T.gold} label={<>Déclaré <b className="tabnum">{money(ca?.declaredXof || 0)}</b></>} />
            <span className="text-faint tabnum">· total {money(ca?.totalXof || 0)}{ca?.exerciseYear ? ` (exercice ${ca.exerciseYear})` : ""}</span>
          </div>
        )}
        {/* CA d'autres millésimes (n° BC/AAAA/N) écarté de l'exercice — remonté, jamais silencieux (ADR-P16). */}
        {!!(ca?.offExerciseXof) && (
          <div className="mt-1 text-[11px] text-faint">
            {money(ca!.offExerciseXof!)} de commandes d'autres millésimes exclues de l'exercice {ca?.exerciseYear || ""} ({ca?.offExerciseCount || 0} BC).
          </div>
        )}
        {!!(ca?.unmappedCount ?? (ca?.unmapped || []).length) && (
          <div className="mt-2 text-[12px] text-gold">
            {ca?.unmappedCount ?? (ca!.unmapped!).length} fournisseur(s) BC non rattaché(s) à un constructeur (à mapper en Paramétrage) — ex. {(ca?.unmapped || []).slice(0, 3).map((u) => u.supplier).join(", ")}.
          </div>
        )}
        {/* Tendance du CA (historisé à chaque recalcul) : total + ventilation BC/déclaré. */}
        {(caHistory?.days || []).length >= 2 && (
          <div className="mt-3">
            <MultiLine
              data={(caHistory!.days!).slice(-30).map((d) => ({ name: (d.date || "").slice(5), Total: d.totalXof, BC: d.bcXof, "Déclaré": d.declaredXof }))}
              series={[{ key: "Total", color: T.ink, name: "Total" }, { key: "BC", color: T.emerald, name: "BC dérivé" }, { key: "Déclaré", color: T.gold, name: "Déclaré" }]}
              h={200}
            />
          </div>
        )}
      </Card>
      )}

      {/* Pipeline SOURCÉ PARTENAIRE (PAR-L1) : opps taguées d'un constructeur (formulaire Pipeline) —
          ouvert + pondéré (même autorité projectionWeight que la prévision) + gagné de l'exercice, avec
          l'objectif pipeline du plan d'affaires en regard (contrepartie MESURÉE du déclaré). */}
      {!!(pipeline?.partners || []).length && (
        <Card title={`Pipeline sourcé partenaire${pipeline?.exerciseYear ? ` · ${pipeline.exerciseYear}` : ""}`} actions={<ExportBtn name="pipeline-source-partenaire" cols={[
          { header: "Constructeur", render: (r: NonNullable<NonNullable<PipelineSummary>["partners"]>[number]) => r.name },
          { header: "Ouvert (FCFA)", render: (r: NonNullable<NonNullable<PipelineSummary>["partners"]>[number]) => String(r.openXof) },
          { header: "Pondéré (FCFA)", render: (r: NonNullable<NonNullable<PipelineSummary>["partners"]>[number]) => String(r.openWeightedXof) },
          { header: "Gagné (FCFA)", render: (r: NonNullable<NonNullable<PipelineSummary>["partners"]>[number]) => String(r.wonXof) },
          { header: "Opps ouvertes", render: (r: NonNullable<NonNullable<PipelineSummary>["partners"]>[number]) => String(r.openCount) },
        ]} rows={pipeline!.partners!} />}>
          <Tip>Les opportunités <b>taguées d'un constructeur</b> (champ « Constructeur (partenariat) » du formulaire Pipeline) : pipeline <b>ouvert</b>, son <b>pondéré</b> de projection (mêmes paliers que la prévision) et le <b>gagné</b> de l'exercice — à comparer à l'objectif pipeline du plan d'affaires, qui reste déclaratif.</Tip>
          <Table
            columns={[
              colText("Constructeur", (r) => r.name, (r) => r.name),
              colNum("Ouvert", (r) => money(r.openXof), (r) => r.openXof),
              colNum("Pondéré", (r) => money(r.openWeightedXof), (r) => r.openWeightedXof),
              colNum("Gagné", (r) => r.wonXof ? money(r.wonXof) : <span className="text-faint">—</span>, (r) => r.wonXof),
              colNum("Opps", (r) => `${r.openCount}${r.wonCount ? ` + ${r.wonCount} gagnée(s)` : ""}`, (r) => r.openCount + r.wonCount),
              colNum("vs objectif pipeline (BP)", (r) => {
                const bp = Number(partners.find((p) => p.id === r.partnerId)?.businessPlan?.pipelineBp) || 0;
                return bp > 0 ? <MiniBar ratio={(r.openXof + r.wonXof) / bp} /> : <span className="text-faint">—</span>;
              }, (r) => { const bp = Number(partners.find((p) => p.id === r.partnerId)?.businessPlan?.pipelineBp) || 0; return bp > 0 ? (r.openXof + r.wonXof) / bp : -1; }),
            ]}
            rows={pipeline!.partners!} rowKey={(r) => r.partnerId} empty="Aucune opportunité taguée d'un constructeur."
          />
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px]">
            <Dot color={T.gold} label={<>Ouvert <b className="tabnum">{money(pipeline?.totalOpenXof || 0)}</b></>} />
            <Dot color={T.emerald} label={<>Gagné <b className="tabnum">{money(pipeline?.totalWonXof || 0)}</b></>} />
          </div>
        </Card>
      )}

      <Card title="Conformité des quotas de certification" actions={<ExportBtn name="conformite-quotas" cols={[
        { header: "Constructeur", render: (r: QuotaRow) => r.name },
        { header: "Statut", render: (r: QuotaRow) => label(PARTNERSHIP_STATUS_LABEL, r.status) },
        { header: "Niveau tenu", render: (r: QuotaRow) => tp(r).achieved?.name || "" },
        { header: "Prochain niveau", render: (r: QuotaRow) => tp(r).next?.name || "" },
        { header: "Écart au prochain", render: (r: QuotaRow) => tp(r).gaps.map((g) => `${g.target} (${g.holders}/${g.minCount})`).join(" | ") },
        { header: "Exigences couvertes", render: (r: QuotaRow) => `${(r.coverage || []).filter((c) => c.ok).length}/${(r.coverage || []).length}` },
      ]} rows={quotaPartners} />}>
        <Tip>Le <b>niveau tenu</b> est le plus haut palier dont toutes les exigences (et celles d'en dessous) sont couvertes ; le <b>prochain niveau</b> et son <b>écart</b> disent ce qu'il manque pour monter d'un cran. Dérivé de la couverture des quotas ci-après (mêmes chiffres).</Tip>
        <Table
          columns={[
            colText("Constructeur", (r) => r.name),
            colText("Statut", (r) => <Badge tone={partnershipTone(r.status)}>{label(PARTNERSHIP_STATUS_LABEL, r.status)}</Badge>),
            colText("Niveau tenu", (r) => tp(r).achieved?.name || "—"),
            // Statut DÉCLARÉ vs niveau CALCULÉ (PAR-P4) : badge quand la fiche revendique un niveau que la
            // couverture des quotas ne soutient pas (ou l'inverse) — signal de mise à jour de fiche ou de
            // risque à l'audit constructeur. Simple signal, pas une erreur (les libellés peuvent différer).
            colText("Déclaré", (r: QuotaRow) => {
              const d = declaredById.get(r.partnerId) || "";
              if (!d) return <span className="text-faint">—</span>;
              const a = tp(r).achieved?.name || "";
              return normLvl(d) === normLvl(a)
                ? <span>{d}</span>
                : <span className="inline-flex items-center gap-1.5" title={`Statut déclaré « ${d} » ≠ niveau calculé « ${a || "aucun"} » (couverture des quotas)`}>{d}<Badge tone="gold">≠ calculé</Badge></span>;
            }, (r: QuotaRow) => declaredById.get(r.partnerId) || ""),
            colText("Prochain niveau", (r) => { const p = tp(r); return p.next ? <span>{p.next.name}{p.gaps.length ? <span className="text-faint"> · {p.gaps.map((g) => `${g.target} ${g.holders}/${g.minCount}`).join(", ")}</span> : null}</span> : <span className="text-emerald">Palier max tenu</span>; }),
            colText("Exigences couvertes", (r: QuotaRow) => { const tot = (r.coverage || []).length; const ok = (r.coverage || []).filter((c) => c.ok).length; return <MiniBar ratio={tot ? ok / tot : null} label={`${ok}/${tot}`} />; }),
            colText("Écarts", (r: QuotaRow) => (r.gaps || []).length ? r.gaps.map((g) => `${g.target} (${g.holders}/${g.minCount})`).join(", ") : "—"),
            ...(canWrite ? [editCol((r) => r.partnerId)] : []),
          ]}
          rows={quotaPartners} rowKey={(r) => r.partnerId} empty="Aucun quota évalué — ajoutez des exigences au référentiel et des certifications."
        />
      </Card>

      {/* Comparatif inter-constructeurs (PAR-P4) : mise côte à côte des états DÉJÀ calculés — quel
          partenariat rapporte (CA), lequel coûte (conformité, renouvellements). Aucune re-dérivation. */}
      {compareRows.length >= 2 && (
        <Card title="Comparatif inter-constructeurs" actions={<ExportBtn name="comparatif-constructeurs" cols={[
          { header: "Constructeur", render: (r: typeof compareRows[number]) => r.name },
          ...(canSeeCa ? [{ header: "CA (FCFA)", render: (r: typeof compareRows[number]) => String(r.caXof) }] : []),
          { header: "Conformité", render: (r: typeof compareRows[number]) => label(PARTNERSHIP_STATUS_LABEL, r.quotaStatus) },
          { header: "Niveau tenu", render: (r: typeof compareRows[number]) => r.achieved || "" },
          { header: "Certifs valides", render: (r: typeof compareRows[number]) => `${r.certOk}/${r.certTot}` },
          { header: "À renouveler ≤ 90 j", render: (r: typeof compareRows[number]) => String(r.renouv) },
        ]} rows={compareRows} />}>
          <Tip>Les constructeurs côte à côte : le <b>CA</b> qu'ils génèrent{canSeeCa ? "" : " (masqué sans droit rentabilité)"}, la <b>conformité</b> des quotas, le <b>niveau tenu</b> et la pression de <b>renouvellement</b>. Mêmes chiffres que les cartes ci-dessus — juste alignés pour arbitrer où investir.</Tip>
          <Table
            columns={[
              colText("Constructeur", (r) => r.name, (r) => r.name),
              ...(canSeeCa ? [colNum("CA (FCFA)", (r: typeof compareRows[number]) => r.caXof ? <span className="inline-flex items-center gap-1.5">{money(r.caXof)}{r.caSource === "declare" && <Badge tone="gold">Déclaré</Badge>}</span> : <span className="text-faint">—</span>, (r: typeof compareRows[number]) => r.caXof)] : []),
              colText("Conformité", (r) => <Badge tone={partnershipTone(r.quotaStatus)}>{label(PARTNERSHIP_STATUS_LABEL, r.quotaStatus)}</Badge>, (r) => r.quotaStatus),
              colText("Niveau tenu", (r) => r.achieved || "—", (r) => r.achieved || ""),
              colNum("Certifs valides", (r) => r.certTot ? <MiniBar ratio={r.certOk / r.certTot} label={`${r.certOk}/${r.certTot}`} /> : <span className="text-faint">—</span>, (r) => r.certTot ? r.certOk / r.certTot : -1),
              colNum("À renouveler", (r) => r.renouv ? <span className="text-gold tabnum">{r.renouv}</span> : "0", (r) => r.renouv),
            ]}
            rows={compareRows} rowKey={(r) => r.partnerId} empty="Au moins deux partenaires requis."
          />
        </Card>
      )}

      {/* Renouvellement du PARTENARIAT lui-même (PAR-P4) : renewalDate du référentiel, fenêtres J-90/60/30
          matérialisées au recompute (partnerRenewalWatch) — le contrat programme se renégocie en amont. */}
      {!!partnerRenewals.length && (
        <Card title="Renouvellements de partenariats (≤ 90 j)">
          <Tip>Échéances de <b>contrat programme</b> constructeur à préparer : renégociation du niveau, quotas et plan d'affaires. Dérivé de la date d'échéance saisie sur chaque fiche partenaire.</Tip>
          <Table
            columns={[
              colText("Constructeur", (r) => r.name, (r) => r.name),
              colText("Échéance", (r) => frDate(r.renewalDate), (r) => r.renewalDate),
              colNum("Jours restants", (r) => r.daysLeft <= 0 ? <span className="text-clay tabnum">échue</span> : <span className="tabnum">{r.daysLeft}</span>, (r) => r.daysLeft),
              colText("Urgence", (r) => <Badge tone={alertBucketTone(r.bucket)}>{r.bucket === "expired" ? "Échue" : label(ALERT_BUCKET_LABEL, r.bucket)}</Badge>, (r) => r.bucket),
              ...(canWrite ? [editCol((r) => r.partnerId)] : []),
            ]}
            rows={partnerRenewals} rowKey={(r) => r.id} pageSize={10} empty="Aucun partenariat à échéance sous 90 jours."
          />
        </Card>
      )}

      {!!trainRows.length && (
        <Card title="Plan de formation — combler les quotas">
          <Tip>Pour chaque partenariat <b>non conforme</b>, les ingénieurs à <b>assigner</b> pour atteindre le niveau : des candidats déjà engagés chez le constructeur qui ne détiennent pas encore la cible. « Assigner » crée les assignations (échéance à 90 j, éditable dans l'onglet Assignations).</Tip>
          <div className="space-y-3">
            {trainRows.map((p) => (
              <div key={p.partnerId} className="rounded-lg border border-line p-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <button className="font-medium hover:underline" onClick={() => onEditPartner(p.partnerId)}>{p.name}</button>
                  <Badge tone={partnershipTone(p.status)}>{label(PARTNERSHIP_STATUS_LABEL, p.status)}</Badge>
                </div>
                {p.gaps.map((g, i) => (
                  <div key={i} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px]">
                    <span className="text-clay tabnum font-medium">Manque {g.need}</span>
                    <span className="text-muted">· {g.targetLabel} ({g.holders}/{g.minCount})</span>
                    {g.candidates.length
                      ? <span className="text-faint">— {g.candidates.slice(0, 5).map((c) => c.name).join(", ")}{g.candidates.length > 5 ? "…" : ""}</span>
                      : <span className="text-faint">— aucun candidat engagé (former un nouvel ingénieur)</span>}
                    {canWrite && g.assignCertId && g.candidates.length > 0 && (
                      <Busy variant="ghost" label={`Assigner ${Math.min(g.need, g.candidates.length)}`}
                        fn={async () => { const picks = g.candidates.slice(0, g.need); const t = td90(); await Promise.all(picks.map((c) => callFn("upsertParAssignment", { consultantId: c.consultantId, partnerId: p.partnerId, certificationCatalogId: g.assignCertId, targetDate: t }))); }}
                        okMsg={`${Math.min(g.need, g.candidates.length)} assignation(s) créée(s) — échéance à 90 j`} />
                    )}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </Card>
      )}

      {trend.length >= 2 && (
        <Card title="Tendance de conformité des partenariats (30 j)">
          <Tip>Évolution quotidienne du nombre de partenariats conformes, à risque et non conformes (historisé à chaque recalcul).</Tip>
          <MultiLine
            data={trend}
            money={false}
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
          colText("Ingénieur", (r) => r.consultantName || r.consultantId, (r) => r.consultantName || r.consultantId),
          colText("BU", (r) => r.consultantBu || "—", (r) => r.consultantBu || ""),
          colText("Constructeur", (r) => partnerName[r.partnerId] || r.partnerId, (r) => partnerName[r.partnerId] || r.partnerId),
          colText("Certification", (r) => r.certName || r.certificationCatalogId, (r) => r.certName || r.certificationCatalogId),
          colText("Obtenue", (r) => frDate(r.obtainedDate), (r) => r.obtainedDate || ""),
          colText("Expire", (r) => r.expiryDate ? frDate(r.expiryDate) : "—", (r) => r.expiryDate || ""),
          colText("Statut", (r) => <Badge tone={certStatusTone(r.status)}>{label(CERT_STATUS_LABEL, r.status)}</Badge>, (r) => r.status),
          // Actions par ligne (écriture seulement) : réviser la date d'obtention ou retirer la certif.
          ...(canWrite ? [colText("", (r) => (
            <span className="inline-flex items-center gap-2">
              <button className="btn-ghost text-[11px]" onClick={() => setEdit(r)}>Éditer</button>
              <DangerBtn label="Suppr." confirm={`Supprimer la certification « ${r.certName || r.certificationCatalogId} » de ${r.consultantName || r.consultantId} ?`} fn={() => callFn("deleteParCertification", { id: r.id })} okMsg="Certification supprimée" />
            </span>
          ))] : []),
        ]}
        rows={certifs} rowKey={(r) => r.id} pageSize={12} searchKeys={[(r) => r.consultantName, (r) => r.certName, (r) => r.partnerId]}
        bulk={canWrite ? [
          // Échec partiel honnête (allSettled) : un item en échec ne doit pas masquer les autres déjà passés.
          { label: "Supprimer", tone: "danger", confirm: "Supprimer les certifications sélectionnées ?",
            run: async (rows) => { const res = await Promise.allSettled(rows.map((r) => callFn("deleteParCertification", { id: r.id }))); const ok = res.filter((x) => x.status === "fulfilled").length; const fail = res.length - ok; if (fail) throw new Error(`${ok} supprimée(s), ${fail} en échec`); return ok; },
            okMsg: (rows) => `${rows.length} certification(s) supprimée(s)` },
        ] : undefined}
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
          colText("Ingénieur", (r) => r.consultantName || r.consultantId, (r) => r.consultantName || r.consultantId),
          colText("Constructeur", (r) => partnerName[r.partnerId] || r.partnerId, (r) => partnerName[r.partnerId] || r.partnerId),
          colText("Certif visée", (r) => r.cert || r.certificationCatalogId, (r) => r.cert || r.certificationCatalogId),
          colText("Échéance", (r) => frDate(r.targetDate), (r) => r.targetDate || ""),
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
        rows={assigns} rowKey={(r) => r.id} pageSize={12} searchKeys={[(r) => r.consultantName, (r) => r.cert, (r) => r.partnerId]}
        bulk={canWrite ? [
          // Échec partiel honnête (allSettled) : id périmé, rate-limit ClickUp (30/60s) → on rapporte ok/échec
          // au lieu de masquer les écritures déjà passées sous un rejet global (Promise.all).
          { label: "Changer le statut", pick: { options: MANUAL_ASSIGN_STATUSES.map((s) => ({ value: s, label: label(ASSIGNMENT_STATUS_LABEL, s) })), placeholder: "Statut cible" },
            run: async (rows, picked) => { if (!picked) throw new Error("Choisissez un statut cible"); const res = await Promise.allSettled(rows.map((r) => callFn("setParAssignmentStatus", { id: r.id, status: picked }))); const ok = res.filter((x) => x.status === "fulfilled").length; const fail = res.length - ok; if (fail) throw new Error(`${ok} mis à jour, ${fail} en échec`); return ok; }, okMsg: (rows) => `${rows.length} statut(s) mis à jour` },
          { label: "Pousser vers ClickUp",
            run: async (rows) => { const res = await Promise.allSettled(rows.map((r) => callFn("pushParAssignmentToClickup", { id: r.id }))); const ok = res.filter((x) => x.status === "fulfilled").length; const fail = res.length - ok; if (fail) throw new Error(`${ok} synchronisée(s), ${fail} en échec (rate-limit ClickUp ou erreur)`); return ok; }, okMsg: (rows) => `${rows.length} tâche(s) synchronisée(s)` },
          { label: "Supprimer", tone: "danger", confirm: "Supprimer les assignations sélectionnées ?",
            run: async (rows) => { const res = await Promise.allSettled(rows.map((r) => callFn("deleteParAssignment", { id: r.id }))); const ok = res.filter((x) => x.status === "fulfilled").length; const fail = res.length - ok; if (fail) throw new Error(`${ok} supprimée(s), ${fail} en échec`); return ok; }, okMsg: (rows) => `${rows.length} assignation(s) supprimée(s)` },
        ] : undefined}
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
const ConfigTab: FC<{ partners: Partner[]; certifs: Certif[]; assigns: Assign[]; partnerOpts: { value: string; label: string }[]; mapDoc: { map?: Record<string, string | Record<string, number>> } | null; ca: CaSummary; canWrite: boolean; openEditId?: string | null; onConsumedEdit?: () => void }> = ({ partners, certifs, assigns, partnerOpts, mapDoc, ca, canWrite, openEditId, onConsumedEdit }) => {
  // Un fournisseur (distributeur) peut porter PLUSIEURS constructeurs (ADR-P14) : chaque ligne a une liste
  // d'allocations { constructeur, poids }. Poids par défaut = 1 (répartition égale à la sauvegarde).
  const [rows, setRows] = useState<{ supplier: string; allocs: { partnerId: string; weight: string }[] }[]>([]);
  const toast = useToast();
  const [suggBusy, setSuggBusy] = useState(false);
  const [askImport, importConfirmNode] = useConfirm();
  const [impBusy, setImpBusy] = useState(false);
  // Import des certifs en DEUX temps (audit adverse #2) : un dry-run montre QUI serait créé dans l'annuaire ESN
  // partagé (consultants « actifs », comptés dans les KPI d'activité) ; l'utilisateur confirme avant l'écriture.
  const runCertImport = async () => {
    if (impBusy) return; setImpBusy(true);
    try {
      const prev = await callFn<{ wouldCreateCount?: number; wouldCreateConsultants?: string[]; certsPlanned?: number; assignsPlanned?: number }>("importParCertifications", { dryRun: true }, 300_000);
      const n = prev?.wouldCreateCount || 0;
      if (n > 0) {
        const names = (prev.wouldCreateConsultants || []).slice(0, 20).join(", ");
        const ok = await askImport(
          <div className="space-y-1 text-[13px]"><div>Cet import créera <b>{n}</b> consultant(s) absent(s) de l'annuaire ESN, en statut <b>actif</b> — ils entreront dans les indicateurs d'activité (TACE, occupation).</div><div className="text-muted">{names}{n > 20 ? " …" : ""}</div></div>,
          { title: "Création de consultants", confirmLabel: `Créer et importer`, tone: "gold" },
        );
        if (!ok) { toast("Import annulé", "info"); return; }
      }
      const r = await callFn<{ certsWritten?: number; assignsWritten?: number; createdConsultants?: number; catalogAdded?: number; skipped?: number }>("importParCertifications", {}, 300_000);
      toast(`${r?.certsWritten || 0} certifs + ${r?.assignsWritten || 0} assignations · ${r?.createdConsultants || 0} consultant(s) créé(s) · ${r?.catalogAdded || 0} entrée(s) catalogue${r?.skipped ? ` · ${r.skipped} écartée(s)` : ""}`, "ok");
    } catch (e: any) { toast(`Échec — ${String(e?.message || e?.code || "").replace(/^functions\//, "") || "import refusé"}`, "err"); }
    finally { setImpBusy(false); }
  };
  // undefined = formulaire fermé ; null = nouveau partenaire ; Partner = édition d'un existant.
  const [edit, setEdit] = useState<Partner | null | undefined>(undefined);
  // Édition demandée depuis une vue read-only (Plan d'affaires / Conformité) : ouvre le formulaire pour ce
  // partenaire une fois l'onglet monté, puis acquitte (évite une réouverture en boucle).
  useEffect(() => {
    if (!openEditId) return;
    const p = partners.find((x) => x.id === openEditId);
    if (p) setEdit(p);
    onConsumedEdit?.();
  }, [openEditId, partners, onConsumedEdit]);
  // Garde d'intégrité (PA3) : compter les certifs/assignations rattachées à un partenaire avant suppression.
  // deleteParPartner ne cascade PAS — supprimer un partenaire pointé laisserait des orphelins : on prévient.
  const links = useMemo(() => {
    const m = new Map<string, { certs: number; assigns: number }>();
    const bump = (id: string, k: "certs" | "assigns") => { const e = m.get(id) || { certs: 0, assigns: 0 }; e[k]++; m.set(id, e); };
    for (const c of certifs) if (c.partnerId) bump(c.partnerId, "certs");
    for (const a of assigns) if (a.partnerId) bump(a.partnerId, "assigns");
    return m;
  }, [certifs, assigns]);
  const delConfirm = (p: Partner) => {
    const l = links.get(p.id);
    const rattache = l ? [l.certs ? `${l.certs} certification(s)` : "", l.assigns ? `${l.assigns} assignation(s)` : ""].filter(Boolean).join(" et ") : "";
    return `Supprimer le partenaire « ${p.name} » et tout son référentiel (niveaux, compétences, catalogue, exigences, plan d'affaires) ?`
      + (rattache ? ` ⚠️ ${rattache} lui reste(nt) rattachée(s) — elles deviendront orphelines (à supprimer séparément dans les onglets Certifications / Assignations).` : "");
  };
  // Reconstruit les lignes depuis l'overlay : valeur string = 1 constructeur (poids 1) ; objet = répartition.
  useEffect(() => {
    setRows(Object.entries(mapDoc?.map || {}).map(([supplier, val]) => ({
      supplier,
      allocs: typeof val === "string"
        ? [{ partnerId: val, weight: "1" }]
        : Object.entries(val || {}).map(([partnerId, w]) => ({ partnerId, weight: String(w) })),
    })));
  }, [mapDoc]);
  const unmapped = ca?.unmapped || [];
  const save = async () => {
    // Garde anti-perte silencieuse : deux lignes du MÊME fournisseur (après normalisation) verraient la seconde
    // écraser la première dans la table → allocations perdues sans avertissement. On bloque et on nomme le doublon.
    const seen = new Set<string>();
    for (const r of rows) {
      const sup = r.supplier.replace(/\s+/g, " ").trim().toUpperCase(); if (!sup) continue;
      if (seen.has(sup)) throw new Error(`Fournisseur en double : « ${r.supplier.trim()} » — fusionnez les deux lignes avant d'enregistrer`);
      seen.add(sup);
    }
    // 1 constructeur → forme simple (string) ; plusieurs → { partnerId: poids }. Le backend renormalise.
    const map: Record<string, string | Record<string, number>> = {};
    for (const r of rows) {
      const sup = r.supplier.replace(/\s+/g, " ").trim().toUpperCase(); if (!sup) continue;
      const valid = r.allocs.filter((a) => a.partnerId && (Number(a.weight) || 0) > 0);
      if (valid.length === 1) map[sup] = valid[0].partnerId;
      else if (valid.length > 1) { const o: Record<string, number> = {}; for (const a of valid) o[a.partnerId] = Number(a.weight); map[sup] = o; }
    }
    await callFn("setParPartnerMap", { map });
  };
  // Mutations d'allocation (ajout/retrait/édition d'un constructeur d'un fournisseur).
  const setAlloc = (i: number, fn: (a: { partnerId: string; weight: string }[]) => { partnerId: string; weight: string }[]) =>
    setRows((rs) => rs.map((x, j) => j === i ? { ...x, allocs: fn(x.allocs) } : x));
  // Suggestion IA (ADR-P15) : l'IA propose un rattachement fournisseur → constructeur(s) à partir des noms.
  // On PRÉ-REMPLIT seulement les lignes encore VIDES (allocs sans constructeur) et on AJOUTE les fournisseurs
  // manquants — jamais d'écrasement d'un choix humain. Rien n'est enregistré : l'utilisateur valide puis Enregistre.
  const suggest = async () => {
    if (suggBusy) return; setSuggBusy(true);
    try {
      const r = await callFn<{ suggestions: { supplier: string; allocations: { partnerId: string; weight: number }[] }[] }>("suggestParPartnerMap", {}, 300_000);
      const sugg = r.suggestions || [];
      if (!sugg.length) { toast("Aucun rattachement proposé — vérifiez à la main", "info"); return; }
      const byUpper = new Map(sugg.map((s) => [s.supplier.trim().toUpperCase(), s]));
      let filled = 0;
      setRows((rs) => {
        const next = rs.map((row) => {
          const s = byUpper.get(row.supplier.trim().toUpperCase());
          const empty = !row.allocs.some((a) => a.partnerId); // ne touche pas un choix déjà posé
          if (s && empty) { filled++; return { ...row, allocs: s.allocations.map((a) => ({ partnerId: a.partnerId, weight: String(a.weight) })) }; }
          return row;
        });
        // Fournisseurs proposés sans ligne existante → ajoutés (l'IA les a vus dans les BC non rattachés).
        const known = new Set(next.map((x) => x.supplier.trim().toUpperCase()));
        for (const s of sugg) { const k = s.supplier.trim().toUpperCase(); if (!known.has(k)) { filled++; next.push({ supplier: s.supplier, allocs: s.allocations.map((a) => ({ partnerId: a.partnerId, weight: String(a.weight) })) }); } }
        return next;
      });
      toast(filled ? `${filled} rattachement(s) proposé(s) — vérifiez puis Enregistrer` : "Propositions déjà présentes (rien à pré-remplir)", "ok");
    } catch (e: any) { toast(`Échec — ${String(e?.message || e?.code || "").replace(/^functions\//, "") || "action refusée"}`, "err"); }
    finally { setSuggBusy(false); }
  };
  return (
    <div className="space-y-4">
      <Card title="Correspondance fournisseur → constructeur" actions={canWrite ? <div className="flex items-center gap-2">
        {!!unmapped.length && <button className="btn-ghost text-[12px]" disabled={suggBusy} onClick={suggest} title="L'IA propose un rattachement fournisseur → constructeur ; vous validez avant d'enregistrer"><Sparkles size={13} /> {suggBusy ? "Analyse…" : "Suggérer (IA)"}</button>}
        <Busy label="Enregistrer" fn={save} okMsg="Correspondance enregistrée" />
      </div> : undefined}>
        <Tip>Le CA par constructeur est dérivé des BC fournisseurs. Un <b>fournisseur</b> (souvent un distributeur) peut porter <b>plusieurs constructeurs</b> : ajoutez-en autant que nécessaire avec un <b>poids</b> — le montant du BC est <b>réparti</b> selon ces poids (jamais additionné). Non renseigné ⇒ le BC n'est pas compté. Un seul constructeur = 100 %.</Tip>
        <div className="space-y-2">
          {rows.map((r, i) => {
            const wsum = r.allocs.reduce((s, a) => s + (Number(a.weight) || 0), 0) || 1;
            return (
            <div key={i} className="rounded-lg border border-line p-2 space-y-2">
              <div className="flex items-center gap-2">
                <input className="field flex-1" value={r.supplier} disabled={!canWrite} placeholder="Nom fournisseur (BC)" onChange={(e) => setRows((rs) => rs.map((x, j) => j === i ? { ...x, supplier: e.target.value } : x))} />
                {canWrite && <button className="btn-ghost text-clay text-[11px]" onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}>Retirer</button>}
              </div>
              {r.allocs.map((a, k) => (
                <div key={k} className="flex items-center gap-2 pl-3">
                  <span className="text-faint">↳</span>
                  <div className="flex-1"><Select value={a.partnerId} onChange={(v) => setAlloc(i, (al) => al.map((x, m) => m === k ? { ...x, partnerId: v } : x))} options={partnerOpts} placeholder="Constructeur…" /></div>
                  {r.allocs.length > 1 && <>
                    <input className="field tabnum w-20" type="number" min="0" value={a.weight} disabled={!canWrite} aria-label="Poids" placeholder="Poids" onChange={(e) => setAlloc(i, (al) => al.map((x, m) => m === k ? { ...x, weight: e.target.value } : x))} />
                    <span className="text-faint text-[11px] w-12 text-right tabnum">{pct((Number(a.weight) || 0) / wsum)}</span>
                  </>}
                  {canWrite && r.allocs.length > 1 && <button className="btn-ghost text-clay text-[11px]" onClick={() => setAlloc(i, (al) => al.filter((_, m) => m !== k))}>×</button>}
                </div>
              ))}
              {canWrite && <button className="btn-ghost text-[11px] pl-3" onClick={() => setAlloc(i, (al) => [...al, { partnerId: "", weight: "1" }])}><Plus size={12} /> Ajouter un constructeur</button>}
            </div>
          ); })}
          {canWrite && <button className="btn-ghost text-[12px]" onClick={() => setRows((rs) => [...rs, { supplier: "", allocs: [{ partnerId: "", weight: "1" }] }])}><Plus size={13} /> Ajouter un fournisseur</button>}
          {!rows.length && !canWrite && <EmptyState label="Aucun mapping fournisseur défini." />}
        </div>
        {!!unmapped.length && (
          <div className="mt-3">
            <div className="text-[12px] text-muted mb-1">Fournisseurs BC non encore rattachés (à mapper) :</div>
            <div className="flex flex-wrap gap-1">
              {unmapped.slice(0, 12).map((u) => (
                <button key={u.supplier} className="text-[11px] px-2 py-0.5 rounded-md bg-panel2 text-muted hover:text-ink" disabled={!canWrite}
                  onClick={() => setRows((rs) => rs.some((x) => x.supplier.toUpperCase() === u.supplier) ? rs : [...rs, { supplier: u.supplier, allocs: [{ partnerId: "", weight: "1" }] }])}>
                  {u.supplier} ({fmt(u.revenueXof)})
                </button>
              ))}
            </div>
          </div>
        )}
      </Card>

      <Card title="Référentiel des partenaires" actions={<div className="flex items-center gap-2">
        <ExportBtn name="referentiel-partenaires" cols={[
          { header: "Constructeur", render: (r: Partner) => r.name },
          { header: "Programme", render: (r: Partner) => r.programName || "" },
          { header: "Statut", render: (r: Partner) => r.status || "" },
          { header: "Échéance", render: (r: Partner) => r.renewalDate ? frDate(r.renewalDate) : "" },
          { header: "Validation", render: (r: Partner) => label(VALIDATION_STATUS_LABEL, r.validationStatus) },
          { header: "Niveaux", render: (r: Partner) => String((r.tiers || []).length) },
          { header: "Certifs catalogue", render: (r: Partner) => String((r.certificationCatalog || []).length) },
          { header: "Exigences", render: (r: Partner) => String((r.requirements || []).length) },
        ]} rows={partners} />
        {/* Amorçage en MASSE : enregistre les 20 partenaires de référence (données réelles NT — statut, plan
            d'affaires, échéances, catalogue de certifs, exigences de quota) via le callable existant. Réservé
            au référentiel VIDE : les modèles sont des points de départ, ce bouton les matérialise en une fois
            (sinon le module reste à zéro tant qu'on n'a pas créé chaque partenaire un par un). Idempotent
            (upsertParPartner clé par slug) mais masqué dès qu'un partenaire existe, pour éviter tout écrasement. */}
        {canWrite && !partners.length && (
          <Busy label="Importer les 20 partenaires de référence" okMsg="Partenaires de référence importés — le tableau de bord se remplit"
            fn={async () => {
              const errs: string[] = [];
              for (const p of PARTNER_PRESETS) {
                const built = buildPartnerPayload(buildPartnerPreset(p.id, nk));
                if (!built.ok) { errs.push(`${p.label}: ${built.error}`); continue; }
                await callFn("upsertParPartner", built.value);
              }
              if (errs.length) throw new Error(`Échecs (${errs.length}/${PARTNER_PRESETS.length}) : ${errs.slice(0, 3).join(" ; ")}`);
              // Rafraîchissement immédiat : les upsert déclenchent un recompute DIFFÉRÉ (non traité en prod),
              // on force donc un recompute synchrone scopé (comme « Recalculer »). Best-effort : réservé
              // direction ; si l'appelant n'y a pas droit, l'amorçage reste bon, le tableau se remplira au
              // prochain recompute nocturne/manuel.
              try { await callFn("recompute", { only: ["partenariats"] }, 300_000); } catch { /* droit direction requis — non bloquant */ }
            }} />
        )}
        {/* Amorçage des CERTIFICATIONS par ingénieur (2ᵉ fichier direction). Le callable résout les noms contre
            l'annuaire ESN, crée les consultants nommés manquants, complète le catalogue, écrit certifs détenues
            + assignations, et renvoie un rapport. Réservé au référentiel PEUPLÉ (les partenaires doivent exister). */}
        {canWrite && !!partners.length && (
          <button className="btn-ghost text-[12px]" disabled={impBusy} onClick={runCertImport}>{impBusy ? "Import…" : "Importer les certifications de référence"}</button>
        )}
        {canWrite && <button className="btn" onClick={() => setEdit(null)}><Plus size={14} /> Nouveau partenaire</button>}
      </div>}>
        <Tip>Un <b>partenaire</b> = un constructeur (Dell, Cisco, Fortinet…) avec ses <b>niveaux</b>, ses <b>compétences</b>, son <b>catalogue de certifications</b> et ses <b>exigences de quota</b> (les objectifs : par niveau, combien d'ingénieurs certifiés sur quelle cible). Ces exigences alimentent la conformité des quotas et les partenariats à risque du tableau de bord.</Tip>
        <Table
          columns={[
            colText("Constructeur", (r) => r.name),
            colText("Programme", (r) => r.programName || "—"),
            colNum("Niveaux", (r) => String((r.tiers || []).length)),
            colNum("Certifs au catalogue", (r) => String((r.certificationCatalog || []).length)),
            colNum("Exigences", (r) => String((r.requirements || []).length)),
            colText("Exercice", (r) => fiscalMonthsLabel(r.fiscalStartMonth) || "Calendaire"),
            colNum("Rattachés", (r) => { const l = links.get(r.id); return l ? String(l.certs + l.assigns) : "—"; }, (r) => { const l = links.get(r.id); return l ? l.certs + l.assigns : 0; }),
            ...(canWrite ? [colText("", (r) => (
              <span className="inline-flex items-center gap-2">
                <button className="btn-ghost text-[11px]" onClick={() => setEdit(r)}>Éditer</button>
                <DangerBtn label="Suppr." confirm={delConfirm(r)} fn={() => callFn("deleteParPartner", { id: r.id })} okMsg="Partenaire supprimé" />
              </span>
            ))] : []),
          ]}
          rows={partners} rowKey={(r) => r.id} pageSize={12} searchKeys={[(r) => r.name, (r) => r.programName]}
          bulk={canWrite ? [
            // Suppression en masse : la garde d'intégrité serveur (PA3) bloque un partenaire encore rattaché
            // à des certifs/assignations. On tolère l'échec partiel (allSettled) et on le rapporte honnêtement.
            { label: "Supprimer", tone: "danger", confirm: "Supprimer les partenaires sélectionnés ? Ceux encore rattachés à des certifications/assignations seront refusés.",
              run: async (rows) => { const res = await Promise.allSettled(rows.map((r) => callFn("deleteParPartner", { id: r.id }))); const ok = res.filter((x) => x.status === "fulfilled").length; const fail = res.length - ok; if (fail) throw new Error(`${ok} supprimé(s), ${fail} refusé(s) (rattachés à des certifs/assignations)`); return ok; },
              okMsg: (rows) => `${rows.length} partenaire(s) supprimé(s)` },
          ] : undefined}
          empty="Aucun partenaire — créez le premier constructeur avec « Nouveau partenaire »."
        />
      </Card>
      {edit !== undefined && <PartnerForm initial={edit} onClose={() => setEdit(undefined)} />}
      {importConfirmNode}
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
    : { name: "", programName: "", status: "", renewalDate: "", validationStatus: "", bp: { ...EMPTY_BP }, caDeclaredXof: "", fiscalStartMonth: "", tiers: [], comps: [], certs: [], reqs: [] });
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
        <FormSection title="Identité" hint="Le constructeur et son programme partenaire.">
          <div className="grid sm:grid-cols-2 gap-3">
            <Field label="Constructeur (nom)"><input className="field" value={f.name} placeholder="Ex. Fortinet" onChange={(e) => set({ name: e.target.value })} /></Field>
            <Field label="Programme"><input className="field" value={f.programName} placeholder="Ex. Engage (optionnel)" onChange={(e) => set({ programName: e.target.value })} /></Field>
          </div>
        </FormSection>

        {/* Statut courant + plan d'affaires (objectif BP vs réalisé YTD par axe) — miroir du tableau de bord
            direction Partners_Status_Tracking. Montants en FCFA entiers via le champ numérique (pas de décimale). */}
        <FormSection title="Statut & plan d'affaires" hint="Miroir du tableau de pilotage direction. Objectif (BP) vs réalisé (YTD) — le % d'atteinte apparaît au tableau de bord.">
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
          <p className="text-[11px] text-faint">Pipeline &amp; Booking en FCFA ; Certifications en nombre ; Croissance en %.</p>
        </FormSection>

        {/* CA réalisé déclaratif (mixé au CA dérivé des BC — ADR-P12) + exercice fiscal du partenaire. */}
        <FormSection title="Chiffre d'affaires & exercice fiscal" hint="Le CA déclaré comble le CA dérivé des BC tant qu'aucun BC n'est rattaché (repli = booking YTD). L'exercice borne le réalisé.">
          <div className="grid sm:grid-cols-2 gap-3">
            <Field label="CA réalisé déclaré (FCFA)"><input className="field tabnum" type="number" value={f.caDeclaredXof} placeholder="Repli = booking YTD" onChange={(e) => set({ caDeclaredXof: e.target.value })} /></Field>
            <Field label="Début d'exercice fiscal"><Select value={f.fiscalStartMonth} onChange={(v) => set({ fiscalStartMonth: v })} options={FR_MONTHS.map((m, i) => ({ value: i === 0 ? "" : String(i), label: i === 0 ? "Calendaire (janvier)" : m }))} placeholder="Calendaire (janvier)" /></Field>
          </div>
        </FormSection>

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
