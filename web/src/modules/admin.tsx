// 13 — Habilitations : matrice profil × module + attribution de rôle.
import { useState, type FC } from "react";
import { orderBy, limit } from "firebase/firestore";
import { useDocData, useCollectionData } from "../lib/hooks";
import { useCan } from "../lib/rbac";
import { Card, Table, Badge, Tip, Busy, colText, colNum, cx } from "../design/components";
import { updateMatrix, callSetUserRole, callDedupe, type DedupeResult } from "../lib/writes";
import { Props, DataImportCard, relTime } from "./_shared";
import type { PermissionsConfig, UserRow, OpsLog } from "../types";

export const Habilitations: FC<Props> = () => {
  const { data } = useDocData<PermissionsConfig>("config/permissions");
  const { rows: users } = useCollectionData<UserRow>("users");
  const canWrite = useCan("habilitations") === "write";
  const [draft, setDraft] = useState<Record<string, Record<string, string>> | null>(null);
  const matrix = draft || data?.matrix || {};
  const roles = Object.keys(matrix);
  // Union des modules sur TOUS les rôles (pas seulement le premier) pour ne rien masquer.
  const modules = [...new Set(roles.flatMap((r) => Object.keys(matrix[r] || {})))];
  const cyc: Record<string, string> = { none: "read", read: "write", write: "none" };
  const glyph: Record<string, string> = { write: "W", read: "R", none: "–" };
  const tone: Record<string, string> = { write: "bg-emerald text-bg", read: "bg-steel text-bg", none: "bg-panel2 text-muted" };
  const setCell = (r: string, m: string) => { const b = JSON.parse(JSON.stringify(matrix)); b[r][m] = cyc[b[r][m]] || "read"; setDraft(b); };
  return (
    <div className="flex flex-col gap-4">
      {canWrite && <DataImportCard />}
      {canWrite && <OpsHealthCard />}
      {canWrite && <DedupeCard />}
      <Card title="Matrice droits (profil × module)" actions={canWrite && draft ? <div className="flex gap-2"><Busy label="Enregistrer" fn={async () => { await updateMatrix(draft); setDraft(null); }} /><button className="btn-ghost" onClick={() => setDraft(null)}>Annuler</button></div> : undefined}>
        <div className="overflow-x-auto">
          <table className="text-xs">
            <thead><tr><th className="px-2 py-1 text-left text-muted">Module</th>{roles.map((r) => <th key={r} className="px-2 py-1 text-muted font-medium">{r}</th>)}</tr></thead>
            <tbody>
              {modules.map((m) => (
                <tr key={m}>
                  <td className="px-2 py-1">{m}</td>
                  {roles.map((r) => (
                    <td key={r} className="px-1 py-1 text-center">
                      <button disabled={!canWrite} aria-label={`Droit ${r} sur ${m} : ${matrix[r]?.[m] || "aucun"}`} title={`${r} · ${m} : ${matrix[r]?.[m] || "aucun"}`} onClick={() => canWrite && setCell(r, m)} className={cx("w-10 h-9 rounded font-semibold", tone[matrix[r]?.[m]] || "bg-panel2", canWrite && "hover:opacity-80")}>{glyph[matrix[r]?.[m]] ?? "–"}</button>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <Card title="Utilisateurs & rôles">
        <Table columns={[
          colText("Email", (u) => u.email), colText("Nom", (u) => u.name),
          colText("Actif", (u) => u.active ? <Badge tone="emerald">oui</Badge> : <Badge tone="clay">non</Badge>),
          ...(canWrite ? [colNum("Rôle", (u: UserRow) => <RoleSetter uid={u.id!} />)] : []),
        ]} rows={users} />
        <Tip>Le rôle est un custom claim posé via la Cloud Function setUserRole (auditée).</Tip>
      </Card>
    </div>
  );
};

// Exploitation : santé des recomputes (manuels + planifié quotidien) via le journal opsLog.
// Donne une visibilité durable sur les échecs d'agrégation (observabilité), au-delà des logs Cloud.
function OpsHealthCard() {
  const { rows } = useCollectionData<OpsLog>("opsLog", [orderBy("ts", "desc"), limit(8)], "ops8");
  const last = rows[0];
  const lastErr = rows.find((r) => r.status === "error");
  return (
    <Card title="Exploitation — santé des recalculs">
      <div className="flex flex-wrap items-center gap-2 text-[13px]">
        {last ? (
          <Badge tone={last.status === "ok" ? "emerald" : "clay"}>{last.status === "ok" ? "OK" : "ÉCHEC"}</Badge>
        ) : <span className="text-muted">Aucun recalcul journalisé pour l'instant.</span>}
        {last && <span className="text-muted">Dernier recalcul {relTime(last.ts)} ({last.trigger}{last.detail?.summaries ? ` · ${last.detail.summaries} agrégats` : ""}{last.ms ? ` · ${(last.ms / 1000).toFixed(1)} s` : ""}).</span>}
      </div>
      {lastErr && lastErr.status === "error" && last?.status !== "error" && (
        <div className="mt-1 text-[12px] text-clay">Dernier échec {relTime(lastErr.ts)} : {lastErr.error}</div>
      )}
      {last?.status === "error" && <div className="mt-1 text-[12px] text-clay">Motif : {last.error}</div>}
      {rows.length > 1 && (
        <details className="mt-2 text-[12px]">
          <summary className="cursor-pointer select-none text-faint hover:text-ink">Historique des recalculs</summary>
          <ul className="mt-1.5 flex flex-col gap-1">
            {rows.map((r) => (
              <li key={r.id} className="flex items-center gap-1.5 text-muted">
                <Badge tone={r.status === "ok" ? "emerald" : "clay"}>{r.status === "ok" ? "OK" : "KO"}</Badge>
                <span className="text-faint w-20 shrink-0">{relTime(r.ts)}</span>
                <span className="text-ink">{r.trigger}</span>
                <span className="text-faint">· {r.status === "ok" ? `${r.detail?.summaries || 0} agrégats · ${((r.ms || 0) / 1000).toFixed(1)} s` : (r.error || "").slice(0, 80)}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
      <Tip>Un recompute planifié tourne chaque jour à 05:00 (agrégats jamais datés). Les échecs sont tracés ici en plus des logs Cloud.</Tip>
    </Card>
  );
}

// Dédoublonnage (admin) : factures / opportunités / BC fournisseurs. Analyse d'abord (aperçu),
// puis suppression des doublons (le meilleur représentant de chaque groupe est conservé).
const DEDUPE_LABEL: Record<string, string> = { invoices: "Factures", opportunities: "Opportunités", bcLines: "BC fournisseurs" };
function DedupeCard() {
  const [res, setRes] = useState<DedupeResult | null>(null);
  const totalDup = res ? Object.values(res.result).reduce((s, r) => s + r.duplicates, 0) : 0;
  return (
    <Card title="Dédoublonnage" actions={
      <div className="flex gap-2">
        <Busy variant="ghost" label="Analyser" okMsg="Analyse terminée" errMsg="Analyse refusée" fn={async () => { setRes(await callDedupe(undefined, false)); }} />
        {res && totalDup > 0 && (
          <Busy label={`Supprimer ${totalDup} doublon${totalDup > 1 ? "s" : ""}`} okMsg="Doublons supprimés" errMsg="Suppression refusée" fn={async () => { setRes(await callDedupe(undefined, true)); }} />
        )}
      </div>
    }>
      {res ? (
        <div className="flex flex-col gap-2">
          <Table columns={[
            colText("Collection", (r: any) => DEDUPE_LABEL[r.col] || r.col),
            colNum("Total", (r: any) => r.total.toLocaleString("fr-FR")),
            colNum("Groupes en doublon", (r: any) => r.duplicateGroups),
            colNum("À supprimer", (r: any) => r.duplicates),
          ]} rows={Object.entries(res.result).map(([col, s]) => ({ col, ...s }))} />
          <Tip>{res.applied
            ? "Doublons supprimés — le meilleur enregistrement de chaque groupe (source figée, plus récent) est conservé ; agrégats recalculés."
            : totalDup > 0 ? `${totalDup.toLocaleString("fr-FR")} doublon(s) détecté(s) — cliquez « Supprimer » pour nettoyer.` : "Aucun doublon détecté."}</Tip>
        </div>
      ) : (
        <Tip>Analyse les factures, opportunités et BC fournisseurs (même clé métier ⇒ doublon), puis supprime les redondances en conservant le meilleur enregistrement.</Tip>
      )}
    </Card>
  );
}

function RoleSetter({ uid }: { uid: string }) {
  const [role, setRole] = useState("lecture");
  return (
    <span className="inline-flex gap-1.5">
      <select aria-label="Rôle de l'utilisateur" className="field !py-1" value={role} onChange={(e) => setRole(e.target.value)}>
        {["direction", "commercial_dir", "commercial", "pmo", "achats", "lecture"].map((r) => <option key={r}>{r}</option>)}
      </select>
      <Busy label="Poser" fn={() => callSetUserRole(uid, role)} />
    </span>
  );
}
