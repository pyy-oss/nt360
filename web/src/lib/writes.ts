// Écritures gardées (BUILD_KIT §12, F5). Les rules restent la barrière opposable :
// ces écritures échouent côté serveur si le rôle est insuffisant (UI désactivée en amont).
import { httpsCallable } from "firebase/functions";
import { functions } from "./firebase";
import type { MntContrat } from "../types";

// Un appel callable peut échouer TRANSITOIREMENT pendant un DÉPLOIEMENT des Cloud Functions : le temps
// que la fonction soit remplacée, l'infra renvoie un 500/INTERNAL (parfois UNAVAILABLE / DEADLINE).
// Pour les appels de LECTURE idempotents (analyses), on réessaie brièvement sur ces codes transitoires
// avant d'abandonner — sinon un simple redéploiement fait échouer « Analyser » et fige la liste. Les
// vraies erreurs (permission, invalid-argument…) remontent immédiatement, sans réessai.
const TRANSIENT_CODES = new Set([
  "functions/internal", "internal",
  "functions/unavailable", "unavailable",
  "functions/deadline-exceeded", "deadline-exceeded",
]);
async function withTransientRetry<T>(fn: () => Promise<T>, tries = 4): Promise<T> {
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    try { return await fn(); }
    catch (e) {
      last = e;
      if (!TRANSIENT_CODES.has(String((e as { code?: string })?.code || ""))) throw e;
      if (i < tries - 1) await new Promise((r) => setTimeout(r, 2000 * (i + 1))); // 2s, 4s, 6s (déploiement ~qq s/fonction)
    }
  }
  throw last;
}

export type OppInput = {
  id?: string; client: string; am: string; bu: string; amount: number; stage: number;
  probability: number; closingDate?: string; fp?: string; mbPrev?: number; dr?: boolean;
  nextStep?: string; nextStepDate?: string | null; lostReason?: string; ownerUid?: string | null;
  forecastCategory?: ForecastCategory | null; custom?: Record<string, unknown>; lines?: OppLine[];
  leadSource?: string; competitor?: string;
};
// LIGNES PRODUIT / CPQ-lite (Lot 8) — quand des lignes existent, le montant de l'opp est DÉRIVÉ.
export type OppLine = { product: string; qty: number; unitPrice: number; discountPct: number; lineTotal?: number };
export type ForecastCategory = "omitted" | "pipeline" | "best_case" | "commit";
// CHAMPS CUSTOM (Lot 7b) — définitions éditées par la direction, valeurs stockées dans opp.custom.
export type CustomFieldDef = { key: string; label: string; type: "text" | "number" | "select" | "date" | "checkbox"; options: string[]; active: boolean };

/** Crée OU met à jour une opportunité de saisie (onCall : pose source='saisie', calcule le
 *  pondéré + l'étiquette d'étape, puis RECALCULE les agrégats — sinon l'opp reste invisible). */
export async function upsertOpportunity(data: OppInput): Promise<{ ok: boolean; id: string }> {
  const res = await httpsCallable(functions, "upsertOpportunity")(data);
  return res.data as { ok: boolean; id: string };
}

/** Supprime une opportunité SAISIE (onCall : recalcule ensuite). */
export async function deleteOpportunity(id: string) {
  await httpsCallable(functions, "deleteOpportunity")({ id });
}

/** Corrige une opportunité EXISTANTE (importée ou saisie) sans changer sa source : N° FP, D Prev,
 *  montant, étape, AM, BU. Comble le cas « opp gagnée importée sans N° FP ». onCall : recalcule. */
export async function patchOpportunity(data: { id: string; fp?: string; closingDate?: string | null; amount?: number; stage?: number; am?: string; bu?: string; probability?: number; nextStep?: string; nextStepDate?: string | null; lostReason?: string; ownerUid?: string | null; forecastCategory?: ForecastCategory | null; custom?: Record<string, unknown>; lines?: OppLine[]; leadSource?: string; competitor?: string }) {
  await httpsCallable(functions, "patchOpportunity")(data);
}

// PRÉVISION COMMERCIALE GOUVERNABLE (Lot 5) — roll-up des catégories de prévision sur le périmètre visible.
export type ForecastAmRow = { am: string; closed: number; commit: number; bestCase: number; pipeline: number; counts: { closed: number; commit: number; bestCase: number; pipeline: number } };
export type ForecastRollup = {
  ok: boolean; fiscalYear: number; allPeriods?: boolean; scoped: boolean; quota: number;
  closed: number; commit: number; bestCase: number; pipeline: number;
  counts: { closed: number; commit: number; bestCase: number; pipeline: number; omitted: number };
  attainment: { closed: number; commit: number; bestCase: number } | null;
  byAm?: ForecastAmRow[];
};
/** Roll-up de la prévision commerciale (catégories Commit/Best Case/Pipeline/Closed) + atteinte du quota,
 *  filtré sur l'EXERCICE sélectionné (année de clôture) ; `period` = "2026" ou "all"/absent (cumul). */
export async function forecastRollup(period?: string) {
  const res = await httpsCallable(functions, "forecastRollup")({ period: period || "all" });
  return res.data as ForecastRollup;
}

// CONSULTANTS / RESSOURCES (Lot 11 « 20/10 DirOps ») — annuaire des ressources délivrantes.
export type ConsultantGrade = "junior" | "confirme" | "senior" | "expert" | "manager";
export type ConsultantStatus = "active" | "intercontrat" | "conge" | "inactive";
export type Consultant = {
  id?: string; name: string; email?: string; grade?: ConsultantGrade; bu?: string;
  tjmTarget?: number | null; cjm?: number | null; skills?: string[]; status?: ConsultantStatus;
  managerUid?: string | null; startDate?: string | null; clickupUserId?: string | null;
};
export async function upsertConsultant(c: Consultant) {
  const res = await httpsCallable(functions, "upsertConsultant")(c);
  return res.data as { ok: boolean; id: string };
}
export async function deleteConsultant(id: string) {
  const res = await httpsCallable(functions, "deleteConsultant")({ id });
  return res.data as { ok: boolean };
}
export async function listConsultants() {
  const res = await httpsCallable(functions, "listConsultants")({});
  return res.data as { ok: boolean; rows: Consultant[]; canCost: boolean };
}

// PLAN DE CHARGE / STAFFING (Lot 12) — affectations consultant × mission × période + charge calculée.
export type Assignment = {
  id?: string; consultantId: string; projectFp?: string | null; label?: string;
  startMonth: string; endMonth: string; allocationPct: number; tjmBilled?: number | null;
  status?: "planned" | "confirmed";
};
export type StaffingPlan = {
  ok: boolean; months: string[];
  consultants: { id: string; name: string | null; status: string; bu: string | null }[];
  assignments: Assignment[];
  byConsultant: Record<string, Record<string, number>>;
  flags: { over: { id: string; month: string; pct: number }[]; idle: { id: string; month: string }[] };
};
export async function upsertAssignment(a: Assignment) {
  const res = await httpsCallable(functions, "upsertAssignment")(a);
  return res.data as { ok: boolean; id: string };
}
export async function deleteAssignment(id: string) {
  const res = await httpsCallable(functions, "deleteAssignment")({ id });
  return res.data as { ok: boolean };
}
export async function staffingPlan(fromMonth?: string, months?: number) {
  const res = await httpsCallable(functions, "staffingPlan")({ fromMonth, months });
  return res.data as StaffingPlan;
}

// KPI D'ACTIVITÉ (Lot 13) — occupation, intercontrat, CA/marge staffés prévisionnels.
// + objectifs d'occupation (Lot 18) : cible par ressource + détection de dérive.
export type ActivityConsultant = { id: string; name: string | null; bu: string | null; status: string; occupancyPct: number; idleMonths: number; billableDays: number; revenueForecast: number; marginForecast: number | null; targetPct?: number; belowBy?: number; isBelow?: boolean };
export type ActivityBu = { bu: string; headcount: number; active: number; occupancyPct: number; revenueForecast: number; marginForecast: number | null };
export type StaffingTargets = { occupancy: number; tace: number; byGrade: Record<string, number>; byBu: Record<string, number> };
export type ActivityKpis = {
  ok: boolean; months: string[]; canCost: boolean;
  global: { headcount: number; active: number; occupancyPct: number; intercontratPct: number; revenueForecast: number; marginForecast: number | null };
  byBu: ActivityBu[]; rows: ActivityConsultant[];
  targets?: StaffingTargets; occupancyTargetPct?: number; belowTargetCount?: number;
};
export async function activityKpis(fromMonth?: string, months?: number) {
  const res = await httpsCallable(functions, "activityKpis")({ fromMonth, months });
  return res.data as ActivityKpis;
}
export async function setStaffingTargets(t: Partial<StaffingTargets>) {
  const res = await httpsCallable(functions, "setStaffingTargets")(t);
  return res.data as { ok: boolean } & StaffingTargets;
}

// CAPACITÉ ⇄ PIPELINE (Lot 14) — capacité de délivrance disponible vs demande pipeline pondérée.
export type CapacityBu = { bu: string; capacityDays: number; demandDays: number; gapDays: number; fteGap: number };
export type CapacityPlan = {
  ok: boolean; months: string[]; openOppCount: number; tjm: number;
  capacityDays: number; demandDays: number; gapDays: number; fteGap: number; byBu: CapacityBu[];
};
export async function capacityPlan(fromMonth?: string, months?: number) {
  const res = await httpsCallable(functions, "capacityPlan")({ fromMonth, months });
  return res.data as CapacityPlan;
}

