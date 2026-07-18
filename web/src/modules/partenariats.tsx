// Module « Partenariats & Certifications » (par_). Derrière le drapeau config/parFeature (App masque
// l'onglet si éteint) et gouverné par le droit `partenariats`. Réutilise les primitives design, les
// écritures callable et les formats de l'ERP (FCFA entier via money, date JJ/MM/AAAA via frDate). Le CA
// est DÉRIVÉ des BC fournisseurs (summaries/par_ca) — aucune saisie. Aucune valeur en dur (tons/libellés
// via lib/parLabels). Composant LAZY → callables inline (hors chunk d'entrée).
import { useEffect, useMemo, useState, type FC, type ReactNode } from "react";
import { Plus } from "lucide-react";
import { httpsCallable } from "firebase/functions";
import { functions } from "../lib/firebase";
import { useCan } from "../lib/rbac";
import { useCollectionData, useDocData } from "../lib/hooks";
import { Card, Tip, Badge, Busy, Table, colText, colNum, Kpi, money, EmptyState, Modal, Segmented } from "../design/components";
import { Select, DateField } from "../design/inputs";
import { frDate } from "../lib/format";
import { fmt } from "../design/tokens";
import {
  PARTNERSHIP_STATUS_LABEL, partnershipTone, CERT_STATUS_LABEL, certStatusTone,
  ALERT_BUCKET_LABEL, alertBucketTone, ASSIGNMENT_STATUS_LABEL, assignmentTone,
  relanceBucketLabel, relanceBucketTone, label,
} from "../lib/parLabels";
import type { Props } from "./_shared";

// Appel callable INLINE (module lazy) — évite d'alourdir writes.ts (budget bundle).
const callFn = <T,>(name: string, payload: unknown) => httpsCallable(functions, name)(payload).then((r) => r.data as T);

type CatalogEntry = { id: string; code?: string; name: string; competencyId: string; level: string; validityMonths: number };
type Partner = { id: string; name: string; programName?: string; tiers?: { id: string; name: string; rank: number }[]; certificationCatalog?: CatalogEntry[]; requirements?: unknown[] };
type Certif = { id: string; consultantId: string; consultantName?: string; consultantBu?: string; partnerId: string; certificationCatalogId: string; certName?: string; certCode?: string; status: string; obtainedDate: string; expiryDate?: string };
type Assign = { id: string; consultantId: string; consultantName?: string; partnerId: string; certificationCatalogId: string; cert?: string; targetDate: string; status: string };
type CaSummary = { byPartner?: { partnerId: string; name: string; revenueXof: number; bcCount: number }[]; unmapped?: { supplier: string; revenueXof: number; bcCount: number }[]; totalXof?: number; asOf?: string } | null;
type QuotaSummary = { partners?: { partnerId: string; name: string; status: string; coverage: { tierId: string; target: string; minCount: number; holders: number; ok: boolean }[]; gaps: { target: string; minCount: number; holders: number }[] }[] } | null;
type AlertSummary = { items?: { id: string; consultantName?: string; partnerId: string; certName?: string; expiryDate: string; daysLeft: number; bucket: string }[]; counts?: Record<string, number>; total?: number } | null;
type RelanceSummary = { items?: { id: string; consultantName?: string; partnerId: string; cert?: string; targetDate: string; daysLeft: number; bucket: string; effectiveStatus?: string }[]; counts?: { total: number; late: number } } | null;
type ConsultantLite = { id: string; name: string; bu?: string };

const Field: FC<{ label: string; children: ReactNode }> = ({ label, children }) => (
  <label className="flex flex-col gap-1"><span className="text-[11px] text-muted">{label}</span>{children}</label>
);

export const Partenariats: FC<Props> = () => {
  const canWrite = useCan("partenariats") === "write";
  const [tab, setTab] = useState<"dash" | "certifs" | "assigns" | "config">("dash");

  // Lectures temps réel (onSnapshot) — gatées par les rules (drapeau + droit).
  const { rows: partners } = useCollectionData<Partner>("par_partners");
  const { rows: certifs } = useCollectionData<Certif>("par_certifications");
  const { rows: assigns } = useCollectionData<Assign>("par_assignments");
  const { data: ca } = useDocData<CaSummary>("summaries/par_ca");
  const { data: quotas } = useDocData<QuotaSummary>("summaries/par_quotas");
  const { data: alerts } = useDocData<AlertSummary>("summaries/par_alerts");
  const { data: relances } = useDocData<RelanceSummary>("summaries/par_relances");
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
        ]}
      />

      {tab === "dash" && <Dashboard ca={ca} quotas={quotas} alerts={alerts} relances={relances} partners={partners || []} partnerName={partnerName} />}
      {tab === "certifs" && <CertifsTab certifs={certifs || []} partners={partners || []} partnerName={partnerName} partnerOpts={partnerOpts} canWrite={canWrite} />}
      {tab === "assigns" && <AssignsTab assigns={assigns || []} partners={partners || []} partnerName={partnerName} partnerOpts={partnerOpts} canWrite={canWrite} />}
      {tab === "config" && <ConfigTab partners={partners || []} partnerOpts={partnerOpts} mapDoc={mapDoc} ca={ca} canWrite={canWrite} />}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────── Tableau de bord
