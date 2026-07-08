// Écritures gardées (BUILD_KIT §12, F5). Les rules restent la barrière opposable :
// ces écritures échouent côté serveur si le rôle est insuffisant (UI désactivée en amont).
import { httpsCallable } from "firebase/functions";
import { functions } from "./firebase";

export type OppInput = {
  id?: string; client: string; am: string; bu: string; amount: number; stage: number;
  probability: number; closingDate?: string; fp?: string; mbPrev?: number; dr?: boolean;
  nextStep?: string; nextStepDate?: string | null; lostReason?: string;
};

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
export async function patchOpportunity(data: { id: string; fp?: string; closingDate?: string | null; amount?: number; stage?: number; am?: string; bu?: string; probability?: number; nextStep?: string; nextStepDate?: string | null; lostReason?: string }) {
  await httpsCallable(functions, "patchOpportunity")(data);
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
  const res = await httpsCallable(functions, "reconClient", { timeout: 120_000 })(client ? { client } : {});
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
  const res = await httpsCallable(functions, "correctionQueue", { timeout: 120_000 })({});
  return res.data as CorrectionQueueResult;
}

// OBJET COMPTE (Account 360) + CONTACTS. Métadonnée gouvernée « pipeline » ; lecture « overview ».
export type Account = { id?: string; name?: string; sector?: string; country?: string; parentId?: string | null; ownerUid?: string | null; notes?: string; tags?: string[] };
export type Contact = { id?: string; accountId?: string; name?: string; role?: string; email?: string; phone?: string; primary?: boolean };
export type AccountView = { ok: boolean; id: string; name: string; account: Account | null; contacts: Contact[] };
/** Vue Compte : résout le client → id canonique côté serveur, renvoie métadonnée + contacts. */
export async function accountView(client: string): Promise<AccountView> {
  const res = await httpsCallable(functions, "accountView")({ client });
  return res.data as AccountView;
}
/** Crée / met à jour la métadonnée d'un compte (clé sur le nom client canonique). */
export async function upsertAccount(data: { name: string; sector?: string; country?: string; parent?: string | null; ownerUid?: string | null; notes?: string; tags?: string[] }) {
  const res = await httpsCallable(functions, "upsertAccount")(data);
  return res.data as { ok: boolean; id: string; name: string };
}
/** Crée / met à jour un contact rattaché à un compte (par nom de client). */
export async function upsertContact(data: { id?: string; account: string; name: string; role?: string; email?: string; phone?: string; primary?: boolean }) {
  const res = await httpsCallable(functions, "upsertContact")(data);
  return res.data as { ok: boolean; id: string; accountId: string };
}
export async function deleteContact(id: string) { await httpsCallable(functions, "deleteContact")({ id }); }

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

/** Enregistre la table des taux de change (XOF par unité de devise) — admin. Remplace l'ensemble. */
export async function setFxRates(rates: Record<string, number>) {
  const res = await httpsCallable(functions, "setFxRates")({ rates });
  return res.data as { ok: boolean; rates: Record<string, number> };
}

/** Enregistre un référentiel éditable (liste des Project Managers / des BU) — admin. Remplace la liste. */
export async function setRefList(kind: "projectManagers" | "businessUnits", list: string[]) {
  const res = await httpsCallable(functions, "setRefList")({ kind, list });
  return res.data as { ok: boolean; kind: string; list: string[] };
}

/** Config intégration ClickUp (activation + liste cible) — admin. */
export async function setClickupConfig(cfg: { enabled?: boolean; teamId?: string; defaultListId?: string }) {
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
/** Enrichit les tâches ClickUp liées : commentaire de synthèse idempotent (CA/RAF, jalons, BC, qualité)
 *  + tag « à risque ». Admin. Peut être long. */
export async function enrichClickup() {
  const res = await httpsCallable(functions, "enrichClickup", { timeout: 540_000 })({});
  return res.data as { ok: boolean; enriched: number; failed?: number; tagged: number; subtasked: number; checklisted: number; total: number };
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

export type AlertThresholds = { concentration: number; surfacturationPct: number; rafEcartPct: number; dormantYears: number };
/** Enregistre les seuils d'alerte (admin) : recompute alertes + qualité côté serveur. */
export async function callSetAlertThresholds(cfg: AlertThresholds) {
  const res = await httpsCallable(functions, "setAlertThresholds")(cfg);
  return res.data as AlertThresholds & { ok: boolean };
}

export type ProjectionTierInput = { active: boolean; weight: number };
// cashOpening : solde d'ouverture de trésorerie (SOA global) — base de la position cash projetée.
export type ProjectionConfigInput = { certitudes: ProjectionTierInput; forecast: ProjectionTierInput; pipe: ProjectionTierInput; cashOpening?: number };
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

export type DedupeStat = { total: number; duplicateGroups: number; duplicates: number };
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