// CRA / TEMPS CONSTATÉ (Lot 15) — TACE et occupation RÉELS, comparés au prévisionnel.
export type Timesheet = { id?: string; consultantId: string; month: string; billedDays: number; leaveDays: number; internalDays: number };
export type TimesheetConstatRow = { consultantId: string; name: string; billedDays: number; leaveDays: number; internalDays: number; months: number; tacePct: number; occupancyPct: number };
export type TimesheetKpis = {
  ok: boolean; months: string[]; plannedOccupancyPct: number;
  global: { tacePct: number; occupancyPct: number; billedDays: number; leaveDays: number; internalDays: number; reportedConsultants: number };
  rows: TimesheetConstatRow[];
};
export async function upsertTimesheet(t: Timesheet) {
  const res = await httpsCallable(functions, "upsertTimesheet")(t);
  return res.data as { ok: boolean; id: string };
}
export async function deleteTimesheet(id: string) {
  const res = await httpsCallable(functions, "deleteTimesheet")({ id });
  return res.data as { ok: boolean };
}
export async function timesheetKpis(fromMonth?: string, months?: number) {
  const res = await httpsCallable(functions, "timesheetKpis")({ fromMonth, months });
  return res.data as TimesheetKpis;
}
// Import CRA en masse (Lot 19) — colle un tableau Nom/mois/facturés/congés/internes.
export async function importTimesheets(text: string) {
  const res = await httpsCallable(functions, "importTimesheets")({ text });
  return res.data as { ok: boolean; imported: number; errorCount: number; errors: { line: number; reason: string }[] };
}
// Auto-CRA depuis ClickUp (Lot 20) — pré-remplit les jours facturés depuis le temps ClickUp.
export async function syncClickupTimesheets(months?: number) {
  const res = await httpsCallable(functions, "syncClickupTimesheets")({ months });
  return res.data as { ok: boolean; entries: number; upserts: number; mapped: number; months: string[] };
}

// VIVIER / RECRUTEMENT (Lot 16) — pipeline de candidats + capacité future attendue par BU.
export type CandidateStatus = "sourced" | "interview" | "offer" | "hired" | "rejected";
export type Candidate = { id?: string; name: string; gradeTarget?: ConsultantGrade; bu?: string; skills?: string[]; tjmTarget?: number | null; status?: CandidateStatus; expectedStartMonth?: string | null; source?: string; notes?: string };
export type Recruitment = {
  ok: boolean; rows: Candidate[]; inPipeline: number;
  counts: Record<CandidateStatus, number>;
  byBu: { bu: string; active: number; expectedHires: number }[];
};
export async function upsertCandidate(c: Candidate) {
  const res = await httpsCallable(functions, "upsertCandidate")(c);
  return res.data as { ok: boolean; id: string };
}
export async function deleteCandidate(id: string) {
  const res = await httpsCallable(functions, "deleteCandidate")({ id });
  return res.data as { ok: boolean };
}
export async function listCandidates() {
  const res = await httpsCallable(functions, "listCandidates")({});
  return res.data as Recruitment;
}

// RENTABILITÉ PAR RESSOURCE (Lot 17) — P&L par consultant (confidentiel, droit « rentabilité »).
export type ResourcePnlRow = { id: string; name: string | null; bu: string | null; grade: string | null; billedDays: number; caReal: number; cost: number | null; margin: number | null; marginPct: number | null; missingTjm: boolean; missingCjm: boolean };
export type ResourcePnlGroup = { key: string; headcount: number; billedDays: number; caReal: number; cost: number | null; margin: number | null; marginPct: number | null };
export type ResourcePnl = {
  ok: boolean; months: string[];
  global: { headcount: number; billedDays: number; caReal: number; cost: number | null; margin: number | null; marginPct: number | null };
  byBu: ResourcePnlGroup[]; byGrade: ResourcePnlGroup[]; rows: ResourcePnlRow[];
};
export async function resourcePnl(fromMonth?: string, months?: number) {
  const res = await httpsCallable(functions, "resourcePnl")({ fromMonth, months });
  return res.data as ResourcePnl;
}

// PRÉ-FACTURATION DEPUIS LE CRA (Lot 21) — proposition de facturation = jours facturés × TJM. Lecture seule.
export type PreBillingLine = {
  consultantId: string; name: string; bu: string | null; month: string; billedDays: number;
  tjm: number | null; tjmSource: "assignment" | "target" | "none"; projectFp: string | null;
  amountHt: number; missingTjm: boolean; ambiguousRate: boolean;
};
export type PreBillingGroup = { key: string; billedDays: number; amountHt: number; lines: number; missingTjm: number };
export type PreBilling = {
  ok: boolean; months: string[];
  global: { lines: number; billedDays: number; amountHt: number; missingTjm: number };
  lines: PreBillingLine[]; byConsultant: PreBillingGroup[]; byBu: PreBillingGroup[]; byMonth: PreBillingGroup[];
};
export async function preBillingFromCra(fromMonth?: string, months?: number) {
  const res = await httpsCallable(functions, "preBillingFromCra")({ fromMonth, months });
  return res.data as PreBilling;
}

// HISTORISATION TACE + TENDANCE (Lot 22) — série mensuelle du TACE constaté + occupation, dérivée du CRA.
export type TacePoint = { month: string; headcount: number; billedDays: number; leaveDays: number; internalDays: number; tacePct: number | null; occupancyPct: number | null; byBu: { bu: string; tacePct: number | null; occupancyPct: number | null; headcount: number }[] };
export type TaceTrend = {
  ok: boolean; months: string[]; series: TacePoint[];
  summary: { latest: number | null; previous: number | null; avg: number | null; delta: number | null; slope: number | null; direction: "up" | "down" | "flat"; points: number };
};
export async function taceHistory(fromMonth?: string, months?: number) {
  const res = await httpsCallable(functions, "taceHistory")({ fromMonth, months });
  return res.data as TaceTrend;
}

// SCORING IA EXPLICABLE (Lot 5b) — probabilité de gain des opportunités ouvertes + facteurs.
export type ScoreFactor = { label: string; impact: number };
export type ScoredOpp = { id: string; client: string | null; am: string | null; amount: number; stage: number; score: number; band: "hot" | "warm" | "cold"; factors: ScoreFactor[] };
// Calibration empirique (R6) : le modèle ancre sa base sur le taux de gain historique observé.
export type ScoreCalib = { calibrated: boolean; sample?: number; baseWinRate?: number };
export type ScoringResult = { ok: boolean; scoped: boolean; rows: ScoredOpp[]; bands: { hot: number; warm: number; cold: number }; total: number; calib?: ScoreCalib };
/** Classe les opportunités ouvertes par probabilité de gain (score explicable + facteurs). */
export async function scoreOpportunities() {
  const res = await httpsCallable(functions, "scoreOpportunities")({});
  return res.data as ScoringResult;
}

// VÉLOCITÉ COMMERCIALE (Lot 8b) — indicateurs de dynamique du pipeline sur le périmètre visible.
export type SalesVelocity = { ok: boolean; openCount: number; openWeighted: number; winRate: number; avgDeal: number; won: number; lost: number; velocityIndex: number };
export async function salesVelocity() {
  const res = await httpsCallable(functions, "salesVelocity")({});
  return res.data as SalesVelocity;
}

// REPORTING SELF-SERVICE (Lot 6) — moteur de rapport sur les opportunités + définitions sauvegardées.
export type ReportGroupBy = "bu" | "am" | "stage" | "client" | "forecastCategory";
export type ReportMeasure = "count" | "amount" | "weighted";
export type ReportFilters = { bu?: string | null; am?: string | null; client?: string | null; stage?: number | null; forecastCategory?: string | null; minAmount?: number | null; openOnly?: boolean };
export type ReportDef = { groupBy: ReportGroupBy; measure: ReportMeasure; filters?: ReportFilters };
export type ReportRow = { key: string; count: number; amount: number; weighted: number };
export type ReportResult = { ok: boolean; groupBy: ReportGroupBy; measure: ReportMeasure; rows: ReportRow[]; totals: { count: number; amount: number; weighted: number } };
export type SavedReport = { id: string; name: string; def: ReportDef; ownerUid?: string; ownerName?: string | null };
/** Exécute un rapport (filtres + regroupement + mesure) sur le périmètre visible de l'appelant. */
export async function runReport(def: ReportDef) {
  const res = await httpsCallable(functions, "runReport")({ def });
  return res.data as ReportResult;
}
/** Sauvegarde (ou met à jour) une définition de rapport partagée. Droit « pipeline ». */
export async function saveReport(name: string, def: ReportDef, id?: string) {
  const res = await httpsCallable(functions, "saveReport")({ name, def, id });
  return res.data as { ok: boolean; id: string };
}
/** Liste les définitions de rapport sauvegardées (partagées). */
export async function listReports() {
  const res = await httpsCallable(functions, "listReports")({});
  return res.data as { ok: boolean; reports: SavedReport[] };
}
/** Supprime une définition de rapport (propriétaire ou direction). */
export async function deleteReport(id: string) { await httpsCallable(functions, "deleteReport")({ id }); }

// API REST PUBLIQUE (Lot 7) — clés API (hachées côté serveur, brut affiché une seule fois). Direction.
export type ApiKeyInfo = { id: string; prefix: string; label: string; scopes: string[]; active: boolean };
/** Crée une clé API (renvoie la clé brute UNE fois). Direction. */
export async function createApiKey(label: string, scopes: string[]) {
  const res = await httpsCallable(functions, "createApiKey")({ label, scopes });
  return res.data as { ok: boolean; id: string; key: string; prefix: string; scopes: string[]; note: string };
}
/** Révoque une clé API. Direction. */
export async function revokeApiKey(id: string) { await httpsCallable(functions, "revokeApiKey")({ id }); }
/** Liste les clés API (métadonnées, sans secret). Direction. */
export async function listApiKeys() {
  const res = await httpsCallable(functions, "listApiKeys")({});
  return res.data as { ok: boolean; keys: ApiKeyInfo[] };
}

