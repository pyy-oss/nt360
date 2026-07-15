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
  fy?: number; next?: AtterrissageNext; realiseCas?: number;
  // Assiette opposable : signé/facturé non daté, exclu du réalisé (à dater pour fiabiliser le R/O).
  realiseCasUndated?: number; realiseCasUndatedCount?: number; factureNUndated?: number; factureNUndatedCount?: number;
  backlog?: number; backlogProjete?: number; reporteCaf?: number; pipelinePondere?: number;
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
// Funnel de conversion (Lot C) : dérivé de l'historique des transitions d'étape (oppHistory).
export interface OppFunnelSummary {
  transitions?: { from: number; to: number; count: number; amount: number }[];
  won?: number; lost?: number; advanced?: number; regressed?: number; winRate?: number; total?: number;
  truncated?: boolean; windowSize?: number; // fenêtre glissante si la borne de lecture est atteinte (A1)
}
export type PmRow = { pm: string; count: number; cas: number; raf: number };
export interface PmsSummary { count?: number; rows?: PmRow[] }
// Analytique délais/échéances ClickUp (summaries/clickupDelays) : retard de livraison par PM/statut
// + RAF échéancé par mois de date prév. de fin (synchro inverse ClickUp).
export type ClickupPmDelay = { pm: string; active: number; overdue: number; avgDaysLate: number };
export type ClickupStatusDist = { status: string; count: number; overdue: number };
export type ClickupMonthRaf = { month: string; raf: number; count: number };
export interface ClickupDelaysSummary { overdueTotal?: number; avgDaysLate?: number; byPm?: ClickupPmDelay[]; byStatus?: ClickupStatusDist[]; rafByMonth?: ClickupMonthRaf[] }
// Suivi BC ⇄ ClickUp (summaries/clickupBc) : couverture + retards d'avancement achat.
export interface ClickupBcSummary {
  totalBc?: number; linkedCount?: number; overdueCount?: number;
  byStatus?: Record<string, number>;
  overdue?: { bcNumber: string; supplier: string; status: string | null; eta: string | null }[];
  overdueRefs?: string[]; at?: any;
}
// Diagnostic qualité de l'intégration ClickUp (summaries/clickupHealth).
export interface ClickupHealthSummary {
  commandesTotal?: number; linked?: number; unlinked?: number; unlinkedMatchable?: number; synced?: number;
  tasksTotal?: number; tasksWithFp?: number; orphanTasks?: number; duplicateTasks?: number; duplicateFps?: number; cafGapCount?: number; cafGapTotal?: number; coverage?: number;
  unlinkedSample?: { fp?: string; client?: string; matchable?: boolean }[];
  orphanSample?: { id?: string; name?: string; fp?: string | null }[];
  duplicateSample?: { fp?: string; count?: number }[];
  listId?: string; at?: any;
  lastError?: string; lastErrorAt?: any; // raison persistée du dernier échec de vérification ClickUp (API-side)
}
export type TrendPoint = { date: string; casReel?: number; caf?: number; backlog?: number; pipeline?: number; projeteCas?: number; projeteCaf?: number; fy?: number };
export interface TrendsSummary { points?: TrendPoint[] }
export interface ReceivablesSummary {
  totalAR?: number; overdue?: number; overdueCount?: number; openCount?: number; dso?: number;
  buckets?: { notDue?: number; b0_30?: number; b31_60?: number; b61_90?: number; b90p?: number };
  topAR?: { key: string; value: number }[];
}
export type CashMonth = { month: string; ar: number; backlog: number; cumulAr: number; decaissement?: number; engaged?: number; net?: number; cumulNet?: number };
// Prévision cash avancée : scénarios best/base/worst + tension (position cumulée pire sous plancher).
export type ScenarioTriplet = { best: number; base: number; worst: number };
export type CashScenarioMonth = { month: string; enc: ScenarioTriplet; dec: ScenarioTriplet; net: ScenarioTriplet; cum: ScenarioTriplet };
export interface CashScenarioSummary {
  asOf?: string; horizon?: number; opening?: number; months?: CashScenarioMonth[];
  tension?: { floor?: number; firstMonth?: string | null; monthsCount?: number; trough?: { month?: string | null; value?: number } };
}
export interface CashflowSummary {
  asOf?: string; horizon?: number; months?: CashMonth[];
  overdue?: number; overdueCount?: number; beyond?: number;
  totalAR?: number; arHorizon?: number; totalRaf?: number; openCount?: number;
  totalDecaissement?: number; decaissementBeyond?: number; decaissementOverdue?: number; decaissementOverdueCount?: number; bcOpenCount?: number;
  decaissementEtaCompleteness?: number; decaissementNoEtaCount?: number;
  // Engagement (BC non facturés) : sortie potentielle, hors position nette de base (règle SOA).
  decaissementEngaged?: number; decaissementEngagedCount?: number; decaissementEngagedBeyond?: number;
}
export type EntityRow = { key: string; cas?: number; facture?: number; backlog?: number; mb?: number; pmb?: number; forecast?: number; projete?: number; isOther?: boolean };

