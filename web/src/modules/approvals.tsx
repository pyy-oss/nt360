// APPROBATIONS (Lot 4 « niveau Salesforce ») — processus d'approbation gouvernable : soumission d'une
// action sensible → décision par l'approbateur (manager du demandeur — hiérarchie Lot 2 — sinon
// direction) → traçabilité. Comble l'écart #4 de l'audit (aucun processus gouvernable). Trois volets :
// à décider par moi, mes demandes, et un formulaire de nouvelle demande. Accès par callable.
import { useState, useEffect, useCallback, type FC } from "react";
import { useCan } from "../lib/rbac";
import { Card, Tip, Badge, Busy, money } from "../design/components";
import { Select } from "../design/inputs";
import { listApprovals, submitForApproval, decideApproval, type Approval, type ApprovalKind } from "../lib/writes";
import type { Props } from "./_shared";

const KIND_META: Record<ApprovalKind, { label: string; entityType: "opportunity" | "bcLine" | "order" | "other" }> = {
  remise_opp: { label: "Remise / DR (opportunité)", entityType: "opportunity" },
  depassement_bc: { label: "Dépassement plafond (BC)", entityType: "bcLine" },
  commande_manuelle: { label: "Commande manuelle", entityType: "order" },
  autre: { label: "Autre", entityType: "other" },
};
const statusTone: Record<string, "gold" | "emerald" | "clay"> = { pending: "gold", approved: "emerald", rejected: "clay" };
const statusLabel: Record<string, string> = { pending: "en attente", approved: "approuvée", rejected: "rejetée" };

function ApprovalCard({ a, canDecide, onChange }: { a: Approval; canDecide: boolean; onChange: () => void }) {
  const [note, setNote] = useState("");
  return (
    <div className="flex flex-col gap-1.5 border-t border-hair py-2 text-[13px]">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={statusTone[a.status] || "steel"}>{statusLabel[a.status] || a.status}</Badge>
        <span className="font-medium">{KIND_META[a.kind]?.label || a.kind}</span>
        <span className="text-[11px] text-muted">{a.entityLabel || a.entityId}</span>
        {a.amount != null && <span className="tabnum text-[12px]">{money(a.amount)}</span>}
      </div>
      {a.note && <div className="text-[12px] text-muted break-words">« {a.note} »</div>}
      <div className="text-[11px] text-faint">Demandé par {a.requestedByName || a.requestedBy || "—"}{a.at ? ` · ${a.at}` : ""}{a.decisionNote ? ` · décision : ${a.decisionNote}` : ""}</div>
      {canDecide && a.status === "pending" && (
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <input className="field !py-1 w-56" aria-label="Note de décision" placeholder="Motif (optionnel)…" value={note} onChange={(e) => setNote(e.target.value)} />
          <Busy variant="ghost" label="Approuver" okMsg="Demande approuvée" errMsg="Refusé" fn={async () => { await decideApproval(a.id!, "approved", note); onChange(); }} />
          <Busy variant="ghost" label="Rejeter" okMsg="Demande rejetée" errMsg="Refusé" fn={async () => { await decideApproval(a.id!, "rejected", note); onChange(); }} />
        </div>
      )}
    </div>
  );
}

