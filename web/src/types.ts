// Types de données Firestore (summaries/* et collections) — frontière typée du front.
// Volontairement permissifs (champs optionnels) : les agrégats évoluent côté back-end.

export type Ratios = { tauxFacturation?: number; tauxConversionVente?: number; pmb?: number };

export type TierBucket = { key: string; label: string; band: string; weight: number; active: boolean; brut: number; pond: number; count: number };
export interface OverviewSummary {
  period?: string;
  certitudes?: number; pondCertain?: number; pipelineProjete?: number; tierBreakdown?: TierBucket[]; commandes?: number;
  facture?: number; rafPeriode?: number; backlog?: number; backlogCount?: number;
  mb?: number; pipelineWon?: number; perdu?: number; ratios?: Ratios;
}

export type BillingMilestonesDoc = { fp?: string; milestones?: { date: string; amount: number }[]; updatedAt?: unknown };
export type BillingTrendMonth = { month: string; realise: number; planifie: number; retenu: number; cumulRealise: number; cumulTrajectoire: number };
export interface BillingTrendSummary {
  fy?: number; months?: BillingTrendMonth[]; realiseYtd?: number; planifieRestant?: number; projeteDec?: number;
}
export type AtterrissageNext = {
  fy?: number; realiseCas?: number; factureN?: number; reporteEntrant?: number; pipelinePondere?: number;
  projete?: number; cafProjete?: number; objectif?: number; ecart?: number; objectifCaf?: number; ecartCaf?: number;
};
export interface AtterrissageSummary {
  fy?: number; next?: AtterrissageNext; realiseCas?: number; backlog?: number; backlogProjete?: number; reporteCaf?: number; pipelinePondere?: number;
  pipelineRetard?: number; pipelineRetardCount?: number;
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
  // Ancienneté du retard (jours depuis la D Prev dépassée) : ≤30 j / 31-90 j / >90 j + moyenne.
  overdueAge?: { d30?: ClosingBucket; d90?: ClosingBucket; dPlus?: ClosingBucket };
  avgOverdueDays?: number;
}
export interface PipelineSummary {
  tot?: { brut?: number; weighted?: number; count?: number; countConf?: number };
  susp?: { brut?: number; count?: number };
  tierBreakdown?: TierBucket[];
  conv?: number; wonCount?: number; lostCount?: number;
  byStage?: Record<number, StageBucket>; byAM?: Record<string, number>; byMonth?: Record<string, number>;
  byAmConv?: { am: string; won: number; lost: number; conv: number; activeCount: number; weighted: number }[];
  topOpps?: Opportunity[];
  closing?: ClosingAnalysis | null;
}

export interface BacklogSummary {
  fy?: number; total?: number; count?: number;
  byVintage?: Record<string, number>; byBu?: Record<string, number>;
  top?: { fp?: string; client?: string; affaire?: string; bu?: string; raf?: number }[];
  // Diagnostic de fiabilité : RAF curaté Excel vs RAF dérivé (CAS − facturé, surévalué).
  totalExcel?: number; totalDerive?: number; countExcel?: number; countDerive?: number;
  deriveTop?: { fp?: string; client?: string; affaire?: string; bu?: string; source?: string | null; yearPo?: number; cas?: number; facture?: number; raf?: number }[];
}

export interface FacturationSummary {
  period?: string; total?: number; count?: number;
  monthly?: Record<string, number>; byBu?: Record<string, number>;
  topClients?: { key: string; value: number }[];
}

// Une perspective de rentabilité (assiette générique `base` = CAS ou Facturé).
export interface RentabPerspective {
  base: number; mb: number; pmb: number;
  byBu: { bu: string; base: number; mb: number; pmb: number }[];
  byAm: { am: string; base: number; mb: number; pmb: number }[];
  bottomAffaires: { fp?: string; client?: string; am?: string; base: number; mb: number; pmb: number }[];
  topClients: { key: string; value: number }[];
}
export interface RentabiliteSummary {
  // Champs racine = perspective Commande (rétro-compat).
  period?: string; mb?: number; cas?: number; pmb?: number;
  byBu?: { bu: string; cas: number; mb: number }[]; topClients?: { key: string; value: number }[];
  byAm?: { am: string; cas: number; mb: number; pmb: number }[];
  bottomAffaires?: { fp?: string; client?: string; am?: string; cas: number; mb: number; pmb: number }[];
  // Deux perspectives : Commande (CAS) et Facturé (CAF).
  perspectives?: { commande: RentabPerspective; facture: RentabPerspective };
}

