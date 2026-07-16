// Module « Contrats de maintenance » (mnt_). Lot 1 : contrats + engagements SLA. Lot 2 : tickets
// (demandes sous contrat) + interventions (temps consultant, qui alimente le CRA). Tout est DERRIÈRE
// le drapeau config/mntFeature (App masque l'onglet si éteint) et gouverné par le droit `maintenance`.
// Réutilise les primitives design, les écritures callable et les formats de l'ERP (FCFA entier via
// money, date JJ/MM/AAAA via frDate). Aucune valeur en dur (tokens/tons via lib/mntContrat).
import { useEffect, useMemo, useState, type FC, type ReactNode } from "react";
import { Plus } from "lucide-react";
import { where } from "firebase/firestore";
import { useCan } from "../lib/rbac";
import { useCollectionData, useDocData } from "../lib/hooks";
import { Card, Tip, Badge, Busy, DangerBtn, Table, colText, colNum, Kpi, money, EmptyState, Modal, cx } from "../design/components";
import { Select, DateField } from "../design/inputs";
import { fmt } from "../design/tokens";
import { frDate, tsMillis } from "../lib/format";
import { fpKey } from "../lib/ids";
import { slaState, slaTone, SLA_STATE_LABEL, echeancier, echeancierPlan, ECHEANCE_STATUT_LABEL, echeanceStatutTone } from "../lib/mntSla";
import type { Invoice, Order } from "../types";
import {
  upsertMntContrat, deleteMntContrat, upsertMntTicket, deleteMntTicket, upsertMntIntervention, deleteMntIntervention, listConsultants, submitMntDecision,
  importMntContrats, type MntImportResult, aiSuggestMntContrats, type MntAiSuggestion, type MntAiSuggestResult,
} from "../lib/writes";
import type { MntContrat, MntEngagement, MntTicket, MntIntervention } from "../types";
import {
  STATUTS, ECHEANCES, SLA_TYPES, COUVERTURES, STATUT_LABEL, ECHEANCE_LABEL, SLA_TYPE_LABEL, COUVERTURE_LABEL,
  TICKET_STATUTS, PRIORITES, TICKET_STATUT_LABEL, PRIORITE_LABEL, statutTone, ticketStatutTone, prioriteTone, label,
} from "../lib/mntContrat";
import { NIVEAU_LABEL, niveauTone, signalText, label as riskLabel, type RisqueSummary, type RisqueItem } from "../lib/mntRisque";
import { computeMntDashboard, slaAgenda, mntCompliance, type SlaAgendaItem, type MntComplianceItem } from "../lib/mntDashboard";
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
type CForm = { fp: string; client: string; bu: string; am: string; statut: string; echeanceType: string; dateDebut: string; dateFin: string; montantEngage: string; engagements: { type: string; couverture: string; seuilHeures: string; quota: string }[] };
const emptyContrat = (): CForm => ({ fp: "", client: "", bu: "AUTRE", am: "", statut: "brouillon", echeanceType: "mensuel", dateDebut: "", dateFin: "", montantEngage: "", engagements: [] });
const toContratForm = (c: MntContrat): CForm => ({
  fp: c.fp || "", client: c.client || "", bu: c.bu || "AUTRE", am: c.am || "", statut: c.statut || "brouillon", echeanceType: c.echeanceType || "mensuel",
  dateDebut: c.dateDebut || "", dateFin: c.dateFin || "", montantEngage: String(c.montantEngage ?? ""),
  engagements: (c.engagements || []).map((e) => ({ type: e.type, couverture: e.couverture, seuilHeures: String(e.seuilHeures ?? ""), quota: e.quota == null ? "" : String(e.quota) })),
});
const contratPayload = (f: CForm): MntContrat => ({
  fp: f.fp.trim(), client: f.client.trim(), bu: f.bu, am: f.am.trim(), statut: f.statut, echeanceType: f.echeanceType,
  dateDebut: f.dateDebut, dateFin: f.dateFin || null, montantEngage: Number(f.montantEngage || 0), deviseEngage: "XOF",
  engagements: f.engagements.map((e): MntEngagement => ({ type: e.type, couverture: e.couverture, seuilHeures: Number(e.seuilHeures || 0), quota: e.quota === "" ? null : Number(e.quota) })),
});

