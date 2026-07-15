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
import { frDate, tsMillis } from "../lib/format";
import { fpKey } from "../lib/ids";
import { slaState, slaTone, SLA_STATE_LABEL, echeancier } from "../lib/mntSla";
import type { Invoice } from "../types";
import {
  upsertMntContrat, deleteMntContrat, upsertMntTicket, deleteMntTicket, upsertMntIntervention, deleteMntIntervention, listConsultants, submitMntDecision,
} from "../lib/writes";
import type { MntContrat, MntEngagement, MntTicket, MntIntervention } from "../types";
import {
  STATUTS, ECHEANCES, SLA_TYPES, COUVERTURES, STATUT_LABEL, ECHEANCE_LABEL, SLA_TYPE_LABEL, COUVERTURE_LABEL,
  TICKET_STATUTS, PRIORITES, TICKET_STATUT_LABEL, PRIORITE_LABEL, statutTone, ticketStatutTone, prioriteTone, label,
} from "../lib/mntContrat";
import { NIVEAU_LABEL, niveauTone, signalText, label as riskLabel, type RisqueSummary, type RisqueItem } from "../lib/mntRisque";
import { FpLink } from "./_shared";
import type { Props } from "./_shared";

const BU_OPTS = ["ICT", "CLOUD", "FORMATION", "AUTRE"];
const opt = (map: Record<string, string>, vals: readonly string[]) => vals.map((v) => ({ value: v, label: map[v] || v }));
const digits = (s: string) => s.replace(/[^\d]/g, "");
const decimals = (s: string) => s.replace(/[^\d.,]/g, "").replace(",", ".");

const Field: FC<{ label: string; children: ReactNode }> = ({ label, children }) => (
  <label className="flex flex-col gap-1"><span className="text-[11px] text-muted">{label}</span>{children}</label>
);

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

  // --- Tickets ---
  const [tOpen, setTOpen] = useState(false);
  const [tForm, setTForm] = useState<MntTicket>({ statut: "ouvert", priorite: "moyenne" });
  const setT = <K extends keyof MntTicket>(k: K, v: MntTicket[K]) => setTForm((f) => ({ ...f, [k]: v }));
  const ticketsSorted = useMemo(() => [...tickets].sort((a, b) => String(a.client || "").localeCompare(String(b.client || ""))), [tickets]);
  const contratById = useMemo(() => Object.fromEntries(contrats.map((c) => [c.id!, c])), [contrats]);
  const nowMs = Date.now();
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

  return (
    <div className="flex flex-col gap-4">
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

      <Card title="Contrats de maintenance"
        actions={canWrite ? <button type="button" onClick={() => { setCForm(emptyContrat()); setCId(""); setCEdit(false); setCOpen(true); }} className="btn-ghost !px-2.5 !py-1 text-xs inline-flex items-center gap-1.5"><Plus size={14} /> Nouveau contrat</button> : undefined}>
        <Tip>Chaque contrat est adossé au <b>N° FP</b> de l'affaire. Le montant d'engagement est propre au contrat ; la facturation réelle reste celle de l'ERP.</Tip>
        {lc ? <div className="text-[13px] text-muted py-3">Chargement…</div> : contratsSorted.length === 0 ? <EmptyState label="Aucun contrat de maintenance." /> : <Table columns={contratCols} rows={contratsSorted} colsKey="mnt_contrats" />}
      </Card>

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
                  <div key={i} className="grid grid-cols-2 sm:grid-cols-4 gap-2 items-end border border-line/60 rounded-lg p-2">
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
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 items-end border border-line/60 rounded-lg p-2">
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
