// WATERFALL DE MARGE (Lot 9b « niveau Salesforce ») — décompose la marge totale en CONTRIBUTIONS par
// domaine (BU), façon cascade : chaque BU ajoute (ou retranche, si marge négative) sa contribution,
// jusqu'au total. Comble le volet « waterfall » de l'écart #9 (rentabilité 10/10). Fonction PURE →
// testée (web/src/lib/waterfall.test.ts). Utilisée par le module Rentabilité.
export type WaterfallStep = { label: string; value: number; start: number; end: number; kind: "pos" | "neg" | "total" };

export function marginWaterfall(byBu: { bu?: string; mb?: number }[]): { steps: WaterfallStep[]; total: number } {
  const rows = (byBu || []).filter((b) => b && b.bu != null).slice().sort((a, b) => (Number(b.mb) || 0) - (Number(a.mb) || 0));
  let cum = 0;
  const steps: WaterfallStep[] = [];
  for (const b of rows) {
    const v = Number(b.mb) || 0;
    steps.push({ label: String(b.bu), value: v, start: Math.min(cum, cum + v), end: Math.max(cum, cum + v), kind: v >= 0 ? "pos" : "neg" });
    cum += v;
  }
  steps.push({ label: "Total marge", value: cum, start: 0, end: cum, kind: "total" });
  return { steps, total: cum };
}
