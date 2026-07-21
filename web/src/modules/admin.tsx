// 13 — Habilitations : matrice profil × module + attribution de rôle.
import { useState, useEffect, type FC, type ReactNode } from "react";
import { orderBy, limit } from "firebase/firestore";
import { useDocData, useCollectionData } from "../lib/hooks";
import { useCan, useClaims, useCanImport } from "../lib/rbac";
import { Card, Table, ListView, Badge, Tip, Busy, DangerBtn, Toggle, Eyebrow, colText, colNum, cx, useToast } from "../design/components";
import { httpsCallable } from "firebase/functions";
import { functions } from "../lib/firebase";
import { Select } from "../design/inputs";
import { updateMatrix, callSetUserRole, callSetUserTeam, callCreateUser, callAttachUser, callSetUserActive, callDedupe, callSetAlertThresholds, callSetNotificationConfig, callSetProjectionConfig, callSetManager, callSetRecordAccess, callSetSecurityConfig, callReindexVisibility, setAutomations, runAutomations, createApiKey, revokeApiKey, listApiKeys, setCustomFields, setOutboundWebhook, setOdooWebhook, odooWebhookStatus, setStaffingTargets, setMntFeature, purgeCollections, type ApiKeyInfo, type CustomFieldDef, type RecordAccess, type AutomationRule, type AutomationRuleType, type DedupeResult, type AlertThresholds, type NotificationConfig, type ProjectionConfigInput, type StaffingTargets } from "../lib/writes";
import { Props, DataImportCard, relTime } from "./_shared";
import { setEmailNotifyConfig, sendTestEmail, type EmailNotifyConfig } from "../lib/emailNotifyWrites";
import type { PermissionsConfig, UserRow, OpsLog, ErrorLog } from "../types";

