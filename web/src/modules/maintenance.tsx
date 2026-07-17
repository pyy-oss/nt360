// Module « Contrats de maintenance » (mnt_). Lot 1 : contrats + engagements SLA. Lot 2 : tickets
// (demandes sous contrat) + interventions (temps consultant, qui alimente le CRA). Tout est DERRIÈRE
// le drapeau config/mntFeature (App masque l'onglet si éteint) et gouverné par le droit `maintenance`.
// Réutilise les primitives design, les écritures callable et les formats de l'ERP (FCFA entier via
// money, date JJ/MM/AAAA via frDate). Aucune valeur en dur (tokens/tons via lib/mntContrat).
import { useEffect, useMemo, useState, type FC, type ReactNode } from "react";
import { Plus } from "lucide-react";
import { where, orderBy, limit } from "firebase/firestore";
import { useCan, useClaims } from "../lib/rbac";
import { useCollectionData, useDocData } from "../lib/hooks";
import { Card, Tip, Badge, Busy, DangerBtn, Table, colText, colNum, Kpi, money, EmptyState, Modal, Segmented, cx, useConfirm, type BulkAction } from "../design/components";
import { Select, DateField } from "../design/inputs";
import { fmt, pct } from "../design/tokens";
import { frDate, tsMillis } from "../lib/format";
import { fpKey } from "../lib/ids";
import { isMntEnabled, type MntFeature } from "../lib/mntFeature";
import { slaState, slaTone, SLA_STATE_LABEL, echeancier, echeancierPlan, ECHEANCE_STATUT_LABEL, echeanceStatutTone } from "../lib/mntSla";
import type { Invoice, Order, AuditLog } from "../types";
import {
  upsertMntContrat, deleteMntContrat, setMntContratStatut, setMntWatch, aiMntContratStatut, revertMntAutoStatut, upsertMntTicket, deleteMntTicket, upsertMntIntervention, deleteMntIntervention, listConsultants, submitMntDecision,
  importMntContrats, type MntImportResult, aiSuggestMntContrats, type MntAiSuggestion, type MntAiSuggestResult,
  mntContratPnl, type MntContratPnlRow, aiAnalyzeChurn, type ChurnInput, type ChurnResult, type ChurnAnalysis,
} from "../lib/writes";
import type { MntContrat, MntEngagement, MntTicket, MntIntervention, MntWatch } from "../types";
import { EVENT_TYPE_LABEL, SEVERITY_LABEL, severityTone, watchMatchesEvent, hasAnyWatch, type MntSurveillanceEvent, type MntSurveillanceSummary } from "../lib/mntSurveillance";
import { STATUT_SOURCE_LABEL, confidenceTone, type MntStatutProposal, type MntStatutRun } from "../lib/mntStatutAuto";
import {
  STATUTS, ECHEANCES, SLA_TYPES, COUVERTURES, STATUT_LABEL, ECHEANCE_LABEL, SLA_TYPE_LABEL, COUVERTURE_LABEL,
  TICKET_STATUTS, PRIORITES, TICKET_STATUT_LABEL, PRIORITE_LABEL, statutTone, ticketStatutTone, prioriteTone, label,
  TYPES_MAINTENANCE, TYPE_MAINTENANCE_LABEL,
} from "../lib/mntContrat";
import { NIVEAU_LABEL, niveauTone, signalText, label as riskLabel, type RisqueSummary, type RisqueItem } from "../lib/mntRisque";
import { computeMntDashboard, slaAgenda, mntCompliance, mntRenouvellements, mntTypeStats, MNT_TYPES, type MntTypeCount, type SlaAgendaItem, type MntComplianceItem, type MntRenouvellement } from "../lib/mntDashboard";
import { suggestMntContrats, mntCandidatePool, buildContratDraft, type MntSuggestion } from "../lib/mntSuggest";
import { FpLink, useCommandesRows } from "./_shared";
import type { Props } from "./_shared";

const BU_OPTS = ["ICT", "CLOUD", "FORMATION", "AUTRE"];
const MNT_COMPLIANCE_LABEL: Record<string, string> = { sans_sla: "Sans engagement SLA", sans_echeance: "Sans date de fin", echeance_depassee: "Échéance dépassée", montant_nul: "Montant nul" };
const opt = (map: Record<string, string>, vals: readonly string[]) => vals.map((v) => ({ value: v, label: map[v] || v }));
const digits = (s: string) => s.replace(/[^\d]/g, "");
const decimals = (s: string) => s.replace(/[^\d.,]/g, "").replace(",", ".");

const Field: FC<{ label: string; children: ReactNode }> = ({ label, children }) => (
  <label className="flex flex-col gap-1"><span className="text-[11px] text-muted">{label}</span>{children}</label>
);

// Import EN MASSE des contrats (Lot 8) : « Aperçu » (dry-run) puis « Importer ». Rapprochement par N° FP
// (ré-import = mise à jour). Rendu seulement en écriture ; le callable est doublement gaté (droit + drapeau).
const ImportContratsCard: FC = () => {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<MntImportResult | null>(null);
  return (
    <Card title="Importer des contrats (Excel)">
      <div className="flex flex-wrap items-center gap-2">
        <input type="file" accept=".xlsx,.xls,.csv" aria-label="Fichier de contrats"
          className="text-xs file:btn-ghost file:!px-2.5 file:!py-1 file:text-xs file:mr-2"
          onChange={(e) => { setFile(e.target.files?.[0] || null); setPreview(null); }} />
        {file && <Busy variant="ghost" label="Aperçu" okMsg="Aperçu prêt" errMsg="Fichier illisible"
          fn={async () => { setPreview(await importMntContrats(file, false)); }} />}
        {preview && (preview.created + preview.updated) > 0 && (
          <Busy variant="gold" label={`Importer (${preview.created + preview.updated})`} okMsg="Contrats importés" errMsg="Import refusé"
            fn={async () => { await importMntContrats(file!, true); setFile(null); setPreview(null); }} />
        )}
      </div>
      {preview && (
        <div className="mt-3 text-[13px] flex flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="emerald">{preview.created} création(s)</Badge>
            <Badge tone="gold">{preview.updated} mise(s) à jour</Badge>
            {preview.skipped > 0 && <Badge tone="clay">{preview.skipped} erreur(s)</Badge>}
            <span className="text-faint text-[12px]">· {preview.rowsParsed} ligne(s) lue(s)</span>
          </div>
          {preview.samples?.errors?.length ? (
            <ul className="text-[12px] text-clay list-disc pl-4">
              {preview.samples.errors.map((e, i) => <li key={i}>Ligne {e.line}{e.fp ? ` (${e.fp})` : ""} : {e.error}</li>)}
            </ul>
          ) : null}
        </div>
      )}
      <Tip>Colonnes attendues : <b>N° FP</b>, <b>Client</b>, BU, AM, <b>Statut</b> (Actif/Suspendu/Échu/Résilié/Brouillon), <b>Périodicité</b> (Mensuel/Trimestriel/Annuel), <b>Date début</b> (AAAA-MM-JJ ou JJ/MM/AAAA), Date fin, Montant engagé, Devise. Rapprochement par <b>N° FP</b> (1 contrat = 1 affaire) : ré-importer <b>met à jour sans effacer</b> — seules les colonnes <b>renseignées</b> sont écrites, les champs laissés vides et les <b>engagements SLA</b> (saisis en fiche) sont <b>préservés</b>. « <b>Aperçu</b> » ne modifie rien.</Tip>
    </Card>
  );
};

// ---------------------------------------------------------------------------------------------------
// Fiche contrat (création / édition) — Lot 1.
type CForm = { fp: string; client: string; bu: string; am: string; statut: string; echeanceType: string; dateDebut: string; dateFin: string; montantEngage: string; engagements: { type: string; couverture: string; seuilHeures: string; quota: string }[]; objectifs: Record<string, string> };
const emptyContrat = (): CForm => ({ fp: "", client: "", bu: "AUTRE", am: "", statut: "brouillon", echeanceType: "mensuel", dateDebut: "", dateFin: "", montantEngage: "", engagements: [], objectifs: {} });
const toContratForm = (c: MntContrat): CForm => ({
  fp: c.fp || "", client: c.client || "", bu: c.bu || "AUTRE", am: c.am || "", statut: c.statut || "brouillon", echeanceType: c.echeanceType || "mensuel",
  dateDebut: c.dateDebut || "", dateFin: c.dateFin || "", montantEngage: String(c.montantEngage ?? ""),
  engagements: (c.engagements || []).map((e) => ({ type: e.type, couverture: e.couverture, seuilHeures: String(e.seuilHeures ?? ""), quota: e.quota == null ? "" : String(e.quota) })),
  objectifs: Object.fromEntries(TYPES_MAINTENANCE.map((t) => { const v = (c.objectifsMaintenance as Record<string, number> | null | undefined)?.[t]; return [t, v == null ? "" : String(v)]; })),
});
const contratPayload = (f: CForm): MntContrat => ({
  fp: f.fp.trim(), client: f.client.trim(), bu: f.bu, am: f.am.trim(), statut: f.statut, echeanceType: f.echeanceType,
  dateDebut: f.dateDebut, dateFin: f.dateFin || null, montantEngage: Number(f.montantEngage || 0), deviseEngage: "XOF",
  engagements: f.engagements.map((e): MntEngagement => ({ type: e.type, couverture: e.couverture, seuilHeures: Number(e.seuilHeures || 0), quota: e.quota === "" ? null : Number(e.quota) })),
  // Objectifs de maintenance embarqués (ADR-025) : ne garde que les types RENSEIGNÉS (entier), null si aucun.
  objectifsMaintenance: (() => { const o: Record<string, number> = {}; for (const t of TYPES_MAINTENANCE) { const v = (f.objectifs[t] || "").trim(); if (v !== "") o[t] = Math.max(0, Math.round(Number(v) || 0)); } return Object.keys(o).length ? o : null; })(),
});

