// Écran « Astreintes » — sous la section EXÉCUTION (ADR-037). Une astreinte (on-call) est imputée en charge
// sur une AFFAIRE (N° FP) et éventuellement un contrat : elle pèse donc à la fois sur la rentabilité de
// livraison ET sur celle des contrats — sa place est transverse, en Exécution, pas dans le seul module
// Contrats. Déplacement PRÉSENTATIONNEL : mêmes callables (listAstreintes/submitAstreinte, gouvernés droit
// `maintenance` + drapeau mntFeature côté backend) — on ne change QUE l'emplacement de l'écran, pas qui y
// accède. Réutilise les primitives et formats de l'ERP (money FCFA, frDate JJ/MM/AAAA).
import { useEffect, useState, type FC, type ReactNode } from "react";
import { Plus } from "lucide-react";
import { httpsCallable } from "firebase/functions";
import { functions } from "../lib/firebase";
import { useCan } from "../lib/rbac";
import { useCollectionData, useDocData } from "../lib/hooks";
import { Card, Tip, Badge, Busy, Table, colText, colNum, money, EmptyState, Modal } from "../design/components";
import { Select, DateField } from "../design/inputs";
import { frDate } from "../lib/format";
import { isMntEnabled, type MntFeature } from "../lib/mntFeature";
import type { MntContrat } from "../types";
import { FpLink, type Props } from "./_shared";

const callFn = <T,>(name: string, payload: unknown) => httpsCallable(functions, name)(payload).then((r) => r.data as T);
const digits = (s: string) => s.replace(/[^\d]/g, "");
const Field: FC<{ label: string; children: ReactNode }> = ({ label, children }) => (
  <label className="flex flex-col gap-1"><span className="text-[12px] text-muted">{label}</span>{children}</label>
);

type AstreinteRow = { id: string; fp: string | null; contratId: string | null; consultantId: string | null; dateDebut: string | null; dateFin: string | null; motif: string; statut: string; requestedByName: string | null; approvalId: string | null; montant: number | null };
const ASTREINTE_STATUT_LABEL: Record<string, string> = { en_attente: "En attente", validee: "Validée", rejetee: "Rejetée" };
const astreinteTone = (s?: string): "emerald" | "clay" | "gold" => (s === "validee" ? "emerald" : s === "rejetee" ? "clay" : "gold");

