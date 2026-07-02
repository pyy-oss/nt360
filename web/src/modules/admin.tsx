// 13 — Habilitations : matrice profil × module + attribution de rôle.
import { useState, type FC } from "react";
import { useDocData, useCollectionData } from "../lib/hooks";
import { useCan } from "../lib/rbac";
import { Card, Table, Badge, Tip, Busy, colText, colNum, cx } from "../design/components";
import { updateMatrix, callSetUserRole } from "../lib/writes";
import { Props } from "./_shared";
import type { PermissionsConfig, UserRow } from "../types";

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
