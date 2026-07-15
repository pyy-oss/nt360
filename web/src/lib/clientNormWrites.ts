// Appel de l'atelier de normalisation clients. ISOLÉ de lib/writes.ts pour ne PAS alourdir le chunk
// d'entrée (writes.ts y est) : importé UNIQUEMENT par le module Normalisation clients (lazy).
import { httpsCallable } from "firebase/functions";
import { functions } from "./firebase";

export type ClientNameGroup = { canon: string; variants: { name: string; count: number; aliased: boolean }[]; total: number; distinct: number; hasVariants: boolean };
export type ClientNamesResult = { ok: boolean; capped: boolean; distinctNames: number; distinctCanon: number; toReview: number; aliasCount: number; groups: ClientNameGroup[] };

/** Inventaire des noms de clients (commandes + factures + opps) groupés par cible canonique. Droit « import ». */
export async function clientNames() {
  const res = await httpsCallable(functions, "clientNames", { timeout: 120_000 })({});
  return res.data as ClientNamesResult;
}