export interface EntitySummary { period?: string; rows?: EntityRow[] }
export type AmRow = {
  am: string; cas: number; casFy: number; backlog: number; facture: number;
  pipelinePondere: number; activeCount: number; won: number; lost: number;
  conv: number; targetCas: number; roCas: number | null; orderCount: number;
};
export interface AmsSummary { fy?: number | null; rows?: AmRow[] }
export type TrendPoint = { date: string; casReel?: number; caf?: number; backlog?: number; pipeline?: number; projeteCas?: number; projeteCaf?: number; ar?: number; dso?: number; fy?: number };
export interface TrendsSummary { points?: TrendPoint[] }
export interface ReceivablesSummary {
  totalAR?: number; overdue?: number; overdueCount?: number; openCount?: number; dso?: number;
  buckets?: { notDue?: number; b0_30?: number; b31_60?: number; b61_90?: number; b90p?: number };
  topAR?: { key: string; value: number }[];
}
export type CashMonth = { month: string; ar: number; backlog: number; cumulAr: number; decaissement?: number; net?: number; cumulNet?: number };
export interface CashflowSummary {
  asOf?: string; horizon?: number; months?: CashMonth[];
  overdue?: number; overdueCount?: number; beyond?: number;
  totalAR?: number; arHorizon?: number; totalRaf?: number; openCount?: number;
  totalDecaissement?: number; decaissementBeyond?: number; decaissementOverdue?: number; decaissementOverdueCount?: number; bcOpenCount?: number;
  decaissementEtaCompleteness?: number; decaissementNoEtaCount?: number;
}
export type EntityRow = { key: string; cas?: number; facture?: number; backlog?: number; mb?: number; pmb?: number };

export interface SuppliersSummary {
  totalExpo?: number; openTotal?: number; encoursTotal?: number;
  bySupplier?: SupplierRow[];
}
export type SupplierRow = { name: string; expo?: number; open?: number; encours?: number; authorized?: number; coverage?: number; util?: number; reco?: number; state?: string };

export type AlertItem = { type: string; severity: "high" | "medium" | "low"; count: number; message: string; refs?: string[] };
export interface AlertsSummary { items?: AlertItem[]; fy?: number }
export type QualityIssue = { type: string; severity: "high" | "medium" | "low"; count: number; label: string; refs?: string[] };
export interface DataQualitySummary {
  issues?: QualityIssue[]; score?: number;
  counts?: { orders?: number; invoices?: number; opportunities?: number; bcLines?: number; projectSheets?: number };
}
export type QualityPoint = { date: string; score: number; anomalies: number; types: number };
export interface QualityHistory { days?: QualityPoint[] }
export type AuditLog = { id?: string; uid?: string; action?: string; module?: string; entity?: string; entityId?: string; detail?: any; ts?: { seconds?: number } };

export type Order = { id?: string; fp?: string; client?: string; bu?: string; am?: string; cas?: number; raf?: number; facture?: number; mb?: number; yearPo?: number; affaire?: string | null; costTotal?: number | null; marginPct?: number | null; source?: string | null; pnlSource?: string | null };
// Méta des commandes matérialisées. Les lignes sont désormais dans les chunks commandesRows/{i}
// (rows conservé optionnel pour lire un ancien agrégat pré-chunking en transition).
export interface CommandesSummary { count?: number; chunks?: number; rows?: Order[] }
export interface CommandeChunk { i?: number; rows?: Order[] }
export type Invoice = { id?: string; numero?: string; fp?: string; client?: string; bu?: string; date?: string; dueDate?: string | null; amountHt?: number; linked?: boolean; prePo?: boolean; paymentStatus?: string; paid?: boolean; lines?: number };
export type Opportunity = { id?: string; oppId?: string; fp?: string; client?: string; designation?: string; am?: string; bu?: string; amount?: number; stage?: number; stageLabel?: string; probability?: number; weighted?: number; closingDate?: string; source?: string };
export type BcLine = { id?: string; fp?: string; supplier?: string; expenseType?: string; amountXof?: number; status?: string; bcNumber?: string; customer?: string; country?: string; description?: string; currency?: string; amount?: number; dateIn?: string | null; etaContrat?: string | null; etaReel?: string | null; updateDate?: string | null; comment?: string; source?: string };
export type ProjectSheet = { id?: string; fp?: string; client?: string; affaire?: string; costTotal?: number; saleTotal?: number; margin?: number; marginPct?: number };
export type Objective = {
  id?: string; label?: string; fiscalYear?: number; scope?: string; scopeValue?: string;
  targetCas?: number; targetInvoiced?: number; targetMargin?: number; targetMarginPct?: number;
};
export type UserRow = { id?: string; email?: string; name?: string; active?: boolean; role?: string; createdAt?: any };

// Actualité : bulletins d'événements clés + recommandations (moteur functions/domain/news).
export type NewsBulletin = { id: string; domain: string; severity: "high" | "medium" | "info"; title: string; detail?: string; refs?: string[]; module?: string; segment?: string; action?: string };
export type NewsRecommendation = { priority: number; text: string; domain?: string; module?: string; severity?: string };
export interface NewsSummary { generatedFor?: number; bulletins?: NewsBulletin[]; recommendations?: NewsRecommendation[]; counts?: { high?: number; medium?: number; info?: number } }

export type PeriodsConfig = { available?: string[]; currentFy?: number; lastRecomputeAt?: any };
export interface ClientAliasConfig { pairs?: { from: string; to: string }[]; updatedAt?: any }
// Journal d'exploitation (recompute manuel/planifié + échecs).
export type OpsLog = { id?: string; kind?: string; action?: string; trigger?: string; status?: string; ms?: number; error?: string; detail?: { summaries?: number; currentFy?: number; count?: number }; ts?: any };
// Journal d'erreurs client (observabilité front) — écrit par le callable logClientError, lu en Admin.
export type ErrorLog = { id?: string; uid?: string; role?: string | null; message?: string; stack?: string | null; url?: string | null; module?: string | null; ua?: string | null; ts?: any };
export type PermissionsConfig = { matrix?: Record<string, Record<string, string>> };
