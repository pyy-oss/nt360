// Écritures gardées (BUILD_KIT §12, F5). Les rules restent la barrière opposable :
// ces écritures échouent côté serveur si le rôle est insuffisant (UI désactivée en amont).
import { doc, setDoc, deleteDoc } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "./firebase";

export type OppInput = {
  id?: string; client: string; am: string; bu: string; amount: number; stage: number;
  probability: number; closingDate?: string; fp?: string;
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
export async function patchOpportunity(data: { id: string; fp?: string; closingDate?: string | null; amount?: number; stage?: number; am?: string; bu?: string; probability?: number }) {
  await httpsCallable(functions, "patchOpportunity")(data);
}

/** Rattache une facture orpheline à sa commande en corrigeant son N° FP (onCall : recalcule). */
export async function setInvoiceFp(id: string, fp: string) {
  await httpsCallable(functions, "setInvoiceFp")({ id, fp });
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
/** Liste les membres du workspace ClickUp (nom + e-mail) — pour peupler le référentiel PM (admin). */
export async function listClickupMembers() {
  const res = await httpsCallable(functions, "listClickupMembers", { timeout: 60_000 })({});
  return res.data as { ok: boolean; members: { name: string; email: string }[] };
}
/** Champs complémentaires du modal ClickUp (ceux que la commande ne fournit pas — ex-formulaire). */
export type ClickupExtra = {
  pays?: string; nature?: string; domaine?: string; secteur?: string; circuit?: string; catRecurrent?: string;
  priority?: string; commentaire?: string;
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
export async function patchBcLine(data: { id: string; fp?: string; amountXof?: number; supplier?: string; expenseType?: string; description?: string; dateIn?: string | null }) {
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

/** Crée/met à jour un objectif annuel (périmètre : global / bu / commercial / client). */
export async function upsertObjective(o: {
  fiscalYear: number; scope: string; scopeValue: string; label?: string;
  targetCas: number; targetInvoiced: number; targetMargin: number; targetMarginPct?: number;
}) {
  await setDoc(doc(db, "objectives", objectiveId(o)), o, { merge: true });
}

/** Supprime un objectif. */
export async function deleteObjective(id: string) {
  await deleteDoc(doc(db, "objectives", id));
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