export interface SuppliersSummary {
  totalExpo?: number; openTotal?: number; encoursTotal?: number; engagementTotal?: number; soldeTotal?: number;
  bySupplier?: SupplierRow[];
}
// SOA : `solde` = compte réel (ouverture + BC facturés non payés) ; `engagement` = BC non facturés
// + prévisionnel ; `disponible` = autorisé − solde − engagement. `encours` conservé (= solde) pour compat.
export type SupplierRow = {
  name: string; expo?: number; open?: number; engagement?: number; solde?: number; opening?: number;
  facture?: number; openingDate?: string | null; encours?: number; authorized?: number;
  disponible?: number; coverage?: number; util?: number; reco?: number; state?: string;
};

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
// Overlay d'annulation (statut « Annulée » persistant, hors delta) : ids exclus des agrégats,
// avec un libellé/nom non monétaire pour les afficher/rétablir. Écrit par le callable setCancellation.
export type CancellationEntry = { id: string; label?: string; client?: string; uid?: string; ts?: number };
export interface CancellationsDoc { items?: CancellationEntry[]; updatedAt?: any }

// Plan de relance & anticipation : trois familles d'actions datées par responsable (cloisonnées
// par module côté agrégat : créances→facturation, bc→fournisseurs, jalons→backlog).
export type RelanceResp = { key: string; count: number; total: number };
export type CreanceItem = { numero: string; fp?: string | null; client: string; am: string; amount: number; dueDate: string; daysLate: number; bucket: string };
export type BcRetardItem = { bcNumber: string; supplier: string; fp?: string | null; customer: string; amount: number; eta: string; daysLate: number; status: string; am: string };
export type JalonItem = { fp: string; client: string; am: string; dueDate: string; expected: number; invoiced: number; gap: number; daysLate: number };
export interface RelanceCreances { asOf?: string; count?: number; total?: number; items?: CreanceItem[]; byResp?: RelanceResp[] }
export interface RelanceBc { asOf?: string; count?: number; total?: number; items?: BcRetardItem[]; byResp?: RelanceResp[] }
export interface RelanceJalons { asOf?: string; count?: number; total?: number; items?: JalonItem[]; byResp?: RelanceResp[] }

export type Order = { id?: string; fp?: string; client?: string; bu?: string; am?: string; pm?: string | null; cas?: number; raf?: number; facture?: number; mb?: number; yearPo?: number; affaire?: string | null; costTotal?: number | null; marginPct?: number | null; source?: string | null; pnlSource?: string | null;
  casSource?: string | null; // 'override' = CAS surchargé depuis l'opportunité liée (syncOrderAmount)
  // Synchro inverse ClickUp (overlay config/clickupSync) : statut projet + dates (ISO yyyy-mm-dd).
  clickupStatus?: string | null; dateCommande?: string | null; dateContractuelle?: string | null; dateFinPrev?: string | null; clickupTaskId?: string | null;
  // Enrichissements ClickUp → app (Lot 4) : priorité, blocage, avancement checklists (%), temps passé (h).
  clickupPriority?: string | null; clickupBlocked?: boolean; clickupProgress?: number | null; clickupTimeSpentH?: number | null;
  // Dernière note ops remontée de ClickUp (webhook taskCommentPosted).
  clickupLastComment?: { by?: string | null; text?: string; at?: string | null } | null };
