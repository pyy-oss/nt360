// Store GLOBAL d'activité serveur : compte les opérations en cours (écritures — chacune inclut un
// recompute côté serveur de plusieurs secondes — mais aussi exports/lectures longues). Sert un indicateur
// global HONNÊTE (« traitement en cours ») pendant que l'UI attend le rafraîchissement des agrégats
// matérialisés. Externe à React (partagé par TOUS les boutons Busy/DangerBtn via trackWrite).
import { useSyncExternalStore } from "react";

let pending = 0;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

export function beginWrite(): void { pending += 1; notify(); }
export function endWrite(): void { pending = Math.max(0, pending - 1); notify(); }

/** Enveloppe une promesse pour la compter comme opération en cours (begin/end garantis, même en erreur). */
export async function trackWrite<T>(p: Promise<T>): Promise<T> {
  beginWrite();
  try { return await p; } finally { endWrite(); }
}

function subscribe(cb: () => void) { listeners.add(cb); return () => { listeners.delete(cb); }; }
/** `true` tant qu'au moins une opération serveur est en cours. */
export function useWriteActivity(): boolean {
  return useSyncExternalStore(subscribe, () => pending > 0, () => false);
}