/** Enregistre les définitions de champs custom d'opportunité (config/customFields). Direction. */
export async function setCustomFields(fields: Partial<CustomFieldDef>[]) {
  const res = await httpsCallable(functions, "setCustomFields")({ fields });
  return res.data as { ok: boolean; fields: CustomFieldDef[] };
}
export type OutboundWebhookConfig = { url: string; events: string[]; enabled: boolean };
/** Configure le webhook sortant (config/outboundWebhooks) ; test=true envoie un ping. Direction. */
export async function setOutboundWebhook(cfg: OutboundWebhookConfig & { test?: boolean }) {
  const res = await httpsCallable(functions, "setOutboundWebhook")(cfg);
  return res.data as OutboundWebhookConfig & { ok: boolean };
}

/** Webhook ENTRANT Odoo (opportunités / commandes / factures). Le secret partagé est écrit côté serveur,
 *  jamais relu (config/odooWebhook non lisible client). `enabled` = interrupteur (kill-switch). */
export async function setOdooWebhook(cfg: { secret?: string; enabled?: boolean }) {
  const res = await httpsCallable(functions, "setOdooWebhook")(cfg);
  return res.data as { ok: boolean; enabled: boolean; hasSecret: boolean };
}
/** État de l'intégration Odoo (jamais le secret) : `hasSecret` (secret posé) + `enabled` (interrupteur). */
export async function odooWebhookStatus() {
  const res = await httpsCallable(functions, "odooWebhookStatus")();
  return res.data as { enabled: boolean; hasSecret: boolean };
}

/** Exporte TOUTES les opportunités dans le modèle round-trip (.xlsx) : renvoie le fichier encodé en
 *  base64 (à télécharger via downloadBase64). Réservé au droit « pipeline ». */
export async function exportOpportunities() {
  const res = await httpsCallable(functions, "exportOpportunities", { timeout: 120_000 })({});
  return res.data as { ok: boolean; filename: string; fileB64: string; count: number };
}

export type OppImportSample = { line: number; id?: string | null; client?: string | null; matchBy?: string; changed?: string[]; fp?: string | null; reason?: string };
export type OppImportResult = {
  ok: boolean; applied: boolean;
  updated: number; created: number; skipped: number; rowsParsed: number;
  samples?: { update: OppImportSample[]; create: OppImportSample[]; skip: OppImportSample[] };
};
/** Importe/actualise en masse les opportunités depuis le modèle édité (.xlsx/.csv). `apply=false` =
 *  APERÇU (dry-run, n'écrit rien) ; `apply=true` = applique (upsert + recompute). Rapprochement
 *  Opp ID → N° FP → création `saisie`, mise à jour des seuls champs renseignés. Droit « pipeline ». */
export async function importOpportunities(file: File, apply: boolean): Promise<OppImportResult> {
  const fileB64 = await fileToBase64(file);
  const res = await httpsCallable(functions, "importOpportunities", { timeout: 300_000 })({ fileB64, filename: file.name, apply });
  return res.data as OppImportResult;
}

