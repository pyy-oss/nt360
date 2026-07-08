// 13 — Habilitations : matrice profil × module + attribution de rôle.
import { useState, type FC } from "react";
import { orderBy, limit } from "firebase/firestore";
import { useDocData, useCollectionData } from "../lib/hooks";
import { useCan, useClaims, useCanImport } from "../lib/rbac";
import { Card, Table, Badge, Tip, Busy, DangerBtn, Toggle, colText, colNum, cx, useToast } from "../design/components";
import { Select } from "../design/inputs";
import { updateMatrix, callSetUserRole, callCreateUser, callAttachUser, callSetUserActive, callDedupe, callSetAlertThresholds, callSetNotificationConfig, callSetProjectionConfig, setClientAliases, setFxRates, setRefList, setClickupConfig, listClickupMembers, syncClickupCaf, syncFromClickup, pushAllOrdersToClickup, reconcileClickupLinks, clickupHealth, pushAllBcToClickup, reconcileBcLinks, importBcFromClickup, syncBcFromClickup, setupClickupWebhook, deleteClickupWebhook, enrichClickup, callSetManager, callSetRecordAccess, callSetSecurityConfig, callReindexVisibility, type RecordAccess, type DedupeResult, type AlertThresholds, type NotificationConfig, type ProjectionConfigInput } from "../lib/writes";
import { Props, DataImportCard, relTime } from "./_shared";
import type { PermissionsConfig, UserRow, OpsLog, ErrorLog, ClientAliasConfig, ClickupHealthSummary } from "../types";