// Carte Astreintes — demande + validation (approbation hiérarchique) + comptabilisation en charge. Le
// montant (charge) est CONFIDENTIEL : masqué côté backend sans le droit `rentabilite` (hasCost).
const AstreintesCard: FC<{ gate: boolean; canWrite: boolean; contrats: MntContrat[] }> = ({ gate, canWrite, contrats }) => {
  const [rows, setRows] = useState<AstreinteRow[] | null>(null);
  const [hasCost, setHasCost] = useState(false);
  const [open, setOpen] = useState(false);
  const empty = { fp: "", contratId: "", dateDebut: "", dateFin: "", montant: "", motif: "" };
  const [form, setForm] = useState(empty);
  const setF = (k: keyof typeof empty, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const load = () => callFn<{ rows: AstreinteRow[]; hasCost: boolean }>("listAstreintes", {}).then((r) => { setRows(r.rows || []); setHasCost(!!r.hasCost); }).catch(() => setRows([]));
  useEffect(() => { if (gate) load(); }, [gate]);
  const cols = [
    colText("N° FP", (r: AstreinteRow) => <FpLink fp={r.fp || undefined} />),
    colText("Période", (r: AstreinteRow) => (r.dateDebut ? `${frDate(r.dateDebut)} → ${frDate(r.dateFin || "")}` : "—")),
    colText("Motif", (r: AstreinteRow) => r.motif || "—", (r: AstreinteRow) => r.motif || ""),
    ...(hasCost ? [colNum("Charge", (r: AstreinteRow) => money(r.montant || 0), (r: AstreinteRow) => r.montant || 0)] : []),
    colText("Statut", (r: AstreinteRow) => <Badge tone={astreinteTone(r.statut)}>{ASTREINTE_STATUT_LABEL[r.statut] || r.statut}</Badge>, (r: AstreinteRow) => r.statut),
  ];
  return (
    <Card title={`Astreintes${rows && rows.length ? ` · ${rows.length}` : ""}`}
      actions={canWrite ? <button type="button" className="btn-gold !px-2.5 !py-1.5 text-xs inline-flex items-center gap-1" onClick={() => { setForm(empty); setOpen(true); }}><Plus size={14} /> Demander une astreinte</button> : undefined}>
      <Tip>Astreinte (on-call) imputée <b>en charge</b> sur une affaire (N° FP) et éventuellement un contrat. Cycle : <b>demande → validation</b> (approbation hiérarchique) → <b>comptabilisation</b>. Seules les astreintes <b>validées</b> pèsent dans la rentabilité (contrat & livraison). {hasCost ? null : <b>Montant masqué — droit « Rentabilité » requis.</b>}</Tip>
      {rows == null ? <div className="text-[13px] text-muted py-3">Chargement…</div>
        : rows.length === 0 ? <EmptyState label="Aucune astreinte — « Demander une astreinte » pour en enregistrer une." />
          : <Table columns={cols} rows={rows} colsKey="mnt_astreintes" />}
      {canWrite && (
        <Modal open={open} onClose={() => setOpen(false)} title="Demander une astreinte" size="form"
          actions={<Busy label="Soumettre" okMsg="Astreinte soumise à approbation" errMsg="Soumission refusée"
            fn={async () => { await callFn("submitAstreinte", { fp: form.fp, contratId: form.contratId || undefined, dateDebut: form.dateDebut, dateFin: form.dateFin, montant: Number(form.montant) || 0, motif: form.motif }); setOpen(false); load(); }} />}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="N° FP (affaire)"><input className="field" data-autofocus value={form.fp} placeholder="FP/2026/123" onChange={(e) => setF("fp", e.target.value)} /></Field>
            <Field label="Contrat (optionnel)"><Select value={form.contratId} onChange={(v) => setF("contratId", v)} options={[{ value: "", label: "— aucun —" }, ...contrats.filter((c) => c.id).map((c) => ({ value: c.id!, label: `${c.client || ""} · ${c.fp || ""}`.trim() }))]} ariaLabel="Contrat rattaché" placeholder="— aucun —" /></Field>
            <Field label="Début"><DateField value={form.dateDebut} onChange={(v) => setF("dateDebut", v)} ariaLabel="Date de début" /></Field>
            <Field label="Fin"><DateField value={form.dateFin} onChange={(v) => setF("dateFin", v)} ariaLabel="Date de fin" /></Field>
            <Field label="Montant (charge, FCFA)"><input className="field tabnum" inputMode="numeric" value={form.montant} placeholder="0" onChange={(e) => setF("montant", digits(e.target.value))} /></Field>
            <Field label="Motif"><input className="field" value={form.motif} placeholder="Astreinte week-end…" onChange={(e) => setF("motif", e.target.value)} /></Field>
          </div>
        </Modal>
      )}
    </Card>
  );
};

// Écran Astreintes (section Exécution). Gate identique au module Contrats : droit `maintenance` + drapeau
// mntFeature (l'entrée de nav est déjà doublement masquée ; garde défensive ici pour un accès direct).
export const Astreintes: FC<Props> = () => {
  const canRead = useCan("maintenance");
  const { data: mntFeature } = useDocData<MntFeature>("config/mntFeature");
  const gate = canRead !== "none" && isMntEnabled(mntFeature);
  const canWrite = canRead === "write";
  const { rows: contrats } = useCollectionData<MntContrat>(gate ? "mnt_contrats" : null);
  if (!gate) return <EmptyState label="Module indisponible — activation requise (Habilitations)." />;
  return (
    <div className="flex flex-col gap-4">
      <AstreintesCard gate={gate} canWrite={canWrite} contrats={contrats} />
    </div>
  );
};