/** Déclenche le téléchargement d'un fichier binaire encodé base64 (ex. .xlsx renvoyé par un callable). */
export function downloadBase64(filename: string, b64: string, mime = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") {
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.rel = "noopener";
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Rattache une facture orpheline à sa commande en corrigeant son N° FP (onCall : recalcule). */
export async function setInvoiceFp(id: string, fp: string) {
  await httpsCallable(functions, "setInvoiceFp")({ id, fp });
}

/** RÉCONCILIATION FP — déclare qu'un N° FP (souvent celui d'une opp gagnée) désigne en réalité la
 *  même commande qu'un N° FP DÉJÀ au P&L. Le FP P&L (`to`, lié à la facturation) fait autorité : à
 *  chaque recalcul, les lignes portant `from` sont ré-étiquetées `to` en mémoire (overlay
 *  config/fpAliases, non destructif — survit aux ré-imports). `to` vide = supprime l'alias. Droit
 *  « import ». onCall : recalcule. */
export async function setFpAlias(from: string, to: string) {
  const res = await httpsCallable(functions, "setFpAlias")({ from, to });
  return res.data as { ok: boolean; from: string; to: string | null; aliasCount: number };
}

// DOSSIER CLIENT (rapprochement Opp/Commande/Facture). Lecture seule, gouverné « import ».
export type ReconRow = { fp?: string; client?: string; amount?: number; cas?: number; raf?: number; amountHt?: number; stage?: number; stageLabel?: string; designation?: string; am?: string; date?: string; numero?: string; source?: string; linked?: boolean };
export type ReconCluster = { fp: string; opps: ReconRow[]; orders: ReconRow[]; invoices: ReconRow[]; oppAmount: number; orderCas: number; invoiceTotal: number; hasOrder: boolean; hasInvoice: boolean; won: boolean };
export type ReconSuggestion = { from: string; to: string; reason: "opp_gagnee_sans_pnl" | "facture_sous_autre_fp"; targetHasInvoice: boolean; confidence: "montant" | "designation" | "partielle" };
export type ReconDossier = { client: string; clusters: ReconCluster[]; authoritativeFps: string[]; suggestions: ReconSuggestion[]; wonNoPnl: number; counts: { opps: number; orders: number; invoices: number } };
export type ReconListItem = { client: string; counts: { opps: number; orders: number; invoices: number }; suggestions: number; wonNoPnl: number };
export type ReconResult = { ok: boolean; mode: "list" | "detail"; clients?: ReconListItem[]; totalSuggestions?: number; scanned?: { orders: number; invoices: number; opps: number }; dossier?: ReconDossier | null };
/** Dossier de rapprochement. Sans `client` : liste de triage (clients à rapprocher). Avec `client` :
 *  détail aligné (clusters par N° FP) + propositions de réconciliation. */
export async function reconClient(client?: string): Promise<ReconResult> {
  const res = await withTransientRetry(() => httpsCallable(functions, "reconClient", { timeout: 120_000 })(client ? { client } : {}));
  return res.data as ReconResult;
}

// CENTRE DE CORRECTION (Assainissement). Lecture seule, gouverné « import ».
export type CorrectionItem = {
  id?: string; fp?: string; client?: string; am?: string; numero?: string; amountHt?: number; amount?: number;
  cas?: number; yearPo?: number; date?: string; dueDate?: string; stage?: number; stageLabel?: string;
  designation?: string; supplier?: string; bcNumber?: string; currency?: string; amountXof?: number;
  saleTotal?: number; affaire?: string; source?: string;
};
export type CorrectionBucket = { type: string; severity: "high" | "medium" | "low"; label: string; count: number; items: CorrectionItem[] };
export type CorrectionQueueResult = { ok: boolean; buckets: CorrectionBucket[]; cap: number; total: number };
/** File de correction : par type d'anomalie, les enregistrements concrets à corriger (plafonnés). */
export async function correctionQueue(): Promise<CorrectionQueueResult> {
  const res = await withTransientRetry(() => httpsCallable(functions, "correctionQueue", { timeout: 120_000 })({}));
  return res.data as CorrectionQueueResult;
}

// ASSISTANT IA DU CENTRE DE CORRECTION (Phase 1 : « l'IA propose, l'humain valide »). Renvoie, pour un
// lot d'anomalies d'un même type, des PROPOSITIONS de correction justifiées et notées en confiance. Le
// serveur ne fait qu'analyser (aucune écriture) ; l'application passe par les écritures gouvernées
// habituelles sur clic. Lecture-analyse gouvernée « import ». Réessaie sur codes transitoires (déploiement).
export type AiCorrectionAction =
  | "review" | "set_invoice_fp" | "generate_from_invoice"
  | "patch_order" | "patch_opportunity" | "patch_bc_line";
export type AiSuggestion = {
  ref: string; action: AiCorrectionAction; fields: Record<string, string | number>;
  confidence: number; rationale: string;
  verified?: boolean; verifyReason?: string; // 2e passage adverse (fiabilité max)
};
export type AiSuggestResult = {
  ok: boolean; type: string; suggestions: AiSuggestion[]; model: string;
  verified?: boolean; verifiedCount?: number; // vérification adverse activée + nb de propositions vérifiées
  truncated: boolean; analyzed: number; total: number;
};
/** Demande à l'assistant IA des propositions de correction pour un lot d'anomalies d'un même type. */
export async function aiSuggestCorrections(type: string, records: CorrectionItem[]): Promise<AiSuggestResult> {
  const res = await withTransientRetry(() => httpsCallable(functions, "aiSuggestCorrections", { timeout: 120_000 })({ type, records }));
  return res.data as AiSuggestResult;
}

/** Génère commande P&L + opp gagnée depuis des factures NON RATTACHÉES (unitaire via ids, ou masse via all).
 *  Skip les factures sans FP canonique et les FP déjà au carnet (aucun doublon). Droit « import ». */
export type GenFromInvoiceResult = {
  ok: boolean; created: { orders: number; opps: number }; skippedNoFp: number; skippedExisting: number;
  plan: { fp: string; cas: number; client: string; yearPo: number; invoiceCount: number }[];
};
export async function generateFromInvoices(args: { ids?: string[]; all?: boolean }): Promise<GenFromInvoiceResult> {
  const res = await httpsCallable(functions, "generateFromInvoices", { timeout: 300_000 })({ ids: args.ids, all: !!args.all });
  return res.data as GenFromInvoiceResult;
}

// OBJET COMPTE (Account 360) + CONTACTS. Métadonnée gouvernée « pipeline » ; lecture « overview ».
export type Account = { id?: string; name?: string; sector?: string; country?: string; territory?: string; parentId?: string | null; ownerUid?: string | null; notes?: string; tags?: string[] };
export type Contact = { id?: string; accountId?: string; name?: string; role?: string; email?: string; phone?: string; primary?: boolean };
export type AccountView = { ok: boolean; id: string; name: string; account: Account | null; contacts: Contact[] };
/** Vue Compte : résout le client → id canonique côté serveur, renvoie métadonnée + contacts. */
export async function accountView(client: string): Promise<AccountView> {
  const res = await httpsCallable(functions, "accountView")({ client });
  return res.data as AccountView;
}
/** Crée / met à jour la métadonnée d'un compte (clé sur le nom client canonique). */
export async function upsertAccount(data: { name: string; sector?: string; country?: string; territory?: string; parent?: string | null; ownerUid?: string | null; notes?: string; tags?: string[] }) {
  const res = await httpsCallable(functions, "upsertAccount")(data);
  return res.data as { ok: boolean; id: string; name: string };
}
/** Crée / met à jour un contact rattaché à un compte (par nom de client). */
export async function upsertContact(data: { id?: string; account: string; name: string; role?: string; email?: string; phone?: string; primary?: boolean }) {
  const res = await httpsCallable(functions, "upsertContact")(data);
  return res.data as { ok: boolean; id: string; accountId: string };
}
export async function deleteContact(id: string) { await httpsCallable(functions, "deleteContact")({ id }); }

// ACTIVITÉS & TÂCHES (Lot 3) — journal d'actions + tâches à échéance, rattachées à un compte/opp.
// Accès 100% par callable (la visibilité par enregistrement est appliquée côté serveur).
export type ActivityType = "call" | "email" | "meeting" | "note" | "task";
export type Activity = {
  id?: string; type: ActivityType; subject: string; body?: string;
  relatedType: "account" | "opportunity"; relatedId: string; relatedName?: string;
  at?: string | null; dueDate?: string | null; done?: boolean; ownerUid?: string | null; overdue?: boolean;
};
/** Crée / met à jour une activité ou tâche (propriétaire = créateur par défaut). Droit « pipeline ». */
export async function upsertActivity(data: Partial<Activity> & { type: ActivityType; subject: string; relatedType: "account" | "opportunity"; relatedId: string }) {
  const res = await httpsCallable(functions, "upsertActivity")(data);
  return res.data as { ok: boolean; id: string };
}
/** Supprime une activité/tâche. Droit « pipeline ». */
export async function deleteActivity(id: string) { await httpsCallable(functions, "deleteActivity")({ id }); }
/** Liste des activités : timeline d'un enregistrement (relatedId), les miennes (mine), ou le flux
 *  global ; openTasksOnly = seulement les tâches ouvertes. La visibilité est appliquée côté serveur. */
export async function listActivities(opts?: { relatedId?: string; mine?: boolean; openTasksOnly?: boolean; limit?: number }) {
  const res = await httpsCallable(functions, "listActivities")(opts || {});
  return res.data as { ok: boolean; activities: Activity[]; total: number };
}

// SÉCURITÉ PAR ENREGISTREMENT (Lot 2) — propriété + hiérarchie + OWD + MFA.
/** Réaffecte le propriétaire d'un enregistrement (opportunité/compte) — recalcule visibleTo. Droit « pipeline ». */
export async function assignOwner(collection: "opportunities" | "accounts", id: string, ownerUid: string | null) {
  const res = await httpsCallable(functions, "assignOwner")({ collection, id, ownerUid });
  return res.data as { ok: boolean; id: string; ownerUid: string | null };
}
/** Pose le manager d'un utilisateur (hiérarchie de rôles) — direction. Refuse cycle/auto-management ; ré-indexe. */
export async function callSetManager(uid: string, managerUid: string | null) {
  const res = await httpsCallable(functions, "setManager", { timeout: 300_000 })({ uid, managerUid });
  return res.data as { ok: boolean; uid: string; managerUid: string | null; reindexed: number };
}
export type RecordAccess = { opportunities: "public" | "private"; accounts: "public" | "private" };
/** OWD par objet (config/recordAccess) — direction. « private » = propriétaire + hiérarchie + admins seulement. */
export async function callSetRecordAccess(cfg: Partial<RecordAccess>) {
  const res = await httpsCallable(functions, "setRecordAccess")(cfg);
  return res.data as RecordAccess & { ok: boolean };
}
/** Politique d'authentification (config/security) : MFA obligatoire pour actions sensibles — direction. */
export async function callSetSecurityConfig(require2fa: boolean) {
  const res = await httpsCallable(functions, "setSecurityConfig")({ require2fa });
  return res.data as { ok: boolean; require2fa: boolean };
}
/** Ré-indexe visibleTo sur tous les enregistrements (backfill avant bascule OWD « private ») — direction.
 *  deriveFromAm : dérive un propriétaire depuis le champ AM des opps sans propriétaire (mapping par nom). */
export async function callReindexVisibility(deriveFromAm = false) {
  const res = await httpsCallable(functions, "reindexVisibility", { timeout: 300_000 })({ deriveFromAm });
  return res.data as { ok: boolean; reindexed: number; derived: number };
}

// APPROBATIONS (Lot 4) — processus d'approbation gouvernable. Accès par callable (visibilité +
// contrôle de l'approbateur appliqués serveur).
export type ApprovalKind = "remise_opp" | "depassement_bc" | "commande_manuelle" | "autre";
export type Approval = {
  id?: string; kind: ApprovalKind; entityType: "opportunity" | "bcLine" | "order" | "other"; entityId: string;
  entityLabel?: string; amount?: number | null; note?: string; status: "pending" | "approved" | "rejected";
  requestedBy?: string; requestedByName?: string; approverUid?: string; decidedBy?: string; decisionNote?: string; at?: string;
};
/** Soumet une action sensible à approbation (routée vers le manager, sinon la direction). Droit « pipeline ». */
export async function submitForApproval(data: { kind: ApprovalKind; entityType: "opportunity" | "bcLine" | "order" | "other"; entityId: string; entityLabel?: string; amount?: number | null; note?: string }) {
  const res = await httpsCallable(functions, "submitForApproval")(data);
  return res.data as { ok: boolean; id: string; approverUid: string };
}
/** Décide d'une demande (approbateur ou direction) : approuve ou rejette, avec note. Droit « pipeline ». */
export async function decideApproval(id: string, decision: "approved" | "rejected", note?: string) {
  const res = await httpsCallable(functions, "decideApproval")({ id, decision, note });
  return res.data as { ok: boolean; id: string; status: string };
}
/** Liste des approbations : « toDecide » (à décider par moi), « mine » (mes demandes), « all » (admin). */
export async function listApprovals(box: "toDecide" | "mine" | "all" = "toDecide") {
  const res = await httpsCallable(functions, "listApprovals")({ box });
  return res.data as { ok: boolean; approvals: Approval[]; total: number };
}

// AUTOMATISATION DÉCLARATIVE (Lot 4b) — règles sans code qui génèrent des tâches. Direction.
export type AutomationRuleType = "opp_no_nextstep" | "opp_stale";
export type AutomationRule = { type: AutomationRuleType; enabled: boolean; dueInDays: number };
/** Enregistre les règles d'automatisation (config/automations). Remplace l'ensemble. Direction. */
export async function setAutomations(rules: AutomationRule[]) {
  const res = await httpsCallable(functions, "setAutomations")({ rules });
  return res.data as { ok: boolean; rules: AutomationRule[] };
}
/** Exécute maintenant les règles actives → crée les tâches manquantes (idempotent). Direction. */
export async function runAutomations() {
  const res = await httpsCallable(functions, "runAutomations", { timeout: 300_000 })({});
  return res.data as { ok: boolean; created: number; evaluated: number };
}

/** Corrige une facture existante : date de facturation et/ou échéance (le montant reste piloté par
 *  la source — intégrité comptable). onCall : recalcule échéancier cash + qualité des données. */
export async function patchInvoice(data: { id: string; date?: string | null; dueDate?: string | null }) {
  await httpsCallable(functions, "patchInvoice")(data);
}

/** Corrige une commande P&L : année/CAS/RAF/N° FP + client/AM/BU/désignation (onCall : recalcule). */
export async function patchOrder(data: { fp: string; yearPo?: number; newFp?: string; cas?: number; raf?: number; client?: string; am?: string; bu?: string; designation?: string }) {
  await httpsCallable(functions, "patchOrder")(data);
}

/** Affecte (ou désaffecte, pm vide) un Project Manager à une commande. Overlay persistant, recalcul. */
export async function setOrderPm(fp: string, pm: string) {
  await httpsCallable(functions, "setOrderPm")({ fp, pm });
}

/** Synchronise le montant (CA Signé) entre une commande et son opportunité liée (même N° FP).
 *  - "toOpp"   : le CAS de la commande (`cas`) devient le montant de l'opp ;
 *  - "toOrder" : le montant de l'opp devient le CAS de la commande (surcharge persistante) ;
 *  - "clear"   : retire la surcharge (la commande reprend son CAS P&L/opp/fiche). */
export async function syncOrderAmount(fp: string, direction: "toOpp" | "toOrder" | "clear", cas?: number) {
  const res = await httpsCallable(functions, "syncOrderAmount", { timeout: 120_000 })({ fp, direction, cas });
  return res.data as { ok: boolean; fp: string; direction: string; oppId?: string; cas: number | null };
}
export type AmountPeek = {
  ok: boolean; fp: string; direction: "peek";
  oppFound: boolean; count: number; ambiguous: boolean;
  oppId: string | null; oppAmount: number | null; oppHasLines: boolean; oppWon: boolean;
};
/** Lecture seule : montant de l'opportunité liée (même N° FP) + état, pour comparer avant de synchroniser. */
export async function peekOrderAmount(fp: string): Promise<AmountPeek> {
  const res = await httpsCallable(functions, "syncOrderAmount", { timeout: 120_000 })({ fp, direction: "peek" });
  return res.data as AmountPeek;
}

/** Enregistre la table des taux de change (XOF par unité de devise) — admin. Remplace l'ensemble. */
export async function setFxRates(rates: Record<string, number>) {
  const res = await httpsCallable(functions, "setFxRates")({ rates });
  return res.data as { ok: boolean; rates: Record<string, number> };
}

/** Enregistre un référentiel éditable (PM / BU / territoires / équipes) — admin. Remplace la liste. */
export async function setRefList(kind: "projectManagers" | "businessUnits" | "territories" | "teams", list: string[]) {
  const res = await httpsCallable(functions, "setRefList")({ kind, list });
  return res.data as { ok: boolean; kind: string; list: string[] };
}
/** Affecte un utilisateur à une équipe (regroupement organisationnel, Lot 10b) — direction. */
export async function callSetUserTeam(uid: string, team: string | null) {
  const res = await httpsCallable(functions, "setUserTeam")({ uid, team });
  return res.data as { ok: boolean; uid: string; team: string };
}

/** Config intégration ClickUp (activation + liste cible) — admin. */
export async function setClickupConfig(cfg: { enabled?: boolean; teamId?: string; defaultListId?: string; parListId?: string }) {
  const res = await httpsCallable(functions, "setClickupConfig")(cfg);
  return res.data as { ok: boolean; config: any };
}
/** Force la synchro du CAF (CA Facturé) de toutes les tâches ClickUp liées (admin). */
export async function syncClickupCaf() {
  const res = await httpsCallable(functions, "syncClickupCaf", { timeout: 300_000 })({});
  return res.data as { ok: boolean; pushed: number; skipped: number; failed?: number; total: number };
}
/** Sens inverse : remonte statut projet + dates des tâches ClickUp vers l'app (admin). */
export async function syncFromClickup() {
  const res = await httpsCallable(functions, "syncFromClickup", { timeout: 300_000 })({});
  return res.data as { ok: boolean; pulled: number; failed?: number; total: number; pmUpdated?: number };
}
/** Push en masse : crée/synchronise les tâches ClickUp des commandes (force=true resynchronise aussi
 *  les tâches déjà liées). Admin. Peut être long (timeout client possible, traitement poursuivi). */
export async function pushAllOrdersToClickup(opts?: { force?: boolean; listId?: string }) {
  const res = await httpsCallable(functions, "pushAllOrdersToClickup", { timeout: 540_000 })({ force: opts?.force, listId: opts?.listId });
  return res.data as { ok: boolean; created: number; updated: number; adopted: number; failed: number; skipped: number; total: number };
}
/** Réconciliation anti-doublons : rattache les commandes aux tâches ClickUp DÉJÀ existantes
 *  (Opp ID = FP), sans rien créer. À lancer AVANT tout push en masse. Admin. */
export async function reconcileClickupLinks(opts?: { listId?: string }) {
  const res = await httpsCallable(functions, "reconcileClickupLinks", { timeout: 300_000 })({ listId: opts?.listId });
  return res.data as { ok: boolean; matched: number; already: number; total: number; tasksWithFp: number };
}
/** Nettoyage des tâches ClickUp DUPLIQUÉES (même N° FP) — créées par des push concurrents. Deux temps :
 *  apply=false → aperçu (ne supprime rien), apply=true → supprime. `windowHours` borne aux doublons
 *  récents (défaut 24 h = « du jour »). Conserve la tâche liée / la plus ancienne. Admin. */
export async function dedupeClickupTasks(opts?: { apply?: boolean; listId?: string; windowHours?: number }) {
  const res = await httpsCallable(functions, "dedupeClickupTasks", { timeout: 540_000 })({ apply: opts?.apply, listId: opts?.listId, windowHours: opts?.windowHours });
  return res.data as { ok: boolean; dryRun: boolean; groups: number; duplicates: number; deletable: number; deleted: number; failed: number; windowHours: number; samples: { fp: string; keptId: string; toDelete: number }[] };
}
/** Enrichit les tâches ClickUp liées : commentaire de synthèse idempotent (CA/RAF, jalons, BC, qualité)
 *  + tag « à risque ». Admin. Peut être long. */
export async function enrichClickup() {
  const res = await httpsCallable(functions, "enrichClickup", { timeout: 540_000 })({});
  return res.data as { ok: boolean; enriched: number; failed?: number; tagged: number; subtasked: number; checklisted: number; total: number };
}
/** Allume/éteint le module « Contrats de maintenance » (drapeau config/mntFeature, ADR-009). Direction. */
export async function setMntFeature(enabled: boolean) {
  const res = await httpsCallable(functions, "setMntFeature")({ enabled });
  return res.data as { ok: boolean; enabled: boolean };
}
/** Diagnostic qualité de l'intégration ClickUp (couverture, orphelines, écarts CAF…). Admin. */
export async function clickupHealth(opts?: { listId?: string }) {
  const res = await httpsCallable(functions, "clickupHealth", { timeout: 300_000 })({ listId: opts?.listId });
  return res.data as { ok: boolean } & Record<string, any>;
}
/** Liste les membres du workspace ClickUp (nom + e-mail) — pour peupler le référentiel PM (admin). */
export async function listClickupMembers() {
  const res = await httpsCallable(functions, "listClickupMembers", { timeout: 60_000 })({});
  return res.data as { ok: boolean; members: { name: string; email: string }[] };
}
/** Champs complémentaires du modal ClickUp (ceux que la commande ne fournit pas — ex-formulaire). */
export type ClickupExtra = {
  pays?: string; nature?: string; domaine?: string; secteur?: string; circuit?: string; catRecurrent?: string;
  priority?: string; commentaire?: string; lieu?: string;
  dateCommande?: number; dateContractuelle?: number; dateFinPrev?: number; // epoch ms
};
/** Pousse une commande vers ClickUp (crée/màj une tâche assignée au PM, avec champs complémentaires
 *  et liste cible CI/BF/GN). Renvoie l'URL de la tâche. */
export async function pushOrderToClickup(
  order: { fp?: string; client?: string; affaire?: string | null; designation?: string | null; bu?: string; am?: string; cas?: number; facture?: number; pm?: string | null },
  opts?: { listId?: string; extra?: ClickupExtra },
) {
  const res = await httpsCallable(functions, "pushOrderToClickup", { timeout: 120_000 })({ order, listId: opts?.listId, extra: opts?.extra });
  return res.data as { ok: boolean; taskId: string; url: string; assigned: boolean; created: boolean; fields: number };
}

/** BC ⇄ ClickUp — pousse UN bon de commande (agrégé par N° BC) vers la liste « Commandes
 *  Fournisseurs » (crée/màj une tâche : fournisseur, montant, ETA, pays, client, Opp ID). Droit « bc ». */
export async function pushBcToClickup(bcNumber: string, opts?: { listId?: string; extra?: { status?: string } }) {
  const res = await httpsCallable(functions, "pushBcToClickup", { timeout: 120_000 })({ bcNumber, listId: opts?.listId, extra: opts?.extra });
  return res.data as { ok: boolean; taskId: string; url: string; created: boolean; fields: number };
}
/** Push BC en masse : crée/synchronise les tâches ClickUp de tous les BC (force=true resynchronise
 *  aussi les tâches déjà liées). Admin. Peut être long. */
export async function pushAllBcToClickup(opts?: { force?: boolean; listId?: string }) {
  const res = await httpsCallable(functions, "pushAllBcToClickup", { timeout: 540_000 })({ force: opts?.force, listId: opts?.listId });
  return res.data as { ok: boolean; created: number; updated: number; adopted: number; failed: number; skipped: number; total: number };
}
/** Réconciliation BC anti-doublons : rattache les BC aux tâches ClickUp DÉJÀ existantes (par N° de
 *  Commande), sans rien créer. À lancer AVANT tout push en masse. Admin. */
export async function reconcileBcLinks(opts?: { listId?: string }) {
  const res = await httpsCallable(functions, "reconcileBcLinks", { timeout: 300_000 })({ listId: opts?.listId });
  return res.data as { ok: boolean; matched: number; already: number; total: number; tasksWithNumber: number };
}
/** Importe dans l'app les BC saisis directement dans ClickUp (tâches sans bcLine). Dédup par N° BC
 *  (import comptable prioritaire), statut « émis » (engagement, hors solde SOA), conversion XOF. Admin. */
export async function importBcFromClickup(opts?: { listId?: string }) {
  const res = await httpsCallable(functions, "importBcFromClickup", { timeout: 300_000 })({ listId: opts?.listId });
  return res.data as { ok: boolean; created: number; skippedKnown: number; skippedIncomplete: number; scanned: number };
}
/** Sens inverse BC : remonte l'avancement achat (statut) + l'ETA des tâches ClickUp liées vers l'app
 *  (overlay additif). Admin. */
export async function syncBcFromClickup() {
  const res = await httpsCallable(functions, "syncBcFromClickup", { timeout: 300_000 })({});
  return res.data as { ok: boolean; pulled: number; failed?: number; total: number };
}
/** Webhooks temps réel : enregistre (ou met à jour) le webhook ClickUp pointant vers la fonction
 *  clickupWebhook. Le secret HMAC est stocké côté serveur. Admin. */
export async function setupClickupWebhook(endpoint: string) {
  const res = await httpsCallable(functions, "setupClickupWebhook", { timeout: 60_000 })({ endpoint });
  return res.data as { ok: boolean; id: string; endpoint: string; events: string[]; hasSecret: boolean; created: boolean };
}
/** Supprime le webhook ClickUp temps réel (côté ClickUp + config). Admin. */
export async function deleteClickupWebhook() {
  const res = await httpsCallable(functions, "deleteClickupWebhook", { timeout: 60_000 })({});
  return res.data as { ok: boolean; deleted?: string; note?: string };
}

/** Crée une commande (ligne P&L) DIRECTEMENT dans l'app. N° FP + CAS (> 0) requis. Refuse un FP
 *  déjà présent (Excel curaté prioritaire). Sert la réconciliation d'une opp gagnée sans P&L ou la
 *  saisie manuelle d'une commande. Réservé au droit « import ». Recalcule ensuite. */
export async function createOrder(data: { fp: string; cas: number; client?: string; designation?: string; bu?: string; am?: string; yearPo?: number; raf?: number }) {
  const res = await httpsCallable(functions, "createOrder")(data);
  return res.data as { ok: boolean; fp: string };
}

/** Fait évoluer le statut d'une ligne BC (onCall : recalcule ensuite exposition + alertes). */
export async function setBcStatus(id: string, status: string) {
  await httpsCallable(functions, "setBcStatus")({ id, status });
}

/** Fiabilise une ligne BC : N° FP, montant XOF, fournisseur, type de dépense, description, date
 *  d'entrée (onCall : recalcule exposition + alertes + décaissements). */
export async function patchBcLine(data: { id: string; fp?: string; amountXof?: number; fxRate?: number; supplier?: string; expenseType?: string; description?: string; dateIn?: string | null }) {
  await httpsCallable(functions, "patchBcLine")(data);
}

/** Remonte une erreur client (observabilité). Réservé aux sessions authentifiées côté serveur. */
export async function logClientError(payload: { message: string; stack?: string; url?: string; module?: string; ua?: string }) {
  await httpsCallable(functions, "logClientError")(payload);
}

export type BillingMilestone = { date: string; amount: number };
/** Enregistre l'échéancier de facturation d'un projet (≤ 15 jalons). Direction/PMO. Recalcule. */
export async function setBillingMilestones(fp: string, milestones: BillingMilestone[]) {
  const res = await httpsCallable(functions, "setBillingMilestones")({ fp, milestones });
  return res.data as { ok: boolean; fp: string; milestones: BillingMilestone[] };
}

/** Corrige une fiche affaire : prix de vente et/ou de revient (marge recalculée). Donnée de marge —
 *  droit « rentabilité ». Comble « fiche sans prix de vente ». onCall : recalcule. */
export async function patchProjectSheet(data: { fp: string; saleTotal?: number; costTotal?: number }) {
  await httpsCallable(functions, "patchProjectSheet")(data);
}

/** Crée/met à jour une ligne de crédit fournisseur : plafond autorisé + solde d'ouverture SOA daté
 *  (« à jour maintenant »). Seule une facture (BC statut « facturé ») bouge ensuite le solde.
 *  onCall : recalcule exposition + alertes. */
export async function upsertCreditLine(id: string, data: { authorized: number; openingBalance?: number; openingDate?: string | null }) {
  await httpsCallable(functions, "upsertCreditLine")({ id, authorized: data.authorized, openingBalance: data.openingBalance, openingDate: data.openingDate ?? null });
}

/** MES ADR-P20 — ré-appareille les lignes de crédit fournisseur sur leur clé CANONIQUE (cleanName :
 *  espaces internes compactés + casse). Une ligne saisie « à un espace/casse près » (selon la source
 *  du BC) est DÉPLACÉE vers sa clé canonique ; en cas de collision, la cible conserve son plafond et la
 *  source est retirée (fusion sans perte). À lancer UNE fois après le déploiement de l'unification, puis
 *  le SOA est recalculé. Idempotent (relançable). Droit « fournisseurs ». */
export async function migrateCreditLineKeys() {
  const res = await httpsCallable(functions, "migrateCreditLineKeys", { timeout: 300_000 })({});
  return res.data as { ok: boolean; moved: number; merged: number; skipped: number };
}

/** Identifiant déterministe d'un objectif (année × périmètre × valeur). */
export const objectiveId = (o: { fiscalYear: number; scope?: string; scopeValue?: string }) =>
  `${o.fiscalYear}_${o.scope || "global"}_${o.scopeValue || "all"}`;

/** Crée/met à jour un objectif annuel (périmètre : global / bu / commercial / client). Écriture
 *  serveur (callable validé + audité) : la règle Firestore de objectives est en write:false. */
export async function upsertObjective(o: {
  fiscalYear: number; scope: string; scopeValue: string; label?: string;
  targetCas: number; targetInvoiced: number; targetMargin: number; targetMarginPct?: number;
}) {
  await httpsCallable(functions, "upsertObjective")(o);
}

/** Supprime un objectif (callable serveur). */
export async function deleteObjective(id: string) {
  await httpsCallable(functions, "deleteObjective")({ id });
}

/** Met à jour la matrice de droits via le callable setPermissions (schéma validé + audité côté
 *  serveur). Plus d'écriture directe : la règle Firestore de config/permissions est en write:false. */
export async function updateMatrix(matrix: Record<string, Record<string, string>>) {
  await httpsCallable(functions, "setPermissions")({ matrix });
}

/** Pose un rôle sur un utilisateur (Cloud Function admin). */
export async function callSetUserRole(uidTarget: string, role: string) {
  await httpsCallable(functions, "setUserRole")({ uid: uidTarget, role });
}

/** Provisionne un compte : Auth (email + mot de passe initial) + rôle + fiche users/. Direction
 *  uniquement. Refuse un email déjà utilisé. Renvoie l'uid créé. */
export async function callCreateUser(input: { email: string; name?: string; role: string; password: string }) {
  const res = await httpsCallable(functions, "createUser")(input);
  return res.data as { ok: boolean; uid: string };
}
/** RATTACHE un compte Firebase déjà existant (autre app du même projet) : pose le rôle + crée la
 *  fiche, sans recréer le compte ni toucher au mot de passe. Direction uniquement. */
export async function callAttachUser(input: { email: string; name?: string; role: string }) {
  const res = await httpsCallable(functions, "attachUser")(input);
  return res.data as { ok: boolean; uid: string; attached: boolean };
}

/** Active/désactive un compte (Auth `disabled` + fiche users.active). Direction uniquement. */
export async function callSetUserActive(uid: string, active: boolean) {
  await httpsCallable(functions, "setUserActive")({ uid, active });
}

export type AlertThresholds = { concentration: number; surfacturationPct: number; rafEcartPct: number; dormantYears: number; valorisationEcartPct: number; nonFactureJours: number };
/** Enregistre les seuils d'alerte (admin) : recompute alertes + qualité côté serveur. */
export async function callSetAlertThresholds(cfg: AlertThresholds) {
  const res = await httpsCallable(functions, "setAlertThresholds")(cfg);
  return res.data as AlertThresholds & { ok: boolean };
}

export type ProjectionTierInput = { active: boolean; weight: number };
// cashOpening : solde d'ouverture de trésorerie (SOA global) — base de la position cash projetée.
export type ProjectionConfigInput = { certitudes: ProjectionTierInput; forecast: ProjectionTierInput; pipe: ProjectionTierInput; cashOpening?: number; excludeDormant?: boolean; geleMonths?: number };
/** Enregistre les niveaux de projection (admin) : recompute COMPLET (overview/pipeline/atterrissage/ams). */
export async function callSetProjectionConfig(cfg: ProjectionConfigInput) {
  const res = await httpsCallable(functions, "setProjectionConfig")(cfg);
  return res.data as ProjectionConfigInput & { ok: boolean };
}

export type NotificationConfig = { enabled: boolean; minSeverity: "high" | "medium"; webhookUrl: string };
/** Enregistre la config de notifications (admin) ; test=true envoie un ping de vérification. */
export async function callSetNotificationConfig(cfg: NotificationConfig & { test?: boolean }) {
  await httpsCallable(functions, "setNotificationConfig")(cfg);
}

// FUZZY MATCHING QUALITÉ (Lot 9) — quasi-doublons de noms clients (à corriger via un alias).
export type FuzzyPair = { a: string; b: string; score: number };
/** Détecte les quasi-doublons de noms clients (typos, mot en plus). Droit « import ». */
export async function fuzzyDuplicateClients(threshold?: number) {
  const res = await httpsCallable(functions, "fuzzyDuplicateClients", { timeout: 120_000 })({ threshold });
  return res.data as { ok: boolean; pairs: FuzzyPair[]; scanned: number; threshold: number };
}

// NORMALISATION IA — l'IA (Claude) juge quelles graphies désignent la MÊME entité et propose des fusions
// `variant → canonique` (au-delà du fuzzy Levenshtein). « L'IA propose, l'humain valide » : aucune écriture,
// les propositions s'ajoutent à la table d'alias que la direction enregistre (setClientAliases).
export type ClientMergeSuggestion = { from: string; to: string; confidence: number; reason: string; existingTarget: boolean };
export type ClientMergeResult = { ok: boolean; suggestions: ClientMergeSuggestion[]; model: string; truncated: boolean; analyzed: number; total: number };
export async function aiSuggestClientMerges(names: { name: string; count: number }[]): Promise<ClientMergeResult> {
  const res = await httpsCallable(functions, "aiSuggestClientMerges", { timeout: 300_000 })({ names });
  return res.data as ClientMergeResult;
}

/** Enregistre la table d'alias de normalisation des noms de clients (direction). Remplace la table
 *  entière ; recalcule tous les agrégats client. */
export async function setClientAliases(pairs: { from: string; to: string }[]) {
  const res = await httpsCallable(functions, "setClientAliases")({ pairs });
  return res.data as { ok: boolean; count: number };
}

/** ASSAINISSEMENT — supprime des enregistrements erronés/fantômes (les imports delta ne purgent
 *  jamais). Gouverné par le module RBAC de la donnée, audité, recompute derrière. Les identifiants
 *  sont des DOC IDS. Collections : orders / invoices / bcLines / projectSheets / opportunities. */
export async function deleteRecords(collection: string, ids: string[]) {
  const res = await httpsCallable(functions, "deleteRecords")({ collection, ids });
  return res.data as { ok: boolean; count: number };
}
/** Supprime un seul enregistrement (assainissement). */
export const deleteRecord = (collection: string, id: string) => deleteRecords(collection, [id]);

/** ANNULATION — bascule le statut « Annulée » d'une commande / facture. Non destructif : l'objet
 *  reste (historique) mais est EXCLU de tous les agrégats (carnet, CAS, backlog, facturation, cash).
 *  Stocké en overlay (config/cancellations) → survit à un ré-import delta. `id` = DOC ID (commande =
 *  fpDocId(fp)). meta = libellé/nom non monétaires pour l'affichage de la liste des annulées. */
export async function setCancellation(collection: "orders" | "invoices", id: string, cancelled: boolean, meta?: { label?: string; client?: string }) {
  const res = await httpsCallable(functions, "setCancellation")({ collection, id, cancelled, ...(meta || {}) });
  return res.data as { ok: boolean; id: string; cancelled: boolean };
}

/** Doc id Firestore d'un N° FP (miroir de functions/lib/sheets safeId — NON idempotent). Sert à
 *  cibler orders/{safeId(fp)} depuis une ligne de commande (qui ne porte que le FP). */
export const fpDocId = (fp: string) => String(fp || "").trim().replace(/_/g, "%5F").replace(/\//g, "_").replace(/\s+/g, "");

/** Relance la CURATION LLM de la veille (scoring de pertinence des bulletins). Direction. Échoue avec
 *  « failed-precondition » si le secret ANTHROPIC_API_KEY n'est pas configuré. */
export async function curateNewsNow() {
  const res = await httpsCallable(functions, "curateNewsNow", { timeout: 120_000 })({});
  return res.data as { ok: boolean; scored?: number; active?: number; model?: string };
}

/** Déclenche un recalcul des agrégats (admin). */
export async function callRecompute() {
  const res = await httpsCallable(functions, "recompute")({});
  return res.data;
}

export type ReingestResult = {
  ok: boolean; objectsScanned: number; objectsIngested: number; objectsFailed: number;
  kinds: string[]; rowsIn: number; rowsOk: number; rowsSkipped: number;
  files?: { object: string; kinds?: string[]; rowsOk?: number; error?: string }[];
};
/** Re-parse les classeurs sources déjà présents dans gs://nt360 (sans re-upload) puis recompute.
 *  Direction uniquement. `prefix` restreint éventuellement le balayage à un sous-dossier. */
export async function callReingest(prefix?: string): Promise<ReingestResult> {
  const res = await httpsCallable(functions, "reingest", { timeout: 540_000 })(prefix ? { prefix } : {});
  return res.data as ReingestResult;
}

/** Encode un File en base64 (sans le préfixe `data:...;base64,`). */
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const s = String(r.result || "");
      resolve(s.slice(s.indexOf(",") + 1));
    };
    r.onerror = () => reject(r.error || new Error("lecture du fichier impossible"));
    r.readAsDataURL(file);
  });
}

