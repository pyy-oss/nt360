// Écritures des notifications email (Office 365 / Graph). ISOLÉ de lib/writes.ts pour ne pas alourdir
// le chunk d'entrée : importé UNIQUEMENT par le module Habilitations (lazy). Le secret client n'est
// jamais côté app (Secret Manager, GRAPH_CLIENT_SECRET).
import { httpsCallable } from "firebase/functions";
import { functions } from "./firebase";

export type EmailNotifyConfig = {
  enabled: boolean; tenantId: string; clientId: string; sender: string;
  recipients: { alerts: string[]; codir: string[] };
  triggers: { approvals: boolean; relances: boolean; alerts: boolean; codir: boolean };
};

/** Enregistre la config des notifications email (direction). */
export async function setEmailNotifyConfig(cfg: EmailNotifyConfig) {
  await httpsCallable(functions, "setEmailNotifyConfig")(cfg);
}

/** Envoie un email de test (valide l'app Azure + le secret de bout en bout). Remonte l'échec. Direction. */
export async function sendTestEmail(to: string) {
  const res = await httpsCallable(functions, "sendTestEmail", { timeout: 60_000 })({ to });
  return res.data as { ok: boolean; sent?: number; skipped?: string };
}
