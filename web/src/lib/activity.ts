// Store GLOBAL d'activité serveur : suit les opérations (écritures — chacune inclut un recompute côté
// serveur de plusieurs secondes — exports, lectures longues). Sert (1) un indicateur global HONNÊTE
// (« traitement en cours ») et (2) un JOURNAL d'activité : ce qui est en cours, ce qui vient de se
// terminer, ce qui a échoué — au-delà du toast éphémère. Externe à React (partagé par TOUS les boutons
// Busy/DangerBtn via trackWrite) ; les 40 dernières entrées survivent au rechargement (localStorage).
import { useSyncExternalStore } from "react";

export type ActivityStatus = "running" | "done" | "error";
export type ActivityEntry = { id: number; label: string; status: ActivityStatus; startedAt: number; endedAt?: number; detail?: string };

const LOG_CAP = 40;
const STORE_KEY = "nt360.activity.v1";

// « Époque » d'écriture : incrémentée à CHAQUE opération terminée avec SUCCÈS. Sert de signal global de
// RÉACTIVITÉ — les vues alimentées par un callable (qui tiennent leurs données en état local, hors du
// temps-réel Firestore) s'y abonnent pour se rafraîchir automatiquement après une action, sans que
// l'utilisateur ait à recharger la page. Une écriture ÉCHOUÉE ne change pas la donnée → n'incrémente pas.
let writeEpoch = 0;

let entries: ActivityEntry[] = load();
let seq = entries.reduce((m, e) => Math.max(m, e.id), 0);
const listeners = new Set<() => void>();
const notify = () => { save(); listeners.forEach((l) => l()); };

function load(): ActivityEntry[] {
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(STORE_KEY) : null;
    const arr = raw ? JSON.parse(raw) : [];
    // Une opération « en cours » à la restauration est forcément orpheline (rechargement) → marquée interrompue.
    return (Array.isArray(arr) ? arr : []).map((e: ActivityEntry) => e.status === "running" ? { ...e, status: "error" as const, detail: "interrompu (rechargement)", endedAt: e.startedAt } : e).slice(0, LOG_CAP);
  } catch { return []; }
}
function save() {
  try { if (typeof localStorage !== "undefined") localStorage.setItem(STORE_KEY, JSON.stringify(entries.slice(0, LOG_CAP))); } catch { /* quota / privé : best-effort */ }
}

function upsert(e: ActivityEntry) {
  entries = [e, ...entries.filter((x) => x.id !== e.id)].slice(0, LOG_CAP);
  notify();
}

// Compat : compteur d'opérations en cours = nombre d'entrées « running ».
export function useWriteActivity(): boolean {
  return useSyncExternalStore(subscribe, () => entries.some((e) => e.status === "running"), () => false);
}
export function useActivityLog(): ActivityEntry[] {
  return useSyncExternalStore(subscribe, () => entries, () => entries);
}
/** Compteur d'écritures réussies — change à chaque mutation terminée. À mettre en dépendance d'un effet
 *  pour rafraîchir une vue callable après action (cf. useReloadOnWrite). */
export function useWriteEpoch(): number {
  return useSyncExternalStore(subscribe, () => writeEpoch, () => 0);
}
function subscribe(cb: () => void) { listeners.add(cb); return () => { listeners.delete(cb); }; }

export function clearActivityLog(): void {
  // On ne retire que les entrées TERMINÉES (une opération en cours reste visible jusqu'à sa fin).
  entries = entries.filter((e) => e.status === "running");
  notify();
}

/**
 * Enveloppe une promesse pour la journaliser (begin/end garantis, même en erreur) et la compter comme
 * opération en cours. `label` = intitulé lisible affiché dans le centre d'activité (sinon « Opération »).
 */
export async function trackWrite<T>(p: Promise<T>, label = "Opération"): Promise<T> {
  const id = ++seq;
  const startedAt = Date.now();
  upsert({ id, label, status: "running", startedAt });
  try {
    const r = await p;
    writeEpoch += 1; // mutation réussie → réveille les vues callable abonnées (réactivité)
    upsert({ id, label, status: "done", startedAt, endedAt: Date.now() });
    return r;
  } catch (e: any) {
    const detail = String(e?.message || e?.code || "").replace(/^functions\//, "") || "échec";
    upsert({ id, label, status: "error", startedAt, endedAt: Date.now(), detail });
    throw e;
  }
}