// Rendu « Maintenance par type vs objectifs » (ADR-025) — tickets ET interventions comptés SÉPARÉMENT par
// type ; le Total (tickets + interventions) est confronté à l'objectif (max) quand il est fourni (fiche
// contrat). Dépassement signalé en clay. Sans objectif (vue agrégée), la colonne Objectif est masquée.
function TypeStatsTable({ tickets, interventions, objectifs }: { tickets: MntTypeCount; interventions: MntTypeCount; objectifs?: Partial<MntTypeCount> | null }) {
  const th = "px-3 py-2 font-medium text-xs";
  return (
    <div className="overflow-x-auto -mx-1">
      <table className="w-full text-sm rtable">
        <thead><tr className="text-muted">
          <th className={cx(th, "text-left")}>Type</th>
          <th className={cx(th, "text-right")}>Tickets</th>
          <th className={cx(th, "text-right")}>Interventions</th>
          <th className={cx(th, "text-right")}>Total</th>
          {objectifs && <th className={cx(th, "text-right")}>Objectif</th>}
        </tr></thead>
        <tbody>
          {MNT_TYPES.map((t) => {
            const total = tickets[t] + interventions[t];
            const obj = objectifs ? objectifs[t] : undefined;
            const over = obj != null && total > obj;
            return (
              <tr key={t} className="odd:bg-ink/[.03]">
                {/* data-label : requis par .rtable (mode carte < 640 px) — sans lui, les colonnes s'affichent
                    sans libellé sur mobile (aligné sur le primitif Table). */}
                <td className="px-3 py-1.5" data-label="Type">{TYPE_MAINTENANCE_LABEL[t]}</td>
                <td className="px-3 py-1.5 text-right tabnum" data-label="Tickets">{tickets[t]}</td>
                <td className="px-3 py-1.5 text-right tabnum" data-label="Interventions">{interventions[t]}</td>
                <td className={cx("px-3 py-1.5 text-right tabnum font-semibold", over && "text-clay")} data-label="Total">{total}</td>
                {objectifs && <td className="px-3 py-1.5 text-right tabnum text-muted" data-label="Objectif">{obj != null ? obj : "—"}</td>}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export const Maintenance: FC<Props> = () => {
  const canRead = useCan("maintenance");
  const canWrite = canRead === "write";
  const [askConfirm, confirmNode] = useConfirm(); // confirmation des actions en masse (statut auto)
  // Défense en profondeur : le gate exige le DROIT `maintenance` ET le drapeau config/mntFeature — même
  // invariant que la nav (App) et les rules Firestore. Si un futur refactor rendait ce composant atteignable
  // hors du filtre de nav, aucun abonnement mnt_ ne partirait drapeau éteint (audit info). Doc minuscule.
  const { data: mntFeature } = useDocData<MntFeature>("config/mntFeature");
  const gate = canRead !== "none" && isMntEnabled(mntFeature);
  const { rows: contrats, loading: lc } = useCollectionData<MntContrat>(gate ? "mnt_contrats" : null);
  const { rows: tickets } = useCollectionData<MntTicket>(gate ? "mnt_tickets" : null);
  const { rows: interventions } = useCollectionData<MntIntervention>(gate ? "mnt_interventions" : null);
  // Scores de risque MATÉRIALISÉS par le recompute (summaries/mnt_risque, ADR-003) — une seule vérité
  // du score. Le doc est gaté (drapeau + droit maintenance) côté rules ; on ne le lit que si `gate`.
  const { data: risque } = useDocData<RisqueSummary>(gate ? "summaries/mnt_risque" : null);
  // Centre de surveillance (Lot 5, ADR-026) : flux d'événements MATÉRIALISÉ (projection du risque) + les
  // abonnements PAR UTILISATEUR (doc mnt_watches/{uid}, lu en direct — chaque utilisateur ne lit que le sien).
  const { user } = useClaims();
  const { data: surv } = useDocData<MntSurveillanceSummary>(gate ? "summaries/mnt_surveillance" : null);
  const { data: watch } = useDocData<MntWatch>(gate && user?.uid ? `mnt_watches/${user.uid}` : null);
  // Consultants pour la saisie d'intervention (collection consultants = callable-only → listConsultants).
  const [consultants, setConsultants] = useState<{ id: string; name?: string }[]>([]);
  useEffect(() => { if (!gate) return; listConsultants().then((r) => setConsultants((r.rows || []).filter((c) => c.id).map((c) => ({ id: c.id!, name: c.name || undefined })))).catch(() => setConsultants([])); }, [gate]);
  const consultantName = useMemo(() => Object.fromEntries(consultants.map((c) => [c.id, c.name || c.id])), [consultants]);

  // --- Contrats ---
  const [cOpen, setCOpen] = useState(false);
  const [cForm, setCForm] = useState<CForm>(emptyContrat);
  const [cEdit, setCEdit] = useState(false);
  const [cId, setCId] = useState(""); // id du contrat édité (pour les décisions renouvellement/résiliation)
  const [viewC, setViewC] = useState<MntContrat | null>(null); // fiche contrat en CONSULTATION (lecture seule)
  const setC = <K extends keyof CForm>(k: K, v: CForm[K]) => setCForm((f) => ({ ...f, [k]: v }));
  const contratsSorted = useMemo(() => [...contrats].sort((a, b) => String(a.client || "").localeCompare(String(b.client || ""))), [contrats]);
  // Action EN MASSE « Passer au statut » — même patron que les BC (operations.tsx). Appels séquentiels
  // (chaque écriture déclenche un recompute coalescé) ; réutilise setMntContratStatut (ne touche que le statut).
  // Statut automatique (Lot 6, ADR-027 révisé ADR-028) : le callable PROPOSE le statut juste (règles + IA) —
  // il n'écrit RIEN (l'auto-application a causé un incident : tout le parc basculé en échu). L'application
  // reste un geste HUMAIN, à l'unité (« Appliquer ») ou en masse (« Appliquer les recommandés »).
  const [statutRun, setStatutRun] = useState<MntStatutRun | null>(null);
  const runStatutAuto = async (ids?: string[]) => { const r = await aiMntContratStatut(ids ? { ids } : {}); setStatutRun(r); return r; };
  const dropProposal = (id: string) => setStatutRun((r) => (r ? { ...r, proposals: r.proposals.filter((p) => p.id !== id) } : r));
  const applyProposal = async (p: MntStatutProposal) => { await setMntContratStatut(p.id, p.proposed); dropProposal(p.id); };
  const contratBulk: BulkAction[] = canWrite ? [
    { label: "Passer au statut", pick: { options: STATUTS.map((s) => ({ value: s, label: STATUT_LABEL[s] })), placeholder: "Statut cible" },
      okMsg: (rs) => { const k = rs.filter((r) => r.id).length; return `${k} contrat${k > 1 ? "s" : ""} mis à jour`; }, errMsg: "Mise à jour refusée",
      run: async (rs, statut) => { for (const r of rs.filter((x) => x.id)) await setMntContratStatut(r.id!, statut!); } },
    // Déterminer le statut (IA) sur la sélection : PROPOSE seulement (rien n'est écrit), les propositions
    // s'affichent dans la carte « Statut automatique » — à appliquer à la main.
    { label: "Déterminer le statut (IA)",
      okMsg: (rs) => `${rs.filter((r) => r.id).length} contrat(s) analysé(s) — voir les propositions`, errMsg: "Analyse refusée",
      run: async (rs) => runStatutAuto(rs.map((r) => r.id).filter(Boolean)) },
  ] : [];
  const statutCols = [
    colText("Client", (p: MntStatutProposal) => p.client || "—", (p: MntStatutProposal) => p.client || ""),
    colText("N° FP", (p: MntStatutProposal) => <FpLink fp={p.fp || undefined} />),
    colText("Transition", (p: MntStatutProposal) => (
      <span className="inline-flex items-center gap-1.5">
        <Badge tone={statutTone(p.current)}>{label(STATUT_LABEL, p.current)}</Badge>
        <span className="text-faint">→</span>
        <Badge tone={statutTone(p.proposed)}>{label(STATUT_LABEL, p.proposed)}</Badge>
      </span>
    )),
    colText("Origine", (p: MntStatutProposal) => <Badge tone={p.source === "regle" ? "steel" : "gold"}>{STATUT_SOURCE_LABEL[p.source] || p.source}</Badge>),
    colNum("Confiance", (p: MntStatutProposal) => <Badge tone={confidenceTone(p.confidence)}>{Math.round(p.confidence * 100)} %</Badge>, (p: MntStatutProposal) => p.confidence),
    colText("Motif", (p: MntStatutProposal) => <span className="text-[12px] text-muted">{p.motif || "—"}</span>),
    colText("", (p: MntStatutProposal) => (canWrite ? <Busy variant="ghost" label="Appliquer" okMsg="Statut appliqué" errMsg="Application refusée" fn={() => applyProposal(p)} /> : null)),
  ];
  const cValid = cForm.fp.trim() && cForm.client.trim() && cForm.dateDebut;
  const addEng = () => setC("engagements", [...cForm.engagements, { type: "resolution", couverture: "ouvre_lun_ven", seuilHeures: "", quota: "" }]);
  const setEng = (i: number, k: string, v: string) => setC("engagements", cForm.engagements.map((e, j) => (j === i ? { ...e, [k]: v } : e)));
  const rmEng = (i: number) => setC("engagements", cForm.engagements.filter((_, j) => j !== i));
  // Échéancier du contrat ouvert : factures de l'affaire (par N° FP canonique) → engagé vs facturé.
  // Lecture bornée par la requête (where fp==) ; nécessite le droit `facturation` (sinon écart neutre).
  // Édition OU consultation ouverte : `cForm` reflète le contrat visé dans les deux cas → l'échéancier
  // (ech/plan/factureTotal) est partagé, garantissant la parité entre la fiche d'édition et la consultation.
  const openFp = (cOpen || !!viewC) && cForm.fp ? fpKey(cForm.fp) : "";
  const { rows: cInvoices } = useCollectionData<Invoice>(openFp ? "invoices" : null, openFp ? [where("fp", "==", openFp)] : [], openFp || "");
  const factureTotal = useMemo(() => cInvoices.reduce((s, i) => s + (Number(i.amountHt) || 0), 0), [cInvoices]);
  const ech = useMemo(() => echeancier({ echeanceType: cForm.echeanceType, montantEngage: Number(cForm.montantEngage || 0), dateDebut: cForm.dateDebut, dateFin: cForm.dateFin || null }, factureTotal, new Date().toISOString().slice(0, 10)), [cForm.echeanceType, cForm.montantEngage, cForm.dateDebut, cForm.dateFin, factureTotal]);
  // Échéancier DÉTAILLÉ (liste datée) : chaque échéance marquée facturée (couverte par le facturé cumulé) /
  // dûe (passée non couverte) / à venir. Même assiette que l'agrégat `ech` (parité echeancierPlan/echeancier).
  const plan = useMemo(() => echeancierPlan({ echeanceType: cForm.echeanceType, montantEngage: Number(cForm.montantEngage || 0), dateDebut: cForm.dateDebut, dateFin: cForm.dateFin || null }, factureTotal, new Date().toISOString().slice(0, 10)), [cForm.echeanceType, cForm.montantEngage, cForm.dateDebut, cForm.dateFin, factureTotal]);

  // --- Tickets ---
  const [tOpen, setTOpen] = useState(false);
  const [tForm, setTForm] = useState<MntTicket>({ statut: "ouvert", priorite: "moyenne" });
  const setT = <K extends keyof MntTicket>(k: K, v: MntTicket[K]) => setTForm((f) => ({ ...f, [k]: v }));
  const ticketsSorted = useMemo(() => [...tickets].sort((a, b) => String(a.client || "").localeCompare(String(b.client || ""))), [tickets]);
  const contratById = useMemo(() => Object.fromEntries(contrats.map((c) => [c.id!, c])), [contrats]);
  const nowMs = Date.now();
  // Calendrier SLA (Lot 2/7) : échéances SLA en attente des tickets ouverts, live. Horodatages convertis en
  // millis (tsMillis) avant l'appel → la vue PURE slaAgenda reste testable ; même moteur slaState que la fiche.
  const agenda = useMemo(() => slaAgenda(
    tickets.map((t) => ({
      id: t.id, contratId: t.contratId, client: t.client, titre: t.titre, priorite: t.priorite, statut: t.statut,
      ouvertMs: t.ouvertLe ? tsMillis(t.ouvertLe) : null,
      priseEnCompteMs: t.priseEnCompteLe ? tsMillis(t.priseEnCompteLe) : null,
      resoluMs: t.resoluLe ? tsMillis(t.resoluLe) : null,
    })),
    contrats, nowMs), [tickets, contrats, nowMs]);
  // Restant lisible : « 2 j 3 h » ou « En retard de … » (rompu). Zéro dépendance externe (arrondi h).
  const fmtRemaining = (ms: number) => {
    const h = Math.floor(Math.abs(ms) / 3_600_000), d = Math.floor(h / 24);
    const txt = d > 0 ? `${d} j ${h % 24} h` : `${h} h`;
    return ms < 0 ? `En retard de ${txt}` : txt;
  };
  const openNewTicket = () => { setTForm({ statut: "ouvert", priorite: "moyenne" }); setTOpen(true); };
  const openEditTicket = (t: MntTicket) => { setTForm({ ...t }); setTOpen(true); };
  // Sélection d'un contrat : renseigne contratId + reporte fp/client (rattachement).
  const pickContrat = (id: string) => { const c = contrats.find((x) => x.id === id); setTForm((f) => ({ ...f, contratId: id, fp: c?.fp, client: c?.client })); };
  const tValid = tForm.contratId && (tForm.titre || "").trim();
  const ticketInterventions = useMemo(() => interventions.filter((i) => i.ticketId === tForm.id).sort((a, b) => String(b.date).localeCompare(String(a.date))), [interventions, tForm.id]);

  // Nouvelle intervention (dans la fiche ticket).
  const [iForm, setIForm] = useState<{ consultantId: string; date: string; heures: string; commentaire: string; typeMaintenance: string }>({ consultantId: "", date: "", heures: "", commentaire: "", typeMaintenance: "" });
  const iValid = tForm.id && iForm.consultantId && iForm.date && Number(iForm.heures) > 0;

  const contratCols = [
    colText("Client", (c: MntContrat) => c.client || "—", (c: MntContrat) => c.client || ""),
    colText("N° FP", (c: MntContrat) => <FpLink fp={c.fp} />),
    colText("Statut", (c: MntContrat) => <Badge tone={statutTone(c.statut)}>{label(STATUT_LABEL, c.statut)}</Badge>),
    colText("Période", (c: MntContrat) => `${frDate(c.dateDebut)} → ${c.dateFin ? frDate(c.dateFin) : "—"}`),
    colNum("Engagé", (c: MntContrat) => money(c.montantEngage), (c: MntContrat) => c.montantEngage || 0),
    colNum("SLA", (c: MntContrat) => c.engagements?.length || 0),
    colText("", (c: MntContrat) => (
      <div className="flex items-center justify-end gap-1.5">
        {/* Consulter : fiche 360° en LECTURE SEULE (engagements, échéancier, tickets, interventions, P&L,
            risque). `cForm` est aussi renseigné → l'échéancier partage la même assiette que l'édition. */}
        <button type="button" className="btn-ghost !px-2 !py-1 text-xs" onClick={() => { setCForm(toContratForm(c)); setViewC(c); }}>Consulter</button>
        {canWrite && <button type="button" className="btn-ghost !px-2 !py-1 text-xs" onClick={() => { setCForm(toContratForm(c)); setCId(c.id || ""); setCEdit(true); setCOpen(true); }}>Éditer</button>}
        {/* Statut IA (unitaire, ADR-027) : détermine le statut juste ; appliqué si fiable, sinon proposé dans la carte. */}
        {canWrite && <Busy variant="ghost" label="Statut IA" okMsg={(r: MntStatutRun) => { const p = r.proposals[0]; return !p ? "Statut déjà cohérent" : `Proposition : ${label(STATUT_LABEL, p.proposed)} (voir la carte pour appliquer)`; }} errMsg="Analyse refusée" fn={() => runStatutAuto([c.id!])} />}
        {canWrite && <DangerBtn label="Suppr." confirm={`Supprimer le contrat ${c.fp} ?`} fn={() => deleteMntContrat(c.id!)} okMsg="Contrat supprimé" errMsg="Suppression refusée" />}
      </div>
    )),
  ];
  const ticketCols = [
    colText("Client", (t: MntTicket) => t.client || "—", (t: MntTicket) => t.client || ""),
    colText("N° FP", (t: MntTicket) => <FpLink fp={t.fp} />),
    colText("Titre", (t: MntTicket) => t.titre || "—"),
    colText("Priorité", (t: MntTicket) => <Badge tone={prioriteTone(t.priorite)}>{label(PRIORITE_LABEL, t.priorite)}</Badge>),
    colText("Statut", (t: MntTicket) => <Badge tone={ticketStatutTone(t.statut)}>{label(TICKET_STATUT_LABEL, t.statut)}</Badge>),
    // SLA de RÉSOLUTION : dérivé live de l'engagement du contrat (jours ouvrés, ADR-002) — ouvertLe →
    // resoluLe (ou maintenant si non résolu). « — » si le contrat n'a pas d'engagement de résolution.
    colText("SLA résolution", (t: MntTicket) => {
      const eng = (contratById[t.contratId || ""]?.engagements || []).find((e) => e.type === "resolution");
      if (!eng || !t.ouvertLe) return "—";
      const st = slaState(eng, tsMillis(t.ouvertLe), t.resoluLe ? tsMillis(t.resoluLe) : null, nowMs);
      return <Badge tone={slaTone(st.state)}>{SLA_STATE_LABEL[st.state]}</Badge>;
    }),
    colText("", (t: MntTicket) => (
      <div className="flex items-center justify-end gap-1.5">
        <button type="button" className="btn-ghost !px-2 !py-1 text-xs" onClick={() => openEditTicket(t)}>{canWrite ? "Ouvrir" : "Voir"}</button>
        {canWrite && <DangerBtn label="Suppr." confirm={`Supprimer le ticket « ${t.titre} » ?`} fn={() => deleteMntTicket(t.id!)} okMsg="Ticket supprimé" errMsg="Suppression refusée" />}
      </div>
    )),
  ];

  const agendaCols = [
    colText("État", (a: SlaAgendaItem) => <Badge tone={slaTone(a.state)}>{SLA_STATE_LABEL[a.state]}</Badge>, (a: SlaAgendaItem) => (a.state === "rompu" ? 0 : 1)),
    colText("Restant", (a: SlaAgendaItem) => <span className={cx("text-[12px] whitespace-nowrap", a.remainingMs < 0 && "text-clay")}>{fmtRemaining(a.remainingMs)}</span>, (a: SlaAgendaItem) => a.remainingMs),
    colText("Client", (a: SlaAgendaItem) => a.client || "—", (a: SlaAgendaItem) => a.client || ""),
    colText("Ticket", (a: SlaAgendaItem) => <span className="truncate max-w-[220px] inline-block align-bottom" title={a.titre}>{a.titre || "—"}</span>),
    colText("SLA", (a: SlaAgendaItem) => label(SLA_TYPE_LABEL, a.slaType)),
    colText("Priorité", (a: SlaAgendaItem) => <Badge tone={prioriteTone(a.priorite)}>{label(PRIORITE_LABEL, a.priorite)}</Badge>),
  ];

  // Contrats à risque (Ambre et plus), les plus critiques d'abord — le summary est DÉJÀ trié.
  const risqueItems = risque?.items || [];
  const atRisk = risqueItems.filter((r) => r.niveau !== "vert");
  const counts = risque?.counts || { vert: 0, ambre: 0, rouge: 0, critique: 0 };
  const risqueCols = [
    colText("Client", (r: RisqueItem) => r.client || "—", (r: RisqueItem) => r.client || ""),
    colText("N° FP", (r: RisqueItem) => <FpLink fp={r.fp || undefined} />),
    colText("Niveau", (r: RisqueItem) => <Badge tone={niveauTone(r.niveau)}>{riskLabel(NIVEAU_LABEL, r.niveau)}</Badge>),
    colNum("Score", (r: RisqueItem) => String(r.score), (r: RisqueItem) => r.score),
    colText("Signaux", (r: RisqueItem) => (
      <div className="flex flex-wrap gap-1">
        {(r.signals || []).map((s, i) => <Badge key={i} tone="steel">{signalText(s)}</Badge>)}
      </div>
    )),
    colText("AM", (r: RisqueItem) => r.am || "—"),
  ];

  // Tableau de bord (Lot 6) — cockpit consolidé en tête du module, dérivé des collections déjà
  // chargées (aucun appel serveur). asOf = aujourd'hui (échéances proches ≤ 60 j).
  const asOfIso = new Date().toISOString().slice(0, 10);
  const dash = useMemo(() => computeMntDashboard(contrats, tickets, asOfIso), [contrats, tickets, asOfIso]);
  // Conformité (Lot 3/7) : manques bloquants sur les contrats ACTIFS (sans SLA, sans date de fin, échéance
  // dépassée, montant nul). Vue pure, dérivée des contrats déjà chargés. « Corriger » ouvre la fiche.
  const compliance = useMemo(() => mntCompliance(contrats, asOfIso), [contrats, asOfIso]);
  // Renouvellements à anticiper (Lot 5/7) : contrats actifs dont la fin approche (≤ 90 j), plus urgent d'abord.
  const renouvellements = useMemo(() => mntRenouvellements(contrats, asOfIso), [contrats, asOfIso]);
  // Maintenance par TYPE vs objectifs (ADR-025) : nombre de tickets ET d'interventions par type, par
  // contrat + total agrégé. Vue pure (mntTypeStats), dérivée des collections déjà chargées.
  const typeStats = useMemo(() => mntTypeStats(contrats, tickets, interventions), [contrats, tickets, interventions]);
  // --- Centre de surveillance (ADR-026) : flux d'événements + abonnements ciblés ---
  const [survScope, setSurvScope] = useState<"tout" | "abonnements">("tout");
  const survEvents = useMemo<MntSurveillanceEvent[]>(() => surv?.events || [], [surv]);
  const survCounts = surv?.counts || { high: 0, medium: 0, low: 0 };
  const watched = hasAnyWatch(watch);
  // « Mes abonnements » filtre le flux aux événements couverts par l'abonnement (miroir de watchMatchesEvent back).
  const survRows = useMemo(() => (survScope === "abonnements" ? survEvents.filter((e) => watchMatchesEvent(watch, e)) : survEvents), [survEvents, survScope, watch]);
  const isWatchedContrat = (id: string) => !!watch?.global || (watch?.contrats || []).includes(id);
  // Bascule l'abonnement CIBLÉ d'un contrat (ajout/retrait dans mnt_watches/{uid}). Le reste de l'abonnement
  // (global, clients, ams) est préservé — le callable renormalise et écrit le doc complet.
  const toggleWatchContrat = async (contratId: string) => {
    const set = new Set(watch?.contrats || []);
    if (set.has(contratId)) set.delete(contratId); else set.add(contratId);
    await setMntWatch({ global: !!watch?.global, contrats: [...set], clients: watch?.clients || [], ams: watch?.ams || [] });
  };
  const setWatchGlobal = async (g: boolean) => setMntWatch({ global: g, contrats: watch?.contrats || [], clients: watch?.clients || [], ams: watch?.ams || [] });
  const survCols = [
    colText("Sévérité", (e: MntSurveillanceEvent) => <Badge tone={severityTone(e.severity)}>{SEVERITY_LABEL[e.severity] || e.severity}</Badge>, (e: MntSurveillanceEvent) => (e.severity === "high" ? 0 : e.severity === "medium" ? 1 : 2)),
    colText("Événement", (e: MntSurveillanceEvent) => (
      <div className="flex flex-col gap-0.5">
        <Badge tone="steel">{EVENT_TYPE_LABEL[e.type] || e.type}</Badge>
        <span className="text-[12px] text-muted">{e.message}</span>
      </div>
    ), (e: MntSurveillanceEvent) => e.type),
    colText("Client", (e: MntSurveillanceEvent) => e.client || "—", (e: MntSurveillanceEvent) => e.client || ""),
    colText("N° FP", (e: MntSurveillanceEvent) => <FpLink fp={e.fp || undefined} />),
    colText("AM", (e: MntSurveillanceEvent) => e.am || "—"),
    colText("", (e: MntSurveillanceEvent) => (
      <div className="flex items-center justify-end gap-1.5">
        <button type="button" className="btn-ghost !px-2 !py-1 text-xs" onClick={() => { const c = contratById[e.contratId]; if (c) { setCForm(toContratForm(c)); setViewC(c); } }}>Consulter</button>
        {/* S'abonner CIBLÉ à ce contrat. Masqué si abonnement global (déjà tout couvert). */}
        {!watch?.global && <Busy variant="ghost" label={isWatchedContrat(e.contratId) ? "Suivi ✓" : "Suivre"} okMsg={isWatchedContrat(e.contratId) ? "Désabonné" : "Abonné"} errMsg="Action refusée" fn={() => toggleWatchContrat(e.contratId)} />}
      </div>
    )),
  ];
  const RENOUV_LABEL: Record<string, string> = { critique: "Critique", proche: "Proche", a_venir: "À venir" };
  const renouvCols = [
    colText("Urgence", (r: MntRenouvellement) => <Badge tone={r.bucket === "critique" ? "clay" : r.bucket === "proche" ? "gold" : "steel"}>{RENOUV_LABEL[r.bucket]}</Badge>, (r: MntRenouvellement) => r.jours),
    colText("Client", (r: MntRenouvellement) => r.client || "—", (r: MntRenouvellement) => r.client || ""),
    colText("N° FP", (r: MntRenouvellement) => <FpLink fp={r.fp || undefined} />),
    colText("Fin", (r: MntRenouvellement) => frDate(r.dateFin)),
    colNum("Jours restants", (r: MntRenouvellement) => String(r.jours), (r: MntRenouvellement) => r.jours),
    colText("", (r: MntRenouvellement) => (canWrite ? <Busy variant="ghost" label="Demander le renouvellement" okMsg="Renouvellement soumis à approbation" errMsg="Soumission refusée" fn={() => submitMntDecision(r.id, "renouvellement_contrat")} /> : null)),
  ];
  // Rentabilité par contrat (Lot 4/7) : callable gouverné (coût CJM serveur, masqué sans droit rentabilité).
  // Chargé à l'ouverture du module ; « Recalculer » rafraîchit après édition.
  const [pnl, setPnl] = useState<{ rows: MntContratPnlRow[]; hasCost: boolean } | null>(null);
  useEffect(() => { if (!gate) return; mntContratPnl().then((r) => setPnl({ rows: r.rows, hasCost: r.hasCost })).catch(() => setPnl(null)); }, [gate]);
  const pnlCols = pnl ? [
    colText("Client", (r: MntContratPnlRow) => r.client || "—", (r: MntContratPnlRow) => r.client || ""),
    colText("N° FP", (r: MntContratPnlRow) => <FpLink fp={r.fp || undefined} />),
    colNum("Revenu engagé", (r: MntContratPnlRow) => money(r.revenue), (r: MntContratPnlRow) => r.revenue),
    colNum("Jours", (r: MntContratPnlRow) => String(r.jours), (r: MntContratPnlRow) => r.jours),
    ...(pnl.hasCost ? [
      colNum("Coût", (r: MntContratPnlRow) => money(r.cout || 0), (r: MntContratPnlRow) => r.cout || 0),
      colNum("Marge", (r: MntContratPnlRow) => (
        <span className={cx("tabnum", (r.marge || 0) < 0 ? "text-clay" : "text-emerald")}>
          {money(r.marge || 0)}
          {(r.missingCjm || 0) > 0 && <span className="text-gold" title={`${r.missingCjm} j d'intervention sans CJM connu — marge non fiable (coût sous-estimé)`}> ⚠</span>}
        </span>
      ), (r: MntContratPnlRow) => r.marge || 0),
      colNum("Marge %", (r: MntContratPnlRow) => (r.margePct == null ? "—" : pct(r.margePct)), (r: MntContratPnlRow) => r.margePct || 0),
    ] : []),
  ] : [];
  // Analyse de rétention IA (Lot 6/7) : contrats à risque (moteur existant) enrichis de stats tickets +
  // proximité d'échéance → l'IA rend motifs de churn + reco. Parité : on part de ce que l'écran affiche.
  const churnInput = useMemo<ChurnInput[]>(() => {
    const openByFp = new Map<string, number>();
    for (const t of tickets) {
      const k = fpKey(t.fp || ""); if (!k) continue;
      if (t.statut === "ouvert" || t.statut === "en_cours") openByFp.set(k, (openByFp.get(k) || 0) + 1);
    }
    const finJours = (fp?: string | null) => {
      const c = contrats.find((x) => fpKey(x.fp) === fpKey(fp || ""));
      if (!c?.dateFin) return null;
      const finMs = Date.parse(`${c.dateFin}T00:00:00Z`), asMs = Date.parse(`${asOfIso}T00:00:00Z`);
      return Number.isFinite(finMs) ? Math.round((finMs - asMs) / 86400000) : null;
    };
    return atRisk.map((r) => {
      const k = fpKey(r.fp || "") || "";
      // slaBreaches = r.slaRompus, la source UNIQUE déjà matérialisée par le moteur de risque back (parcourt
      // TOUS les engagements, repli prise_en_compte→résolution). On ne le RECALCULE pas côté front (le front
      // n'aurait vu que 'resolution' → divergence « même métrique = même nombre », audit m3).
      return { fp: r.fp || "", client: r.client || "", niveau: r.niveau, signals: (r.signals || []).map((s) => signalText(s)), joursEcheance: finJours(r.fp), ticketsOuverts: openByFp.get(k) || 0, slaBreaches: r.slaRompus || 0 };
    });
  }, [atRisk, tickets, contrats, asOfIso]);
  const [churn, setChurn] = useState<ChurnResult | null>(null);
  const CHURN_LABEL: Record<string, string> = { eleve: "Élevé", moyen: "Moyen", faible: "Faible" };
  const churnCols = [
    colText("Risque churn", (a: ChurnAnalysis) => <Badge tone={a.churnRisk === "eleve" ? "clay" : a.churnRisk === "moyen" ? "gold" : "steel"}>{CHURN_LABEL[a.churnRisk]}</Badge>, (a: ChurnAnalysis) => (a.churnRisk === "eleve" ? 0 : a.churnRisk === "moyen" ? 1 : 2)),
    colText("Client", (a: ChurnAnalysis) => a.client || "—", (a: ChurnAnalysis) => a.client || ""),
    colText("N° FP", (a: ChurnAnalysis) => <FpLink fp={a.fp} />),
    colText("Motifs", (a: ChurnAnalysis) => <div className="flex flex-wrap gap-1">{a.drivers.map((d, i) => <Badge key={i} tone="steel">{d}</Badge>)}</div>),
    colText("Reco de rétention", (a: ChurnAnalysis) => <span className="text-[12px]">{a.recommendation || "—"}</span>),
  ];

  // Registre d'audit (Lot 7/7 — conformité) : la piste opposable auditLog filtrée sur le module. Lecture
  // réservée au droit `habilitations` (rules). Index composite (module, ts desc) → 500 plus récentes.
  // La Table expose son export CSV natif (colsKey) → dossier de conformité prêt.
  const canAudit = useCan("habilitations") === "write";
  const { rows: audit } = useCollectionData<AuditLog>(gate && canAudit ? "auditLog" : null, [where("module", "==", "maintenance"), orderBy("ts", "desc"), limit(500)], "mnt_audit");
  const auditCols = [
    colText("Date", (r: AuditLog) => (r.ts?.seconds ? new Date(r.ts.seconds * 1000).toLocaleString("fr-FR") : "—"), (r: AuditLog) => r.ts?.seconds || 0),
    colText("Action", (r: AuditLog) => r.action || "—"),
    colText("Entité", (r: AuditLog) => r.entity || "—"),
    colText("Réf", (r: AuditLog) => r.entityId || "—"),
    colText("Détail", (r: AuditLog) => { const s = r.detail ? JSON.stringify(r.detail) : ""; return <span className="text-[11px] text-muted truncate max-w-[280px] inline-block align-bottom" title={s}>{s || "—"}</span>; }),
    colText("Par", (r: AuditLog) => <span className="text-[11px]" title={r.uid}>{(r.uid || "").slice(0, 8) || "—"}</span>),
  ];

  const openContrat = (id: string) => { const c = contratById[id]; if (!c) return; setCForm(toContratForm(c)); setCId(id); setCEdit(true); setCOpen(true); };
  const complianceCols = [
    colText("Client", (r: MntComplianceItem) => r.client || "—", (r: MntComplianceItem) => r.client || ""),
    colText("N° FP", (r: MntComplianceItem) => <FpLink fp={r.fp || undefined} />),
    colText("Manques", (r: MntComplianceItem) => <div className="flex flex-wrap gap-1">{r.issues.map((k) => <Badge key={k} tone={k === "echeance_depassee" ? "clay" : "gold"}>{MNT_COMPLIANCE_LABEL[k]}</Badge>)}</div>),
    colText("", (r: MntComplianceItem) => (canWrite ? <button type="button" className="btn-ghost !px-2.5 !py-1 text-xs" onClick={() => openContrat(r.id)}>Corriger</button> : null)),
  ];
  const atRiskCount = (counts.ambre || 0) + (counts.rouge || 0) + (counts.critique || 0);

  // Suggestions (Lot 7) — affaires du carnet ressemblant à de la maintenance et sans contrat. Le carnet
  // n'est lu que si l'on a le droit (gate) ; sinon liste vide. Chaque suggestion PRÉ-REMPLIT la fiche
  // contrat (aucune création automatique). Réutilise fpKey pour le rapprochement commande ↔ contrat.
  const { rows: commandes } = useCommandesRows(gate);
  const suggestions = useMemo(() => suggestMntContrats(commandes, contrats, fpKey), [commandes, contrats]);
  // Lot d'affaires SANS contrat soumis à l'IA (bornage aligné sur le plafond serveur). L'IA juge le FOND,
  // au-delà des seuls mots-clés — d'où un pool plus large que les suggestions heuristiques instantanées.
  const candidatePool = useMemo(() => mntCandidatePool(commandes, contrats, fpKey), [commandes, contrats]);
  const [aiSug, setAiSug] = useState<MntAiSuggestResult | null>(null);
  // Le carnet évolue (temps réel) : une analyse IA obsolète (affaire désormais sous contrat) doit disparaître.
  const aiRows = useMemo(() => {
    if (!aiSug) return [];
    const have = new Set(contrats.map((c) => fpKey(c.fp)).filter(Boolean));
    return aiSug.suggestions.filter((s) => !have.has(fpKey(s.fp)));
  }, [aiSug, contrats]);
  // Commande par FP CANONIQUE (première rencontrée — même ordre que les constructeurs de suggestions) :
  // source de la date de commande + du CAS pour pré-remplir un contrat. Échéance IA par FP (si suggérée).
  const orderByFp = useMemo(() => {
    const m = new Map<string, Order>();
    for (const o of commandes) { const k = fpKey(o.fp); if (k && !m.has(k)) m.set(k, o); }
    return m;
  }, [commandes]);
  type SugLike = { fp?: string; client?: string; bu?: string; am?: string; cas?: number; echeance?: string | null };
  const keyOf = (s: SugLike) => fpKey(s.fp || "") || "";
  // Brouillon pré-rempli (dateFin = date commande + 12 mois, montant = CAS…). Repli sur la suggestion si la
  // commande n'est plus en mémoire (le carnet vit) — les dates tombent alors sur le millésime / aujourd'hui.
  const draftFor = (s: SugLike) => {
    const o = orderByFp.get(keyOf(s));
    return buildContratDraft(o || { fp: s.fp, client: s.client, bu: s.bu, am: s.am, cas: s.cas }, asOfIso, s.echeance ?? undefined);
  };
  const prefill = (s: SugLike) => {
    const f = toContratForm(draftFor(s));
    // Le Select BU du formulaire n'accepte que BU_OPTS ; une BU hors liste retombe sur « AUTRE » (le serveur
    // cleanBu gère la valeur réelle à l'écriture). La création en masse, elle, écrit la BU brute nettoyée serveur.
    setCForm({ ...f, bu: BU_OPTS.includes(f.bu) ? f.bu : "AUTRE" });
    setCId(""); setCEdit(false); setCOpen(true);
  };

  // Sélection multiple (par FP canonique) → création EN MASSE. On boucle l'écriture GOUVERNÉE existante
  // (upsertMntContrat), tolérante par ligne — même patron que « appliquer en lot » du Centre de correction.
  const [sel, setSel] = useState<Set<string>>(new Set());
  const toggleSel = (k: string) => setSel((p) => { const n = new Set(p); n.has(k) ? n.delete(k) : n.add(k); return n; });
  const visibleKeys = (aiSug ? aiRows : suggestions).map(keyOf).filter(Boolean);
  const allSelected = visibleKeys.length > 0 && visibleKeys.every((k) => sel.has(k));
  const toggleAll = () => setSel(allSelected ? new Set() : new Set(visibleKeys));
  const bulkCreate = async () => {
    let ok = 0; const fails: string[] = [];
    for (const s of (aiSug ? aiRows : suggestions)) {
      const k = keyOf(s); if (!sel.has(k)) continue;
      try { await upsertMntContrat(draftFor(s)); ok++; } catch { fails.push(k); }
    }
    setSel(new Set());
    return { ok, fails: fails.length };
  };
  const selCol = <T extends SugLike>() => colText("", (s: T) => {
    const k = keyOf(s);
    return <input type="checkbox" className="accent-gold" checked={sel.has(k)} onChange={() => toggleSel(k)} aria-label={`Sélectionner ${s.fp || ""}`} />;
  });
  // Échéance dérivée (date commande + 12 mois), visible pour que rien ne soit « inventé » en silence.
  const echCol = <T extends SugLike>() => colText("Échéance", (s: T) => {
    const d = draftFor(s);
    return <span className="text-[12px] whitespace-nowrap" title={`Début ${frDate(d.dateDebut)}`}>{frDate(d.dateFin || undefined)}</span>;
  }, (s: T) => draftFor(s).dateFin || "");
  const createBtn = <T extends SugLike>() => colText("", (s: T) => (canWrite ? <button type="button" className="btn-ghost !px-2.5 !py-1 text-xs" onClick={() => prefill(s)}>Créer</button> : null));
  const suggestCols = [
    ...(canWrite ? [selCol<MntSuggestion>()] : []),
    colText("Client", (s: MntSuggestion) => s.client || "—", (s: MntSuggestion) => s.client || ""),
    colText("N° FP", (s: MntSuggestion) => <FpLink fp={s.fp} />),
    colText("Affaire", (s: MntSuggestion) => <span className="truncate max-w-[240px] inline-block align-bottom" title={s.affaire}>{s.affaire || "—"}</span>),
    colNum("Montant", (s: MntSuggestion) => money(s.cas), (s: MntSuggestion) => s.cas),
    echCol<MntSuggestion>(),
    colText("Signaux", (s: MntSuggestion) => <div className="flex flex-wrap gap-1">{s.reasons.slice(0, 4).map((r, i) => <Badge key={i} tone="steel">{r}</Badge>)}</div>),
    createBtn<MntSuggestion>(),
  ];
  // Confiance IA → ton (visuel aligné sur l'échelle de risque : forte = vert, moyenne = or, faible = argile).
  const confTone = (c: number) => (c >= 0.75 ? "emerald" : c >= 0.5 ? "gold" : "clay");
  const aiCols = [
    ...(canWrite ? [selCol<MntAiSuggestion>()] : []),
    colText("Client", (s: MntAiSuggestion) => s.client || "—", (s: MntAiSuggestion) => s.client || ""),
    colText("N° FP", (s: MntAiSuggestion) => <FpLink fp={s.fp} />),
    colText("Affaire", (s: MntAiSuggestion) => <span className="truncate max-w-[240px] inline-block align-bottom" title={s.affaire}>{s.affaire || "—"}</span>),
    colNum("Montant", (s: MntAiSuggestion) => money(s.cas), (s: MntAiSuggestion) => s.cas),
    echCol<MntAiSuggestion>(),
    colNum("Confiance", (s: MntAiSuggestion) => <Badge tone={confTone(s.confidence)}>{Math.round(s.confidence * 100)} %</Badge>, (s: MntAiSuggestion) => s.confidence),
    colText("Analyse", (s: MntAiSuggestion) => <span className="text-[12px] text-muted">{s.reason || "—"}</span>),
    createBtn<MntAiSuggestion>(),
  ];
  // Barre d'actions de sélection (montée quand ≥ 1 ligne cochée) — réutilisée par les deux tables.
  const bulkBar = canWrite ? (
    <div className="flex flex-wrap items-center gap-2 mb-2 text-[12px]">
      <label className="inline-flex items-center gap-1.5 cursor-pointer">
        <input type="checkbox" className="accent-gold" checked={allSelected} onChange={toggleAll} aria-label="Tout sélectionner" />
        <span className="text-muted">{sel.size > 0 ? `${sel.size} sélectionné(s)` : "Tout sélectionner"}</span>
      </label>
      {sel.size > 0 && <Busy variant="gold" label={`Créer ${sel.size} contrat(s)`} okMsg={(r: { ok: number; fails: number }) => `${r.ok} contrat(s) créé(s)${r.fails ? ` — ${r.fails} échec(s)` : ""}`} errMsg="Création refusée" fn={bulkCreate} />}
      {sel.size > 0 && <button type="button" className="btn-ghost !px-2 !py-1 text-xs" onClick={() => setSel(new Set())}>Effacer</button>}
    </div>
  ) : null;

  return (
    <div className="flex flex-col gap-4">
      {gate && (contrats.length > 0 || tickets.length > 0) && (
        <Card title="Tableau de bord">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Kpi label="Contrats actifs" value={`${dash.contratsActifs}/${dash.contratsTotal}`} tone="emerald" />
            <Kpi label="Montant engagé (actifs)" value={fmt(dash.montantEngageActifs)} tone="ink" />
            <Kpi label="Tickets ouverts" value={String(dash.ticketsOuverts)} tone={dash.ticketsOuverts > 0 ? "gold" : "ink"} />
            <Kpi label="Contrats à risque" value={String(atRiskCount)} tone={atRiskCount > 0 ? "clay" : "emerald"} />
          </div>
          <div className="mt-3 grid grid-cols-1 lg:grid-cols-3 gap-x-8 gap-y-3">
            <div>
              <div className="text-[11px] text-muted mb-1.5">Contrats par statut</div>
              <div className="flex flex-wrap gap-1.5">
                {STATUTS.filter((s) => (dash.parStatut[s] || 0) > 0).map((s) => (
                  <Badge key={s} tone={statutTone(s)}>{label(STATUT_LABEL, s)} · {dash.parStatut[s]}</Badge>
                ))}
                {dash.contratsTotal === 0 && <span className="text-[12px] text-muted">—</span>}
              </div>
            </div>
            <div>
              <div className="text-[11px] text-muted mb-1.5">Tickets ouverts par priorité</div>
              <div className="flex flex-wrap gap-1.5">
                {PRIORITES.filter((p) => (dash.parPriorite[p] || 0) > 0).map((p) => (
                  <Badge key={p} tone={prioriteTone(p)}>{label(PRIORITE_LABEL, p)} · {dash.parPriorite[p]}</Badge>
                ))}
                {dash.ticketsOuverts === 0 && <span className="text-[12px] text-muted">Aucun ticket ouvert.</span>}
              </div>
            </div>
            <div>
              <div className="text-[11px] text-muted mb-1.5">Échéances proches (≤ 60 j)</div>
              {dash.echeancesProches.length === 0 ? <span className="text-[12px] text-muted">Aucune échéance imminente.</span> : (
                <div className="flex flex-col gap-1 text-[12px]">
                  {dash.echeancesProches.slice(0, 5).map((e) => (
                    <div key={e.id} className="flex items-center justify-between gap-2">
                      <span className="truncate">{e.client || "—"} · <FpLink fp={e.fp || undefined} /></span>
                      <Badge tone={e.jours <= 15 ? "clay" : "gold"}>{frDate(e.dateFin)} · {e.jours} j</Badge>
                    </div>
                  ))}
                  {dash.echeancesProches.length > 5 && <span className="text-muted">+{dash.echeancesProches.length - 5} autre(s)</span>}
                </div>
              )}
            </div>
          </div>
        </Card>
      )}
      {/* Maintenance par type (ADR-025) — agrégé sur tout le parc : tickets ET interventions comptés
          SÉPARÉMENT par type. Vue d'ensemble (sans colonne Objectif — les objectifs sont par contrat,
          visibles en consultation). N'apparaît que si au moins un item est classé. */}
      {gate && MNT_TYPES.some((t) => typeStats.totalTickets[t] || typeStats.totalInterventions[t]) && (
        <Card title="Maintenance par type">
          <Tip>Nombre de <b>tickets</b> et d'<b>interventions</b> classés par type sur l'ensemble du parc — comptés <b>séparément</b>. Les <b>objectifs</b> (max visé) se fixent et se suivent <b>par contrat</b> (fiche en consultation). Les items non classés ne sont pas comptés.</Tip>
          <TypeStatsTable tickets={typeStats.totalTickets} interventions={typeStats.totalInterventions} />
        </Card>
      )}
      {/* Centre de surveillance (ADR-026) — flux d'événements clés (projection du risque) + abonnements
          ciblés. Proactivité : « Tout » = tout le parc, « Mes abonnements » = ce que je suis (contrat/parc). */}
      {gate && surv && (
        <Card title="Centre de surveillance"
          actions={(
            <div className="flex flex-wrap items-center gap-2">
              <Segmented value={survScope} onChange={setSurvScope} ariaLabel="Portée de la surveillance"
                options={[
                  { value: "tout", label: "Tout", count: survEvents.length },
                  { value: "abonnements", label: "Mes abonnements", count: survEvents.filter((e) => watchMatchesEvent(watch, e)).length },
                ]} />
              <Busy variant={watch?.global ? "gold" : "ghost"} label={watch?.global ? "Parc suivi ✓" : "Suivre tout le parc"}
                okMsg={watch?.global ? "Désabonné du parc" : "Abonné à tout le parc"} errMsg="Action refusée" fn={() => setWatchGlobal(!watch?.global)} />
            </div>
          )}>
          <Tip>Événements clés dérivés du <b>moteur de risque</b> (SLA rompus, renouvellements, quotas, sous-facturation), <b>les plus graves d'abord</b>. « <b>Suivre</b> » abonne à un contrat (ou tout le parc) : « <b>Mes abonnements</b> » ne montre alors que ce qui vous concerne. Diffusion <b>en direct</b>, sans e-mail.</Tip>
          <div className="grid grid-cols-3 gap-3 mb-3">
            <Kpi label="Urgent" value={String(survCounts.high || 0)} tone={survCounts.high ? "clay" : "ink"} />
            <Kpi label="À surveiller" value={String(survCounts.medium || 0)} tone={survCounts.medium ? "gold" : "ink"} />
            <Kpi label="Info" value={String(survCounts.low || 0)} tone="ink" />
          </div>
          {survRows.length === 0
            ? <EmptyState label={survScope === "abonnements" ? (watched ? "Aucun événement sur vos abonnements." : "Aucun abonnement — « Suivre » un contrat ou tout le parc pour un suivi ciblé.") : "Aucun événement — parc sous contrôle."} />
            : <Table columns={survCols} rows={survRows} colsKey="mnt_surveillance" rowKey={(e) => e.id} />}
        </Card>
      )}
      {risque && (
        <Card title="Risque des contrats">
          <Tip>Score matérialisé au dernier recalcul, à partir de 4 signaux : <b>SLA rompus</b>, <b>échéance proche</b>, <b>quota dépassé</b>, <b>sous-facturation</b>. Un contrat au repos reste Vert.</Tip>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
            <Kpi label="Critique" value={String(counts.critique || 0)} tone="plum" />
            <Kpi label="Rouge" value={String(counts.rouge || 0)} tone="clay" />
            <Kpi label="Ambre" value={String(counts.ambre || 0)} tone="gold" />
            <Kpi label="Vert" value={String(counts.vert || 0)} tone="emerald" />
          </div>
          {atRisk.length === 0 ? <EmptyState label="Aucun contrat à risque." /> : <Table columns={risqueCols} rows={atRisk} colsKey="mnt_risque" />}
        </Card>
      )}

      {gate && churnInput.length > 0 && (
        <Card title={churn ? `Analyse de rétention IA · ${churn.analyses.length}` : "Analyse de rétention IA"}
          actions={<Busy variant="gold" label={churn ? "Réanalyser" : "Analyser le churn (IA)"} okMsg="Analyse prête" errMsg="Analyse IA indisponible" fn={async () => setChurn(await aiAnalyzeChurn(churnInput))} />}>
          {!churn ? (
            <Tip>L'<b>IA</b> lit les <b>{churnInput.length}</b> contrat(s) à risque (moteur ci-dessus) + les stats tickets et rend, par contrat, les <b>motifs de non-renouvellement</b> et une <b>reco de rétention</b>. Elle ne re-score pas — elle explique et recommande.</Tip>
          ) : churn.analyses.length === 0 ? (
            <EmptyState label="L'IA n'a produit aucune analyse sur ce lot." />
          ) : (
            <Table columns={churnCols} rows={churn.analyses} colsKey="mnt_churn" />
          )}
        </Card>
      )}

      {gate && renouvellements.length > 0 && (
        <Card title={`Renouvellements à anticiper · ${renouvellements.length}`}>
          <Tip>Contrats <b>actifs</b> dont la fin approche (≤ 90 j) — <b>critique ≤ 30 j</b>. « Demander le renouvellement » soumet la décision au <b>circuit d'approbation</b> (comme depuis la fiche).</Tip>
          <Table columns={renouvCols} rows={renouvellements} colsKey="mnt_renouv" />
        </Card>
      )}

      {gate && agenda.length > 0 && (
        <Card title={`Calendrier SLA · ${agenda.length}`}>
          <Tip>Échéances SLA <b>en attente</b> des tickets ouverts (prise en compte / résolution), calculées <b>en direct</b> — <b>rompues d'abord</b>, puis les plus proches. Un ticket dont le contrat n'a pas l'engagement du type n'apparaît pas.</Tip>
          <Table columns={agendaCols} rows={agenda} colsKey="mnt_sla_agenda" />
        </Card>
      )}

      {gate && compliance.activeTotal > 0 && (
        <Card title="Conformité des contrats">
          <Tip>Contrôle des contrats <b>actifs</b> : un contrat en vigueur doit avoir un <b>engagement SLA</b>, une <b>date de fin</b> non dépassée et un <b>montant d'engagement</b>. « Corriger » ouvre la fiche.</Tip>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
            <Kpi label="Conformes" value={`${compliance.conformes}/${compliance.activeTotal}`} tone={compliance.items.length === 0 ? "emerald" : "gold"} />
            <Kpi label="Sans SLA" value={String(compliance.byIssue.sans_sla)} tone={compliance.byIssue.sans_sla ? "gold" : "ink"} />
            <Kpi label="Échéance manquante/dépassée" value={String(compliance.byIssue.sans_echeance + compliance.byIssue.echeance_depassee)} tone={compliance.byIssue.sans_echeance + compliance.byIssue.echeance_depassee ? "clay" : "ink"} />
            <Kpi label="Montant nul" value={String(compliance.byIssue.montant_nul)} tone={compliance.byIssue.montant_nul ? "gold" : "ink"} />
          </div>
          {compliance.items.length === 0 ? <EmptyState label="Tous les contrats actifs sont conformes." /> : <Table columns={complianceCols} rows={compliance.items} colsKey="mnt_conformite" />}
        </Card>
      )}

      {gate && pnl && pnl.rows.length > 0 && (
        <Card title="Rentabilité des contrats"
          actions={<Busy variant="ghost" label="Recalculer" okMsg="Rentabilité à jour" errMsg="Recalcul refusé" fn={async () => { const r = await mntContratPnl(); setPnl({ rows: r.rows, hasCost: r.hasCost }); }} />}>
          <Tip>Revenu <b>engagé à ce jour</b> (échéancier) vs <b>coût des interventions</b> (jours CRA × coût journalier du consultant). {pnl.hasCost ? <>Pires marges d'abord.</> : <b>Coût et marge masqués — droit « Rentabilité » requis.</b>}</Tip>
          <Table columns={pnlCols} rows={pnl.rows} colsKey="mnt_pnl" />
        </Card>
      )}

      {/* Statut automatique (ADR-027, révisé ADR-028) — PROPOSE seulement : « Analyser le parc » n'écrit rien,
          l'application est un geste humain (« Appliquer » à l'unité, « Appliquer les recommandés » en masse).
          « Rétablir » annule des statuts auto-appliqués par l'ancienne version (rétablissement d'incident). */}
      {canWrite && (contrats.length > 0 || !!statutRun) && (
        <Card title={statutRun ? `Statut automatique (IA) · ${statutRun.proposals.length} proposition(s)` : "Statut automatique (IA)"}
          actions={(
            <div className="flex flex-wrap items-center gap-2">
              {statutRun && statutRun.proposals.some((p) => p.recommended) && (
                <Busy variant="gold" label="Appliquer les recommandés"
                  okMsg={(n: number) => `${n} statut(s) appliqué(s)`} errMsg="Application refusée"
                  fn={async () => {
                    const rec = (statutRun.proposals || []).filter((p) => p.recommended);
                    // Garde-fou : application de MASSE → confirmation avec décompte (les propositions à réviser,
                    // dont « échéance dépassée → échu », ne sont PAS recommandées et restent à l'unité).
                    const ok = await askConfirm(`Appliquer ${rec.length} changement(s) de statut recommandé(s) ?`, { title: "Appliquer les recommandés", confirmLabel: "Appliquer" });
                    if (!ok) return 0;
                    for (const p of rec) await setMntContratStatut(p.id, p.proposed);
                    setStatutRun((r) => (r ? { ...r, proposals: r.proposals.filter((p) => !p.recommended) } : r));
                    return rec.length;
                  }} />
              )}
              <Busy variant="ghost" label="Analyser le parc" okMsg={(r: MntStatutRun) => `${r.proposals.length} proposition(s)`} errMsg="Analyse refusée" fn={() => runStatutAuto()} />
              <Busy variant="ghost" label="Rétablir (annuler l'auto)" okMsg={(r: { restored: number }) => `${r.restored} statut(s) rétabli(s) à leur valeur d'avant`} errMsg="Rétablissement refusé" fn={revertMntAutoStatut} />
            </div>
          )}>
          <Tip>Propose le statut juste de chaque contrat : transitions <b>mécaniques</b> (date de début atteinte → <b>actif</b>…) par règles, cas de <b>jugement</b> (dormant, réactivation) par l'<b>IA</b>. <b>Rien n'est appliqué automatiquement</b> — vous validez chaque proposition (« Appliquer »), ou en bloc les <b>recommandées</b> (confiance élevée). La transition <b>« échéance dépassée → échu » reste à réviser à l'unité</b> (jamais recommandée en masse) : un contrat reconduit peut garder une date de fin passée tout en restant actif.</Tip>
          {statutRun && (statutRun.proposals.length === 0
            ? <EmptyState label="Aucun changement de statut — le parc est cohérent." />
            : <Table columns={statutCols} rows={statutRun.proposals} colsKey="mnt_statut_ia" rowKey={(p) => p.id} />)}
        </Card>
      )}

      <Card title="Contrats de maintenance"
        actions={canWrite ? <button type="button" onClick={() => { setCForm(emptyContrat()); setCId(""); setCEdit(false); setCOpen(true); }} className="btn-ghost !px-2.5 !py-1 text-xs inline-flex items-center gap-1.5"><Plus size={14} /> Nouveau contrat</button> : undefined}>
        <Tip>Chaque contrat est adossé au <b>N° FP</b> de l'affaire. Le montant d'engagement est propre au contrat ; la facturation réelle reste celle de l'ERP.</Tip>
        {lc ? <div className="text-[13px] text-muted py-3">Chargement…</div> : contratsSorted.length === 0 ? <EmptyState label="Aucun contrat de maintenance." /> : <Table columns={contratCols} rows={contratsSorted} colsKey="mnt_contrats" rowKey={(c) => c.id || ""} bulk={contratBulk} />}
      </Card>

      {canWrite && <ImportContratsCard />}

      {canWrite && (suggestions.length > 0 || candidatePool.length > 0) && (
        <Card title={aiSug ? `Suggestions IA · ${aiRows.length}` : `Suggestions de contrats · ${suggestions.length}`}
          actions={candidatePool.length > 0 ? (
            <Busy variant="gold" label={aiSug ? "Réanalyser à l'IA" : "Doper à l'IA"}
              okMsg="Analyse IA prête" errMsg="Analyse IA indisponible"
              fn={async () => { const r = await aiSuggestMntContrats(candidatePool); setSel(new Set()); setAiSug(r); }} />
          ) : undefined}>
          {aiSug ? (
            <>
              <Tip>L'<b>IA</b> a jugé <b>{aiSug.analyzed}</b> affaire(s) sans contrat et retenu celles relevant d'une <b>prestation récurrente</b> (au-delà des seuls mots-clés), avec sa <b>confiance</b> et son analyse. Coche des lignes pour <b>créer en masse</b>, ou « Créer » pour ouvrir une fiche <b>pré-remplie</b> (échéance = date de commande + 12 mois). Rien n'est créé automatiquement.{aiSug.truncated ? ` Lot borné aux ${aiSug.analyzed} affaires les plus probables.` : ""}</Tip>
              {aiRows.length === 0 ? <EmptyState label="L'IA n'a retenu aucune affaire récurrente dans le carnet." /> : <>{bulkBar}<Table columns={aiCols} rows={aiRows} colsKey="mnt_suggest_ai" /></>}
            </>
          ) : (
            <>
              <Tip>Affaires du carnet de commandes qui <b>ressemblent à de la maintenance</b> (mots-clés sur la désignation) et n'ont <b>pas encore de contrat</b>. « <b>Doper à l'IA</b> » demande à Claude de juger le fond — il écarte les faux positifs et repère les affaires récurrentes sans mot-clé évident. Coche des lignes pour <b>créer en masse</b> (échéance = date de commande + 12 mois), ou « Créer » pour une fiche <b>pré-remplie</b>.</Tip>
              {suggestions.length === 0 ? <EmptyState label="Aucun signal par mots-clés — lancez l'analyse IA pour un jugement au fond." /> : <>{bulkBar}<Table columns={suggestCols} rows={suggestions} colsKey="mnt_suggest" /></>}
            </>
          )}
        </Card>
      )}

      <Card title="Tickets & interventions"
        actions={canWrite ? <button type="button" onClick={openNewTicket} disabled={contrats.length === 0} className={cx("btn-ghost !px-2.5 !py-1 text-xs inline-flex items-center gap-1.5", contrats.length === 0 && "opacity-50 cursor-not-allowed")}><Plus size={14} /> Nouveau ticket</button> : undefined}>
        <Tip>Un ticket est une demande sous contrat. Le temps saisi sur une <b>intervention</b> alimente le CRA (une seule vérité du temps).</Tip>
        {ticketsSorted.length === 0 ? <EmptyState label="Aucun ticket." /> : <Table columns={ticketCols} rows={ticketsSorted} colsKey="mnt_tickets" rowKey={(t) => t.id || ""} bulk={[]} />}
      </Card>

      {gate && canAudit && audit.length > 0 && (
        <Card title={`Registre d'audit · ${audit.length}${audit.length >= 500 ? "+" : ""}`}>
          <Tip>Traçabilité <b>opposable</b> des actions du module (contrats, tickets, interventions, décisions, imports) — la piste que chaque écriture gouvernée enregistre. Le bouton <b>CSV</b> exporte le registre pour un dossier de conformité.{audit.length >= 500 ? " Affichage borné aux 500 entrées les plus récentes." : ""}</Tip>
          <Table columns={auditCols} rows={audit} colsKey="mnt_audit" />
        </Card>
      )}

      {/* --- Fiche contrat --- */}
      {cOpen && (
        <Modal open={cOpen} onClose={() => setCOpen(false)} title={cEdit ? "Modifier le contrat" : "Nouveau contrat de maintenance"} size="md"
          actions={canWrite ? <Busy label="Enregistrer" variant={cValid ? "gold" : "ghost"} fn={async () => { if (!cValid) throw new Error("N° FP, client et date de début requis"); await upsertMntContrat(contratPayload(cForm)); setCOpen(false); }} okMsg="Contrat enregistré" errMsg="Enregistrement refusé" /> : undefined}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="N° FP (affaire)"><input className={cx("field", cEdit && "opacity-60")} value={cForm.fp} disabled={cEdit} placeholder="FP/2026/123" onChange={(e) => setC("fp", e.target.value)} /></Field>
            <Field label="Client"><input className="field" value={cForm.client} onChange={(e) => setC("client", e.target.value)} /></Field>
            <Field label="BU"><Select value={cForm.bu} onChange={(v) => setC("bu", v)} options={BU_OPTS.map((b) => ({ value: b, label: b }))} ariaLabel="BU" /></Field>
            <Field label="AM"><input className="field" value={cForm.am} onChange={(e) => setC("am", e.target.value)} /></Field>
            <Field label="Statut"><Select value={cForm.statut} onChange={(v) => setC("statut", v)} options={opt(STATUT_LABEL, STATUTS)} ariaLabel="Statut" /></Field>
            <Field label="Périodicité d'échéance"><Select value={cForm.echeanceType} onChange={(v) => setC("echeanceType", v)} options={opt(ECHEANCE_LABEL, ECHEANCES)} ariaLabel="Périodicité" /></Field>
            <Field label="Date de début"><DateField value={cForm.dateDebut} onChange={(v) => setC("dateDebut", v)} ariaLabel="Date de début" /></Field>
            <Field label="Date de fin (optionnelle)"><DateField value={cForm.dateFin} onChange={(v) => setC("dateFin", v)} ariaLabel="Date de fin" /></Field>
            <Field label="Montant engagé (FCFA)"><input className="field tabnum" inputMode="numeric" value={cForm.montantEngage} onChange={(e) => setC("montantEngage", digits(e.target.value))} placeholder="0" /></Field>
          </div>
          <div className="mt-4">
            <div className="flex items-center justify-between mb-2"><span className="text-[13px] font-medium">Engagements SLA</span>{canWrite && <button type="button" onClick={addEng} className="btn-ghost !px-2 !py-1 text-xs inline-flex items-center gap-1"><Plus size={13} /> Ajouter</button>}</div>
            {cForm.engagements.length === 0 ? <div className="text-[12px] text-muted">Aucun engagement.</div> : (
              <div className="flex flex-col gap-2">
                {cForm.engagements.map((e, i) => (
                  <div key={i} className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-2 items-end border border-line/60 rounded-lg p-2">
                    <Field label="Type"><Select value={e.type} onChange={(v) => setEng(i, "type", v)} options={opt(SLA_TYPE_LABEL, SLA_TYPES)} ariaLabel="Type SLA" /></Field>
                    <Field label="Couverture"><Select value={e.couverture} onChange={(v) => setEng(i, "couverture", v)} options={opt(COUVERTURE_LABEL, COUVERTURES)} ariaLabel="Couverture" /></Field>
                    <Field label="Seuil (h ouvrées)"><input className="field tabnum" inputMode="numeric" value={e.seuilHeures} onChange={(ev) => setEng(i, "seuilHeures", digits(ev.target.value))} /></Field>
                    <div className="flex items-end gap-1"><Field label="Quota (opt.)"><input className="field tabnum" inputMode="numeric" value={e.quota} onChange={(ev) => setEng(i, "quota", digits(ev.target.value))} /></Field>{canWrite && <button type="button" onClick={() => rmEng(i)} className="btn-ghost !px-2 !py-1 text-xs text-clay mb-0.5">Retirer</button>}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
          {/* Objectifs de maintenance par type (ADR-025) — nombre MAX visé par type (prédictive, corrective,
              évolutive, veille). Optionnel : un champ vide = pas d'objectif sur ce type. Confronté au nombre réel
              de tickets + interventions dans la consultation et le tableau de bord. */}
          <div className="mt-4 pt-3 border-t border-line/60">
            <div className="text-[13px] font-medium mb-2">Objectifs de maintenance <span className="text-[11px] text-muted font-normal">— nombre max visé par type (optionnel)</span></div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {TYPES_MAINTENANCE.map((t) => (
                <Field key={t} label={TYPE_MAINTENANCE_LABEL[t]}>
                  <input className="field tabnum" inputMode="numeric" value={cForm.objectifs[t] || ""} placeholder="—"
                    onChange={(e) => setC("objectifs", { ...cForm.objectifs, [t]: digits(e.target.value) })} />
                </Field>
              ))}
            </div>
          </div>
          <div className="mt-4 pt-3 border-t border-line/60">
            <div className="text-[13px] font-medium mb-2">Échéancier <span className="text-[11px] text-muted font-normal">— engagé (par échéance × {ech.periodsDue}) vs facturé (affaire)</span></div>
            <div className="flex flex-wrap gap-x-8 gap-y-1 text-[13px]">
              <div><div className="text-[11px] text-muted">Engagé à ce jour</div><div className="tabnum">{money(ech.engage)}</div></div>
              <div><div className="text-[11px] text-muted">Facturé (ERP)</div><div className="tabnum">{money(ech.facture)}</div></div>
              <div><div className="text-[11px] text-muted">Écart</div><div className={cx("tabnum", ech.ecart > 0 ? "text-clay" : "text-emerald")}>{money(ech.ecart)}{ech.ecart > 0 ? " (sous-facturé)" : ""}</div></div>
            </div>
            {plan.periods.length > 0 && (
              <div className="mt-3">
                <div className="text-[11px] text-muted mb-1.5">Détail des échéances <span className="text-faint">— {plan.periods.length} échéance(s) · statut par couverture cumulée du facturé</span></div>
                <div className="max-h-56 overflow-y-auto rounded-lg border border-line/60">
                  <table className="w-full text-[12px]">
                    <thead className="sticky top-0 bg-panel2 text-muted">
                      <tr className="text-left">
                        <th className="px-2 py-1 font-medium">#</th>
                        <th className="px-2 py-1 font-medium">Échéance</th>
                        <th className="px-2 py-1 font-medium text-right">Montant</th>
                        <th className="px-2 py-1 font-medium text-right">Cumul engagé</th>
                        <th className="px-2 py-1 font-medium">Statut</th>
                      </tr>
                    </thead>
                    <tbody>
                      {plan.periods.map((p) => (
                        <tr key={p.index} className="border-t border-line/40">
                          <td className="px-2 py-1 tabnum text-faint">{p.index}</td>
                          <td className="px-2 py-1 whitespace-nowrap">{frDate(p.dateEcheance || undefined)}</td>
                          <td className="px-2 py-1 tabnum text-right">{money(p.montant)}</td>
                          <td className="px-2 py-1 tabnum text-right text-muted">{money(p.cumulEngage)}</td>
                          <td className="px-2 py-1"><Badge tone={echeanceStatutTone(p.statut)}>{ECHEANCE_STATUT_LABEL[p.statut]}</Badge></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
          {cEdit && cId && canWrite && (
            <div className="mt-4 pt-3 border-t border-line/60">
              <div className="text-[13px] font-medium mb-2">Décisions <span className="text-[11px] text-muted font-normal">— soumises à validation hiérarchique (Approbations)</span></div>
              <div className="flex flex-wrap gap-2">
                <Busy label="Demander le renouvellement" variant="ghost" fn={() => submitMntDecision(cId, "renouvellement_contrat")} okMsg="Renouvellement soumis à approbation" errMsg="Soumission refusée" />
                <Busy label="Demander la résiliation" variant="ghost" fn={() => submitMntDecision(cId, "resiliation_contrat")} okMsg="Résiliation soumise à approbation" errMsg="Soumission refusée" />
              </div>
            </div>
          )}
        </Modal>
      )}

      {/* --- Fiche contrat — CONSULTATION (lecture seule, 360°) --- */}
      {viewC && (() => {
        const vc = viewC;
        const vfp = fpKey(vc.fp || "");
        const vcTickets = tickets.filter((t) => (t.contratId && t.contratId === vc.id) || (!!vfp && fpKey(t.fp || "") === vfp));
        const vcTicketIds = new Set(vcTickets.map((t) => t.id));
        const vcInterv = interventions.filter((i) => (i.contratId && i.contratId === vc.id) || (i.ticketId && vcTicketIds.has(i.ticketId)) || (!!vfp && fpKey(i.fp || "") === vfp));
        const vcHeures = vcInterv.reduce((s, i) => s + (Number(i.heures) || 0), 0);
        const vcPnl = pnl?.rows.find((r) => fpKey(r.fp || "") === vfp);
        const vcRisk = risqueItems.find((r) => fpKey(r.fp || "") === vfp);
        const openTk = vcTickets.filter((t) => t.statut === "ouvert" || t.statut === "en_cours").length;
        const resoEng = (vc.engagements || []).find((e) => e.type === "resolution"); // engagement de résolution → état SLA des tickets
        // Maintenance par type de CE contrat (ADR-025) : tickets/interventions comptés séparément, confrontés
        // aux objectifs (max) embarqués. Affiché si le contrat a une activité classée OU des objectifs posés.
        const vcType = typeStats.parContrat.find((p) => p.contratId === vc.id);
        return (
          <Modal open onClose={() => setViewC(null)} title="Contrat de maintenance — consultation" size="md"
            actions={canWrite ? <button type="button" className="btn-ghost !px-3 !py-1.5 text-sm" onClick={() => { setCId(vc.id || ""); setCEdit(true); setViewC(null); setCOpen(true); }}>Éditer</button> : undefined}>
            <div className="flex flex-col gap-4">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <div><div className="text-[11px] text-muted">Client</div><div className="font-display text-lg leading-tight">{vc.client || "—"}</div></div>
                <div><div className="text-[11px] text-muted">N° FP</div><div className="text-[15px]"><FpLink fp={vc.fp} /></div></div>
                <Badge tone={statutTone(vc.statut)}>{label(STATUT_LABEL, vc.statut)}</Badge>
                {vcRisk && vcRisk.niveau !== "vert" && <Badge tone={niveauTone(vcRisk.niveau)}>Risque {riskLabel(NIVEAU_LABEL, vcRisk.niveau)}</Badge>}
              </div>
              <div className="flex flex-wrap gap-x-8 gap-y-2 text-[13px] border-y border-line/60 py-3">
                <div><div className="text-[11px] text-muted">Montant engagé</div><div className="tabnum">{money(vc.montantEngage)}</div></div>
                <div><div className="text-[11px] text-muted">Période</div><div className="tabnum">{frDate(vc.dateDebut)} → {vc.dateFin ? frDate(vc.dateFin) : "—"}</div></div>
                <div><div className="text-[11px] text-muted">Périodicité</div><div>{label(ECHEANCE_LABEL, vc.echeanceType)}</div></div>
                <div><div className="text-[11px] text-muted">Tickets ouverts</div><div className={cx("tabnum", openTk > 0 && "text-gold")}>{openTk} <span className="text-faint">/ {vcTickets.length}</span></div></div>
              </div>
              {vcRisk && vcRisk.niveau !== "vert" && (vcRisk.signals || []).length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5"><span className="text-[12px] text-muted">Signaux de risque :</span>{vcRisk.signals.map((s, i) => <Badge key={i} tone="clay">{signalText(s)}</Badge>)}</div>
              )}
              <div>
                <div className="text-[13px] font-medium mb-1.5">Engagements SLA</div>
                {(vc.engagements || []).length === 0 ? <div className="text-[12px] text-muted">Aucun engagement SLA.</div> : (
                  <div className="flex flex-wrap gap-2">
                    {(vc.engagements || []).map((e, i) => (
                      <div key={i} className="rounded-lg border border-line/60 px-3 py-1.5 text-[12.5px]">
                        <div className="font-medium">{label(SLA_TYPE_LABEL, e.type)}</div>
                        <div className="text-muted text-[11.5px]">{label(COUVERTURE_LABEL, e.couverture)} · seuil {e.seuilHeures} h{e.quota != null ? ` · quota ${e.quota}` : ""}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              {vcType && (
                <div>
                  <div className="text-[13px] font-medium mb-1.5">Maintenance par type <span className="text-[11px] text-muted font-normal">— tickets et interventions vs objectifs (max)</span></div>
                  <TypeStatsTable tickets={vcType.tickets} interventions={vcType.interventions} objectifs={vcType.objectifs} />
                </div>
              )}
              <div>
                <div className="text-[13px] font-medium mb-1.5">Facturation récurrente <span className="text-[11px] text-muted font-normal">— engagé (échéances × montant) vs facturé (affaire)</span></div>
                <div className="flex flex-wrap gap-x-8 gap-y-1 text-[13px]">
                  <div><div className="text-[11px] text-muted">Engagé à ce jour</div><div className="tabnum">{money(ech.engage)}</div></div>
                  <div><div className="text-[11px] text-muted">Facturé (ERP)</div><div className="tabnum">{money(ech.facture)}</div></div>
                  <div><div className="text-[11px] text-muted">Écart</div><div className={cx("tabnum", ech.ecart > 0 ? "text-clay" : "text-emerald")}>{money(ech.ecart)}{ech.ecart > 0 ? " (sous-facturé)" : ""}</div></div>
                </div>
              </div>
              <div>
                <div className="text-[13px] font-medium mb-1.5">Tickets · {vcTickets.length}</div>
                {vcTickets.length === 0 ? <div className="text-[12px] text-muted">Aucun ticket sous ce contrat.</div> : (
                  <div className="max-h-52 overflow-y-auto rounded-lg border border-line/60">
                    <table className="w-full text-[12px]">
                      <thead className="sticky top-0 bg-panel2 text-muted"><tr className="text-left"><th className="px-2 py-1 font-medium">Titre</th><th className="px-2 py-1 font-medium">Priorité</th><th className="px-2 py-1 font-medium">Statut</th><th className="px-2 py-1 font-medium">SLA résolution</th></tr></thead>
                      <tbody>
                        {vcTickets.map((t) => {
                          const st = resoEng && t.ouvertLe ? slaState(resoEng, tsMillis(t.ouvertLe), t.resoluLe ? tsMillis(t.resoluLe) : null, nowMs) : null;
                          return (
                            <tr key={t.id} className="border-t border-line/40">
                              <td className="px-2 py-1">{t.titre || "—"}</td>
                              <td className="px-2 py-1"><Badge tone={prioriteTone(t.priorite)}>{label(PRIORITE_LABEL, t.priorite)}</Badge></td>
                              <td className="px-2 py-1"><Badge tone={ticketStatutTone(t.statut)}>{label(TICKET_STATUT_LABEL, t.statut)}</Badge></td>
                              <td className="px-2 py-1">{st ? <Badge tone={slaTone(st.state)}>{SLA_STATE_LABEL[st.state]}</Badge> : "—"}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
              <div className="flex flex-wrap gap-x-8 gap-y-2 text-[13px] border-t border-line/60 pt-3">
                <div><div className="text-[11px] text-muted">Interventions</div><div className="tabnum">{vcInterv.length} · {vcHeures} h</div></div>
                {vcPnl && <div><div className="text-[11px] text-muted">Revenu engagé</div><div className="tabnum">{money(vcPnl.revenue)}</div></div>}
                {vcPnl && vcPnl.marge != null && <div><div className="text-[11px] text-muted">Marge</div><div className={cx("tabnum", vcPnl.marge >= 0 ? "text-emerald" : "text-clay")}>{money(vcPnl.marge)}{vcPnl.margePct != null ? ` · ${pct(vcPnl.margePct)}` : ""}</div></div>}
              </div>
            </div>
          </Modal>
        );
      })()}

      {/* --- Fiche ticket + interventions --- */}
      {tOpen && (
        <Modal open={tOpen} onClose={() => setTOpen(false)} title={tForm.id ? "Ticket" : "Nouveau ticket"} size="md"
          actions={canWrite ? <Busy label="Enregistrer" variant={tValid ? "gold" : "ghost"} fn={async () => { if (!tValid) throw new Error("Contrat et titre requis"); const r = await upsertMntTicket(tForm); setTForm((f) => ({ ...f, id: r.id })); }} okMsg="Ticket enregistré" errMsg="Enregistrement refusé" /> : undefined}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Contrat"><Select value={tForm.contratId || ""} onChange={pickContrat} options={contrats.map((c) => ({ value: c.id!, label: `${c.client || "—"} · ${c.fp || ""}` }))} ariaLabel="Contrat" placeholder="Choisir un contrat…" /></Field>
            <Field label="Titre"><input className="field" value={tForm.titre || ""} onChange={(e) => setT("titre", e.target.value)} /></Field>
            <Field label="Priorité"><Select value={tForm.priorite || "moyenne"} onChange={(v) => setT("priorite", v)} options={opt(PRIORITE_LABEL, PRIORITES)} ariaLabel="Priorité" /></Field>
            <Field label="Statut"><Select value={tForm.statut || "ouvert"} onChange={(v) => setT("statut", v)} options={opt(TICKET_STATUT_LABEL, TICKET_STATUTS)} ariaLabel="Statut" /></Field>
            {/* Type de maintenance (ADR-025) — classe le ticket ; optionnel (« — » → non classé, ignoré des compteurs par type). */}
            <Field label="Type de maintenance"><Select value={tForm.typeMaintenance || ""} onChange={(v) => setT("typeMaintenance", v || null)} options={[{ value: "", label: "—" }, ...opt(TYPE_MAINTENANCE_LABEL, TYPES_MAINTENANCE)]} ariaLabel="Type de maintenance" /></Field>
          </div>

          <div className="mt-4 pt-3 border-t border-line/60">
            <div className="text-[13px] font-medium mb-2">Interventions{!tForm.id && <span className="text-[11px] text-muted font-normal"> — enregistrez le ticket pour saisir des interventions</span>}</div>
            {tForm.id && (
              <>
                {ticketInterventions.length > 0 && (
                  <div className="flex flex-col gap-1 mb-3">
                    {ticketInterventions.map((iv) => (
                      <div key={iv.id} className="flex items-center justify-between text-[13px] border border-line/60 rounded-lg px-2.5 py-1.5">
                        <span>{frDate(iv.date)} · <b>{consultantName[iv.consultantId || ""] || iv.consultantId}</b> · <span className="tabnum">{iv.heures} h</span>{iv.commentaire ? <span className="text-muted"> — {iv.commentaire}</span> : null}</span>
                        {canWrite && <DangerBtn label="Suppr." confirm="Supprimer cette intervention ?" fn={() => deleteMntIntervention(iv.id!)} okMsg="Intervention supprimée" errMsg="Suppression refusée" />}
                      </div>
                    ))}
                  </div>
                )}
                {canWrite && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-2 items-end border border-line/60 rounded-lg p-2">
                    <Field label="Consultant"><Select value={iForm.consultantId} onChange={(v) => setIForm((f) => ({ ...f, consultantId: v }))} options={consultants.map((c) => ({ value: c.id, label: c.name || c.id }))} ariaLabel="Consultant" placeholder="Choisir…" /></Field>
                    <Field label="Date"><DateField value={iForm.date} onChange={(v) => setIForm((f) => ({ ...f, date: v }))} ariaLabel="Date intervention" /></Field>
                    <Field label="Heures"><input className="field tabnum" inputMode="decimal" value={iForm.heures} onChange={(e) => setIForm((f) => ({ ...f, heures: decimals(e.target.value) }))} placeholder="0" /></Field>
                    {/* Type de maintenance (ADR-025) — classe l'intervention ; optionnel (défaut : celui du ticket, sinon non classé). */}
                    <Field label="Type de maintenance"><Select value={iForm.typeMaintenance} onChange={(v) => setIForm((f) => ({ ...f, typeMaintenance: v }))} options={[{ value: "", label: "—" }, ...opt(TYPE_MAINTENANCE_LABEL, TYPES_MAINTENANCE)]} ariaLabel="Type de maintenance intervention" /></Field>
                    <Busy label="Ajouter" variant={iValid ? "gold" : "ghost"} fn={async () => { if (!iValid) throw new Error("Consultant, date et heures requis"); await upsertMntIntervention({ ticketId: tForm.id, contratId: tForm.contratId, fp: tForm.fp, consultantId: iForm.consultantId, date: iForm.date, heures: Number(iForm.heures), commentaire: iForm.commentaire, typeMaintenance: iForm.typeMaintenance || null }); setIForm({ consultantId: "", date: "", heures: "", commentaire: "", typeMaintenance: "" }); }} okMsg="Intervention ajoutée" errMsg="Ajout refusé" />
                  </div>
                )}
              </>
            )}
          </div>
        </Modal>
      )}
      {confirmNode}
    </div>
  );
};