// Détail par fichier (classeur d'un ZIP ou fichier unique) : ce qui a été reconnu, lignes OK,
// ventilation par type, et cause d'échec éventuelle ("aucune source reconnue", "classeur illisible"…).
export type ImportKindReport = { rowsIn?: number; rowsOk?: number; rowsSkipped?: number; error?: string };
export type ImportFileReport = { file: string; kinds?: string[]; rowsOk?: number; error?: string; byKind?: Record<string, ImportKindReport> };
export type ImportDeltaResult = { ok: boolean; kinds: string[]; rowsIn: number; rowsOk: number; rowsSkipped: number; fileCount?: number; files?: ImportFileReport[] };

/** Importe un delta (XLSX au modèle connu) : upsert idempotent côté serveur + recompute.
 *  `onPhase` signale la progression : "reading" (encodage local) → "processing" (envoi + traitement). */
export async function callImportDelta(file: File, onPhase?: (p: "reading" | "processing") => void): Promise<ImportDeltaResult> {
  onPhase?.("reading");
  const fileB64 = await fileToBase64(file);
  onPhase?.("processing");
  const res = await httpsCallable(functions, "importDelta")({ fileB64, filename: file.name });
  return res.data as ImportDeltaResult;
}

export type BcLineFields = {
  bcNumber?: string; supplier?: string; fp?: string; customer?: string; country?: string;
  expenseType?: string; description?: string; currency?: string; amount?: number; amountXof?: number; status?: string;
  dateIn?: string;
};

