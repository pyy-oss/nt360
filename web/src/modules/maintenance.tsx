// Module « Contrats de maintenance » (mnt_) — Lot 1 : liste + fiche des contrats adossés au N° FP,
// avec leurs engagements SLA embarqués. Tout est DERRIÈRE le drapeau config/mntFeature (App masque
// l'onglet si éteint) et gouverné par le droit RBAC `maintenance`. Réutilise les primitives design
// (Table/Modal/Busy/DangerBtn/Select/DateField/Badge), les écritures callable (writes) et les formats
// de l'ERP (montant FCFA entier via money, date JJ/MM/AAAA via frDate).
import { useMemo, useState, type FC } from "react";
import { Plus } from "lucide-react";
import { useCan } from "../lib/rbac";
import { useCollectionData } from "../lib/hooks";
import { Card, Tip, Badge, Busy, DangerBtn, Table, colText, colNum, money, EmptyState, Modal, cx } from "../design/components";
import { Select, DateField } from "../design/inputs";
import { frDate } from "../lib/format";
import { fmt } from "../design/tokens";
import { upsertMntContrat, deleteMntContrat } from "../lib/writes";
import type { MntContrat, MntEngagement } from "../types";
import {
  STATUTS, ECHEANCES, SLA_TYPES, COUVERTURES, STATUT_LABEL, ECHEANCE_LABEL, SLA_TYPE_LABEL, COUVERTURE_LABEL,
  statutTone, label,
} from "../lib/mntContrat";
import { FpLink } from "./_shared";
import type { Props } from "./_shared";

const BU_OPTS = ["ICT", "CLOUD", "FORMATION", "AUTRE"];
const opt = (map: Record<string, string>, vals: readonly string[]) => vals.map((v) => ({ value: v, label: map[v] || v }));

// Saisie brute d'un montant : on ne garde que les chiffres (FCFA entier, pas de subdivision).
const digits = (s: string) => s.replace(/[^\d]/g, "");

type FormEng = { type: string; couverture: string; seuilHeures: string; quota: string };
type FormState = {
  fp: string; client: string; bu: string; am: string; statut: string; echeanceType: string;
  dateDebut: string; dateFin: string; montantEngage: string; engagements: FormEng[];
};
const emptyForm = (): FormState => ({
  fp: "", client: "", bu: "AUTRE", am: "", statut: "brouillon", echeanceType: "mensuel",
  dateDebut: "", dateFin: "", montantEngage: "", engagements: [],
});
const toForm = (c: MntContrat): FormState => ({
  fp: c.fp || "", client: c.client || "", bu: c.bu || "AUTRE", am: c.am || "",
  statut: c.statut || "brouillon", echeanceType: c.echeanceType || "mensuel",
  dateDebut: c.dateDebut || "", dateFin: c.dateFin || "", montantEngage: String(c.montantEngage ?? ""),
  engagements: (c.engagements || []).map((e) => ({
    type: e.type, couverture: e.couverture, seuilHeures: String(e.seuilHeures ?? ""), quota: e.quota == null ? "" : String(e.quota),
  })),
});
// Payload envoyé au callable : le serveur valide et arrondit (source de vérité). On transmet des types
// bruts ; la validation métier reste côté domaine.
const toPayload = (f: FormState): MntContrat => ({
  fp: f.fp.trim(), client: f.client.trim(), bu: f.bu, am: f.am.trim(), statut: f.statut, echeanceType: f.echeanceType,
  dateDebut: f.dateDebut, dateFin: f.dateFin || null, montantEngage: Number(f.montantEngage || 0), deviseEngage: "XOF",
  engagements: f.engagements.map((e): MntEngagement => ({
    type: e.type, couverture: e.couverture, seuilHeures: Number(e.seuilHeures || 0), quota: e.quota === "" ? null : Number(e.quota),
  })),
});

const Field: FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <label className="flex flex-col gap-1"><span className="text-[11px] text-muted">{label}</span>{children}</label>
);