const Dashboard: FC<{ ca: CaSummary; quotas: QuotaSummary; alerts: AlertSummary; relances: RelanceSummary; partners: Partner[]; partnerName: Record<string, string> }> = ({ ca, quotas, alerts, relances, partners, partnerName }) => {
  const alertItems = alerts?.items || [];
  const relanceItems = relances?.items || [];
  const quotaPartners = quotas?.partners || [];
  const nonConf = quotaPartners.filter((p) => p.status === "non_compliant" || p.status === "at_risk").length;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi label="Partenaires" value={String(partners.length)} sub="référentiel" />
        <Kpi label="CA constructeurs (dérivé BC)" value={fmt(ca?.totalXof || 0)} sub={`${(ca?.byPartner || []).length} partenaire(s)`} tone="emerald" />
        <Kpi label="Certifs à renouveler" value={String(alerts?.total || 0)} sub={`${alerts?.counts?.expired || 0} expirée(s)`} tone={(alerts?.total || 0) > 0 ? "gold" : "ink"} />
        <Kpi label="Partenariats à risque" value={String(nonConf)} sub={`${relances?.counts?.late || 0} relance(s) en retard`} tone={nonConf > 0 ? "clay" : "ink"} />
      </div>

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

      <Card title="Conformité des quotas de certification">
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
  const [open, setOpen] = useState(false);
  return (
    <Card title="Certifications des ingénieurs" actions={canWrite ? <button className="btn" onClick={() => setOpen(true)}><Plus size={14} /> Ajouter</button> : undefined}>
      <Table
        columns={[
          colText("Ingénieur", (r) => r.consultantName || r.consultantId),
          colText("BU", (r) => r.consultantBu || "—"),
          colText("Constructeur", (r) => partnerName[r.partnerId] || r.partnerId),
          colText("Certification", (r) => r.certName || r.certificationCatalogId),
          colText("Obtenue", (r) => frDate(r.obtainedDate)),
          colText("Expire", (r) => r.expiryDate ? frDate(r.expiryDate) : "—"),
          colText("Statut", (r) => <Badge tone={certStatusTone(r.status)}>{label(CERT_STATUS_LABEL, r.status)}</Badge>),
        ]}
        rows={certifs} rowKey={(r) => r.id} searchKeys={[(r) => r.consultantName, (r) => r.certName, (r) => r.partnerId]}
        empty="Aucune certification enregistrée."
      />
      {open && <CertifForm partners={partners} partnerOpts={partnerOpts} onClose={() => setOpen(false)} />}
    </Card>
  );
};

const CertifForm: FC<{ partners: Partner[]; partnerOpts: { value: string; label: string }[]; onClose: () => void }> = ({ partners, partnerOpts, onClose }) => {
  const consultants = useConsultants(true);
  const [consultantId, setConsultantId] = useState("");
  const [partnerId, setPartnerId] = useState("");
  const [catalogId, setCatalogId] = useState("");
  const [obtainedDate, setObtainedDate] = useState("");
  const catalog = useMemo(() => (partners.find((p) => p.id === partnerId)?.certificationCatalog) || [], [partners, partnerId]);
  const valid = !!(consultantId && partnerId && catalogId && obtainedDate);
  const submit = async () => { await callFn("upsertParCertification", { consultantId, partnerId, certificationCatalogId: catalogId, obtainedDate }); onClose(); };
  return (
    <Modal open title="Ajouter une certification" size="form" onClose={onClose} actions={<Busy label="Enregistrer" fn={submit} okMsg="Certification enregistrée" />}>
      <div className="grid sm:grid-cols-2 gap-3">
        <Field label="Ingénieur (consultant)"><Select value={consultantId} onChange={setConsultantId} options={consultants.map((c) => ({ value: c.id, label: c.name }))} placeholder="Choisir…" /></Field>
        <Field label="Constructeur"><Select value={partnerId} onChange={(v) => { setPartnerId(v); setCatalogId(""); }} options={partnerOpts} placeholder="Choisir…" /></Field>
        <Field label="Certification (catalogue)"><Select value={catalogId} onChange={setCatalogId} options={catalog.map((e) => ({ value: e.id, label: e.name }))} placeholder={partnerId ? "Choisir…" : "Choisir un constructeur d'abord"} /></Field>
        <Field label="Date d'obtention"><DateField value={obtainedDate} onChange={setObtainedDate} /></Field>
      </div>
      <Tip>La date d'expiration et le statut sont <b>calculés</b> à partir de la validité du catalogue — jamais saisis.{!valid && <span className="block text-gold mt-1">Renseignez les quatre champs.</span>}</Tip>
    </Modal>
  );
};

