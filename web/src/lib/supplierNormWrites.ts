// Appels de l'atelier de normalisation FOURNISSEURS (variante MINIMALE : inventaire + alias manuels).
// ISOLÉ de lib/writes.ts pour ne PAS alourdir le chunk d'entrée — importé UNIQUEMENT par le module
// Normalisation fournisseurs (lazy). Gouverné par le droit `fournisseurs` (lecture + écriture d'alias).
import { httpsCallable } from "firebase/functions";
import { functions } from "./firebase";

export type SupplierNameGroup = { canon: string; variants: { name: string; count: number; aliased: boolean }[]; total: number; distinct: number; hasVariants: boolean };
export type SupplierNamesResult = { ok: boolean; capped: boolean; distinctNames: number; distinctCanon: number; toReview: number; aliasCount: number; groups: SupplierNameGroup[] };

/** Inventaire des noms de fournisseurs (commandes + BC + factures fournisseur) groupés par clé canonique. */
export async function supplierNames() {
  const res = await httpsCallable(functions, "supplierNames", { timeout: 120_000 })({});
  return res.data as SupplierNamesResult;
}

/** Enregistre la table d'alias fournisseur (config/supplierAliases) — relance un recompute (SOA). */
export async function setSupplierAliases(pairs: { from: string; to: string }[]) {
  const res = await httpsCallable(functions, "setSupplierAliases", { timeout: 300_000 })({ pairs });
  return res.data as { ok: boolean; count: number };
}