export const Maintenance: FC<Props> = () => {
  const canRead = useCan("maintenance");
  const canWrite = canRead === "write";
  const { rows, loading } = useCollectionData<MntContrat>(canRead !== "none" ? "mnt_contrats" : null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [editing, setEditing] = useState(false);

  const sorted = useMemo(
    () => [...rows].sort((a, b) => String(a.client || "").localeCompare(String(b.client || ""))),
    [rows],
  );
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => ({ ...f, [k]: v }));

  const openNew = () => { setForm(emptyForm()); setEditing(false); setOpen(true); };
  const openEdit = (c: MntContrat) => { setForm(toForm(c)); setEditing(true); setOpen(true); };
  const addEng = () => set("engagements", [...form.engagements, { type: "resolution", couverture: "ouvre_lun_ven", seuilHeures: "", quota: "" }]);
  const setEng = (i: number, k: keyof FormEng, v: string) => set("engagements", form.engagements.map((e, j) => (j === i ? { ...e, [k]: v } : e)));
  const rmEng = (i: number) => set("engagements", form.engagements.filter((_, j) => j !== i));

  const valid = form.fp.trim() && form.client.trim() && form.dateDebut;

  const actionCol = colText("", (c: MntContrat) => (
    <div className="flex items-center justify-end gap-1.5">
      <button type="button" className="btn-ghost !px-2 !py-1 text-xs" onClick={() => openEdit(c)}>{canWrite ? "Éditer" : "Voir"}</button>
      {canWrite && <DangerBtn label="Suppr." confirm={`Supprimer le contrat ${c.fp} ?`} fn={() => deleteMntContrat(c.id!)} okMsg="Contrat supprimé" errMsg="Suppression refusée" />}
    </div>
  ));
  const cols = [
    colText("Client", (c: MntContrat) => c.client || "—", (c: MntContrat) => c.client || ""),
    colText("N° FP", (c: MntContrat) => <FpLink fp={c.fp} />),
    colText("Statut", (c: MntContrat) => <Badge tone={statutTone(c.statut)}>{label(STATUT_LABEL, c.statut)}</Badge>),
    colText("Période", (c: MntContrat) => `${frDate(c.dateDebut)} → ${c.dateFin ? frDate(c.dateFin) : "—"}`),
    colText("Échéance", (c: MntContrat) => label(ECHEANCE_LABEL, c.echeanceType)),
    colNum("Engagé", (c: MntContrat) => money(c.montantEngage), (c: MntContrat) => c.montantEngage || 0),
    colNum("SLA", (c: MntContrat) => c.engagements?.length || 0),
    actionCol,
  ];

  return (
    <div className="flex flex-col gap-4">
      <Card
        title="Contrats de maintenance"
        actions={canWrite ? (
          <button type="button" onClick={openNew} className="btn-ghost !px-2.5 !py-1 text-xs inline-flex items-center gap-1.5"><Plus size={14} /> Nouveau contrat</button>
        ) : undefined}
      >
        <Tip>Chaque contrat est adossé au <b>N° FP</b> de l'affaire (une affaire = un contrat). Le
          montant d'engagement est propre au contrat ; la facturation réelle reste celle de l'ERP.</Tip>
        {loading ? <div className="text-[13px] text-muted py-3">Chargement…</div>
          : sorted.length === 0 ? <EmptyState label="Aucun contrat de maintenance." />
          : <Table columns={cols} rows={sorted} colsKey="mnt_contrats" />}
      </Card>

      {open && (
        <Modal open={open} onClose={() => setOpen(false)} title={editing ? "Modifier le contrat" : "Nouveau contrat de maintenance"} size="md"
          actions={canWrite ? (
            <Busy label="Enregistrer" variant={valid ? "gold" : "ghost"}
              fn={async () => { if (!valid) throw new Error("N° FP, client et date de début requis"); await upsertMntContrat(toPayload(form)); setOpen(false); }}
              okMsg="Contrat enregistré" errMsg="Enregistrement refusé" />
          ) : undefined}
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="N° FP (affaire)"><input className={cx("field", editing && "opacity-60")} value={form.fp} disabled={editing} placeholder="FP/2026/123" onChange={(e) => set("fp", e.target.value)} /></Field>
            <Field label="Client"><input className="field" value={form.client} onChange={(e) => set("client", e.target.value)} /></Field>
            <Field label="BU"><Select value={form.bu} onChange={(v) => set("bu", v)} options={BU_OPTS.map((b) => ({ value: b, label: b }))} ariaLabel="BU" /></Field>
            <Field label="AM"><input className="field" value={form.am} onChange={(e) => set("am", e.target.value)} /></Field>
            <Field label="Statut"><Select value={form.statut} onChange={(v) => set("statut", v)} options={opt(STATUT_LABEL, STATUTS)} ariaLabel="Statut" /></Field>
            <Field label="Périodicité d'échéance"><Select value={form.echeanceType} onChange={(v) => set("echeanceType", v)} options={opt(ECHEANCE_LABEL, ECHEANCES)} ariaLabel="Périodicité" /></Field>
            <Field label="Date de début"><DateField value={form.dateDebut} onChange={(v) => set("dateDebut", v)} ariaLabel="Date de début" /></Field>
            <Field label="Date de fin (optionnelle)"><DateField value={form.dateFin} onChange={(v) => set("dateFin", v)} ariaLabel="Date de fin" /></Field>
            <Field label="Montant engagé (FCFA)">
              <input className="field tabnum" inputMode="numeric" value={form.montantEngage ? fmt(Number(form.montantEngage)) : ""}
                onChange={(e) => set("montantEngage", digits(e.target.value))} placeholder="0" />
            </Field>
          </div>

          <div className="mt-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[13px] font-medium">Engagements SLA</span>
              {canWrite && <button type="button" onClick={addEng} className="btn-ghost !px-2 !py-1 text-xs inline-flex items-center gap-1"><Plus size={13} /> Ajouter</button>}
            </div>
            {form.engagements.length === 0 ? <div className="text-[12px] text-muted">Aucun engagement.</div> : (
              <div className="flex flex-col gap-2">
                {form.engagements.map((e, i) => (
                  <div key={i} className="grid grid-cols-2 sm:grid-cols-4 gap-2 items-end border border-line/60 rounded-lg p-2">
                    <Field label="Type"><Select value={e.type} onChange={(v) => setEng(i, "type", v)} options={opt(SLA_TYPE_LABEL, SLA_TYPES)} ariaLabel="Type SLA" /></Field>
                    <Field label="Couverture"><Select value={e.couverture} onChange={(v) => setEng(i, "couverture", v)} options={opt(COUVERTURE_LABEL, COUVERTURES)} ariaLabel="Couverture" /></Field>
                    <Field label="Seuil (h ouvrées)"><input className="field tabnum" inputMode="numeric" value={e.seuilHeures} onChange={(ev) => setEng(i, "seuilHeures", digits(ev.target.value))} /></Field>
                    <div className="flex items-end gap-1">
                      <Field label="Quota (opt.)"><input className="field tabnum" inputMode="numeric" value={e.quota} onChange={(ev) => setEng(i, "quota", digits(ev.target.value))} /></Field>
                      {canWrite && <button type="button" onClick={() => rmEng(i)} className="btn-ghost !px-2 !py-1 text-xs text-clay mb-0.5">Retirer</button>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
};