// ─────────────────────────────────────────────────────────────────────── Assignations
const AssignsTab: FC<{ assigns: Assign[]; partners: Partner[]; partnerName: Record<string, string>; partnerOpts: { value: string; label: string }[]; canWrite: boolean }> = ({ assigns, partners, partnerName, partnerOpts, canWrite }) => {
  const [open, setOpen] = useState(false);
  const markObtenu = (id: string) => callFn("setParAssignmentStatus", { id, status: "obtenu" });
  return (
    <Card title="Assignations de certification" actions={canWrite ? <button className="btn" onClick={() => setOpen(true)}><Plus size={14} /> Ajouter</button> : undefined}>
      <Tip>Affecter à un ingénieur l'obtention d'une certification à une échéance ; les relances (J-30/14/7) et les retards apparaissent au Tableau de bord.</Tip>
      <Table
        columns={[
          colText("Ingénieur", (r) => r.consultantName || r.consultantId),
          colText("Constructeur", (r) => partnerName[r.partnerId] || r.partnerId),
          colText("Certif visée", (r) => r.cert || r.certificationCatalogId),
          colText("Échéance", (r) => frDate(r.targetDate)),
          colText("Statut", (r) => <Badge tone={assignmentTone(r.status)}>{label(ASSIGNMENT_STATUS_LABEL, r.status)}</Badge>),
          ...(canWrite ? [colText("Action", (r) => r.status !== "obtenu" ? <Busy label="Marquer obtenue" variant="ghost" fn={() => markObtenu(r.id)} okMsg="Statut mis à jour" /> : <span className="text-faint">—</span>)] : []),
        ]}
        rows={assigns} rowKey={(r) => r.id} searchKeys={[(r) => r.consultantName, (r) => r.cert, (r) => r.partnerId]}
        empty="Aucune assignation."
      />
      {open && <AssignForm partners={partners} partnerOpts={partnerOpts} onClose={() => setOpen(false)} />}
    </Card>
  );
};

const AssignForm: FC<{ partners: Partner[]; partnerOpts: { value: string; label: string }[]; onClose: () => void }> = ({ partners, partnerOpts, onClose }) => {
  const consultants = useConsultants(true);
  const [consultantId, setConsultantId] = useState("");
  const [partnerId, setPartnerId] = useState("");
  const [catalogId, setCatalogId] = useState("");
  const [targetDate, setTargetDate] = useState("");
  const catalog = useMemo(() => (partners.find((p) => p.id === partnerId)?.certificationCatalog) || [], [partners, partnerId]);
  const valid = !!(consultantId && partnerId && catalogId && targetDate);
  const submit = async () => { await callFn("upsertParAssignment", { consultantId, partnerId, certificationCatalogId: catalogId, targetDate }); onClose(); };
  return (
    <Modal open title="Ajouter une assignation" size="form" onClose={onClose} actions={<Busy label="Enregistrer" fn={submit} okMsg="Assignation enregistrée" />}>
      <div className="grid sm:grid-cols-2 gap-3">
        <Field label="Ingénieur (consultant)"><Select value={consultantId} onChange={setConsultantId} options={consultants.map((c) => ({ value: c.id, label: c.name }))} placeholder="Choisir…" /></Field>
        <Field label="Constructeur"><Select value={partnerId} onChange={(v) => { setPartnerId(v); setCatalogId(""); }} options={partnerOpts} placeholder="Choisir…" /></Field>
        <Field label="Certification à obtenir"><Select value={catalogId} onChange={setCatalogId} options={catalog.map((e) => ({ value: e.id, label: e.name }))} placeholder={partnerId ? "Choisir…" : "Choisir un constructeur d'abord"} /></Field>
        <Field label="Échéance cible"><DateField value={targetDate} onChange={setTargetDate} /></Field>
      </div>
      {!valid && <Tip>Renseignez les quatre champs.</Tip>}
    </Modal>
  );
};

// ─────────────────────────────────────────────────────────────────────── Paramétrage (mapping fournisseur → constructeur)
const ConfigTab: FC<{ partners: Partner[]; partnerOpts: { value: string; label: string }[]; mapDoc: { map?: Record<string, string> } | null; ca: CaSummary; canWrite: boolean }> = ({ partners, partnerOpts, mapDoc, ca, canWrite }) => {
  const [rows, setRows] = useState<{ supplier: string; partnerId: string }[]>([]);
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

      <Card title="Référentiel des partenaires">
        <Table
          columns={[
            colText("Constructeur", (r) => r.name),
            colText("Programme", (r) => r.programName || "—"),
            colNum("Niveaux", (r) => String((r.tiers || []).length)),
            colNum("Certifs au catalogue", (r) => String((r.certificationCatalog || []).length)),
            colNum("Exigences", (r) => String((r.requirements || []).length)),
          ]}
          rows={partners} rowKey={(r) => r.id}
          empty="Aucun partenaire — le référentiel des constructeurs est initialisé côté direction (callable upsertParPartner)."
        />
      </Card>
    </div>
  );
};