/** Analyse un BC PDF (pdfjs côté serveur) et renvoie les champs pré-remplis (best-effort). */
export async function callParseBcPdf(pdf: File): Promise<BcLineFields> {
  const pdfB64 = await fileToBase64(pdf);
  const res = await httpsCallable(functions, "parseBcPdf")({ pdfB64 });
  return (res.data as { ok: boolean; fields: BcLineFields }).fields;
}

/** Ajoute un BC fournisseur unitaire (mode « Unitaire / PDF ») + PDF joint optionnel. */
export async function callAddBcLine(fields: BcLineFields, pdf?: File | null) {
  const pdfB64 = pdf ? await fileToBase64(pdf) : undefined;
  const res = await httpsCallable(functions, "addBcLine")({ fields, pdfB64, filename: pdf?.name });
  return res.data as { ok: boolean; id: string; pdfStored: boolean };
}

export type DedupeSampleGroup = { keep: { id: string; ref: string; source: string | null }; remove: { id: string; ref: string; source: string | null }[] };
export type DedupeStat = { total: number; duplicateGroups: number; duplicates: number; capped?: boolean; sample?: DedupeSampleGroup[] };
export type DedupeResult = { ok: boolean; applied: boolean; result: Record<string, DedupeStat> };

/** Dédoublonne (admin) factures/opportunités/BC. `apply:false` = analyse seule (aperçu). */
export async function callDedupe(collections?: string[], apply = true): Promise<DedupeResult> {
  const res = await httpsCallable(functions, "dedupe")({ collections, apply });
  return res.data as DedupeResult;
}

