// Écritures gardées (BUILD_KIT §12, F5). Les rules restent la barrière opposable :
// ces écritures échouent côté serveur si le rôle est insuffisant (UI désactivée en amont).
import { doc, setDoc, updateDoc, deleteDoc } from "firebase/firestore";
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

/** Fait évoluer le statut d'une ligne BC (seul champ modifiable, cf. rules). */
export async function setBcStatus(id: string, status: string) {
  await updateDoc(doc(db, "bcLines", id), { status });
}

/** Crée/met à jour une ligne de crédit fournisseur. */
export async function upsertCreditLine(id: string, data: { authorized: number; outstanding: number }) {
  await setDoc(doc(db, "creditLines", id), { ...data, updatedAt: new Date().toISOString() }, { merge: true });
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

/** Génère l'export one-pager CODIR (XLSX) et renvoie l'URL signée. */
export async function callExportReport(period: string) {
  const res = await httpsCallable(functions, "exportReport")({ period });
  return res.data as { ok: boolean; objectKey: string; url: string | null };
}
