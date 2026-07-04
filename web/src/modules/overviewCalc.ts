// Recalcul de la Vue d'ensemble POUR UN PÉRIMÈTRE (BU/AM/client), en miroir EXACT du domaine
// serveur `overview()` (functions/domain/chaine.js) : mêmes cohortes (CAS par année de PO,
// CAF = factures datées, backlog glissant = RAF de toutes les commandes ouvertes du périmètre)
// et mêmes ratios. Fonction PURE → testable sans React.
import type { Dim } from "../lib/filters";
import type { Order, Invoice, Opportunity } from "../types";
import { projectionWeight, normalizeTiers, type Tier } from "../lib/projection";

export type FilteredOverview = {
  certitudes: number; commandes: number; facture: number; backlog: number; backlogCount: number; mb: number;
  factureMb: number; facturePmb: number; // perspective Facturé (marge reconnue au prorata, plafonnée au CAS)
  ratios: { tauxFacturation: number; tauxConversionVente: number; pmb: number };
};

const DIMS: Dim[] = ["bu", "am", "client"];

export function computeFilteredOverview(
  cmdRows: Order[], invoices: Invoice[], opps: Opportunity[], period: string,
  match: (row: { bu?: string; am?: string; client?: string }, dims?: Dim[]) => boolean,
  tiers?: Tier[],
): FilteredOverview {
  const t = tiers || normalizeTiers();
  const yr = (d?: string) => (d ? String(d).slice(0, 4) : "");
  const inPeriod = (y: string) => period === "all" || y === period;
  const S = (a: any[], f: (x: any) => number) => a.reduce((s, x) => s + (f(x) || 0), 0);
  // Dédup inter-source (miroir de recomputeAll) : une opp SAISIE dont le FP est aussi couvert par
  // une opp SALESDATA est écartée (la version importée fait foi) — sinon double-compte du pipeline
  // dans la vue filtrée (certitudes / conversion gonflées vs le cockpit global).
  const cf = (s?: string) => (s || "").trim().toUpperCase();
  const salesFps = new Set(opps.filter((o) => o.source === "salesData" && o.fp).map((o) => cf(o.fp)));
  opps = opps.filter((o) => !(o.source === "saisie" && o.fp && salesFps.has(cf(o.fp))));
  // Commandes du périmètre = cohorte par année de PO ; backlog GLISSANT = toutes les commandes
  // ouvertes du périmètre (indépendant de la période).
  const ordP = cmdRows.filter((o) => inPeriod(String(o.yearPo || "")) && match(o, DIMS));
  const ordAll = cmdRows.filter((o) => match(o, DIMS));
  // Attribution des factures au périmètre via leur commande (fp) ; repli sur bu/client de la facture.
  const byFp = new Map<string, Order>();
  for (const o of cmdRows) if (o.fp) byFp.set(o.fp, o);
  const invP = invoices.filter((i) => {
    if (!inPeriod(yr(i.date))) return false;
    const o = i.fp ? byFp.get(i.fp) : undefined;
    return match({ bu: o?.bu ?? i.bu, am: o?.am, client: o?.client ?? i.client }, DIMS);
  });
  const oppP = opps.filter((o) => inPeriod(yr(o.closingDate)) && match(o, DIMS));
  const commandes = S(ordP, (o) => o.cas);
  const backlog = S(ordAll, (o) => Math.max(o.raf || 0, 0));
  const backlogCount = ordAll.filter((o) => (o.raf || 0) > 0).length;
  const mb = S(ordP, (o) => o.mb);
  const facture = S(invP, (i) => i.amountHt);
  // Perspective FACTURÉ : marge reconnue = taux(mb/CAS) de la commande × min(facturé_FP, CAS_FP)
  // (plafond au CAS = pas de marge sur la surfacturation, miroir reporting.factureLines).
  const rateByFp = new Map<string, { rate: number; cas: number }>();
  for (const o of cmdRows) if (o.fp) rateByFp.set(o.fp, { rate: (o.cas || 0) > 0 ? (o.mb || 0) / (o.cas || 0) : 0, cas: o.cas || 0 });
  const facByFp = new Map<string, number>();
  for (const i of invP) { const k = i.fp || ""; facByFp.set(k, (facByFp.get(k) || 0) + (i.amountHt || 0)); }
  let factureMb = 0;
  for (const [fp, base] of facByFp) { const r = rateByFp.get(fp); if (r && r.cas > 0) factureMb += r.rate * Math.min(base, r.cas); }
  const facturePmb = facture > 0 ? factureMb / facture : 0;
  const active = oppP.filter((o) => (o.stage || 0) >= 1 && (o.stage || 0) <= 5);
  // Pipeline projeté = Σ des niveaux ACTIFS (moteur configurable, miroir serveur). Certitudes =
  // contribution pondérée du niveau ≥90 (0 si désactivé).
  const pipelineProjete = S(active, (o) => projectionWeight(o, t));
  const certT = t.find((x) => x.key === "certitudes")!;
  const pondCertain = certT.active ? S(active.filter((o) => (o.probability || 0) >= certT.min), (o) => o.amount) * certT.weight : 0;
  const perdu = S(oppP.filter((o) => o.stage === 7), (o) => o.amount);
  const convDenom = commandes + pipelineProjete + perdu;
  return {
    certitudes: pondCertain, commandes, facture, backlog, backlogCount, mb, factureMb, facturePmb,
    ratios: {
      tauxFacturation: (facture + backlog) > 0 ? facture / (facture + backlog) : 0,
      tauxConversionVente: convDenom > 0 ? commandes / convDenom : 0,
      pmb: commandes > 0 ? mb / commandes : 0,
    },
  };
}
