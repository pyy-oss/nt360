// Centre de surveillance des contrats (mnt_) — miroir client du domaine functions/domain/mntSurveillance.js
// (ADR-026). Les ÉVÉNEMENTS sont matérialisés côté serveur (summaries/mnt_surveillance, projection du
// moteur de risque) ; ici vivent seulement les LIBELLÉS FR, les tons de sévérité et le filtrage par
// abonnement (miroir EXACT de watchMatchesEvent back). Pur → testable.

export type MntSeverity = "high" | "medium" | "low";
export type MntEventType = "sla_rompu" | "echeance_proche" | "quota_depasse" | "sous_facturation";

export interface MntSurveillanceEvent {
  id: string; contratId: string; fp: string | null; client: string; am: string; bu: string; niveau?: string;
  type: MntEventType; severity: MntSeverity; message: string;
  count?: number; jours?: number; depassement?: number; quota?: number; ecart?: number; pct?: number;
}
export interface MntSurveillanceSummary { events: MntSurveillanceEvent[]; counts: Record<MntSeverity, number>; total: number; asOf: string | null }
export interface MntWatch { global?: boolean; contrats?: string[]; clients?: string[]; ams?: string[] }

// Libellé FR du TYPE d'événement (le message détaillé vient du serveur — français, métier).
export const EVENT_TYPE_LABEL: Record<MntEventType, string> = {
  sla_rompu: "SLA rompu", echeance_proche: "Renouvellement", quota_depasse: "Quota dépassé", sous_facturation: "Sous-facturation",
};
// Ton de badge par sévérité, aligné sur la palette de risque de l'ERP (clay=grave, gold=attention, steel=info).
export function severityTone(s?: MntSeverity | string): "clay" | "gold" | "steel" | "neutral" {
  switch (s) { case "high": return "clay"; case "medium": return "gold"; case "low": return "steel"; default: return "neutral"; }
}
// Libellés alignés sur le Centre d'actualité (news.tsx SEV_LABEL) : « Urgent » plutôt que « Critique »,
// ce dernier étant déjà un palier de RISQUE (ADR-016, ton plum) affiché sur le même écran → pas de collision.
export const SEVERITY_LABEL: Record<MntSeverity, string> = { high: "Urgent", medium: "À surveiller", low: "Info" };

// Un événement est-il couvert par un abonnement ? Miroir EXACT de watchMatchesEvent (back) — sinon le
// filtre « Mes abonnements » divergerait de l'intention serveur.
export function watchMatchesEvent(watch: MntWatch | null | undefined, ev: MntSurveillanceEvent): boolean {
  const w = watch || {};
  if (w.global) return true;
  return !!(
    (w.contrats && w.contrats.includes(ev.contratId)) ||
    (w.clients && ev.client && w.clients.includes(ev.client)) ||
    (w.ams && ev.am && w.ams.includes(ev.am))
  );
}

// Y a-t-il au moins un abonnement actif ? (sinon la vue « Mes abonnements » invite à s'abonner).
export function hasAnyWatch(w?: MntWatch | null): boolean {
  return !!w && (!!w.global || !!(w.contrats?.length) || !!(w.clients?.length) || !!(w.ams?.length));
}