export const Maintenance: FC<Props> = () => {
  const canRead = useCan("maintenance");
  const canWrite = canRead === "write";
  const gate = canRead !== "none";
  const { rows: contrats, loading: lc } = useCollectionData<MntContrat>(gate ? "mnt_contrats" : null);
  const { rows: tickets } = useCollectionData<MntTicket>(gate ? "mnt_tickets" : null);
  const { rows: interventions } = useCollectionData<MntIntervention>(gate ? "mnt_interventions" : null);
  // Scores de risque MATÉRIALISÉS par le recompute (summaries/mnt_risque, ADR-003) — une seule vérité
  // du score. Le doc est gaté (drapeau + droit maintenance) côté rules ; on ne le lit que si `gate`.
  const { data: risque } = useDocData<RisqueSummary>(gate ? "summaries/mnt_risque" : null);
  // Consultants pour la saisie d'intervention (collection consultants = callable-only → listConsultants).
  const [consultants, setConsultants] = useState<{ id: string; name?: string }[]>([]);
  useEffect(() => { if (!gate) return; listConsultants().then((r) => setConsultants((r.rows || []).filter((c) => c.id).map((c) => ({ id: c.id!, name: c.name || undefined })))).catch(() => setConsultants([])); }, [gate]);
  const consultantName = useMemo(() => Object.fromEntries(consultants.map((c) => [c.id, c.name || c.id])), [consultants]);

  // --- Contrats ---
  const [cOpen, setCOpen] = useState(false);
  const [cForm, setCForm] = useState<CForm>(emptyContrat);
  const [cEdit, setCEdit] = useState(false);
  const [cId, setCId] = useState(""); // id du contrat édité (pour les décisions renouvellement/résiliation)
  const setC = <K extends keyof CForm>(k: K, v: CForm[K]) => setCForm((f) => ({ ...f, [k]: v }));
  const contratsSorted = useMemo(() => [...contrats].sort((a, b) => String(a.client || "").localeCompare(String(b.client || ""))), [contrats]);
  const cValid = cForm.fp.trim() && cForm.client.trim() && cForm.dateDebut;
  const addEng = () => setC("engagements", [...cForm.engagements, { type: "resolution", couverture: "ouvre_lun_ven", seuilHeures: "", quota: "" }]);
  const setEng = (i: number, k: string, v: string) => setC("engagements", cForm.engagements.map((e, j) => (j === i ? { ...e, [k]: v } : e)));
  const rmEng = (i: number) => setC("engagements", cForm.engagements.filter((_, j) => j !== i));
  // Échéancier du contrat ouvert : factures de l'affaire (par N° FP canonique) → engagé vs facturé.
  // Lecture bornée par la requête (where fp==) ; nécessite le droit `facturation` (sinon écart neutre).
  const openFp = cOpen && cForm.fp ? fpKey(cForm.fp) : "";
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
  const [iForm, setIForm] = useState<{ consultantId: string; date: string; heures: string; commentaire: string }>({ consultantId: "", date: "", heures: "", commentaire: "" });
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
        <button type="button" className="btn-ghost !px-2 !py-1 text-xs" onClick={() => { setCForm(toContratForm(c)); setCId(c.id || ""); setCEdit(true); setCOpen(true); }}>{canWrite ? "Éditer" : "Voir"}</button>
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

      <Card title="Contrats de maintenance"
        actions={canWrite ? <button type="button" onClick={() => { setCForm(emptyContrat()); setCId(""); setCEdit(false); setCOpen(true); }} className="btn-ghost !px-2.5 !py-1 text-xs inline-flex items-center gap-1.5"><Plus size={14} /> Nouveau contrat</button> : undefined}>
        <Tip>Chaque contrat est adossé au <b>N° FP</b> de l'affaire. Le montant d'engagement est propre au contrat ; la facturation réelle reste celle de l'ERP.</Tip>
        {lc ? <div className="text-[13px] text-muted py-3">Chargement…</div> : contratsSorted.length === 0 ? <EmptyState label="Aucun contrat de maintenance." /> : <Table columns={contratCols} rows={contratsSorted} colsKey="mnt_contrats" />}
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
        {ticketsSorted.length === 0 ? <EmptyState label="Aucun ticket." /> : <Table columns={ticketCols} rows={ticketsSorted} colsKey="mnt_tickets" />}
      </Card>

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

      {/* --- Fiche ticket + interventions --- */}
      {tOpen && (
        <Modal open={tOpen} onClose={() => setTOpen(false)} title={tForm.id ? "Ticket" : "Nouveau ticket"} size="md"
          actions={canWrite ? <Busy label="Enregistrer" variant={tValid ? "gold" : "ghost"} fn={async () => { if (!tValid) throw new Error("Contrat et titre requis"); const r = await upsertMntTicket(tForm); setTForm((f) => ({ ...f, id: r.id })); }} okMsg="Ticket enregistré" errMsg="Enregistrement refusé" /> : undefined}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Contrat"><Select value={tForm.contratId || ""} onChange={pickContrat} options={contrats.map((c) => ({ value: c.id!, label: `${c.client || "—"} · ${c.fp || ""}` }))} ariaLabel="Contrat" placeholder="Choisir un contrat…" /></Field>
            <Field label="Titre"><input className="field" value={tForm.titre || ""} onChange={(e) => setT("titre", e.target.value)} /></Field>
            <Field label="Priorité"><Select value={tForm.priorite || "moyenne"} onChange={(v) => setT("priorite", v)} options={opt(PRIORITE_LABEL, PRIORITES)} ariaLabel="Priorité" /></Field>
            <Field label="Statut"><Select value={tForm.statut || "ouvert"} onChange={(v) => setT("statut", v)} options={opt(TICKET_STATUT_LABEL, TICKET_STATUTS)} ariaLabel="Statut" /></Field>
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
                    <Busy label="Ajouter" variant={iValid ? "gold" : "ghost"} fn={async () => { if (!iValid) throw new Error("Consultant, date et heures requis"); await upsertMntIntervention({ ticketId: tForm.id, contratId: tForm.contratId, fp: tForm.fp, consultantId: iForm.consultantId, date: iForm.date, heures: Number(iForm.heures), commentaire: iForm.commentaire }); setIForm({ consultantId: "", date: "", heures: "", commentaire: "" }); }} okMsg="Intervention ajoutée" errMsg="Ajout refusé" />
                  </div>
                )}
              </>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
};