/** Génère l'export one-pager CODIR (XLSX) et renvoie l'URL signée. */
export async function callExportReport(period: string) {
  const res = await httpsCallable(functions, "exportReport")({ period });
  return res.data as { ok: boolean; objectKey: string; url: string | null };
}

// FICHE D'AFFAIRE dématérialisée — chemin ALTERNATIF à l'import du fichier P&L. Circuit 6 étapes,
// masquage serveur des champs confidentiels (le PM / rôle sans « rentabilité » les reçoit OMIS).
export type FicheLine = {
  id?: string | null; ordre?: number; description: string; fournisseur: string;
  type_charge: string; devise: "XOF" | "USD" | "EUR"; montant: number; numero_bc?: string | null;
};
export type FicheFinancials = {
  lignes_xof: number; prix_de_revient_ht: number; prix_vente_ht: number;
  marge_brute: number; pct_marge: number; seuil_marge_pct: number; below_threshold: boolean;
  missing_fx_rate?: boolean; // devise étrangère sans taux → coût sous-évalué, marge non fiable (audit ①)
};
export type Fiche = {
  _id?: string; numero_fp: string; numero_dc?: string | null; client: string; affaire: string;
  commercial: string; po_client_ref?: string | null; po_client_date?: string | null;
  date_fiche?: string | null; editeur_ac?: string; taux_usd?: number; taux_eur?: number;
  seuil_marge_pct?: number; provisions_xof?: number; autres_frais_financiers_xof?: number;
  prix_vente_ht_xof?: number; memo?: string | null; lignes: FicheLine[];
  statut: string; etape_courante: number; terminee?: boolean;
  financials?: FicheFinancials | null; pmMasked?: boolean;
};
export type FicheEvent = {
  etape_code: string; type_action: string; acteur_nom: string; role: string;
  commentaire?: string | null; duree_etape_s?: number | null; horodatage_ms?: number;
};

