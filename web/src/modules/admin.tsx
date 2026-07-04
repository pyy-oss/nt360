// 13 — Habilitations : matrice profil × module + attribution de rôle.
import { useState, type FC } from "react";
import { orderBy, limit } from "firebase/firestore";
import { useDocData, useCollectionData } from "../lib/hooks";
import { useCan } from "../lib/rbac";
import { Card, Table, Badge, Tip, Busy, colText, colNum, cx } from "../design/components";
import { updateMatrix, callSetUserRole, callDedupe, callSetAlertThresholds, callSetNotificationConfig, type DedupeResult, type AlertThresholds, type NotificationConfig } from "../lib/writes";
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
      {canWrite && <AlertThresholdsCard />}
      {canWrite && <NotificationCard />}
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

// Exploitation : santé des FONCTIONS (recomputes + callables + tâches planifiées) via opsLog.
// Visibilité durable sur les échecs inattendus (observabilité), au-delà des logs Cloud.
function OpsHealthCard() {
  const { rows } = useCollectionData<OpsLog>("opsLog", [orderBy("ts", "desc"), limit(12)], "ops12");
  const last = rows[0];
  const errs = rows.filter((r) => r.status === "error");
  const label = (r?: OpsLog) => r?.action || r?.trigger || r?.kind || "—";
  return (
    <Card title="Exploitation — santé des fonctions">
      <div className="flex flex-wrap items-center gap-2 text-[13px]">
        {last ? (
          <Badge tone={last.status === "ok" ? "emerald" : "clay"}>{last.status === "ok" ? "OK" : "ÉCHEC"}</Badge>
        ) : <span className="text-muted">Aucune opération journalisée pour l'instant.</span>}
        {last && <span className="text-muted">Dernier : {label(last)} {relTime(last.ts)}{last.detail?.summaries ? ` · ${last.detail.summaries} agrégats` : ""}{last.ms ? ` · ${(last.ms / 1000).toFixed(1)} s` : ""}.</span>}
        {errs.length > 0 && <Badge tone="clay">{errs.length} échec(s) récent(s)</Badge>}
      </div>
      {last?.status === "error" && <div className="mt-1 text-[12px] text-clay">Motif : {last.error}</div>}
      {last?.status !== "error" && errs[0] && (
        <div className="mt-1 text-[12px] text-clay">Dernier échec — {label(errs[0])} {relTime(errs[0].ts)} : {errs[0].error}</div>
      )}
      {rows.length > 1 && (
        <details className="mt-2 text-[12px]">
          <summary className="cursor-pointer select-none text-faint hover:text-ink">Historique des opérations</summary>
          <ul className="mt-1.5 flex flex-col gap-1">
            {rows.map((r) => (
              <li key={r.id} className="flex items-center gap-1.5 text-muted">
                <Badge tone={r.status === "ok" ? "emerald" : "clay"}>{r.status === "ok" ? "OK" : "KO"}</Badge>
                <span className="text-faint w-20 shrink-0">{relTime(r.ts)}</span>
                <span className="text-ink">{label(r)}</span>
                <span className="text-faint truncate">· {r.status === "ok" ? `${r.detail?.summaries ? `${r.detail.summaries} agrégats · ` : ""}${((r.ms || 0) / 1000).toFixed(1)} s` : (r.error || "").slice(0, 90)}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
      <Tip>Recompute planifié chaque jour à 05:00. Les échecs INATTENDUS des fonctions (callables & tâches planifiées) sont tracés ici et, si un webhook est configuré, poussés en alerte.</Tip>
    </Card>
  );
}

// Seuils d'alerte configurables (config/alerts) : pilotent le Centre d'alertes & la Qualité des
// données. Enregistrer recalcule immédiatement côté serveur.
const DEFAULT_THR: AlertThresholds = { concentration: 0.30, surfacturationPct: 0.005, rafEcartPct: 0.10, dormantYears: 2 };
function AlertThresholdsCard() {
  const { data, loading } = useDocData<AlertThresholds>("config/alerts");
  if (loading && !data) return null;
  return <AlertThresholdsForm key={JSON.stringify(data || {})} initial={{ ...DEFAULT_THR, ...(data || {}) }} />;
}
function ThrField({ label, hint, value, onChange }: { label: string; hint: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="flex flex-col gap-1 text-[13px]">
      <span className="text-ink font-medium">{label}</span>
      <input className="field !py-1" inputMode="decimal" value={value} onChange={(e) => onChange(e.target.value)} aria-label={label} />
      <span className="text-[11px] text-faint">{hint}</span>
    </label>
  );
}
function AlertThresholdsForm({ initial }: { initial: AlertThresholds }) {
  const p1 = (v: number) => String(+(v * 100).toFixed(2));
  const [conc, setConc] = useState(p1(initial.concentration));
  const [surf, setSurf] = useState(p1(initial.surfacturationPct));
  const [raf, setRaf] = useState(p1(initial.rafEcartPct));
  const [yrs, setYrs] = useState(String(initial.dormantYears));
  const num = (s: string) => Number(String(s).replace(",", "."));
  return (
    <Card title="Seuils d'alerte" actions={<Busy label="Enregistrer" okMsg="Seuils appliqués (recalcul lancé)" fn={() => callSetAlertThresholds({
      concentration: num(conc) / 100, surfacturationPct: num(surf) / 100, rafEcartPct: num(raf) / 100, dormantYears: Math.trunc(num(yrs)),
    })} />}>
      <div className="grid gap-3 sm:grid-cols-2">
        <ThrField label="Concentration client (%)" hint="Alerte si un client dépasse cette part du CAS" value={conc} onChange={setConc} />
        <ThrField label="Surfacturation (%)" hint="Σ factures > CAS de plus de ce %" value={surf} onChange={setSurf} />
        <ThrField label="Écart RAF (%)" hint="RAF s'écarte de (CAS − Facturé) de plus de ce %" value={raf} onChange={setRaf} />
        <ThrField label="Backlog dormant (ans)" hint="Commande ouverte d'un millésime ≤ exercice − N" value={yrs} onChange={setYrs} />
      </div>
      <Tip>Pilotent le Centre d'alertes et la Qualité des données. L'enregistrement recalcule immédiatement.</Tip>
    </Card>
  );
}

// Notifications d'alerte (config/notifications) : pousse les alertes ≥ seuil vers un webhook
// entrant Slack/Teams (digest quotidien 07:00). L'URL n'est visible que des habilitations.
function NotificationCard() {
  const { data, loading } = useDocData<NotificationConfig & { lastSentAt?: any }>("config/notifications");
  if (loading && !data) return null;
  return <NotificationForm key={JSON.stringify({ e: data?.enabled, s: data?.minSeverity, u: data?.webhookUrl })}
    initial={{ enabled: !!data?.enabled, minSeverity: data?.minSeverity === "medium" ? "medium" : "high", webhookUrl: data?.webhookUrl || "" }} />;
}
function NotificationForm({ initial }: { initial: NotificationConfig }) {
  const [enabled, setEnabled] = useState(initial.enabled);
  const [sev, setSev] = useState<"high" | "medium">(initial.minSeverity);
  const [url, setUrl] = useState(initial.webhookUrl);
  const save = (test: boolean) => callSetNotificationConfig({ enabled, minSeverity: sev, webhookUrl: url, test });
  return (
    <Card title="Notifications d'alerte" actions={
      <div className="flex gap-2">
        <Busy variant="ghost" label="Tester" okMsg="Ping envoyé au webhook" errMsg="Échec du test" fn={() => save(true)} />
        <Busy label="Enregistrer" okMsg="Notifications enregistrées" fn={() => save(false)} />
      </div>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex items-center gap-2 text-[13px] text-ink">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} aria-label="Activer les notifications" />
          Activer le digest quotidien (07:00)
        </label>
        <label className="flex flex-col gap-1 text-[13px]">
          <span className="text-ink font-medium">Sévérité minimale</span>
          <select className="field !py-1" value={sev} onChange={(e) => setSev(e.target.value as "high" | "medium")} aria-label="Sévérité minimale">
            <option value="high">Critiques seulement (high)</option>
            <option value="medium">Moyennes et critiques</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[13px] sm:col-span-2">
          <span className="text-ink font-medium">URL du webhook (Slack / Teams)</span>
          <input className="field !py-1" type="url" placeholder="https://hooks.slack.com/…" value={url} onChange={(e) => setUrl(e.target.value)} aria-label="URL du webhook" />
        </label>
      </div>
      <Tip>Un webhook entrant Slack/Teams reçoit un message quand l'ensemble des alertes change. L'URL n'est lisible que par les habilitations. « Tester » envoie un ping immédiat.</Tip>
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