// Les 6 profils opposables (source : functions/domain/authz.js ROLES / web/src/lib/rbac Role).
const ROLE_LIST = ["direction", "commercial_dir", "commercial", "pmo", "achats", "assistante", "lecture"];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const Habilitations: FC<Props> = () => {
  const { data } = useDocData<PermissionsConfig>("config/permissions");
  const { rows: users } = useCollectionData<UserRow>("users");
  const canWrite = useCan("habilitations") === "write"; // lecture des cartes d'observabilité (opsLog/errorLog)
  const canImport = useCanImport(); // DataImportCard appelle importDelta (module « import »)
  // La plupart des actions Habilitations (matrice, comptes, rôles, configs, dédoublonnage, alias) sont
  // gouvernées DIRECTION-ONLY côté serveur → on masque leurs contrôles pour tout autre rôle (sinon
  // boutons visibles qui échouent). Cohérent avec le durcissement de setPermissions.
  const isDirection = useClaims().role === "direction";
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
      {canImport && <DataImportCard />}
      <MfaEnrollCard />
      {isDirection && <SecurityCard users={users} />}
      {canWrite && <OpsHealthCard />}
      {canWrite && <ClientErrorsCard />}
      {isDirection && <ProjectionConfigCard />}
      {isDirection && <AlertThresholdsCard />}
      {isDirection && <NotificationCard />}
      {isDirection && <DedupeCard />}
      {isDirection && <ClientAliasCard />}
      {isDirection && <FxRatesCard />}
      {isDirection && <RefListCard kind="projectManagers" title="Référentiel — Project Managers" placeholder="Nom du PM" clickupImport tip="Liste des Project Managers proposée à l'affectation des commandes (écran Commandes). Pour une assignation ClickUp fiable, utilisez « Importer depuis ClickUp » (noms exacts) puis retirez les non-PM. L'auto-complétion combine ce référentiel et les PM déjà affectés." />}
      {isDirection && <RefListCard kind="businessUnits" title="Référentiel — Business Units (BU)" placeholder="ICT" upper tip="Liste des BU proposée dans les sélecteurs (filtre transverse, saisie d'opportunité/commande, objectifs). Les valeurs sont normalisées en MAJUSCULES. Sans référentiel, les BU par défaut (ICT, CLOUD, FORMATION, AUTRE) s'appliquent." />}
      {isDirection && <ClickupCard />}
      <Card title="Matrice droits (profil × module)" actions={isDirection && draft ? <div className="flex gap-2"><Busy label="Enregistrer" fn={async () => { await updateMatrix(draft); setDraft(null); }} /><button className="btn-ghost" onClick={() => setDraft(null)}>Annuler</button></div> : undefined}>
        <div className="overflow-x-auto">
          <table className="text-xs">
            <thead><tr><th className="px-2 py-1 text-left text-muted">Module</th>{roles.map((r) => <th key={r} className="px-2 py-1 text-muted font-medium">{r}</th>)}</tr></thead>
            <tbody>
              {modules.map((m) => (
                <tr key={m}>
                  <td className="px-2 py-1">{m}</td>
                  {roles.map((r) => (
                    <td key={r} className="px-1 py-1 text-center">
                      <button disabled={!isDirection} aria-label={`Droit ${r} sur ${m} : ${matrix[r]?.[m] || "aucun"}`} title={`${r} · ${m} : ${matrix[r]?.[m] || "aucun"}`} onClick={() => isDirection && setCell(r, m)} className={cx("w-10 h-9 rounded font-semibold", tone[matrix[r]?.[m]] || "bg-panel2", isDirection && "hover:opacity-80")}>{glyph[matrix[r]?.[m]] ?? "–"}</button>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      {isDirection && <CreateUserCard />}
      <Card title="Utilisateurs & rôles">
        <Table columns={[
          colText("Email", (u) => u.email), colText("Nom", (u) => u.name),
          isDirection
            ? colText("Actif", (u: UserRow) => <ActiveToggle uid={u.id!} active={u.active} />, (u: UserRow) => (u.active ? 1 : 0))
            : colText("Actif", (u) => u.active ? <Badge tone="emerald">oui</Badge> : <Badge tone="clay">non</Badge>),
          ...(isDirection ? [colNum("Rôle", (u: UserRow) => <RoleSetter uid={u.id!} current={u.role} />)] : []),
          ...(isDirection ? [colText("Manager (hiérarchie)", (u: UserRow) => <ManagerSetter uid={u.id!} current={u.managerUid} users={users} />)] : []),
        ]} rows={users} />
        <Tip>Le rôle est un custom claim posé via la Cloud Function setUserRole (auditée). Après un changement de rôle ou une désactivation, l'utilisateur concerné doit rafraîchir sa session (reconnexion) pour que l'effet soit immédiat. Le <b>manager</b> définit la ligne hiérarchique de la sécurité par enregistrement (un manager voit les enregistrements de ses collaborateurs).</Tip>
      </Card>
    </div>
  );
};

// Observabilité FRONT : dernières erreurs client (JS non gérées / rejets / crashs de rendu),
// remontées par logClientError → errorLog. Vide = aucune erreur remontée (bon signe).
function ClientErrorsCard() {
  const { rows } = useCollectionData<ErrorLog>("errorLog", [orderBy("ts", "desc"), limit(20)], "recent20");
  return (
    <Card title={`Erreurs client récentes${rows.length ? ` · ${rows.length}` : ""}`}>
      {rows.length ? (
        <Table columns={[
          colText("Quand", (e: ErrorLog) => <span className="text-faint tabnum">{relTime(e.ts) || "—"}</span>, (e: ErrorLog) => (e.ts?.seconds ?? 0)),
          colText("Message", (e: ErrorLog) => <span className="text-clay">{e.message || "—"}</span>, (e: ErrorLog) => e.message || ""),
          colText("Source", (e: ErrorLog) => e.module || "—", (e: ErrorLog) => e.module || ""),
          colText("Rôle", (e: ErrorLog) => e.role || "—", (e: ErrorLog) => e.role || ""),
          colText("URL", (e: ErrorLog) => <span className="text-faint truncate max-w-[220px] inline-block align-bottom" title={e.url || ""}>{e.url || "—"}</span>, (e: ErrorLog) => e.url || ""),
        ]} rows={rows} />
      ) : <div className="text-[13px] text-muted">Aucune erreur client remontée récemment.</div>}
      <Tip>Erreurs JavaScript non gérées, rejets de promesses et crashs de rendu remontés par les navigateurs des utilisateurs (sessions authentifiées) → dédoublonnées et plafonnées par session. Un pic ici signale une régression à investiguer.</Tip>
    </Card>
  );
}

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

// Niveaux de PROJECTION configurables (config/projection) : activer/désactiver et pondérer chacun
// des 3 niveaux (Certitudes / Forecast / Pipe). S'applique à TOUTES les vues et projections
// (pondéré pipeline, atterrissage, conversion). Enregistrer recalcule immédiatement côté serveur.
const DEFAULT_PROJ: ProjectionConfigInput = {
  certitudes: { active: true, weight: 1 }, forecast: { active: true, weight: 0.2 }, pipe: { active: true, weight: 0.05 },
};
const PROJ_TIERS = [
  { key: "certitudes", label: "Certitudes", band: "IdC ≥ 90 %" },
  { key: "forecast", label: "Forecast", band: "70-90 %" },
  { key: "pipe", label: "Pipe", band: "50-70 %" },
] as const;
function ProjectionConfigCard() {
  const { data, loading } = useDocData<Partial<ProjectionConfigInput>>("config/projection");
  if (loading && !data) return null;
  const init: ProjectionConfigInput = {
    certitudes: { ...DEFAULT_PROJ.certitudes, ...(data?.certitudes || {}) },
    forecast: { ...DEFAULT_PROJ.forecast, ...(data?.forecast || {}) },
    pipe: { ...DEFAULT_PROJ.pipe, ...(data?.pipe || {}) },
    cashOpening: data?.cashOpening ?? 0,
  };
  return <ProjectionConfigForm key={JSON.stringify(data || {})} initial={init} />;
}
function ProjectionConfigForm({ initial }: { initial: ProjectionConfigInput }) {
  const p1 = (v: number) => String(+(v * 100).toFixed(2));
  const [st, setSt] = useState(() => Object.fromEntries(PROJ_TIERS.map((t) => [t.key, { active: initial[t.key].active, weight: p1(initial[t.key].weight) }])) as Record<string, { active: boolean; weight: string }>);
  const [cashOpening, setCashOpening] = useState(String(initial.cashOpening ?? 0));
  const num = (s: string) => Number(String(s).replace(",", "."));
  const set = (k: string, patch: Partial<{ active: boolean; weight: string }>) => setSt((s) => ({ ...s, [k]: { ...s[k], ...patch } }));
  const build = (): ProjectionConfigInput => ({
    certitudes: { active: st.certitudes.active, weight: num(st.certitudes.weight) / 100 },
    forecast: { active: st.forecast.active, weight: num(st.forecast.weight) / 100 },
    pipe: { active: st.pipe.active, weight: num(st.pipe.weight) / 100 },
    cashOpening: Number.isFinite(num(cashOpening)) ? num(cashOpening) : 0,
  });
  return (
    <Card title="Niveaux de projection du pipeline" actions={<Busy label="Enregistrer" okMsg="Réglages appliqués (recalcul complet lancé)" fn={() => callSetProjectionConfig(build())} />}>
      <div className="flex flex-col gap-2.5">
        {PROJ_TIERS.map((t) => (
          <div key={t.key} className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-2 min-w-[190px]">
              <Toggle checked={st[t.key].active} onChange={(v) => set(t.key, { active: v })} ariaLabel={`Activer ${t.label}`} />
              <span className="text-ink font-medium">{t.label}</span>
              <span className="text-[11px] text-faint">{t.band}</span>
            </div>
            <label className="flex items-center gap-2 text-[13px]">
              <span className="text-muted">Poids (%)</span>
              <input className="field !py-1 w-24" inputMode="decimal" disabled={!st[t.key].active} value={st[t.key].weight} onChange={(e) => set(t.key, { weight: e.target.value })} aria-label={`Poids ${t.label}`} />
            </label>
          </div>
        ))}
      </div>
      <div className="mt-3 border-t border-line/60 pt-3 flex items-center gap-3 flex-wrap">
        <label className="flex items-center gap-2 min-w-[190px]">
          <span className="text-ink font-medium">Solde d'ouverture trésorerie</span>
          <span className="text-[11px] text-faint">position cash de départ</span>
        </label>
        <label className="flex items-center gap-2 text-[13px]">
          <span className="text-muted">FCFA</span>
          <input className="field !py-1 w-40" inputMode="numeric" value={cashOpening} onChange={(e) => setCashOpening(e.target.value)} placeholder="0" aria-label="Solde d'ouverture trésorerie" />
        </label>
      </div>
      <Tip>Les 3 niveaux sont des cohortes <b>disjointes</b> par certitude (IdC). Le <b>pondéré projeté</b> = somme des niveaux <b>cochés</b> uniquement. Le <b>solde d'ouverture trésorerie</b> ancre la <b>prévision cash</b> (Prévision) sur une position absolue plutôt qu'une simple variation (0 = variation depuis aujourd'hui ; peut être négatif). Ces réglages s'appliquent à <b>toutes les vues</b> ; l'enregistrement lance un <b>recalcul complet</b>.</Tip>
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
        <div className="flex items-center gap-2 text-[13px] text-ink">
          <Toggle checked={enabled} onChange={setEnabled} ariaLabel="Activer les notifications" />
          Activer le digest quotidien (07:00)
        </div>
        <label className="flex flex-col gap-1 text-[13px]">
          <span className="text-ink font-medium">Sévérité minimale</span>
          <Select className="!py-1" value={sev} onChange={(v) => setSev(v as "high" | "medium")} ariaLabel="Sévérité minimale"
            options={[{ value: "high", label: "Critiques seulement (high)" }, { value: "medium", label: "Moyennes et critiques" }]} />
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
        {res && !res.applied && totalDup > 0 && (
          // Suppression IRRÉVERSIBLE (cf. audit intégral F1) : confirmation explicite via DangerBtn,
          // et masquée une fois appliquée (!res.applied) pour éviter un second clic à vide (F2).
          <DangerBtn label={`Supprimer ${totalDup} doublon${totalDup > 1 ? "s" : ""}`} okMsg="Doublons supprimés" errMsg="Suppression refusée"
            confirm={`Supprimer définitivement ${totalDup.toLocaleString("fr-FR")} doublon(s) ? Le meilleur enregistrement de chaque groupe (source figée, plus récent) est conservé.`}
            fn={async () => { setRes(await callDedupe(undefined, true)); }} />
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

// Provisionnement d'un compte : email + nom + rôle + mot de passe initial. Direction uniquement
// (le callable createUser rejette tout autre appelant). Le compte est créé actif, email vérifié.
function CreateUserCard() {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState("lecture");
  const [pwd, setPwd] = useState("");
  // Mot de passe aléatoire lisible (14 car., alphabet sans caractères ambigus) — l'admin le copie
  // et le communique à l'utilisateur, qui pourra le changer.
  const gen = () => {
    const cs = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789@#%";
    const a = new Uint32Array(14); crypto.getRandomValues(a);
    setPwd(Array.from(a, (n) => cs[n % cs.length]).join(""));
  };
  const create = async () => {
    const em = email.trim();
    if (!EMAIL_RE.test(em)) throw new Error("email invalide");
    if (pwd.length < 8) throw new Error("mot de passe : 8 caractères minimum");
    await callCreateUser({ email: em, name: name.trim(), role, password: pwd });
    setEmail(""); setName(""); setPwd(""); setRole("lecture");
  };
  // Rattache un compte DÉJÀ existant dans le projet Firebase (créé par une autre app) : rôle + fiche,
  // sans mot de passe. Utile quand « Créer » est refusé car l'email existe déjà à l'échelle du projet.
  const attach = async () => {
    const em = email.trim();
    if (!EMAIL_RE.test(em)) throw new Error("email invalide");
    await callAttachUser({ email: em, name: name.trim(), role });
    setEmail(""); setName(""); setPwd(""); setRole("lecture");
  };
  return (
    <Card title="Créer un utilisateur" actions={
      <div className="flex gap-2 items-center">
        <Busy variant="ghost" label="Rattacher un compte existant" okMsg="Compte existant rattaché" errMsg="Rattachement refusé" fn={attach} />
        <Busy label="Créer le compte" okMsg="Compte créé" errMsg="Création refusée" fn={create} />
      </div>
    }>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-[13px]">
          <span className="text-ink font-medium">Email</span>
          <input className="field !py-1" type="email" autoComplete="off" placeholder="prenom.nom@nt.ci" value={email} onChange={(e) => setEmail(e.target.value)} aria-label="Email du nouvel utilisateur" />
        </label>
        <label className="flex flex-col gap-1 text-[13px]">
          <span className="text-ink font-medium">Nom</span>
          <input className="field !py-1" placeholder="(défaut : partie avant @)" value={name} onChange={(e) => setName(e.target.value)} aria-label="Nom du nouvel utilisateur" />
        </label>
        <label className="flex flex-col gap-1 text-[13px]">
          <span className="text-ink font-medium">Rôle</span>
          <Select className="!py-1" value={role} onChange={setRole} ariaLabel="Rôle du nouvel utilisateur"
            options={ROLE_LIST.map((r) => ({ value: r, label: r }))} />
        </label>
        <label className="flex flex-col gap-1 text-[13px]">
          <span className="text-ink font-medium">Mot de passe initial</span>
          <div className="flex gap-1.5">
            <input className="field !py-1 flex-1" type="text" autoComplete="new-password" placeholder="8 caractères minimum" value={pwd} onChange={(e) => setPwd(e.target.value)} aria-label="Mot de passe initial" />
            <button type="button" className="btn-ghost whitespace-nowrap" onClick={gen}>Générer</button>
          </div>
        </label>
      </div>
      <Tip>Compte créé <b>actif</b>, email vérifié. Communiquez le mot de passe initial à l'utilisateur (hors bande) ; il pourra le changer. <b>« Créer »</b> échoue si l'email existe déjà — l'authentification Firebase est <b>partagée par tout le projet</b>, un compte d'une autre application y figure donc déjà. Dans ce cas, <b>« Rattacher un compte existant »</b> lui donne accès (rôle + fiche) sans le recréer ni changer son mot de passe.</Tip>
    </Card>
  );
}

function ActiveToggle({ uid, active }: { uid: string; active?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2">
      <Badge tone={active ? "emerald" : "clay"}>{active ? "oui" : "non"}</Badge>
      <Busy variant="ghost" label={active ? "Désactiver" : "Réactiver"} okMsg={active ? "Compte désactivé" : "Compte réactivé"} fn={() => callSetUserActive(uid, !active)} />
    </span>
  );
}

// Normalisation des noms de clients : règles déterministes (serveur) + table d'alias éditable pour
// fusionner les graphies distinctes d'un même client. L'enregistrement relance un recalcul complet.
function ClientAliasCard() {
  const { data } = useDocData<ClientAliasConfig>("config/clientAliases");
  const [draft, setDraft] = useState<{ from: string; to: string }[] | null>(null);
  const list = draft ?? (data?.pairs || []);
  const set = (i: number, k: "from" | "to", v: string) => setDraft(list.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  const add = () => setDraft([...list, { from: "", to: "" }]);
  const del = (i: number) => setDraft(list.filter((_, j) => j !== i));
  const save = async () => { await setClientAliases(list.filter((r) => r.from.trim() && r.to.trim())); setDraft(null); };
  return (
    <Card title="Normalisation clients — alias" actions={
      <div className="flex gap-2">
        <button className="btn-ghost !px-2.5 !py-1 text-xs" onClick={add}>+ Alias</button>
        <Busy label="Enregistrer" okMsg="Alias enregistrés (recalcul lancé)" fn={save} />
      </div>}>
      <div className="flex flex-col gap-1.5">
        {list.length ? list.map((r, i) => (
          <div key={i} className="flex items-center gap-2">
            <input className="field !py-1 flex-1" placeholder="Variante (ex. SGBCI)" value={r.from} onChange={(e) => set(i, "from", e.target.value)} aria-label={`Variante ${i + 1}`} />
            <span className="text-muted" aria-hidden="true">→</span>
            <input className="field !py-1 flex-1" placeholder="Nom canonique (ex. Société Générale)" value={r.to} onChange={(e) => set(i, "to", e.target.value)} aria-label={`Nom canonique ${i + 1}`} />
            <button className="btn-ghost !px-2 !py-1" onClick={() => del(i)} aria-label={`Supprimer l'alias ${i + 1}`}>×</button>
          </div>
        )) : <div className="text-[13px] text-muted">Aucun alias — les noms sont normalisés par règles automatiques.</div>}
      </div>
      <Tip>Les noms de clients sont d'abord normalisés par <b>règles</b> (MAJUSCULES, accents, ponctuation, formes juridiques SA/SARL…, suffixe « Côte d'Ivoire »/« CI »). Ajoutez un <b>alias</b> pour fusionner deux graphies que les règles ne rapprochent pas (ex. « SGBCI » → « Société Générale »). L'enregistrement relance un recalcul complet ; les <b>documents sources ne sont pas modifiés</b>.</Tip>
    </Card>
  );
}

// Taux de change (XOF par unité de devise) pour la conversion automatique des BC en devise étrangère.
function FxRatesCard() {
  const { data } = useDocData<{ rates?: Record<string, number> }>("config/fxRates");
  const [draft, setDraft] = useState<{ cur: string; rate: string }[] | null>(null);
  const list = draft ?? Object.entries(data?.rates || {}).map(([cur, rate]) => ({ cur, rate: String(rate) }));
  const set = (i: number, k: "cur" | "rate", v: string) => setDraft(list.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  const add = () => setDraft([...list, { cur: "", rate: "" }]);
  const del = (i: number) => setDraft(list.filter((_, j) => j !== i));
  const save = async () => {
    const rates: Record<string, number> = {};
    for (const r of list) { const c = r.cur.trim().toUpperCase(); const n = Number(r.rate); if (c && c !== "XOF" && Number.isFinite(n) && n > 0) rates[c] = n; }
    await setFxRates(rates); setDraft(null);
  };
  return (
    <Card title="Taux de change — devises (XOF par unité)" actions={
      <div className="flex gap-2">
        <button className="btn-ghost !px-2.5 !py-1 text-xs" onClick={add}>+ Devise</button>
        <Busy label="Enregistrer" okMsg="Taux enregistrés" fn={save} />
      </div>}>
      <div className="flex flex-col gap-1.5">
        {list.length ? list.map((r, i) => (
          <div key={i} className="flex items-center gap-2">
            <input className="field !py-1 w-28 uppercase" placeholder="EUR" value={r.cur} onChange={(e) => set(i, "cur", e.target.value)} aria-label={`Devise ${i + 1}`} />
            <span className="text-muted text-xs" aria-hidden="true">= 1 unité →</span>
            <input className="field !py-1 w-36" inputMode="decimal" placeholder="655.957" value={r.rate} onChange={(e) => set(i, "rate", e.target.value)} aria-label={`Taux XOF pour ${r.cur || `devise ${i + 1}`}`} />
            <span className="text-muted text-xs">XOF</span>
            <button className="btn-ghost !px-2 !py-1" onClick={() => del(i)} aria-label={`Supprimer la devise ${i + 1}`}>×</button>
          </div>
        )) : <div className="text-[13px] text-muted">Aucun taux — les BC en devise étrangère restent « à saisir » (contre-valeur XOF manuelle).</div>}
      </div>
      <Tip>Un BC importé/saisi en devise étrangère est <b>converti automatiquement en XOF</b> à sa création via ces taux (le taux appliqué est figé sur la ligne pour traçabilité). Une contre-valeur XOF <b>saisie manuellement</b> reste prioritaire. Sans taux pour la devise, le BC est marqué <b>« à saisir »</b> (jamais assimilé à du XOF). Ne modifie pas les BC déjà enregistrés.</Tip>
    </Card>
  );
}

// Référentiel éditable (liste simple) — Project Managers / Business Units. Remplace la liste en base.
function RefListCard({ kind, title, placeholder, tip, upper, clickupImport }: { kind: "projectManagers" | "businessUnits"; title: string; placeholder: string; tip: string; upper?: boolean; clickupImport?: boolean }) {
  const { data } = useDocData<{ list?: string[] }>(`config/${kind}`);
  const [draft, setDraft] = useState<string[] | null>(null);
  const toast = useToast();
  const list = draft ?? (data?.list || []);
  const set = (i: number, v: string) => setDraft(list.map((r, j) => (j === i ? v : r)));
  const add = () => setDraft([...list, ""]);
  const del = (i: number) => setDraft(list.filter((_, j) => j !== i));
  const save = async () => { await setRefList(kind, list.map((s) => (upper ? s.trim().toUpperCase() : s.trim())).filter(Boolean)); setDraft(null); };
  // Import ClickUp : fusionne les noms des membres ClickUp dans le brouillon (noms EXACTS → assignation
  // fiable). L'utilisateur retire les non-PM puis Enregistre. Ne remplace rien tant qu'on n'a pas cliqué Enregistrer.
  const importClickup = async () => {
    const r = await listClickupMembers();
    const names = (r.members || []).map((m) => m.name).filter(Boolean);
    const merged = [...new Set([...list, ...names])].sort((a, b) => a.localeCompare(b));
    setDraft(merged);
    toast(`${names.length} membre(s) ClickUp importé(s) — retirez les non-PM puis « Enregistrer ».`, "ok");
  };
  return (
    <Card title={title} actions={
      <div className="flex gap-2">
        {clickupImport && <Busy variant="ghost" label="Importer depuis ClickUp" errMsg="Import ClickUp refusé" fn={importClickup} />}
        <button className="btn-ghost !px-2.5 !py-1 text-xs" onClick={add}>+ Ajouter</button>
        <Busy label="Enregistrer" okMsg="Référentiel enregistré" fn={save} />
      </div>}>
      <div className="flex flex-wrap gap-1.5">
        {list.length ? list.map((r, i) => (
          <div key={i} className="flex items-center gap-1">
            <input className={cx("field !py-1 w-44", upper && "uppercase")} placeholder={placeholder} value={r} onChange={(e) => set(i, e.target.value)} aria-label={`${title} — entrée ${i + 1}`} />
            <button className="btn-ghost !px-2 !py-1" onClick={() => del(i)} aria-label={`Supprimer l'entrée ${i + 1}`}>×</button>
          </div>
        )) : <div className="text-[13px] text-muted">Aucune entrée.</div>}
      </div>
      <Tip>{tip}</Tip>
    </Card>
  );
}

// Intégration ClickUp : activation + liste cible. Le token vit dans Secret Manager (CLICKUP_TOKEN),
// jamais dans l'app. Le push d'une commande se fait depuis la liste Commandes (bouton « ClickUp »).
const CLICKUP_LISTS = [
  { id: "901215917683", label: "Côte d'Ivoire" },
  { id: "901215918697", label: "Burkina Faso" },
  { id: "901215918699", label: "Guinée" },
  { id: "901216066964", label: "Sandbox (test)" },
];
// Cockpit de QUALITÉ de l'intégration ClickUp : couverture, tâches orphelines, écarts CAF, synchro.
function ClickupHealthPanel({ health }: { health?: ClickupHealthSummary | null }) {
  if (!health || health.commandesTotal == null) return null;
  const money = (n?: number) => (n ? (n / 1e6).toFixed(1) + " M" : "0");
  const Metric = ({ label, value, tone, sub }: { label: string; value: string | number; tone?: string; sub?: string }) => (
    <div className="rounded-lg bg-white/[0.03] border border-white/5 px-3 py-2">
      <div className="text-[11px] text-muted">{label}</div>
      <div className={cx("font-display tabnum text-lg leading-tight", tone)}>{value}</div>
      {sub && <div className="text-[11px] text-faint">{sub}</div>}
    </div>
  );
  const cov = health.coverage || 0;
  return (
    <div className="mt-3">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
        <Metric label="Couverture" value={`${cov}%`} tone={cov >= 90 ? "text-emerald" : cov >= 50 ? "text-gold" : "text-clay"} sub={`${health.linked}/${health.commandesTotal} liées`} />
        <Metric label="Commandes non liées" value={health.unlinked || 0} tone={(health.unlinked || 0) > 0 ? "text-gold" : "text-emerald"} sub={`dont ${health.unlinkedMatchable || 0} rattachables`} />
        <Metric label="Synchronisées (statut/dates)" value={health.synced || 0} sub={`sur ${health.linked} liées`} />
        <Metric label="Tâches ClickUp" value={health.tasksTotal || 0} sub={`${health.tasksWithFp || 0} avec N° FP`} />
        <Metric label="Tâches orphelines" value={health.orphanTasks || 0} tone={(health.orphanTasks || 0) > 0 ? "text-gold" : "text-emerald"} sub="sans commande app" />
        <Metric label="Écarts CAF" value={health.cafGapCount || 0} tone={(health.cafGapCount || 0) > 0 ? "text-clay" : "text-emerald"} sub={`${money(health.cafGapTotal)} d'écart`} />
      </div>
      {(health.unlinkedSample?.length || health.orphanSample?.length) ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mt-2">
          {!!health.unlinkedSample?.length && (
            <div>
              <div className="text-[11px] text-muted mb-1">Commandes non liées (échantillon)</div>
              <Table colsKey="clickup-unlinked" columns={[
                colText("FP", (r: { fp?: string }) => r.fp || "—"),
                colText("Client", (r: { client?: string }) => r.client || "—"),
                colText("Tâche existante", (r: { matchable?: boolean }) => (r.matchable ? <Badge tone="gold">à rattacher</Badge> : <span className="text-faint">non</span>)),
              ]} rows={health.unlinkedSample} />
            </div>
          )}
          {!!health.orphanSample?.length && (
            <div>
              <div className="text-[11px] text-muted mb-1">Tâches ClickUp orphelines (échantillon)</div>
              <Table colsKey="clickup-orphans" columns={[
                colText("Tâche", (r: { name?: string; id?: string }) => <a href={`https://app.clickup.com/t/${r.id}`} target="_blank" rel="noopener" className="text-emerald hover:underline">{r.name || r.id}</a>),
                colText("N° FP", (r: { fp?: string | null }) => r.fp || <span className="text-faint">aucun</span>),
              ]} rows={health.orphanSample} />
            </div>
          )}
        </div>
      ) : null}
      {health.at && <div className="text-[11px] text-faint mt-1">Dernier diagnostic : {new Date((health.at.seconds || 0) * 1000).toLocaleString("fr-FR")}</div>}
    </div>
  );
}

// URL par défaut de la fonction HTTP clickupWebhook (2nd gen, région us-central1). Modifiable si la
// région/projet diffèrent — l'admin colle l'URL exacte affichée par le déploiement.
const CLICKUP_WEBHOOK_ENDPOINT = "https://us-central1-propulse-business-87f7a.cloudfunctions.net/clickupWebhook";
function ClickupCard() {
  const { data } = useDocData<{ enabled?: boolean; defaultListId?: string; teamId?: string; webhookActive?: boolean; webhookEndpoint?: string }>("config/clickup");
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [listId, setListId] = useState<string | null>(null);
  const [cafBusy, setCafBusy] = useState(false);
  const [pullBusy, setPullBusy] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [recBusy, setRecBusy] = useState(false);
  const [healthBusy, setHealthBusy] = useState(false);
  const [enrichBusy, setEnrichBusy] = useState(false);
  const [bcRecBusy, setBcRecBusy] = useState(false);
  const [bcBulkBusy, setBcBulkBusy] = useState(false);
  const [bcPullBusy, setBcPullBusy] = useState(false);
  const [bcImportBusy, setBcImportBusy] = useState(false);
  const [whBusy, setWhBusy] = useState(false);
  const [endpoint, setEndpoint] = useState<string | null>(null);
  const { data: health } = useDocData<ClickupHealthSummary>("summaries/clickupHealth");
  const { data: bcCu } = useDocData<{ totalBc?: number; linkedCount?: number; overdueCount?: number }>("summaries/clickupBc");
  const toast = useToast();
  const on = enabled ?? (data?.enabled !== false);
  const list = listId ?? (data?.defaultListId || "901215917683");
  const save = async () => { await setClickupConfig({ enabled: on, defaultListId: list }); setEnabled(null); setListId(null); };
  const forceCaf = async () => {
    if (cafBusy) return;
    setCafBusy(true);
    try {
      const r = await syncClickupCaf();
      toast(`CAF synchronisé — ${r.pushed} poussé(s) / ${r.total} tâche(s)${r.failed ? `, ${r.failed} échec(s)` : ""}`, r.failed ? "err" : "ok");
    } catch (e: any) {
      const detail = String(e?.message || e?.code || "").replace(/^functions\//, "");
      toast(detail ? `CAF refusé — ${detail}` : "CAF : échec", "err");
    } finally { setCafBusy(false); }
  };
  const pull = async () => {
    if (pullBusy) return;
    setPullBusy(true);
    try {
      const r = await syncFromClickup();
      toast(`Remonté depuis ClickUp — ${r.pulled} / ${r.total} tâche(s)${r.pmUpdated ? `, ${r.pmUpdated} PM` : ""}${r.failed ? `, ${r.failed} échec(s)` : ""}`, r.failed ? "err" : "ok");
    } catch (e: any) {
      const detail = String(e?.message || e?.code || "").replace(/^functions\//, "");
      toast(detail ? `Synchro refusée — ${detail}` : "Synchro : échec", "err");
    } finally { setPullBusy(false); }
  };
  const reconcile = async () => {
    if (recBusy) return;
    setRecBusy(true);
    try {
      const r = await reconcileClickupLinks({ listId: list });
      toast(`Rattachement — ${r.matched} tâche(s) existante(s) reliée(s), ${r.already} déjà liée(s) / ${r.total} commande(s)`, "ok");
    } catch (e: any) {
      const detail = String(e?.message || e?.code || "").replace(/^functions\//, "");
      toast(detail ? `Rattachement refusé — ${detail}` : "Rattachement : échec", "err");
    } finally { setRecBusy(false); }
  };
  const refreshHealth = async () => {
    if (healthBusy) return;
    setHealthBusy(true);
    try {
      const r = await clickupHealth({ listId: list });
      toast(`Diagnostic — ${r.linked}/${r.commandesTotal} liées (${r.coverage}%), ${r.orphanTasks} tâche(s) orpheline(s)`, "ok");
    } catch (e: any) {
      const detail = String(e?.message || e?.code || "").replace(/^functions\//, "");
      toast(detail ? `Diagnostic refusé — ${detail}` : "Diagnostic : échec", "err");
    } finally { setHealthBusy(false); }
  };
  const bulkPush = async (force: boolean) => {
    if (bulkBusy) return;
    const label = force ? "Resynchroniser TOUTES les tâches liées (cœur + CAF) ?" : "Créer les tâches ClickUp de toutes les commandes non liées ? (les tâches existantes sont adoptées, pas dupliquées)";
    if (!window.confirm(label + "\n\nAstuce : lancez d'abord « Rattacher les tâches existantes ».")) return;
    setBulkBusy(true);
    try {
      const r = await pushAllOrdersToClickup({ force, listId: list });
      toast(`Push en masse — ${r.created} créée(s), ${r.adopted || 0} rattachée(s), ${r.updated} maj, ${r.skipped} ignorée(s)${r.failed ? `, ${r.failed} échec(s)` : ""} / ${r.total}`, r.failed ? "err" : "ok");
    } catch (e: any) {
      const detail = String(e?.message || e?.code || "").replace(/^functions\//, "");
      // Un timeout client est possible sur un gros volume : le traitement se poursuit côté serveur.
      toast(detail.includes("deadline") || detail.includes("timeout") ? "Push lancé — traitement en cours côté serveur (voir ClickUp)" : (detail ? `Push refusé — ${detail}` : "Push : échec"), detail.includes("deadline") ? "ok" : "err");
    } finally { setBulkBusy(false); }
  };
  const enrich = async () => {
    if (enrichBusy) return;
    setEnrichBusy(true);
    try {
      const r = await enrichClickup();
      toast(`Enrichissement — ${r.enriched} synthèse(s), ${r.subtasked} jalons→sous-tâches, ${r.checklisted} checklist(s) BC, ${r.tagged} tag(s)${r.failed ? `, ${r.failed} échec(s)` : ""} / ${r.total}`, r.failed ? "err" : "ok");
    } catch (e: any) {
      const detail = String(e?.message || e?.code || "").replace(/^functions\//, "");
      toast(detail ? `Enrichissement refusé — ${detail}` : "Enrichissement : échec", "err");
    } finally { setEnrichBusy(false); }
  };
  const bcReconcile = async () => {
    if (bcRecBusy) return;
    setBcRecBusy(true);
    try {
      const r = await reconcileBcLinks();
      toast(`BC rattachés — ${r.matched} tâche(s) reliée(s), ${r.already} déjà liée(s) / ${r.total} BC`, "ok");
    } catch (e: any) {
      const detail = String(e?.message || e?.code || "").replace(/^functions\//, "");
      toast(detail ? `Rattachement BC refusé — ${detail}` : "Rattachement BC : échec", "err");
    } finally { setBcRecBusy(false); }
  };
  const bcImport = async () => {
    if (bcImportBusy) return;
    if (!window.confirm("Importer dans l'app les BC saisis directement dans ClickUp (non encore présents) ?\n\nLes BC déjà connus par un import (Logistics/PDF) sont ignorés. Les BC importés sont créés au statut « émis » (engagement, sans impact sur le solde du compte).")) return;
    setBcImportBusy(true);
    try {
      const r = await importBcFromClickup();
      toast(`Import BC — ${r.created} créé(s), ${r.skippedKnown} déjà connu(s), ${r.skippedIncomplete} incomplet(s) / ${r.scanned} tâche(s)`, "ok");
    } catch (e: any) {
      const detail = String(e?.message || e?.code || "").replace(/^functions\//, "");
      toast(detail ? `Import BC refusé — ${detail}` : "Import BC : échec", "err");
    } finally { setBcImportBusy(false); }
  };
  const bcPull = async () => {
    if (bcPullBusy) return;
    setBcPullBusy(true);
    try {
      const r = await syncBcFromClickup();
      toast(`Avancement BC remonté — ${r.pulled} / ${r.total} tâche(s)${r.failed ? `, ${r.failed} échec(s)` : ""}`, r.failed ? "err" : "ok");
    } catch (e: any) {
      const detail = String(e?.message || e?.code || "").replace(/^functions\//, "");
      toast(detail ? `Synchro BC refusée — ${detail}` : "Synchro BC : échec", "err");
    } finally { setBcPullBusy(false); }
  };
  const bcBulkPush = async (force: boolean) => {
    if (bcBulkBusy) return;
    const label = force ? "Resynchroniser TOUTES les tâches BC liées ?" : "Créer les tâches ClickUp de tous les BC non liés ? (les tâches existantes sont adoptées par N° de Commande, pas dupliquées)";
    if (!window.confirm(label + "\n\nAstuce : lancez d'abord « Rattacher les BC existants ».")) return;
    setBcBulkBusy(true);
    try {
      const r = await pushAllBcToClickup({ force });
      toast(`Push BC — ${r.created} créé(s), ${r.adopted || 0} rattaché(s), ${r.updated} maj, ${r.skipped} ignoré(s)${r.failed ? `, ${r.failed} échec(s)` : ""} / ${r.total}`, r.failed ? "err" : "ok");
    } catch (e: any) {
      const detail = String(e?.message || e?.code || "").replace(/^functions\//, "");
      toast(detail.includes("deadline") || detail.includes("timeout") ? "Push BC lancé — traitement en cours côté serveur (voir ClickUp)" : (detail ? `Push BC refusé — ${detail}` : "Push BC : échec"), detail.includes("deadline") ? "ok" : "err");
    } finally { setBcBulkBusy(false); }
  };
  const ep = endpoint ?? (data?.webhookEndpoint || CLICKUP_WEBHOOK_ENDPOINT);
  const setupWebhook = async () => {
    if (whBusy) return;
    setWhBusy(true);
    try {
      const r = await setupClickupWebhook(ep);
      toast(`Webhook temps réel ${r.created ? "créé" : "mis à jour"}${r.hasSecret ? "" : " (secret manquant — recréez-le)"}`, r.hasSecret ? "ok" : "err");
    } catch (e: any) {
      const detail = String(e?.message || e?.code || "").replace(/^functions\//, "");
      toast(detail ? `Webhook refusé — ${detail}` : "Webhook : échec", "err");
    } finally { setWhBusy(false); }
  };
  const removeWebhook = async () => {
    if (whBusy) return;
    if (!window.confirm("Désactiver les webhooks temps réel ? La synchro repassera au tirage quotidien.")) return;
    setWhBusy(true);
    try {
      await deleteClickupWebhook();
      toast("Webhook temps réel désactivé", "ok");
    } catch (e: any) {
      const detail = String(e?.message || e?.code || "").replace(/^functions\//, "");
      toast(detail ? `Désactivation refusée — ${detail}` : "Désactivation : échec", "err");
    } finally { setWhBusy(false); }
  };
  return (
    <Card title="Intégration ClickUp" actions={<Busy label="Enregistrer" okMsg="Config ClickUp enregistrée" fn={save} />}>
      <div className="flex flex-wrap items-center gap-3 text-[13px]">
        <label className="inline-flex items-center gap-2">
          <input type="checkbox" checked={on} onChange={(e) => setEnabled(e.target.checked)} className="accent-gold" /> Intégration active
        </label>
        <label className="inline-flex items-center gap-2">Liste cible (Gestion de Projets)
          <Select ariaLabel="Liste ClickUp cible" className="!py-1" value={list} onChange={setListId} options={CLICKUP_LISTS.map((l) => ({ value: l.id, label: l.label }))} />
        </label>
        <button type="button" className="btn-ghost !py-1.5" disabled={cafBusy} onClick={forceCaf} title="Repousser le CA Facturé de toutes les tâches liées">
          {cafBusy ? "Synchro CAF…" : "Forcer la synchro CAF"}
        </button>
        <button type="button" className="btn-ghost !py-1.5" disabled={pullBusy} onClick={pull} title="Remonter statut projet + dates depuis ClickUp">
          {pullBusy ? "Synchro…" : "Synchroniser depuis ClickUp"}
        </button>
        <button type="button" className="btn-ghost !py-1.5" disabled={recBusy} onClick={reconcile} title="Rattacher les commandes aux tâches ClickUp DÉJÀ existantes (Opp ID = FP), sans rien créer. À lancer AVANT tout push en masse.">
          {recBusy ? "Rattachement…" : "Rattacher les tâches existantes"}
        </button>
        <button type="button" className="btn-ghost !py-1.5" disabled={bulkBusy} onClick={() => bulkPush(false)} title="Créer les tâches des commandes pas encore liées (adopte automatiquement une tâche existante par Opp ID = FP)">
          {bulkBusy ? "Push…" : "Créer les commandes non liées"}
        </button>
        <button type="button" className="btn-ghost !py-1.5" disabled={bulkBusy} onClick={() => bulkPush(true)} title="Resynchroniser TOUTES les tâches liées (cœur + CAF)">
          {bulkBusy ? "Push…" : "Tout resynchroniser"}
        </button>
        <button type="button" className="btn-ghost !py-1.5" disabled={healthBusy} onClick={refreshHealth} title="Analyser la qualité de l'intégration (couverture, tâches orphelines, écarts CAF)">
          {healthBusy ? "Diagnostic…" : "Diagnostic qualité"}
        </button>
        <button type="button" className="btn-ghost !py-1.5" disabled={enrichBusy} onClick={enrich} title="Sur chaque tâche commande liée : commentaire de synthèse (CA/RAF, qualité) + jalons de facturation en sous-tâches + BC liés en checklist + tag « à risque »">
          {enrichBusy ? "Enrichissement…" : "Enrichir les tâches"}
        </button>
      </div>
      <ClickupHealthPanel health={health} />
      {(health?.unlinkedMatchable || 0) > 0 && <div className="text-[12px] text-amber-400 mt-1">⚠️ {health!.unlinkedMatchable} commande(s) non liée(s) ont pourtant une tâche existante → lance « Rattacher les tâches existantes ».</div>}
      <div className="mt-4 pt-3 border-t border-white/5">
        <div className="text-[13px] font-medium text-ink mb-2">Bons de commande fournisseurs (liste « Commandes Fournisseurs »)</div>
        <div className="flex flex-wrap items-center gap-3 text-[13px]">
          <button type="button" className="btn-ghost !py-1.5" disabled={bcRecBusy} onClick={bcReconcile} title="Rattacher les BC aux tâches ClickUp DÉJÀ existantes (par N° de Commande), sans rien créer. À lancer AVANT tout push en masse.">
            {bcRecBusy ? "Rattachement…" : "Rattacher les BC existants"}
          </button>
          <button type="button" className="btn-ghost !py-1.5" disabled={bcBulkBusy} onClick={() => bcBulkPush(false)} title="Créer les tâches des BC pas encore liés (adopte automatiquement une tâche existante par N° de Commande)">
            {bcBulkBusy ? "Push…" : "Créer les BC non liés"}
          </button>
          <button type="button" className="btn-ghost !py-1.5" disabled={bcBulkBusy} onClick={() => bcBulkPush(true)} title="Resynchroniser TOUTES les tâches BC liées">
            {bcBulkBusy ? "Push…" : "Tout resynchroniser (BC)"}
          </button>
          <button type="button" className="btn-ghost !py-1.5" disabled={bcPullBusy} onClick={bcPull} title="Remonter l'avancement achat (statut) + l'ETA des tâches BC depuis ClickUp">
            {bcPullBusy ? "Synchro…" : "Synchroniser les BC depuis ClickUp"}
          </button>
          <button type="button" className="btn-ghost !py-1.5" disabled={bcImportBusy} onClick={bcImport} title="Créer dans l'app les BC saisis directement dans ClickUp (dédup par N° BC, statut « émis », conversion XOF). L'import Logistics/PDF reste prioritaire.">
            {bcImportBusy ? "Import…" : "Importer les BC depuis ClickUp"}
          </button>
          {bcCu && <span className="text-[12px] text-muted">{bcCu.linkedCount || 0}/{bcCu.totalBc || 0} BC liés{(bcCu.overdueCount || 0) > 0 ? <> · <span className="text-amber-400">{bcCu.overdueCount} en retard (ETA ClickUp)</span></> : null}</span>}
        </div>
      </div>
      <div className="mt-4 pt-3 border-t border-white/5">
        <div className="text-[13px] font-medium text-ink mb-2">Temps réel (webhooks) {data?.webhookActive ? <Badge tone="emerald">actif</Badge> : <Badge tone="steel">inactif</Badge>}</div>
        <div className="flex flex-wrap items-center gap-3 text-[13px]">
          <input className="field !py-1.5 w-[26rem] max-w-full font-mono text-[12px]" aria-label="Endpoint du webhook clickupWebhook" value={ep} onChange={(e) => setEndpoint(e.target.value)} placeholder="https://…cloudfunctions.net/clickupWebhook" />
          <button type="button" className="btn-ghost !py-1.5" disabled={whBusy} onClick={setupWebhook} title="Enregistrer / mettre à jour le webhook ClickUp (statut, champs, suppression) pointant vers l'app">
            {whBusy ? "…" : data?.webhookActive ? "Ré-enregistrer le webhook" : "Activer le temps réel"}
          </button>
          {data?.webhookActive && <button type="button" className="btn-ghost !py-1.5" disabled={whBusy} onClick={removeWebhook} title="Supprimer le webhook (retour au tirage quotidien)">Désactiver</button>}
        </div>
        <Tip>Le webhook remonte <b>en secondes</b> les changements ClickUp (statut, dates, champs, avancement BC) sans attendre le tirage quotidien. La signature est vérifiée par <b>HMAC</b> (secret stocké côté serveur). Après un <b>redéploiement des fonctions</b>, vérifiez que l'URL ci-dessus correspond à celle de <code>clickupWebhook</code>, puis ré-enregistrez si besoin.</Tip>
      </div>
      <Tip>Le <b>token API</b> est stocké dans Secret Manager (<code>CLICKUP_TOKEN</code>) — jamais dans l'app. Depuis la liste <b>Commandes</b>, le bouton <b>« ClickUp »</b> crée (ou met à jour) une tâche dans la liste choisie, <b>assignée au PM</b> de la commande. Le <b>CA Facturé</b> est entretenu automatiquement à chaque recalcul (bouton <b>« Forcer la synchro CAF »</b> pour tout repousser) ; le <b>Backlog</b> (RAF) est une formule ClickUp, rien à pousser. Le bouton <b>« Synchroniser depuis ClickUp »</b> (et un tirage quotidien) remonte le <b>statut projet</b>, les <b>dates</b> et le <b>PM assigné</b> dans les Commandes. <b>⚠️ Avant tout push en masse</b>, lancez <b>« Rattacher les tâches existantes »</b> : il relie les commandes aux tâches déjà présentes (Opp ID = N° FP) pour <b>ne pas créer de doublons</b>.</Tip>
    </Card>
  );
}

function RoleSetter({ uid, current }: { uid: string; current?: string }) {
  const [role, setRole] = useState(current && ROLE_LIST.includes(current) ? current : "lecture");
  return (
    <span className="inline-flex gap-1.5">
      <Select ariaLabel="Rôle de l'utilisateur" className="!py-1" value={role} onChange={setRole}
        options={ROLE_LIST.map((r) => ({ value: r, label: r }))} />
      <Busy label="Poser" fn={() => callSetUserRole(uid, role)} />
    </span>
  );
}

// Pose le MANAGER d'un utilisateur (hiérarchie de rôles). Le serveur refuse cycle/auto-management et
// ré-indexe la visibilité. La liste exclut l'utilisateur lui-même.
function ManagerSetter({ uid, current, users }: { uid: string; current?: string | null; users: UserRow[] }) {
  const [mgr, setMgr] = useState(current || "");
  const options = [{ value: "", label: "— aucun —" }, ...users.filter((u) => u.id !== uid).map((u) => ({ value: u.id!, label: u.name || u.email || u.id! }))];
  return (
    <span className="inline-flex gap-1.5">
      <Select ariaLabel="Manager de l'utilisateur" className="!py-1" value={mgr} onChange={setMgr} options={options} />
      <Busy label="Poser" okMsg="Manager posé (visibilité ré-indexée)" errMsg="Refusé (cycle ou droit insuffisant)" fn={() => callSetManager(uid, mgr || null)} />
    </span>
  );
}

// Sécurité par enregistrement (direction) : OWD par objet (public/privé), dérivation/ré-indexage de la
// visibilité, politique MFA. Non destructif : par défaut tout est « public » (comportement historique).
function SecurityCard({ users: _users }: { users: UserRow[] }) {
  const { data: owd } = useDocData<Partial<RecordAccess>>("config/recordAccess");
  const { data: sec } = useDocData<{ require2fa?: boolean }>("config/security");
  const toast = useToast();
  const [derive, setDerive] = useState(true);
  const opps = owd?.opportunities === "private" ? "private" : "public";
  const accts = owd?.accounts === "private" ? "private" : "public";
  const OwdRow = ({ label, obj, value }: { label: string; obj: keyof RecordAccess; value: "public" | "private" }) => (
    <div className="flex items-center justify-between gap-3 py-1">
      <div>
        <div className="text-[13px]">{label} <Badge tone={value === "private" ? "gold" : "steel"}>{value === "private" ? "privé" : "public"}</Badge></div>
        <div className="text-[11px] text-muted">{value === "private" ? "Propriétaire + hiérarchie + administrateurs seulement" : "Tout rôle habilité au module (défaut)"}</div>
      </div>
      <Busy variant="ghost" label={value === "private" ? "Rendre public" : "Rendre privé"} okMsg="OWD mis à jour"
        fn={() => callSetRecordAccess({ [obj]: value === "private" ? "public" : "private" } as Partial<RecordAccess>)} />
    </div>
  );
  return (
    <Card title="Sécurité par enregistrement (propriétaire + hiérarchie)">
      <div className="flex flex-col gap-1">
        <OwdRow label="Opportunités" obj="opportunities" value={opps} />
        <OwdRow label="Comptes & contacts" obj="accounts" value={accts} />
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-hair pt-3">
        <label className="flex items-center gap-1.5 text-[12px]"><input type="checkbox" checked={derive} onChange={(e) => setDerive(e.target.checked)} /> dériver les propriétaires depuis l'AM</label>
        <Busy variant="ghost" label="Ré-indexer la visibilité" okMsg="Visibilité ré-indexée"
          fn={async () => { const r = await callReindexVisibility(derive); toast(`${r.reindexed} enregistrement(s) ré-indexé(s)${r.derived ? `, ${r.derived} propriétaire(s) dérivé(s) de l'AM` : ""}`); }} />
      </div>
      <div className="mt-3 flex items-center justify-between gap-3 border-t border-hair pt-3">
        <div><div className="text-[13px]">MFA obligatoire (actions sensibles)</div><div className="text-[11px] text-muted">Exige un 2e facteur pour les opérations d'administration.</div></div>
        <Toggle checked={!!sec?.require2fa} onChange={(v) => { callSetSecurityConfig(v).catch(() => {}); }} ariaLabel="MFA obligatoire" />
      </div>
      <Tip>Passez un objet en <b>privé</b> APRÈS un ré-indexage (sinon les enregistrements sans propriétaire seraient invisibles des non-administrateurs). La direction et les administrateurs (droit « habilitations ») voient tout. Le SSO et le fournisseur MFA se configurent côté Identity Platform (console Firebase).</Tip>
    </Card>
  );
}

// Inscription MFA (TOTP) en libre-service — pour tout utilisateur connecté. Best-effort : si le projet
// n'a pas activé l'authentification multi-facteur (Identity Platform), l'appel échoue proprement et le
// message l'explique. Le secret est affiché en URI otpauth (à coller dans une app d'authentification).
function MfaEnrollCard() {
  const { user } = useClaims();
  const toast = useToast();
  const [uri, setUri] = useState<string | null>(null);
  const [secret, setSecret] = useState<import("firebase/auth").TotpSecret | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const enrolled = user ? (user as any).multiFactor?.enrolledFactors?.length > 0 : false;
  const begin = async () => {
    if (!user) return;
    setBusy(true);
    try {
      const { multiFactor, TotpMultiFactorGenerator } = await import("firebase/auth");
      const session = await multiFactor(user).getSession();
      const s = await TotpMultiFactorGenerator.generateSecret(session);
      setSecret(s);
      setUri(s.generateQrCodeUrl(user.email || "nt360", "nt360"));
    } catch (e) {
      toast(`MFA indisponible : ${(e as Error)?.message || "activez l'authentification multi-facteur (Identity Platform)"}`);
    } finally { setBusy(false); }
  };
  const finish = async () => {
    if (!user || !secret) return;
    setBusy(true);
    try {
      const { multiFactor, TotpMultiFactorGenerator } = await import("firebase/auth");
      const assertion = TotpMultiFactorGenerator.assertionForEnrollment(secret, code.trim());
      await multiFactor(user).enroll(assertion, "Authenticator");
      toast("MFA activé — reconnectez-vous pour que le 2e facteur soit pris en compte.");
      setUri(null); setSecret(null); setCode("");
    } catch (e) {
      toast(`Échec de l'inscription : ${(e as Error)?.message || "code invalide"}`);
    } finally { setBusy(false); }
  };
  return (
    <Card title="Ma sécurité — authentification à deux facteurs (MFA)">
      {enrolled ? (
        <Tip>Un second facteur (TOTP) est déjà associé à votre compte. ✔️</Tip>
      ) : !uri ? (
        <div className="flex items-center gap-3">
          <button type="button" className="btn-ghost !py-1.5" disabled={busy || !user} onClick={begin}>Activer le TOTP</button>
          <span className="text-[12px] text-muted">Renforce l'accès (recommandé pour les profils administrateurs).</span>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <div className="text-[12px] text-muted">Ajoutez ce compte dans votre application d'authentification (URI otpauth), puis saisissez le code à 6 chiffres :</div>
          <code className="text-[11px] break-all rounded bg-panel2 p-2">{uri}</code>
          <div className="flex items-center gap-2">
            <input className="field !py-1 w-32" aria-label="Code TOTP" placeholder="000000" value={code} onChange={(e) => setCode(e.target.value)} />
            <button type="button" className="btn-ghost !py-1.5" disabled={busy || code.trim().length < 6} onClick={finish}>Confirmer</button>
            <button type="button" className="btn-ghost !py-1.5" disabled={busy} onClick={() => { setUri(null); setSecret(null); }}>Annuler</button>
          </div>
        </div>
      )}
    </Card>
  );
}