function NewApprovalForm({ onDone }: { onDone: () => void }) {
  const [kind, setKind] = useState<ApprovalKind>("remise_opp");
  const [entityId, setEntityId] = useState("");
  const [entityLabel, setEntityLabel] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  return (
    <div className="flex flex-wrap items-end gap-2 text-[13px]">
      <label className="flex flex-col gap-0.5"><span className="text-[11px] text-muted">Nature</span>
        <Select ariaLabel="Nature de la demande" className="!py-1 w-52" value={kind} onChange={(v) => setKind(v as ApprovalKind)}
          options={(Object.keys(KIND_META) as ApprovalKind[]).map((k) => ({ value: k, label: KIND_META[k].label }))} /></label>
      <label className="flex flex-col gap-0.5"><span className="text-[11px] text-muted">Réf. (FP / N° BC / id)</span>
        <input className="field !py-1 w-40" value={entityId} onChange={(e) => setEntityId(e.target.value)} aria-label="Identifiant de l'entité" placeholder="FP/2026/…" /></label>
      <label className="flex flex-col gap-0.5 grow"><span className="text-[11px] text-muted">Libellé</span>
        <input className="field !py-1 w-full" value={entityLabel} onChange={(e) => setEntityLabel(e.target.value)} aria-label="Libellé" placeholder="Client / objet…" /></label>
      <label className="flex flex-col gap-0.5"><span className="text-[11px] text-muted">Montant (XOF)</span>
        <input className="field !py-1 w-32" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} aria-label="Montant" /></label>
      <label className="flex flex-col gap-0.5 w-full"><span className="text-[11px] text-muted">Motif</span>
        <input className="field !py-1 w-full" value={note} onChange={(e) => setNote(e.target.value)} aria-label="Motif" /></label>
      <Busy variant="ghost" label="Soumettre" okMsg="Demande soumise à l'approbateur" errMsg="Soumission refusée"
        fn={async () => { if (!entityId.trim()) throw new Error("référence requise"); await submitForApproval({ kind, entityType: KIND_META[kind].entityType, entityId: entityId.trim(), entityLabel: entityLabel.trim(), amount: amount.trim() ? Number(amount) : null, note: note.trim() }); setEntityId(""); setEntityLabel(""); setAmount(""); setNote(""); onDone(); }} />
    </div>
  );
}

export const Approvals: FC<Props> = () => {
  const canWrite = useCan("pipeline") === "write";
  const [toDecide, setToDecide] = useState<Approval[]>([]);
  const [mine, setMine] = useState<Approval[]>([]);
  const [loading, setLoading] = useState(true);
  // Pagination : « Mes demandes » s'accumule dans le temps → fenêtre étendue par « Voir plus ».
  const [mineLimit, setMineLimit] = useState(15);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [td, mn] = await Promise.all([listApprovals("toDecide"), listApprovals("mine")]);
      setToDecide(td.approvals); setMine(mn.approvals);
    } catch { setToDecide([]); setMine([]); } finally { setLoading(false); }
  }, []);
  useEffect(() => { load().catch(() => {}); }, [load]);
  return (
    <div className="flex flex-col gap-4">
      <Card title={`À décider${toDecide.length ? ` · ${toDecide.length}` : ""}`}>
        {loading ? <div className="text-[13px] text-muted py-2">Chargement…</div>
          : toDecide.length ? <div>{toDecide.map((a) => <ApprovalCard key={a.id} a={a} canDecide={canWrite} onChange={load} />)}</div>
          : <Tip>Aucune demande en attente de votre décision. Les demandes vous sont routées quand vous êtes le <b>manager</b> du demandeur (hiérarchie), ou à la direction à défaut.</Tip>}
      </Card>
      {canWrite && (
        <Card title="Nouvelle demande d'approbation">
          <NewApprovalForm onDone={load} />
          <Tip>Soumettez une remise/DR, un dépassement de plafond BC ou une commande manuelle. La demande est routée vers votre <b>manager</b> (ou la direction) et tracée (journal d'audit).</Tip>
        </Card>
      )}
      <Card title={`Mes demandes${mine.length ? ` · ${mine.length}` : ""}`}>
        {loading ? <div className="text-[13px] text-muted py-2">Chargement…</div>
          : mine.length ? (
            <div className="flex flex-col">
              <div>{mine.slice(0, mineLimit).map((a) => <ApprovalCard key={a.id} a={a} canDecide={false} onChange={load} />)}</div>
              {mine.length > mineLimit && (
                <button onClick={() => setMineLimit((l) => l + 15)} className="mt-2 btn-ghost !py-1.5 text-xs self-center">
                  Voir plus · {mine.length - mineLimit} restant{mine.length - mineLimit > 1 ? "s" : ""}
                </button>
              )}
            </div>
          )
          : <div className="text-[13px] text-muted py-2">Aucune demande soumise.</div>}
      </Card>
    </div>
  );
};
