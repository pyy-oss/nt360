// Types de données Firestore (summaries/* et collections) — frontière typée du front.
// Volontairement permissifs (champs optionnels) : les agrégats évoluent côté back-end.

export type Ratios = { tauxFacturation?: number; pmb?: number };

export interface OverviewSummary {
  period?: string;
  certitudes?: number; pondCertain?: number; commandes?: number;
  facture?: number; rafPeriode?: number; backlog?: number; backlogCount?: number;
  mb?: number; pipelineWon?: number; ratios?: Ratios;
}

export interface AtterrissageSummary {
  fy?: number; realiseCas?: number; backlog?: number; pipelinePondere?: number;
  projete?: number; cafProjete?: number;
  objectif?: number; ecart?: number; probaAtteinte?: number;
  objectifCaf?: number; ecartCaf?: number; probaAtteinteCaf?: number;
  factureN?: number; factureN1?: number; croissanceFacture?: number;
}

export type StageBucket = { amount?: number; weighted?: number; count?: number };
export type ClosingBucket = { brut?: number; pond?: number; count?: number };
export type StaleOpp = { oppId?: string; client?: string; am?: string; amount?: number; weighted?: number; closingDate?: string; stageLabel?: string };
export interface ClosingAnalysis {
  buckets?: { retard?: ClosingBucket; mois?: ClosingBucket; trim?: ClosingBucket; plus?: ClosingBucket; sans?: ClosingBucket };
  staleCount?: number; staleBrut?: number; staleTop?: StaleOpp[];
}
export interface PipelineSummary {
  tot?: { brut?: number; weighted?: number; count?: number; countConf?: number };
  susp?: { brut?: number; count?: number };
  conv?: number; wonCount?: number; lostCount?: number;
  byStage?: Record<number, StageBucket>; byAM?: Record<string, number>; byMonth?: Record<string, number>;
  byAmConv?: { am: string; won: number; lost: number; conv: number; activeCount: number; weighted: number }[];
  topOpps?: Opportunity[];
  closing?: ClosingAnalysis | null;
}

export interface BacklogSummary {
  fy?: number; total?: number; count?: number;
  byVintage?: Record<string, number>; byBu?: Record<string, number>;
  top?: { fp?: string; client?: string; bu?: string; raf?: number }[];
}

export interface FacturationSummary {
  period?: string; total?: number; count?: number;
  monthly?: Record<string, number>; byBu?: Record<string, number>;
  topClients?: { key: string; value: number }[];
}

export interface RentabiliteSummary {
  period?: string; mb?: number; cas?: number; pmb?: number;
  byBu?: { bu: string; cas: number; mb: number }[]; topClients?: { key: string; value: number }[];
  byAm?: { am: string; cas: number; mb: number; pmb: number }[];
  bottomAffaires?: { fp?: string; client?: string; am?: string; cas: number; mb: number; pmb: number }[];
}

export interface EntitySummary { period?: string; rows?: EntityRow[] }
export type TrendPoint = { date: string; casReel?: number; caf?: number; backlog?: number; pipeline?: number; projeteCas?: number; projeteCaf?: number; ar?: number; dso?: number; fy?: number };
export interface TrendsSummary { points?: TrendPoint[] }
export interface ReceivablesSummary {
  totalAR?: number; overdue?: number; overdueCount?: number; openCount?: number; dso?: number;
  buckets?: { notDue?: number; b0_30?: number; b31_60?: number; b61_90?: number; b90p?: number };
  topAR?: { key: string; value: number }[];
}
export type CashMonth = { month: string; ar: number; backlog: number; cumulAr: number };
export interface CashflowSummary {
  asOf?: string; horizon?: number; months?: CashMonth[];
  overdue?: number; overdueCount?: number; beyond?: number;
  totalAR?: number; arHorizon?: number; totalRaf?: number; openCount?: number;
}
export type EntityRow = { key: string; cas?: number; facture?: number; backlog?: number; mb?: number; pmb?: number };

export interface SuppliersSummary {
  totalExpo?: number; openTotal?: number; encoursTotal?: number;
  bySupplier?: SupplierRow[];
}
export type SupplierRow = { name: string; expo?: number; open?: number; encours?: number; authorized?: number; coverage?: number; util?: number; reco?: number; state?: string };

export type AlertItem = { type: string; severity: "high" | "medium" | "low"; count: number; message: string; refs?: string[] };
export interface AlertsSummary { items?: AlertItem[]; fy?: number }

export type Order = { id?: string; fp?: string; client?: string; bu?: string; am?: string; cas?: number; raf?: number; mb?: number; yearPo?: number; affaire?: string | null; costTotal?: number | null; marginPct?: number | null; source?: string | null; pnlSource?: string | null };
export interface CommandesSummary { count?: number; rows?: Order[] }
export type Invoice = { id?: string; numero?: string; fp?: string; client?: string; bu?: string; date?: string; dueDate?: string | null; amountHt?: number; linked?: boolean; prePo?: boolean; paymentStatus?: string; paid?: boolean; lines?: number };
export type Opportunity = { id?: string; oppId?: string; fp?: string; client?: string; am?: string; bu?: string; amount?: number; stage?: number; stageLabel?: string; probability?: number; weighted?: number; closingDate?: string };
export type BcLine = { id?: string; fp?: string; supplier?: string; expenseType?: string; amountXof?: number; status?: string; bcNumber?: string; customer?: string; country?: string; description?: string; currency?: string; amount?: number; dateIn?: string | null; etaContrat?: string | null; etaReel?: string | null; updateDate?: string | null; comment?: string; source?: string };
export type ProjectSheet = { id?: string; fp?: string; client?: string; affaire?: string; costTotal?: number; saleTotal?: number; margin?: number; marginPct?: number };
export type Objective = {
  id?: string; label?: string; fiscalYear?: number; scope?: string; scopeValue?: string;
  targetCas?: number; targetInvoiced?: number; targetMargin?: number; targetMarginPct?: number;
};
export type UserRow = { id?: string; email?: string; name?: string; active?: boolean };

export type PeriodsConfig = { available?: string[]; currentFy?: number };
export type PermissionsConfig = { matrix?: Record<string, Record<string, string>> };
