// Écritures gardées (BUILD_KIT §12, F5). Les rules restent la barrière opposable :
// ces écritures échouent côté serveur si le rôle est insuffisant (UI désactivée en amont).
import { doc, setDoc, deleteDoc } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "./firebase";

function uid() {
  const c: any = globalThis.crypto;
  return c?.randomUUID ? c.randomUUID() : "id" + Date.now() + Math.floor(Math.random() * 1e6);
}

/** Crée une opportunité de saisie (source='saisie' exigé par les rules). */
export async function addOpportunity(data: {
  client: string; am: string; bu: string; amount: number; stage: number;
  probability: number; closingDate?: string; fp?: string;
}) {
  const id = "saisie_" + uid();
  await setDoc(doc(db, "opportunities", id), {
    oppId: id,
    ...data,
    weighted: (data.amount || 0) * (data.probability || 0),
    source: "saisie",
    updatedAt: new Date().toISOString(),
  });
  return id;
}

/** Fait évoluer le statut d'une ligne BC (onCall : recalcule ensuite exposition + alertes). */
export async function setBcStatus(id: string, status: string) {
  await httpsCallable(functions, "setBcStatus")({ id, status });
}

/** Crée/met à jour une ligne de crédit fournisseur (onCall : recalcule exposition + alertes). */
export async function upsertCreditLine(id: string, data: { authorized: number; outstanding: number }) {
  await httpsCallable(functions, "upsertCreditLine")({ id, authorized: data.authorized, outstanding: data.outstanding });
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

/** Met à jour la matrice de droits (profil habilitations). */
export async function updateMatrix(matrix: Record<string, Record<string, string>>) {
  await setDoc(doc(db, "config", "permissions"), { matrix }, { merge: true });
}

/** Pose un rôle sur un utilisateur (Cloud Function admin). */
export async function callSetUserRole(uidTarget: string, role: string) {
  await httpsCallable(functions, "setUserRole")({ uid: uidTarget, role });
}

/** Déclenche un recalcul des agrégats (admin). */
export async function callRecompute() {
  const res = await httpsCallable(functions, "recompute")({});
  return res.data;
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

export type ImportDeltaResult = { ok: boolean; kinds: string[]; rowsIn: number; rowsOk: number; rowsSkipped: number };

/** Importe un delta (XLSX au modèle connu) : upsert idempotent côté serveur + recompute. */
export async function callImportDelta(file: File): Promise<ImportDeltaResult> {
  const fileB64 = await fileToBase64(file);
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