/** Crée une fiche d'affaire en brouillon (assistance commerciale / direction). */
export async function createFiche(data: Partial<Fiche>) {
  const res = await httpsCallable(functions, "createFiche")(data);
  return res.data as { ok: boolean; id: string; fp: string };
}
/** Édite les champs autorisés à l'étape courante (verrou serveur). */
export async function updateFiche(id: string, patch: Record<string, unknown>) {
  const res = await httpsCallable(functions, "updateFiche")({ id, patch });
  return res.data as { ok: boolean; id: string };
}
/** Soumet / valide l'étape courante → étape suivante (le DRO passe numero_dc). */
export async function ficheAdvance(id: string, opts?: { numero_dc?: string; commentaire?: string }) {
  const res = await httpsCallable(functions, "ficheAdvance")({ id, ...opts });
  return res.data as { ok: boolean; id: string; fiche: Fiche; recomputed: boolean };
}
/** Rejette l'étape courante (motif obligatoire) → retour édition AC. */
export async function ficheReject(id: string, commentaire: string) {
  const res = await httpsCallable(functions, "ficheReject")({ id, commentaire });
  return res.data as { ok: boolean; id: string; fiche: Fiche };
}
/** Charge une fiche + son journal (masquée selon le rôle). */
export async function getFiche(id: string) {
  const res = await httpsCallable(functions, "getFiche")({ id });
  return res.data as { ok: boolean; fiche: Fiche; history: FicheEvent[] };
}
/** Liste les fiches (masquées selon le rôle), filtrable statut/client/commercial. */
export async function listFiches(filter?: { statut?: string; client?: string; commercial?: string; limit?: number }) {
  const res = await httpsCallable(functions, "listFiches")(filter || {});
  return res.data as { ok: boolean; fiches: Fiche[]; count: number };
}

// BULLETIN HEBDO « Hot Topics Opérations » — commentaires / points clés saisis manuellement (Phase 1).
// Structuré en sections (ex. « Engagements fournisseurs », « Projets ») → puces → sous-puces (2 niveaux).
export type BulletinItem = { text: string; sub?: string[] };
export type BulletinSection = { title: string; items: BulletinItem[] };
export type OpsBulletin = { _id?: string; fy: number; week: number; sections: BulletinSection[]; updatedByName?: string; updatedAt?: unknown };

/** Enregistre le bulletin hebdo d'une semaine d'exercice (direction / PMO). Upsert : 1 par semaine. */
export async function upsertOpsBulletin(b: { fy: number; week: number; sections: BulletinSection[] }) {
  const res = await httpsCallable(functions, "upsertOpsBulletin")(b);
  return res.data as { ok: boolean; id: string };
}

// CONTRATS DE MAINTENANCE (module mnt_, Lot 1). Écriture callable-only, double garde serveur
// (droit `maintenance` + drapeau config/mntFeature). L'UI est désactivée en amont si le rôle
// n'a pas le droit ; les rules restent la barrière opposable.
// Appels mnt_ gouvernés (double garde serveur : droit `maintenance` + drapeau). `mntCall` renvoie la
// donnée du callable ; `mntWrite` ignore le retour (suppressions/changements ciblés).
const mntCall = <T>(name: string, data: unknown): Promise<T> => httpsCallable(functions, name)(data).then((r) => r.data as T);
const mntWrite = (name: string, data: unknown): Promise<void> => httpsCallable(functions, name)(data).then(() => {});
// Appel LONG (assistants IA / imports) : timeout élevé pour tenir la réflexion adaptative dans le callable.
const mntCallLong = <T>(name: string, data: unknown): Promise<T> => httpsCallable(functions, name, { timeout: 300_000 })(data).then((r) => r.data as T);
export const upsertMntContrat = (c: MntContrat) => mntCall<{ ok: boolean; id: string }>("upsertMntContrat", c);
export const deleteMntContrat = (id: string) => mntWrite("deleteMntContrat", { id });
// Changement de statut MINIMAL (ne touche que `statut`) — sert l'action en masse « Passer au statut ».
export const setMntContratStatut = (id: string, statut: string) => mntWrite("setMntContratStatut", { id, statut });
// Abonnements de surveillance de l'utilisateur (ADR-026) — écrit mnt_watches/{uid} (normalisé serveur).
export const setMntWatch = (watch: MntWatch) => mntWrite("setMntWatch", watch);
// Statut automatique (ADR-027, révisé ADR-028) — PROPOSE uniquement (n'écrit aucun statut). L'application
// reste un geste humain (setMntContratStatut). `revertMntAutoStatut` rétablit les statuts auto-appliqués
// par l'ancienne version (rétablissement d'incident, idempotent).
export const aiMntContratStatut = (opts?: { ids?: string[]; threshold?: number }) => mntCall<MntStatutRun>("aiMntContratStatut", opts || {});
export const revertMntAutoStatut = () => mntCall<{ ok: boolean; restored: number; considered: number }>("revertMntAutoStatut", {});
// Lignées de renouvellement (ADR-030) — détection IA de contrats distincts = même engagement reconduit,
// numéro généré AAAAMM+client. `aiMntLignees` PROPOSE (aucune écriture) ; `applyMntLignee` persiste `ligneeId`.
export type MntLigneeContrat = { id: string; fp?: string; dateDebut?: string; dateFin?: string | null; montantEngage?: number; affaire?: string };
export type MntLignee = { numero: string; client: string; contrats: MntLigneeContrat[]; montantMoyen: number; debut?: string; fin?: string | null; count: number; confidence?: number; reason?: string };
export type MntLigneeResult = { ok: boolean; lignees: MntLignee[]; model?: string; candidates?: number };
export const aiMntLignees = () => mntCallLong<MntLigneeResult>("aiMntLignees", {});
export const applyMntLignee = (numero: string, contratIds: string[]) => mntCall<{ ok: boolean; numero: string; count: number }>("applyMntLignee", { numero, contratIds });
export type MntImportResult = {
  ok: boolean; applied: boolean; created: number; updated: number; skipped: number; rowsParsed: number;
  samples?: { create: { fp: string; client: string; statut: string }[]; update: { fp: string; client: string; statut: string }[]; errors: { line: number; error: string; fp: string | null }[] };
};
/** Importe/actualise en masse les contrats de maintenance depuis un classeur (.xlsx/.csv). `apply=false` =
 *  APERÇU (dry-run) ; `apply=true` = applique (upsert par N° FP). Double-gaté (droit `maintenance` + drapeau). */
export async function importMntContrats(file: File, apply: boolean): Promise<MntImportResult> {
  const fileB64 = await fileToBase64(file);
  const res = await httpsCallable(functions, "importMntContrats", { timeout: 300_000 })({ fileB64, filename: file.name, apply });
  return res.data as MntImportResult;
}

// Suggestion IA de contrats — l'IA (Claude) juge quelles affaires du carnet (candidats fournis) relèvent
// d'une prestation récurrente. « L'IA propose, l'humain valide » : renvoie des propositions PRÉ-REMPLI-ables,
// aucune écriture. Double-gaté serveur (droit `maintenance` + drapeau) + secret ANTHROPIC_API_KEY.
import type { MntCandidate } from "./mntSuggest";
export type MntAiSuggestion = { fp: string; client: string; bu: string; am: string; affaire: string; cas: number; confidence: number; reason: string; echeance: string | null };
export type MntAiSuggestResult = { ok: boolean; suggestions: MntAiSuggestion[]; model: string; truncated: boolean; analyzed: number; total: number };
export const aiSuggestMntContrats = (candidates: MntCandidate[]) => mntCallLong<MntAiSuggestResult>("aiSuggestMntContrats", { candidates });

// Rentabilité par contrat (Lot 4/7) — revenu engagé vs coût interventions (jours × CJM). Coût/marge MASQUÉS
// (null) sans droit `rentabilite` (calcul serveur, le CJM ne sort jamais). Lecture gouvernée `maintenance`.
export type MntContratPnlRow = { id: string; fp: string | null; client: string; statut: string; revenue: number; jours: number; coutInterventions: number | null; coutPnl: number | null; coutAstreintes: number | null; cout: number | null; marge: number | null; margePct: number | null; missingCjm: number | null };
export const mntContratPnl = () => mntCallLong<{ ok: boolean; rows: MntContratPnlRow[]; hasCost: boolean }>("mntContratPnl", {});

// Analyse de rétention IA (Lot 6/7) — l'IA lit les contrats à risque + stats tickets et rend, par contrat,
// les motifs de churn + une reco de rétention. « L'IA propose », aucune écriture. Droit `maintenance` + secret.
export type ChurnInput = { fp: string; client: string; niveau: string; signals: string[]; joursEcheance: number | null; ticketsOuverts: number; slaBreaches: number };
export type ChurnAnalysis = { fp: string; client: string; churnRisk: "eleve" | "moyen" | "faible"; drivers: string[]; recommendation: string };
export type ChurnResult = { ok: boolean; analyses: ChurnAnalysis[]; model: string; truncated: boolean; analyzed: number; total: number };
export const aiAnalyzeChurn = (contrats: ChurnInput[]) => mntCallLong<ChurnResult>("aiAnalyzeChurn", { contrats });

// Tickets & interventions de maintenance (mnt_, Lot 2). Callable-only, double garde serveur.
import type { MntTicket, MntIntervention, MntWatch } from "../types";
import type { MntStatutRun } from "./mntStatutAuto";
export const upsertMntTicket = (t: MntTicket) => mntCall<{ ok: boolean; id: string }>("upsertMntTicket", t);
export const deleteMntTicket = (id: string) => mntWrite("deleteMntTicket", { id });
export const upsertMntIntervention = (i: MntIntervention) => mntCall<{ ok: boolean; id: string }>("upsertMntIntervention", i);
export const deleteMntIntervention = (id: string) => mntWrite("deleteMntIntervention", { id });

// Décision de contrat (renouvellement / résiliation) soumise au moteur d'approbation (Lot 4, ADR-004).
export async function submitMntDecision(contratId: string, kind: "renouvellement_contrat" | "resiliation_contrat", note?: string) {
  const res = await httpsCallable(functions, "submitMntDecision")({ contratId, kind, note });
  return res.data as { ok: boolean; id: string; approverUid: string };
}