// Méta des commandes matérialisées. Les lignes sont désormais dans les chunks commandesRows/{i}
// (rows conservé optionnel pour lire un ancien agrégat pré-chunking en transition).
export interface CommandesSummary { count?: number; chunks?: number; rows?: Order[] }
export interface CommandeChunk { i?: number; rows?: Order[] }
export type Invoice = { id?: string; numero?: string; fp?: string; client?: string; bu?: string; date?: string; dueDate?: string | null; amountHt?: number; linked?: boolean; prePo?: boolean; paymentStatus?: string; paid?: boolean; lines?: number };
export type Opportunity = { id?: string; oppId?: string; fp?: string; client?: string; designation?: string; am?: string; bu?: string; amount?: number; stage?: number; stageLabel?: string; probability?: number; weighted?: number; closingDate?: string; source?: string; mbPrev?: number | null; dr?: boolean; nextStep?: string | null; nextStepDate?: string | null; lostReason?: string | null; stale?: boolean; ageDays?: number | null };
export type BcLine = { id?: string; fp?: string; supplier?: string; expenseType?: string; amountXof?: number; status?: string; bcNumber?: string; customer?: string; country?: string; description?: string; currency?: string; amount?: number; fxRate?: number | null; fxSource?: string; dateIn?: string | null; etaContrat?: string | null; etaReel?: string | null; updateDate?: string | null; comment?: string; source?: string };
export type ProjectSheet = { id?: string; fp?: string; client?: string; affaire?: string; costTotal?: number; saleTotal?: number; margin?: number; marginPct?: number };
export type Objective = {
  id?: string; label?: string; fiscalYear?: number; scope?: string; scopeValue?: string;
  targetCas?: number; targetInvoiced?: number; targetMargin?: number; targetMarginPct?: number;
};
export type UserRow = { id?: string; email?: string; name?: string; active?: boolean; role?: string; managerUid?: string | null; team?: string | null; createdAt?: any };

// Actualité : bulletins d'événements clés + recommandations (moteur functions/domain/news).
export type NewsBulletin = { id: string; domain: string; severity: "high" | "medium" | "info"; title: string; detail?: string; refs?: string[]; module?: string; segment?: string; action?: string };
export type NewsRecommendation = { priority: number; text: string; domain?: string; module?: string; severity?: string };
export interface NewsSummary { generatedFor?: number; bulletins?: NewsBulletin[]; recommendations?: NewsRecommendation[]; counts?: { high?: number; medium?: number; info?: number } }
// Curation LLM de la veille : score de pertinence par TYPE de bulletin (clé = id du bulletin).
export type NewsCurationScore = { relevance: number; keep: boolean; note?: string };
export interface NewsCuration { scoredAt?: any; model?: string; threshold?: number; signalCount?: number; activeIds?: string[]; scores?: Record<string, NewsCurationScore> }

export type PeriodsConfig = { available?: string[]; currentFy?: number; lastRecomputeAt?: any };
export interface ClientAliasConfig { pairs?: { from: string; to: string }[]; updatedAt?: any }
// Journal d'exploitation (recompute manuel/planifié + échecs).
export type OpsLog = { id?: string; kind?: string; action?: string; trigger?: string; status?: string; ms?: number; error?: string; detail?: { summaries?: number; currentFy?: number; count?: number }; ts?: any };
// Journal d'erreurs client (observabilité front) — écrit par le callable logClientError, lu en Admin.
export type ErrorLog = { id?: string; uid?: string; role?: string | null; message?: string; stack?: string | null; url?: string | null; module?: string | null; ua?: string | null; ts?: any };
export type PermissionsConfig = { matrix?: Record<string, Record<string, string>> };

// Contrats de maintenance (module mnt_, Lot 1). Montants number (FCFA entier), dates ISO AAAA-MM-JJ,
// statuts/couvertures en code applicatif. Engagements SLA EMBARQUÉS (ADR-012). Clé = N° FP (ADR-001).
export type MntEngagement = { type: string; couverture: string; seuilHeures: number; quota: number | null };
export type MntContrat = {
  id?: string; fp?: string; client?: string; bu?: string; am?: string;
  statut?: string; echeanceType?: string; dateDebut?: string; dateFin?: string | null;
  montantEngage?: number; deviseEngage?: string; engagements?: MntEngagement[];
  updatedAt?: any; createdAt?: any;
};
// Tickets & interventions de maintenance (mnt_, Lot 2). Temps d'intervention en heures ; alimente
// le CRA (timesheets) converti en jours. Rattachés au contrat (contratId) et à l'affaire (fp).
export type MntTicket = { id?: string; contratId?: string; fp?: string; client?: string; titre?: string; statut?: string; priorite?: string; ouvertLe?: any; priseEnCompteLe?: any; resoluLe?: any; updatedAt?: any };
export type MntIntervention = { id?: string; ticketId?: string; contratId?: string; fp?: string; consultantId?: string; date?: string; heures?: number; commentaire?: string; updatedAt?: any };