// Les 6 profils opposables (source : functions/domain/authz.js ROLES / web/src/lib/rbac Role).
const ROLE_LIST = ["direction", "commercial_dir", "commercial", "pmo", "achats", "assistante", "lecture", "finance", "directeur_contrats", "data_steward"];
// Préréglages de matrice par persona (audit P2-5) — proposés dans l'éditeur pour un rôle encore absent de
// config/permissions. Reproduisent l'usage attendu ; la Direction les REVOIT et ENREGISTRE (jamais auto-écrits).
// Modules : clés de MODULE_LABEL. Un rôle non listé/non enregistré reste « none » partout (sûr).
const DEFAULT_ROLE_PRESET: Record<string, Record<string, string>> = {
  finance: { facturation: "write", rentabilite: "write", objectifs: "write", prevision: "read", overview: "read", clients: "read" },
  directeur_contrats: { maintenance: "write", clients: "read", overview: "read" },
  data_steward: { import: "write", qualite: "write", clients: "read", overview: "read" },
};
// Libellés humains (matrice des droits) : codes techniques → présentation FR. Repli sur le code brut
// pour un rôle/module non répertorié (rien n'est masqué). Aligné sur guide.ROLE_LABEL.
const ROLE_LABEL: Record<string, string> = {
  direction: "Direction", commercial_dir: "Directeur commercial", commercial: "Commercial",
  pmo: "PMO", achats: "Achats", assistante: "Assistante", lecture: "Lecture",
  finance: "Finance (DF)", directeur_contrats: "Directeur contrats", data_steward: "Data-steward",
};
const MODULE_LABEL: Record<string, string> = {
  overview: "Vue d'ensemble", pipeline: "Pipeline", backlog: "Backlog", import: "Imports",
  bc: "BC fournisseurs", fournisseurs: "Fournisseurs", rentabilite: "Rentabilité",
  objectifs: "Objectifs", habilitations: "Habilitations", qualite: "Qualité",
  clients: "Clients", prevision: "Prévision", facturation: "Facturation", pnlprojet: "P&L projet",
  domaines: "Domaines", maintenance: "Contrats de maintenance",
};
// Modules GOUVERNABLES connus (source de vérité de la matrice) — garantit une ligne pour CHAQUE module même
// s'il n'a encore aucune entrée stockée dans config/permissions (sinon un module récent, ex. `maintenance`,
// reste invisible et INACCORDABLE : seule la Direction peut écrire). Union avec les clés réellement stockées.
const KNOWN_MODULES = Object.keys(MODULE_LABEL);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Titre de rubrique — segmente la page Habilitations (~20 cartes) en blocs lisibles. Réutilise la
// primitive Eyebrow (aucun style de titre en dur) + un filet de séparation léger entre rubriques.
const Rubrique: FC<{ children: ReactNode }> = ({ children }) => (
  <div className="border-t border-line/50 pt-3 mt-1 first:border-t-0 first:pt-0 first:mt-0"><Eyebrow as="h2">{children}</Eyebrow></div>
);

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
  const stored = draft || data?.matrix || {};
  // Rôles connus encore ABSENTS de config/permissions → proposés dans l'éditeur avec leur préréglage
  // (audit P2-5). La Direction les REVOIT et clique « Enregistrer » : rien n'est écrit tant qu'aucune
  // cellule n'est modifiée. Un rôle non enregistré reste « none » partout côté serveur (sûr).
  const matrix: Record<string, Record<string, string>> = { ...stored };
  for (const r of Object.keys(DEFAULT_ROLE_PRESET)) if (!matrix[r]) matrix[r] = { ...DEFAULT_ROLE_PRESET[r] };
  const roles = Object.keys(matrix);
  // Union des modules CONNUS + de ceux réellement stockés sur TOUS les rôles → chaque module gouvernable a
  // une ligne, même sans entrée stockée (sinon `maintenance` & co. restent invisibles/inaccordables).
  const modules = [...new Set([...KNOWN_MODULES, ...roles.flatMap((r) => Object.keys(matrix[r] || {}))])];
  const cyc: Record<string, string> = { none: "read", read: "write", write: "none" };
  const glyph: Record<string, string> = { write: "W", read: "R", none: "–" };
  const tone: Record<string, string> = { write: "bg-emerald text-bg", read: "bg-steel text-bg", none: "bg-panel2 text-muted" };
  const setCell = (r: string, m: string) => { const b = JSON.parse(JSON.stringify(matrix)); b[r] = b[r] || {}; b[r][m] = cyc[b[r][m]] || "read"; setDraft(b); };
  return (
    <div className="flex flex-col gap-4">
      <Rubrique>Mon compte</Rubrique>
      <MfaEnrollCard />
      {canImport && <DataImportCard />}

      {isDirection && <Rubrique>Sécurité &amp; accès</Rubrique>}
      {isDirection && <MntFeatureCard />}
      {isDirection && <ParFeatureCard />}
      {isDirection && <SoaFeatureCard />}
      {isDirection && <SecurityCard users={users} />}

      {/* Intégrations API (Odoo/webhook sortant/API publique/champs custom/automatisations) + Notifications
          (Slack/Teams, e-mail Office 365) : DÉPLACÉES dans l'onglet dédié Admin › Intégration (ADR-048) —
          même garde direction-only. La config ClickUp est dans le cockpit ClickUp (ADR-047). */}

      {isDirection && <Rubrique>Réglages de calcul</Rubrique>}
      {isDirection && <ProjectionConfigCard />}
      {isDirection && <AlertThresholdsCard />}
      {isDirection && <StaffingTargetsCard />}
      {isDirection && <DedupeCard />}

      {isDirection && <Rubrique>Zone dangereuse</Rubrique>}
      {isDirection && <PurgeCard />}

      {/* Normalisation clients (alias + quasi-doublons) : DÉPLACÉE dans l'écran dédié Référentiels >
          Normalisation clients (module clientnorm). Référentiels transverses (Devises/FX, Project Managers,
          Business Units, Territoires, Équipes) : DÉPLACÉS vers Référentiels > Devises & référentiels
          (module referentielsadmin, ADR-045) — même garde direction-only, mêmes callables. Retirés d'ici. */}

      {canWrite && <Rubrique>Observabilité</Rubrique>}
      {canWrite && <OpsHealthCard />}
      {canWrite && <ClientErrorsCard />}

      <Rubrique>Droits &amp; utilisateurs</Rubrique>
      <Card title="Matrice droits (profil × module)" actions={isDirection && draft ? <div className="flex gap-2"><Busy label="Enregistrer" fn={async () => { await updateMatrix(draft); setDraft(null); }} /><button className="btn-ghost" onClick={() => setDraft(null)}>Annuler</button></div> : undefined}>
        <div className="overflow-x-auto">
          <table className="text-xs">
            <thead><tr><th className="px-2 py-1 text-left text-muted">Module</th>{roles.map((r) => <th key={r} className="px-2 py-1 text-muted font-medium whitespace-nowrap">{ROLE_LABEL[r] || r}</th>)}</tr></thead>
            <tbody>
              {modules.map((m) => (
                <tr key={m}>
                  <td className="px-2 py-1 whitespace-nowrap">{MODULE_LABEL[m] || m}</td>
                  {roles.map((r) => (
                    <td key={r} className="px-1 py-1 text-center">
                      <button disabled={!isDirection} aria-label={`Droit ${ROLE_LABEL[r] || r} sur ${MODULE_LABEL[m] || m} : ${matrix[r]?.[m] || "aucun"}`} title={`${ROLE_LABEL[r] || r} · ${MODULE_LABEL[m] || m} : ${matrix[r]?.[m] || "aucun"}`} onClick={() => isDirection && setCell(r, m)} className={cx("w-10 h-9 rounded font-semibold", tone[matrix[r]?.[m]] || "bg-panel2", isDirection && "hover:opacity-80")}>{glyph[matrix[r]?.[m]] ?? "–"}</button>
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
        <ListView colsKey="admin-users" searchKeys={[(u: UserRow) => u.email || "", (u: UserRow) => u.name || ""]} rowKey={(u: UserRow) => u.id || u.email || ""} bulk={[]} placeholder="Rechercher un utilisateur (email, nom)…" columns={[
          colText("Email", (u) => u.email), colText("Nom", (u) => u.name),
          isDirection
            ? colText("Actif", (u: UserRow) => <ActiveToggle uid={u.id!} active={u.active} />, (u: UserRow) => (u.active ? 1 : 0))
            : colText("Actif", (u) => u.active ? <Badge tone="emerald">oui</Badge> : <Badge tone="clay">non</Badge>),
          ...(isDirection ? [colNum("Rôle", (u: UserRow) => <RoleSetter uid={u.id!} current={u.role} />)] : []),
          ...(isDirection ? [colText("Manager (hiérarchie)", (u: UserRow) => <ManagerSetter uid={u.id!} current={u.managerUid} users={users} />)] : []),
          ...(isDirection ? [colText("Équipe", (u: UserRow) => <TeamSetter uid={u.id!} current={u.team} />)] : []),
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
  excludeDormant: true, // absent du doc ⇒ ACTIVÉ (miroir aggregate/forecastRollup)
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
    excludeDormant: data?.excludeDormant !== false, // absent ⇒ activé
    geleMonths: data?.geleMonths ?? 6, // seuil « Gelé » des phases amont (mois), défaut 6
  };
  return <ProjectionConfigForm key={JSON.stringify(data || {})} initial={init} />;
}
function ProjectionConfigForm({ initial }: { initial: ProjectionConfigInput }) {
  const p1 = (v: number) => String(+(v * 100).toFixed(2));
  const [st, setSt] = useState(() => Object.fromEntries(PROJ_TIERS.map((t) => [t.key, { active: initial[t.key].active, weight: p1(initial[t.key].weight) }])) as Record<string, { active: boolean; weight: string }>);
  const [cashOpening, setCashOpening] = useState(String(initial.cashOpening ?? 0));
  const [excludeDormant, setExcludeDormant] = useState(initial.excludeDormant !== false);
  const [geleMonths, setGeleMonths] = useState(String(initial.geleMonths ?? 6));
  const num = (s: string) => Number(String(s).replace(",", "."));
  const set = (k: string, patch: Partial<{ active: boolean; weight: string }>) => setSt((s) => ({ ...s, [k]: { ...s[k], ...patch } }));
  const build = (): ProjectionConfigInput => ({
    certitudes: { active: st.certitudes.active, weight: num(st.certitudes.weight) / 100 },
    forecast: { active: st.forecast.active, weight: num(st.forecast.weight) / 100 },
    pipe: { active: st.pipe.active, weight: num(st.pipe.weight) / 100 },
    cashOpening: Number.isFinite(num(cashOpening)) ? num(cashOpening) : 0,
    excludeDormant,
    geleMonths: Number.isFinite(num(geleMonths)) ? Math.max(1, Math.min(36, Math.round(num(geleMonths)))) : 6,
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
      <div className="mt-3 border-t border-line/60 pt-3 flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2 min-w-[190px]">
          <Toggle checked={excludeDormant} onChange={setExcludeDormant} ariaLabel="Exclure les opportunités dormantes" />
          <span className="text-ink font-medium">Exclure les opportunités dormantes</span>
        </div>
        <span className="text-[11px] text-faint">année de clôture antérieure à l'exercice courant</span>
      </div>
      <div className="mt-3 border-t border-line/60 pt-3 flex items-center gap-3 flex-wrap">
        <label className="flex items-center gap-2 min-w-[190px]">
          <span className="text-ink font-medium">Seuil « Gelé » (phases amont)</span>
          <span className="text-[11px] text-faint">opp non transmise âgée au-delà</span>
        </label>
        <label className="flex items-center gap-2 text-[13px]">
          <span className="text-muted">Mois</span>
          <input className="field !py-1 w-24" inputMode="numeric" value={geleMonths} onChange={(e) => setGeleMonths(e.target.value)} placeholder="6" aria-label="Seuil Gelé en mois" />
        </label>
      </div>
      <Tip>Les 3 niveaux sont des cohortes <b>disjointes</b> par certitude (IdC). Le <b>pondéré projeté</b> = somme des niveaux <b>cochés</b> uniquement. Le <b>solde d'ouverture trésorerie</b> ancre la <b>prévision cash</b> (Prévision) sur une position absolue plutôt qu'une simple variation (0 = variation depuis aujourd'hui ; peut être négatif). Les <b>opportunités dormantes</b> (clôture prévue d'un <b>millésime révolu</b>, jamais reclassée) sont retirées de la <b>prévision cumulée</b> (« Tout ») quand l'option est active — elles restent visibles dans la tuile <b>« Opportunité dormante »</b> du Pipeline (les onglets d'année les écartent déjà). Le <b>seuil « Gelé »</b> classe en phase amont <b>Gelé</b> (Pipeline) toute opportunité active non encore <b>transmise</b> (étape &lt; 3) dont l'âge dépasse ce nombre de mois. Ces réglages s'appliquent à <b>toutes les vues</b> ; l'enregistrement lance un <b>recalcul complet</b>.</Tip>
    </Card>
  );
}

// Seuils d'alerte configurables (config/alerts) : pilotent le Centre d'alertes & la Qualité des
// données. Enregistrer recalcule immédiatement côté serveur.
const DEFAULT_THR: AlertThresholds = { concentration: 0.30, surfacturationPct: 0.005, rafEcartPct: 0.10, dormantYears: 2, valorisationEcartPct: 0.30, nonFactureJours: 90 };
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
  const [valo, setValo] = useState(p1(initial.valorisationEcartPct));
  const [nfj, setNfj] = useState(String(initial.nonFactureJours));
  const num = (s: string) => Number(String(s).replace(",", "."));
  return (
    <Card title="Seuils d'alerte" actions={<Busy label="Enregistrer" okMsg="Seuils appliqués (recalcul lancé)" fn={() => callSetAlertThresholds({
      concentration: num(conc) / 100, surfacturationPct: num(surf) / 100, rafEcartPct: num(raf) / 100, dormantYears: Math.trunc(num(yrs)), valorisationEcartPct: num(valo) / 100, nonFactureJours: Math.trunc(num(nfj)),
    })} />}>
      <div className="grid gap-3 sm:grid-cols-2">
        <ThrField label="Concentration client (%)" hint="Alerte si un client dépasse cette part du CAS" value={conc} onChange={setConc} />
        <ThrField label="Surfacturation (%)" hint="Σ factures > CAS de plus de ce %" value={surf} onChange={setSurf} />
        <ThrField label="Écart RAF (%)" hint="RAF s'écarte de (CAS − Facturé) de plus de ce %" value={raf} onChange={setRaf} />
        <ThrField label="Backlog dormant (ans)" hint="Commande ouverte d'un millésime ≤ exercice − N" value={yrs} onChange={setYrs} />
        <ThrField label="Écart valorisation opp↔commande (%)" hint="CAS retenu (opp gagnée/fiche) s'écarte de la valeur P&L d'origine de plus de ce %" value={valo} onChange={setValo} />
        <ThrField label="Commande non facturée (jours)" hint="Commande signée sans aucune facture depuis plus de N jours" value={nfj} onChange={setNfj} />
      </div>
      <Tip>Pilotent le Centre d'alertes et la Qualité des données. L'enregistrement recalcule immédiatement.</Tip>
    </Card>
  );
}

// Notifications d'alerte (config/notifications) : pousse les alertes ≥ seuil vers un webhook
// entrant Slack/Teams (digest quotidien 07:00). L'URL n'est visible que des habilitations.
export function NotificationCard() {
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

// Notifications EMAIL (Office 365 / Microsoft Graph). Le secret client vit dans Secret Manager
// (GRAPH_CLIENT_SECRET), jamais dans l'app. « Tester » valide l'app Azure + le secret de bout en bout.
const EMAIL_TRIGGERS: { key: keyof EmailNotifyConfig["triggers"]; label: string }[] = [
  { key: "approvals", label: "Demandes d'approbation (au manager)" },
  { key: "relances", label: "Relances échues (au responsable, quotidien)" },
  { key: "alerts", label: "Alertes critiques (à la direction)" },
  { key: "codir", label: "Bulletin CODIR (hebdomadaire)" },
];
export function EmailNotifyCard() {
  const { data, loading } = useDocData<EmailNotifyConfig>("config/emailNotify");
  if (loading && !data) return null;
  return <EmailNotifyForm key={JSON.stringify({ e: data?.enabled, s: data?.sender, t: data?.tenantId })} initial={{
    enabled: !!data?.enabled, tenantId: data?.tenantId || "", clientId: data?.clientId || "", sender: data?.sender || "",
    recipients: { alerts: data?.recipients?.alerts || [], codir: data?.recipients?.codir || [] },
    triggers: { approvals: data?.triggers?.approvals !== false, relances: data?.triggers?.relances !== false, alerts: data?.triggers?.alerts !== false, codir: data?.triggers?.codir !== false },
  }} />;
}
function EmailNotifyForm({ initial }: { initial: EmailNotifyConfig }) {
  const [enabled, setEnabled] = useState(initial.enabled);
  const [tenantId, setTenantId] = useState(initial.tenantId);
  const [clientId, setClientId] = useState(initial.clientId);
  const [sender, setSender] = useState(initial.sender);
  const [alerts, setAlerts] = useState(initial.recipients.alerts.join(", "));
  const [codir, setCodir] = useState(initial.recipients.codir.join(", "));
  const [trig, setTrig] = useState(initial.triggers);
  const [testTo, setTestTo] = useState("");
  const parseList = (s: string) => s.split(/[,;\s]+/).map((x) => x.trim()).filter(Boolean);
  const cfg = (): EmailNotifyConfig => ({ enabled, tenantId: tenantId.trim(), clientId: clientId.trim(), sender: sender.trim(), recipients: { alerts: parseList(alerts), codir: parseList(codir) }, triggers: trig });
  const save = () => setEmailNotifyConfig(cfg());
  // Le test lève en cas d'échec → c'est `Busy` qui affiche l'unique toast (succès ou erreur). On NE toaste
  // PAS ici en plus (sinon double notification au succès).
  const test = async () => {
    const to = testTo.trim();
    if (!to) throw new Error("Renseignez une adresse de test.");
    await setEmailNotifyConfig(cfg()); // enregistre d'abord (le test lit la config serveur)
    const r = await sendTestEmail(to);
    if (!r.ok) throw new Error(r.skipped || "email non envoyé");
  };
  return (
    <Card title="Notifications email — Office 365" actions={
      <div className="flex gap-2">
        <Busy variant="ghost" label="Tester" okMsg="Email de test envoyé" errMsg="Échec du test (voir config Azure / secret)" fn={test} />
        <Busy label="Enregistrer" okMsg="Config email enregistrée" fn={save} />
      </div>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex items-center gap-2 text-[13px] text-ink sm:col-span-2">
          <Toggle checked={enabled} onChange={setEnabled} ariaLabel="Activer les notifications email" />
          Activer l'envoi d'emails via Office 365 (Microsoft Graph)
        </div>
        <label className="flex flex-col gap-1 text-[13px]"><span className="text-ink font-medium">Tenant (annuaire) Azure AD</span>
          <input className="field !py-1 font-mono" placeholder="contoso.onmicrosoft.com ou GUID" value={tenantId} onChange={(e) => setTenantId(e.target.value)} aria-label="Tenant Azure AD" /></label>
        <label className="flex flex-col gap-1 text-[13px]"><span className="text-ink font-medium">Client ID (app enregistrée)</span>
          <input className="field !py-1 font-mono" placeholder="GUID de l'application" value={clientId} onChange={(e) => setClientId(e.target.value)} aria-label="Client ID Azure AD" /></label>
        <label className="flex flex-col gap-1 text-[13px] sm:col-span-2"><span className="text-ink font-medium">Boîte émettrice (sender)</span>
          <input className="field !py-1" type="email" placeholder="no-reply@votredomaine.com" value={sender} onChange={(e) => setSender(e.target.value)} aria-label="Boîte émettrice" /></label>
        <label className="flex flex-col gap-1 text-[13px]"><span className="text-ink font-medium">Destinataires « alertes » (direction)</span>
          <input className="field !py-1" placeholder="a@x.com, b@x.com" value={alerts} onChange={(e) => setAlerts(e.target.value)} aria-label="Destinataires alertes" /></label>
        <label className="flex flex-col gap-1 text-[13px]"><span className="text-ink font-medium">Destinataires « CODIR »</span>
          <input className="field !py-1" placeholder="a@x.com, b@x.com" value={codir} onChange={(e) => setCodir(e.target.value)} aria-label="Destinataires CODIR" /></label>
        <div className="sm:col-span-2 flex flex-col gap-1.5">
          <span className="text-ink font-medium text-[13px]">Déclencheurs</span>
          <div className="grid gap-1.5 sm:grid-cols-2">
            {EMAIL_TRIGGERS.map((t) => (
              <label key={t.key} className="flex items-center gap-2 text-[13px] text-muted">
                <input type="checkbox" className="accent-gold" checked={trig[t.key]} onChange={(e) => setTrig((s) => ({ ...s, [t.key]: e.target.checked }))} aria-label={t.label} />
                {t.label}
              </label>
            ))}
          </div>
        </div>
        <label className="flex flex-col gap-1 text-[13px] sm:col-span-2"><span className="text-ink font-medium">Adresse pour l'email de test</span>
          <input className="field !py-1" type="email" placeholder="vous@votredomaine.com" value={testTo} onChange={(e) => setTestTo(e.target.value)} aria-label="Adresse de test" /></label>
      </div>
      <Tip>Le <b>secret client</b> de l'app Azure AD n'est jamais saisi ici : il est stocké dans Secret Manager (<code>GRAPH_CLIENT_SECRET</code>). L'app doit avoir la permission <b>d'application</b> <code>Mail.Send</code> (consentement admin). « Tester » enregistre la config puis envoie un email de vérification à l'adresse indiquée — valide l'app + le secret de bout en bout.</Tip>
    </Card>
  );
}

// Dédoublonnage (admin) : factures / opportunités / BC fournisseurs. Analyse d'abord (aperçu),
// puis suppression des doublons (le meilleur représentant de chaque groupe est conservé).
const DEDUPE_LABEL: Record<string, string> = { invoices: "Factures", opportunities: "Opportunités", bcLines: "BC fournisseurs" };
// PURGE (table rase) — DIRECTION only (rendu gaté en amont). Vide entièrement le P&L (commandes + chunks +
// overlays) et/ou les opportunités (+ historique). IRRÉVERSIBLE : sélection des cibles + saisie « PURGER »
// obligatoire AVANT que le bouton (rouge, DangerBtn avec re-confirmation) n'apparaisse. Sert à repartir propre
// avant un ré-import du fichier assaini. Callable serveur purgeCollections (ADR-053).
function PurgeCard() {
  const [orders, setOrders] = useState(false);
  const [opps, setOpps] = useState(false);
  const [confirm, setConfirm] = useState("");
  const targets: Array<"orders" | "opportunities"> = [...(orders ? ["orders" as const] : []), ...(opps ? ["opportunities" as const] : [])];
  const ready = targets.length > 0 && confirm === "PURGER";
  const label = targets.map((t) => (t === "orders" ? "P&L (commandes)" : "Opportunités")).join(" + ") || "—";
  return (
    <Card title="Purge des données (table rase)">
      <div className="flex flex-col gap-3">
        <Tip><b>Irréversible.</b> Efface DÉFINITIVEMENT les enregistrements sélectionnés, toutes sources confondues, avec leurs satellites et overlays de correction (annulations, alias FP, overrides CAS, jalons de facturation, historique d'étapes). À utiliser pour repartir propre avant un ré-import du fichier assaini — un ré-import reconstruit le carnet. Réservé à la Direction, tracé au journal.</Tip>
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="accent-gold mt-0.5" checked={orders} onChange={(e) => setOrders(e.target.checked)} aria-label="Purger le P&L" /><span>Purger le <b>P&amp;L</b> — commandes <span className="text-muted">(orders + chunks + overlays cancelOrders / orderCasOverride / fpAliases + jalons + approbations de commandes)</span></span></label>
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="accent-gold mt-0.5" checked={opps} onChange={(e) => setOpps(e.target.checked)} aria-label="Purger les opportunités" /><span>Purger les <b>opportunités</b> <span className="text-muted">(+ historique d'étapes + activités &amp; approbations rattachées)</span></span></label>
        <label className="flex items-center gap-2 text-sm">Tapez <b>PURGER</b> pour confirmer&nbsp;:
          <input className="field !py-1 w-40 font-mono" value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="PURGER" aria-label="Confirmation de purge" />
        </label>
        {ready ? (
          <div>
            <DangerBtn label={`Purger définitivement — ${label}`} tone="clay" okMsg="Purge effectuée (recalcul lancé)" errMsg="Purge refusée"
              confirm={`PURGE IRRÉVERSIBLE de : ${label}. Toutes les données et overlays associés seront effacés, toutes sources confondues. Confirmer ?`}
              fn={async () => { await purgeCollections(targets, confirm); setConfirm(""); setOrders(false); setOpps(false); }} />
          </div>
        ) : (
          <button className="btn-ghost text-clay opacity-40 cursor-not-allowed w-fit" disabled aria-disabled>Purger définitivement</button>
        )}
      </div>
    </Card>
  );
}

function DedupeCard() {
  const [res, setRes] = useState<DedupeResult | null>(null);
  const totalDup = res ? Object.values(res.result).reduce((s, r) => s + r.duplicates, 0) : 0;
  // `capped` = collection trop volumineuse pour être scannée intégralement → l'analyse est PARTIELLE.
  // Sans le signaler, un totalDup=0 sur une collection cappée afficherait « Aucun doublon » à tort.
  const cappedCols = res ? Object.entries(res.result).filter(([, s]) => (s as { capped?: boolean }).capped).map(([col]) => DEDUPE_LABEL[col] || col) : [];
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
            colText("", (r: any) => (r.capped ? <Badge tone="gold">scan partiel</Badge> : null)),
          ]} rows={Object.entries(res.result).map(([col, s]) => ({ col, ...s }))} />
          {cappedCols.length > 0 && (
            <Tip><b>Analyse partielle</b> : {cappedCols.join(", ")} — collection(s) trop volumineuse(s) pour un scan intégral. Des doublons peuvent rester non détectés.</Tip>
          )}
          <Tip>{res.applied
            ? "Doublons supprimés — le meilleur enregistrement de chaque groupe (source figée, plus récent) est conservé ; agrégats recalculés."
            : totalDup > 0 ? `${totalDup.toLocaleString("fr-FR")} doublon(s) détecté(s) — cliquez « Supprimer » pour nettoyer.` : cappedCols.length > 0 ? "Aucun doublon dans la partie scannée (voir l'avertissement ci-dessus)." : "Aucun doublon détecté."}</Tip>
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
      <div className="flex flex-wrap gap-2 items-center justify-end">
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
      {active
        ? <DangerBtn label="Désactiver" confirm="Désactiver ce compte ? L'utilisateur perdra l'accès dès sa prochaine actualisation de session." confirmLabel="Désactiver" okMsg="Compte désactivé" errMsg="Désactivation refusée" fn={() => callSetUserActive(uid, false)} />
        : <Busy variant="ghost" label="Réactiver" okMsg="Compte réactivé" fn={() => callSetUserActive(uid, true)} />}
    </span>
  );
}


// Maître-interrupteur du module « Contrats de maintenance » (drapeau config/mntFeature, ADR-009).
// ÉTEINT (défaut) ⇒ ERP strictement d'avant. Réservé direction (le callable re-vérifie côté serveur).
function MntFeatureCard() {
  const { data } = useDocData<{ enabled?: boolean }>("config/mntFeature");
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const enabled = data?.enabled === true;
  const toggle = async (v: boolean) => {
    if (busy) return;
    setBusy(true);
    try { await setMntFeature(v); toast(v ? "Module Contrats de maintenance ACTIVÉ" : "Module Contrats de maintenance désactivé", "ok"); }
    catch (e: any) { toast(`Échec — ${String(e?.message || e?.code || "").replace(/^functions\//, "") || "action refusée"}`, "err"); }
    finally { setBusy(false); }
  };
  return (
    <Card title="Contrats de maintenance — activation">
      <Tip>Maître-interrupteur du module. <b>Éteint</b>, l'ERP est strictement celui d'avant (aucune donnée, aucun calcul, onglet masqué). <b>Allumé</b>, l'onglet « Contrats de maintenance » apparaît pour les rôles ayant le droit <code>maintenance</code> (la direction l'a déjà). Réversible à tout moment, sans redéploiement.</Tip>
      <div className="flex items-center gap-3 mt-1">
        <Toggle checked={enabled} onChange={toggle} disabled={busy} ariaLabel="Activer le module Contrats de maintenance" />
        <span className={cx("text-[13px]", enabled ? "text-emerald" : "text-muted")}>{enabled ? "Activé" : "Désactivé"}</span>
      </div>
    </Card>
  );
}

// Maître-interrupteur du module « Partenariats & Certifications » (drapeau config/parFeature, ADR-P01),
// même patron que MntFeatureCard. ÉTEINT (défaut) ⇒ ERP strictement d'avant. Réservé direction.
function ParFeatureCard() {
  const { data } = useDocData<{ enabled?: boolean }>("config/parFeature");
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const enabled = data?.enabled === true;
  const toggle = async (v: boolean) => {
    if (busy) return;
    setBusy(true);
    // Callable défini inline (module lazy) plutôt que dans writes.ts : évite d'alourdir le chunk
    // d'entrée (au plafond de 120 KB) pour un interrupteur d'admin rarement appelé. Patron maintenance.tsx.
    try { await httpsCallable(functions, "setParFeature")({ enabled: v }); toast(v ? "Module Partenariats & Certifications ACTIVÉ" : "Module Partenariats & Certifications désactivé", "ok"); }
    catch (e: any) { toast(`Échec — ${String(e?.message || e?.code || "").replace(/^functions\//, "") || "action refusée"}`, "err"); }
    finally { setBusy(false); }
  };
  return (
    <Card title="Partenariats & Certifications — activation">
      <Tip>Maître-interrupteur du module. <b>Éteint</b>, l'ERP est strictement celui d'avant (aucune donnée, aucun calcul, onglet masqué). <b>Allumé</b>, l'onglet « Partenariats » apparaît pour les rôles ayant le droit <code>partenariats</code>. Réversible à tout moment, sans redéploiement.</Tip>
      <div className="flex items-center gap-3 mt-1">
        <Toggle checked={enabled} onChange={toggle} disabled={busy} ariaLabel="Activer le module Partenariats & Certifications" />
        <span className={cx("text-[13px]", enabled ? "text-emerald" : "text-muted")}>{enabled ? "Activé" : "Désactivé"}</span>
      </div>
    </Card>
  );
}

// Drapeau « Vérité du coût » (config/soaFeature, ADR-P21). CONTRAIREMENT à Mnt/Par ce N'EST PAS un
// maître-interrupteur de module (aucun onglet masqué) : il bascule la SOURCE du solde du compte
// fournisseur (SOA). ÉTEINT (défaut) ⇒ solde piloté par le statut BC « facturé » (ERP d'avant) ;
// ALLUMÉ ⇒ solde dérivé des FACTURES FOURNISSEUR RÉELLES (collection supplierInvoices). Réservé direction.
function SoaFeatureCard() {
  const { data } = useDocData<{ enabled?: boolean }>("config/soaFeature");
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const enabled = data?.enabled === true;
  const toggle = async (v: boolean) => {
    if (busy) return;
    setBusy(true);
    // Callable inline (module lazy) plutôt que dans writes.ts : le chunk d'entrée est au plafond 120 KB.
    try { await httpsCallable(functions, "setSoaFeature")({ enabled: v }); toast(v ? "Vérité du coût ACTIVÉE — le solde SOA suit les factures fournisseur" : "Vérité du coût désactivée — retour au solde piloté par le statut BC", "ok"); }
    catch (e: any) { toast(`Échec — ${String(e?.message || e?.code || "").replace(/^functions\//, "") || "action refusée"}`, "err"); }
    finally { setBusy(false); }
  };
  return (
    <Card title="Vérité du coût — solde fournisseur">
      <Tip><b>Éteint</b> (défaut), le solde du compte fournisseur (SOA) est piloté par le statut BC « facturé » — l'ERP d'avant. <b>Allumé</b>, le solde dérive des <b>factures fournisseur réelles</b> (saisies dans « Crédit Fournisseurs »). Saisissez d'abord les pièces, <b>puis</b> basculez : à l'activation, le solde repart des factures enregistrées. Réversible sans redéploiement.</Tip>
      <div className="flex items-center gap-3 mt-1">
        <Toggle checked={enabled} onChange={toggle} disabled={busy} ariaLabel="Activer la vérité du coût (solde SOA depuis les factures fournisseur)" />
        <span className={cx("text-[13px]", enabled ? "text-emerald" : "text-muted")}>{enabled ? "Activé" : "Désactivé"}</span>
      </div>
    </Card>
  );
}



function RoleSetter({ uid, current }: { uid: string; current?: string }) {
  const [role, setRole] = useState(current && ROLE_LIST.includes(current) ? current : "lecture");
  return (
    <span className="inline-flex gap-1.5">
      <Select ariaLabel="Rôle de l'utilisateur" className="!py-1" value={role} onChange={setRole}
        options={ROLE_LIST.map((r) => ({ value: r, label: r }))} />
      <Busy label="Appliquer" okMsg="Rôle appliqué" fn={() => callSetUserRole(uid, role)} />
    </span>
  );
}

// Affecte un utilisateur à une ÉQUIPE (Lot 10b) — choix dans le référentiel config/teams.
function TeamSetter({ uid, current }: { uid: string; current?: string | null }) {
  const { data } = useDocData<{ list?: string[] }>("config/teams");
  const [team, setTeam] = useState(current || "");
  const options = [{ value: "", label: "— aucune —" }, ...(data?.list || []).map((t) => ({ value: t, label: t }))];
  return (
    <span className="inline-flex gap-1.5">
      <Select ariaLabel="Équipe de l'utilisateur" className="!py-1" value={team} onChange={setTeam} options={options} />
      <Busy label="Appliquer" okMsg="Équipe posée" errMsg="Refusé" fn={() => callSetUserTeam(uid, team || null)} />
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
      <Busy label="Appliquer" okMsg="Manager posé (visibilité ré-indexée)" errMsg="Refusé (cycle ou droit insuffisant)" fn={() => callSetManager(uid, mgr || null)} />
    </span>
  );
}

// Sécurité par enregistrement (direction) : OWD par objet (public/privé), dérivation/ré-indexage de la
// visibilité, politique MFA. Non destructif : par défaut tout est « public » (comportement historique).
function SecurityCard({ users: _users }: { users: UserRow[] }) {
  const { data: owd } = useDocData<Partial<RecordAccess>>("config/recordAccess");
  const { data: sec } = useDocData<{ require2fa?: boolean }>("config/security");
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
        <Busy variant="ghost" label="Ré-indexer la visibilité"
          okMsg={(r) => `${r.reindexed} enregistrement(s) ré-indexé(s)${r.derived ? `, ${r.derived} propriétaire(s) dérivé(s) de l'AM` : ""}`}
          fn={() => callReindexVisibility(derive)} />
      </div>
      <div className="mt-3 flex items-center justify-between gap-3 border-t border-hair pt-3">
        <div><div className="text-[13px]">MFA obligatoire (actions sensibles)</div><div className="text-[11px] text-muted">Exige un 2e facteur pour les opérations d'administration.</div></div>
        <Toggle checked={!!sec?.require2fa} onChange={(v) => { callSetSecurityConfig(v).catch(() => {}); }} ariaLabel="MFA obligatoire" />
      </div>
      <Tip>Passez un objet en <b>privé</b> APRÈS un ré-indexage (sinon les enregistrements sans propriétaire seraient invisibles des non-administrateurs). La direction et les administrateurs (droit « habilitations ») voient tout. Le SSO et le fournisseur MFA se configurent côté Identity Platform (console Firebase).</Tip>
    </Card>
  );
}

// Automatisation déclarative (direction) : règles sans code qui génèrent des tâches (objet Activité)
// quand une opportunité entre dans un état à traiter. Idempotent côté serveur (clé type:oppId).
const AUTOMATION_META: Record<AutomationRuleType, string> = {
  opp_no_nextstep: "Opportunité ouverte sans prochaine action → tâche « Définir la prochaine action »",
  opp_stale: "Opportunité dormante (fantôme) → tâche « Requalifier »",
};
export function AutomationCard() {
  const { data } = useDocData<{ rules?: AutomationRule[] }>("config/automations");
  const types = Object.keys(AUTOMATION_META) as AutomationRuleType[];
  const [draft, setDraft] = useState<Record<AutomationRuleType, { enabled: boolean; dueInDays: number }> | null>(null);
  const current: Record<string, { enabled: boolean; dueInDays: number }> = {};
  types.forEach((t) => { const r = (data?.rules || []).find((x) => x.type === t); current[t] = { enabled: !!r?.enabled, dueInDays: r?.dueInDays || 7 }; });
  const state = draft || (current as Record<AutomationRuleType, { enabled: boolean; dueInDays: number }>);
  const setRule = (t: AutomationRuleType, patch: Partial<{ enabled: boolean; dueInDays: number }>) =>
    setDraft({ ...(state as any), [t]: { ...state[t], ...patch } });
  return (
    <Card title="Automatisation déclarative (règles → tâches)" actions={
      <div className="flex gap-2">
        {draft && <Busy label="Enregistrer" okMsg="Règles enregistrées" fn={async () => { await setAutomations(types.map((t) => ({ type: t, enabled: state[t].enabled, dueInDays: state[t].dueInDays }))); setDraft(null); }} />}
        <Busy variant="ghost" label="Exécuter maintenant" okMsg={(r) => `${r.created} tâche(s) créée(s) sur ${r.evaluated} opportunité(s)`} fn={() => runAutomations()} />
      </div>}>
      <div className="flex flex-col gap-2">
        {types.map((t) => (
          <div key={t} className="flex items-center justify-between gap-3 border-t border-hair py-2 text-[13px]">
            <div className="grow">{AUTOMATION_META[t]}</div>
            <label className="flex items-center gap-1 text-[11px] text-muted">échéance
              <input className="field !py-1 w-16" inputMode="numeric" value={String(state[t].dueInDays)} onChange={(e) => setRule(t, { dueInDays: Math.max(1, Number(e.target.value) || 7) })} aria-label={`Échéance (jours) — ${t}`} />j</label>
            <Toggle checked={state[t].enabled} onChange={(v) => setRule(t, { enabled: v })} ariaLabel={`Activer la règle ${t}`} />
          </div>
        ))}
      </div>
      <Tip>Les règles actives sont évaluées au recalcul quotidien (05:00) et via « Exécuter maintenant ». Une tâche n'est <b>jamais recréée</b> pour la même opportunité (idempotence). Les tâches suivent la sécurité par enregistrement (propriétaire de l'opportunité).</Tip>
    </Card>
  );
}

// Clés API (direction) : gestion des clés d'accès à l'API REST publique (/v1). La clé brute n'est
// affichée QU'UNE fois à la création (le serveur n'en garde que le hash). Scopes read/write.
export function ApiKeysCard() {
  const toast = useToast();
  const [keys, setKeys] = useState<ApiKeyInfo[]>([]);
  const [label, setLabel] = useState("");
  const [canRead, setCanRead] = useState(true);
  const [canWriteScope, setCanWriteScope] = useState(false);
  const [fresh, setFresh] = useState<string | null>(null);
  const load = async () => { try { const r = await listApiKeys(); setKeys(r.keys); } catch { setKeys([]); } };
  useEffect(() => { load().catch(() => {}); }, []);
  return (
    <Card title="Clés API (API REST /v1)" actions={
      <div className="flex flex-wrap items-center justify-end gap-2">
        <input className="field !py-1 w-full sm:w-40 text-xs" value={label} onChange={(e) => setLabel(e.target.value)} aria-label="Libellé de la clé" placeholder="Libellé (ex. CRM externe)" />
        <label className="flex items-center gap-1 text-[11px] text-muted"><input type="checkbox" checked={canRead} onChange={(e) => setCanRead(e.target.checked)} />read</label>
        <label className="flex items-center gap-1 text-[11px] text-muted"><input type="checkbox" checked={canWriteScope} onChange={(e) => setCanWriteScope(e.target.checked)} />write</label>
        <Busy variant="ghost" label="Créer" okMsg="Clé créée" errMsg="Échec" fn={async () => {
          const scopes = [...(canRead ? ["read"] : []), ...(canWriteScope ? ["write"] : [])]; if (!scopes.length) throw new Error("au moins un scope");
          const r = await createApiKey(label.trim() || "clé API", scopes); setFresh(r.key); setLabel(""); await load();
        }} />
      </div>}>
      <Tip>Une clé API accède à l'organisation <b>entière</b> : le scope <b>read</b> retourne <b>toutes</b> les opportunités et tous les comptes, <b>indépendamment</b> du cloisonnement par propriétaire (OWD privé) de l'app. Les champs confidentiels (marge) restent masqués. N'émettez une clé qu'à un système de confiance.</Tip>
      {fresh && (
        <div className="mb-3 rounded border border-gold/40 bg-gold/10 p-2">
          <div className="text-[12px] text-muted mb-1">Copiez cette clé maintenant — elle ne sera plus affichée :</div>
          <div className="flex items-center gap-2"><code className="text-[12px] break-all">{fresh}</code>
            <button type="button" className="btn-ghost !py-1 text-xs" onClick={() => { navigator.clipboard?.writeText(fresh).then(() => toast("Clé copiée")); }}>Copier</button>
            <button type="button" className="btn-ghost !py-1 text-xs" onClick={() => setFresh(null)}>Masquer</button></div>
        </div>
      )}
      {keys.length ? (
        <div className="flex flex-col">
          {keys.map((k) => (
            <div key={k.id} className="flex items-center justify-between gap-2 border-t border-hair py-2 text-[13px]">
              <span className="inline-flex items-center gap-2">{!k.active && <Badge tone="clay">révoquée</Badge>}<span className="font-medium">{k.label}</span><code className="text-[11px] text-muted">{k.prefix}…</code>{k.scopes.map((s) => <Badge key={s} tone="steel">{s}</Badge>)}</span>
              {k.active && <DangerBtn label="Révoquer" confirm={`Révoquer la clé « ${k.label} » ? Tout système qui l'utilise perdra l'accès à l'API immédiatement (irréversible).`} confirmLabel="Révoquer" okMsg="Clé révoquée" errMsg="Révocation refusée" fn={async () => { await revokeApiKey(k.id); await load(); }} />}
            </div>
          ))}
        </div>
      ) : <Tip>Aucune clé. Créez une clé pour permettre à un système tiers d'appeler l'API REST : <code>GET /v1/opportunities</code>, <code>POST /v1/opportunities</code>, <code>GET /v1/accounts</code> — en-tête <code>Authorization: Bearer nt360_…</code>.</Tip>}
    </Card>
  );
}

// Champs custom d'opportunité (direction) : définitions sans code (clé dérivée du libellé, type
// text/number/select). Rendues dans la fiche opportunité. Le serveur valide les valeurs saisies.
export function CustomFieldsCard() {
  const { data } = useDocData<{ fields?: CustomFieldDef[] }>("config/customFields");
  const [draft, setDraft] = useState<CustomFieldDef[] | null>(null);
  const rows = draft || data?.fields || [];
  const set = (i: number, patch: Partial<CustomFieldDef>) => { const b = rows.map((r, j) => (j === i ? { ...r, ...patch } : r)); setDraft(b); };
  const add = () => setDraft([...(rows as CustomFieldDef[]), { key: "", label: "", type: "text", options: [], active: true }]);
  const del = (i: number) => setDraft(rows.filter((_, j) => j !== i));
  return (
    <Card title="Champs personnalisés (opportunité)" actions={
      <div className="flex gap-2">
        <button type="button" className="btn-ghost !py-1 text-xs" onClick={add}>+ champ</button>
        {draft && <Busy label="Enregistrer" okMsg="Champs enregistrés" fn={async () => { await setCustomFields(draft.map((r) => ({ key: r.key || r.label, label: r.label, type: r.type, options: r.options, active: r.active }))); setDraft(null); }} />}
      </div>}>
      {rows.length ? (
        <div className="flex flex-col gap-2">
          {rows.map((r, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2 border-t border-hair py-2 text-[13px]">
              <input className="field !py-1 w-44" value={r.label} onChange={(e) => set(i, { label: e.target.value })} aria-label="Libellé du champ" placeholder="Libellé (ex. Concurrent)" />
              <Select ariaLabel="Type" className="!py-1 w-28" value={r.type} onChange={(v) => set(i, { type: v as CustomFieldDef["type"] })} options={[{ value: "text", label: "Texte" }, { value: "number", label: "Nombre" }, { value: "select", label: "Liste" }, { value: "date", label: "Date" }, { value: "checkbox", label: "Case à cocher" }]} />
              {r.type === "select" && <input className="field !py-1 grow" value={(r.options || []).join(", ")} onChange={(e) => set(i, { options: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })} aria-label="Options (séparées par des virgules)" placeholder="Option A, Option B…" />}
              <label className="flex items-center gap-1 text-[11px] text-muted"><input type="checkbox" checked={r.active} onChange={(e) => set(i, { active: e.target.checked })} />actif</label>
              <button type="button" className="text-clay hover:underline text-[11px]" onClick={() => del(i)}>suppr.</button>
            </div>
          ))}
        </div>
      ) : <Tip>Aucun champ personnalisé. Ajoutez des champs (texte / nombre / liste) qui apparaîtront dans la fiche opportunité — utile pour étendre le modèle sans code.</Tip>}
    </Card>
  );
}

// Objectifs d'occupation / TACE (direction, Lot 18 DirOps) : cibles globales (%) affinables par grade
// et par BU. Le cockpit Staffing compare le constaté à ces cibles et signale la dérive.
function StaffingTargetsCard() {
  const { data } = useDocData<StaffingTargets>("config/staffingTargets");
  const [occ, setOcc] = useState<string | null>(null);
  const [tace, setTace] = useState<string | null>(null);
  const [grade, setGrade] = useState<string | null>(null); // saisie "junior:70, senior:90"
  const [bu, setBu] = useState<string | null>(null);
  const fmt = (m?: Record<string, number>) => Object.entries(m || {}).map(([k, v]) => `${k}:${v}`).join(", ");
  const parse = (s: string) => { const o: Record<string, number> = {}; for (const p of s.split(",")) { const [k, v] = p.split(":"); const n = Number(v); if (k && k.trim() && Number.isFinite(n)) o[k.trim()] = n; } return o; };
  const curOcc = occ ?? String(data?.occupancy ?? 85);
  const curTace = tace ?? String(data?.tace ?? 85);
  const curGrade = grade ?? fmt(data?.byGrade);
  const curBu = bu ?? fmt(data?.byBu);
  return (
    <Card title="Objectifs d'occupation (staffing)">
      <div className="flex flex-wrap items-end gap-3 text-[13px]">
        <label className="flex flex-col gap-0.5"><span className="text-[11px] text-muted">Occupation cible (%)</span>
          <input className="field !py-1 w-24" type="number" value={curOcc} onChange={(e) => setOcc(e.target.value)} aria-label="Occupation cible" /></label>
        <label className="flex flex-col gap-0.5"><span className="text-[11px] text-muted">TACE cible (%)</span>
          <input className="field !py-1 w-24" type="number" value={curTace} onChange={(e) => setTace(e.target.value)} aria-label="TACE cible" /></label>
        <label className="flex flex-col gap-0.5 grow"><span className="text-[11px] text-muted">Par grade (ex. junior:70, senior:90)</span>
          <input className="field !py-1 w-full" value={curGrade} onChange={(e) => setGrade(e.target.value)} aria-label="Cibles par grade" /></label>
        <label className="flex flex-col gap-0.5 grow"><span className="text-[11px] text-muted">Par BU (ex. DATA:88, CLOUD:80)</span>
          <input className="field !py-1 w-full" value={curBu} onChange={(e) => setBu(e.target.value)} aria-label="Cibles par BU" /></label>
        <Busy label="Enregistrer" okMsg="Objectifs enregistrés" errMsg="Refusé"
          fn={async () => { await setStaffingTargets({ occupancy: Number(curOcc) || 85, tace: Number(curTace) || 85, byGrade: parse(curGrade), byBu: parse(curBu) }); setOcc(null); setTace(null); setGrade(null); setBu(null); }} />
      </div>
      <Tip>Priorité des cibles : <b>grade</b> &gt; <b>BU</b> &gt; global. Le cockpit « Activité » du Staffing marque en rouge les ressources <b>sous l'objectif</b> et compte la dérive.</Tip>
    </Card>
  );
}

// Webhook sortant (direction) : diffuse les événements métier (opp gagnée, approbation décidée) vers
// un endpoint tiers. L'URL est sensible (lecture réservée aux habilitations côté rules).
export function OutboundWebhookCard() {
  const { data } = useDocData<{ url?: string; events?: string[]; enabled?: boolean }>("config/outboundWebhooks");
  const [url, setUrl] = useState<string | null>(null);
  const [ev, setEv] = useState<string[] | null>(null);
  const curUrl = url ?? data?.url ?? "";
  const curEv = ev ?? data?.events ?? [];
  const toggleEv = (e: string) => setEv((curEv.includes(e) ? curEv.filter((x) => x !== e) : [...curEv, e]));
  const EVENTS = [{ key: "opp_won", label: "Opportunité gagnée" }, { key: "approval_decided", label: "Approbation décidée" }];
  return (
    <Card title="Webhook sortant (événements)" actions={
      <div className="flex gap-2">
        <Busy variant="ghost" label="Tester" okMsg="Ping envoyé" errMsg="Échec" fn={() => setOutboundWebhook({ url: curUrl, events: curEv, enabled: true, test: true })} />
        <Busy label="Enregistrer" okMsg="Webhook enregistré" fn={async () => { await setOutboundWebhook({ url: curUrl, events: curEv, enabled: !!curUrl }); setUrl(null); setEv(null); }} />
      </div>}>
      <div className="flex flex-col gap-2 text-[13px]">
        <label className="flex flex-col gap-1"><span className="text-[11px] text-muted">URL (https)</span>
          <input className="field !py-1" value={curUrl} onChange={(e) => setUrl(e.target.value)} aria-label="URL du webhook" placeholder="https://exemple.com/hooks/nt360" /></label>
        <div className="flex flex-wrap gap-3">
          {EVENTS.map((e) => <label key={e.key} className="flex items-center gap-1.5 text-[12px]"><input type="checkbox" checked={curEv.includes(e.key)} onChange={() => toggleEv(e.key)} />{e.label}</label>)}
        </div>
        <Tip>nt360 enverra un POST JSON <code>{'{ event, data, ts }'}</code> à l'URL à chaque événement souscrit. {data?.enabled ? "Actif." : "Inactif (URL vide)."}</Tip>
      </div>
    </Card>
  );
}

// Webhook ENTRANT Odoo (opportunités / commandes / factures). `config/odooWebhook` n'est PAS lisible côté
// client (il porte le secret) : l'état est lu via le callable `odooWebhookStatus` (jamais le secret). Le
// secret partagé est écrit seul (≥ 16 car.) ; laisser vide conserve l'existant. `enabled` = interrupteur (gate).
export function OdooWebhookCard() {
  const [status, setStatus] = useState<Awaited<ReturnType<typeof odooWebhookStatus>> | null>(null);
  const [enabled, setEnabled] = useState(true);
  const [secret, setSecret] = useState("");
  useEffect(() => { odooWebhookStatus().then((s) => { setStatus(s); setEnabled(s.enabled); }).catch(() => setStatus({ enabled: false, hasSecret: false })); }, []);
  const live = !!status && status.hasSecret && status.enabled;
  const save = async () => {
    const patch: { secret?: string; enabled?: boolean } = { enabled };
    if (secret.trim()) patch.secret = secret.trim();
    const r = await setOdooWebhook(patch);
    setStatus({ enabled: r.enabled, hasSecret: r.hasSecret }); setSecret("");
  };
  return (
    <Card title="Webhook entrant — Odoo" actions={<Busy label="Enregistrer" okMsg="Intégration Odoo enregistrée" errMsg="Enregistrement refusé" fn={save} />}>
      <div className="flex flex-col gap-2 text-[13px]">
        <div className="flex items-center gap-2">
          {status == null ? <Badge>chargement…</Badge> : live ? <Badge tone="emerald">Active</Badge> : status.hasSecret ? <Badge tone="clay">Désactivée</Badge> : <Badge tone="clay">Secret manquant</Badge>}
          <span className="text-[11px] text-muted">Réception des mises à jour Odoo (source autoritaire) — opportunités, commandes, factures.</span>
        </div>
        <label className="flex items-center gap-2"><Toggle checked={enabled} onChange={setEnabled} ariaLabel="Activer l'intégration Odoo" />Activer la réception (interrupteur — coupe l'intégration sans supprimer le secret)</label>
        <label className="flex flex-col gap-1"><span className="text-[11px] text-muted">Secret partagé HMAC (≥ 16 caractères — écrit seul, jamais réaffiché)</span>
          <input className="field !py-1" type="password" value={secret} onChange={(e) => setSecret(e.target.value)} aria-label="Secret partagé Odoo" placeholder={status?.hasSecret ? "•••••••• (laisser vide pour conserver)" : "collez le secret partagé"} /></label>
        {/* État de réception : seul moyen côté app de vérifier qu'un renvoi (unitaire §4ter / backfill §4bis),
            déclenché CÔTÉ ODOO, est bien arrivé — le webhook est entrant uniquement (pas de client sortant). */}
        {status?.lastReceived && (
          <div className="text-[12px] text-muted">
            Dernier envoi reçu : <span className="text-ink tabnum">{status.lastReceived.at ? new Date(status.lastReceived.at).toLocaleString("fr-FR") : "—"}</span>
            {" "}· objet <b className="text-ink">{status.lastReceived.object || "—"}</b>
            {" "}· <span className="tabnum">{status.lastReceived.written}</span> écrit(s){status.lastReceived.failed ? <> · <span className="text-clay tabnum">{status.lastReceived.failed} échec(s)</span></> : ""}
          </div>
        )}
        <Tip>Odoo pousse ses mises à jour en <b>POST JSON signé</b> (<code>X-Signature</code>, HMAC-SHA256 du corps) vers la fonction <code>odooWebhook</code>. Le secret partagé signe le corps ; il est stocké côté serveur et <b>jamais réaffiché</b>. La <b>récupération</b> (unitaire par DC ou backfill en masse) se déclenche <b>côté Odoo</b> — Server Actions prêtes à coller dans <code>docs/ODOO_WEBHOOK.md</code> (§4bis/§4ter) ; le renvoi est idempotent (aucun doublon).</Tip>
      </div>
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
