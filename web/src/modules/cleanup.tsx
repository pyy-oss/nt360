// Console d'ASSAINISSEMENT (gouvernée « import ») : point unique pour nettoyer la base.
//  - Corriger À LA LIGNE : chaque anomalie ouvre l'écran cible pré-filtré (les éditeurs + la
//    suppression par ligne y vivent déjà — cf. remédiation guidée + assainissement lot 1).
//  - Purger EN LOT : le cas clairement « déchet » — les factures orphelines (rattachables à aucune
//    commande) — en une action, plus un raccourci vers le dédoublonnage (doublons).
// NON destructif par défaut : la purge demande confirmation et n'agit que sur des enregistrements
// non rattachables. Le delta reste prioritaire (une source ré-important le record le recrée).
import { useState, type FC, type ReactNode } from "react";
import { orderBy, limit } from "firebase/firestore";
import { useDocData, useCollectionData } from "../lib/hooks";
import { useCanImport, useClaims, useCan } from "../lib/rbac";
import { useNav } from "../lib/nav";
import { Card, Tip, Badge, Busy, DangerBtn, EmptyState, Table, colText, colNum, cx } from "../design/components";
import { pct } from "../design/tokens";
import { deleteRecords, callDedupe, type DedupeResult } from "../lib/writes";
import { Props, relTime } from "./_shared";
import type { DataQualitySummary, QualityHistory, AuditLog, Invoice, BcLine, Opportunity } from "../types";

// Sparkline SVG minimaliste (aucune dépendance chart dans ce chunk admin). points ∈ [0,1].
function Spark({ points }: { points: number[] }) {
  if (points.length < 2) return null;
  const w = 160, h = 32, n = points.length;
  const d = points.map((v, i) => `${(i / (n - 1)) * w},${h - Math.max(0, Math.min(1, v)) * h}`).join(" ");
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="text-gold" aria-hidden="true">
      <polyline points={d} fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

const ACTION_LABEL: Record<string, string> = {
  delete_records: "Suppression", patch_order: "Commande corrigée", patch_opp: "Opp. corrigée",
  patch_invoice: "Facture corrigée", patch_fiche: "Fiche corrigée", bc_patch: "BC corrigé",
  create_order: "Commande créée", set_invoice_fp: "Facture rattachée", client_aliases: "Alias clients",
  upsert_opp: "Opp. saisie", add_bc: "BC ajouté", bc_status: "Statut BC",
  cancel_record: "Annulation", restore_record: "Rétablissement",
};
const CLEANUP_ACTIONS = new Set(Object.keys(ACTION_LABEL));

// Journal des corrections/suppressions (auditLog) — lecture réservée aux habilitations (direction).
function CleanupJournal() {
  const { rows } = useCollectionData<AuditLog>("auditLog", [orderBy("ts", "desc"), limit(50)], "audit50");
  const acts = rows.filter((r) => r.action && CLEANUP_ACTIONS.has(r.action)).slice(0, 25);
  return (
    <Card title="Journal des actions d'assainissement">
      {acts.length ? (
        <Table columns={[
          colText("Quand", (e: AuditLog) => <span className="text-faint tabnum">{relTime(e.ts) || "—"}</span>, (e: AuditLog) => (e.ts?.seconds ?? 0)),
          colText("Action", (e: AuditLog) => ACTION_LABEL[e.action || ""] || e.action || "—"),
          colText("Objet", (e: AuditLog) => e.entity || "—"),
          colText("Réf.", (e: AuditLog) => <span className="text-faint">{e.entityId || "—"}</span>),
          colText("Détail", (e: AuditLog) => <span className="text-faint">{e.detail?.count ? `${e.detail.count} suppr.` : e.detail?.collection || e.detail?.fp || ""}</span>),
        ]} rows={acts} />
      ) : <div className="text-[13px] text-muted">Aucune action d'assainissement récente.</div>}
      <Tip>Traçabilité des corrections & suppressions (auditées). Chaque action déclenche un recalcul ; le score de complétude ci-dessus reflète l'état après nettoyage.</Tip>
    </Card>
  );
}

// Ligne de purge en lot : libellé + compteur + bouton (confirmation) qui supprime le lot d'ids.
function PurgeRow({ label, hint, ids, collection, confirm, okMsg }: { label: string; hint?: ReactNode; ids: string[]; collection: string; confirm: string; okMsg: string }) {
  return (
    <div className="flex items-center gap-3 flex-wrap text-[13px]">
      <span className="text-ink font-medium">{label}</span>
      <Badge tone={ids.length ? "clay" : "emerald"}>{ids.length}</Badge>
      {hint && <span className="text-muted">{hint}</span>}
      {ids.length > 0 && <DangerBtn label={`Purger ${ids.length}`} okMsg={okMsg} confirm={confirm} fn={() => deleteRecords(collection, ids)} />}
    </div>
  );
}

const DEDUPE_LABEL: Record<string, string> = { invoices: "Factures", opportunities: "Opportunités", bcLines: "BC fournisseurs" };

// Dédoublonnage intégré : analyse d'abord (aperçu), puis suppression (le meilleur représentant de
// chaque groupe est conservé). Réservé à la direction (le callable dedupe est direction-only).
function DedupeCard() {
  const [res, setRes] = useState<DedupeResult | null>(null);
  const totalDup = res ? Object.values(res.result).reduce((s, r) => s + r.duplicates, 0) : 0;
  return (
    <Card title="Doublons (factures / opportunités / BC)" actions={
      <div className="flex gap-2">
        <Busy variant="ghost" label="Analyser" okMsg="Analyse terminée" errMsg="Analyse refusée" fn={async () => { setRes(await callDedupe(undefined, false)); }} />
        {res && totalDup > 0 && (
          <Busy label={`Supprimer ${totalDup} doublon${totalDup > 1 ? "s" : ""}`} okMsg="Doublons supprimés" errMsg="Suppression refusée" fn={async () => { setRes(await callDedupe(undefined, true)); }} />
        )}
      </div>
    }>
      {res ? (
        <div className="flex flex-col gap-2">
          <Table columns={[
            colText("Collection", (r: any) => DEDUPE_LABEL[r.col] || r.col),
            colNum("Total", (r: any) => r.total.toLocaleString("fr-FR")),
            colNum("Groupes en doublon", (r: any) => r.duplicateGroups),
            colNum("À supprimer", (r: any) => r.duplicates),
          ]} rows={Object.entries(res.result).map(([col, s]) => ({ col, ...s }))} />
          <Tip>{res.applied
            ? "Doublons supprimés — le meilleur enregistrement de chaque groupe (source figée, plus récent) est conservé ; agrégats recalculés."
            : totalDup > 0 ? `${totalDup.toLocaleString("fr-FR")} doublon(s) détecté(s) — cliquez « Supprimer » pour nettoyer.` : "Aucun doublon détecté."}</Tip>
        </div>
      ) : (
        <Tip>Analyse les factures, opportunités et BC fournisseurs (même clé métier ⇒ doublon), puis supprime les redondances en conservant le meilleur enregistrement de chaque groupe.</Tip>
      )}
    </Card>
  );
}

// Anomalie → écran de correction (miroir du cockpit Qualité). Le drill-through transporte la 1re
// référence en recherche pour arriver directement sur la ligne (éditeur + suppression sur place).
const FIX = (type: string): { module: string; segment?: string } | null => {
  if (type === "factures_orphelines") return { module: "invoicelist", segment: "orphan" };
  if (type.startsWith("factures")) return { module: "invoicelist" };
  if (type.startsWith("commandes") || type === "am_invalide" || type === "surfacturation" || type.startsWith("clickup")) return { module: "orderlist" };
  if (type.startsWith("opps")) return { module: "opplist" };
  if (type.startsWith("bc_")) return { module: "bc" };
  if (type.startsWith("fiches")) return { module: "pnlprojet" };
  return null;
};

export const Cleanup: FC<Props> = () => {
  const { data } = useDocData<DataQualitySummary>("summaries/dataQuality");
  const { data: qh } = useDocData<QualityHistory>("summaries/qualityHistory");
  const canImport = useCanImport();
  const canBc = useCan("bc") !== "none";
  const canPipe = useCan("pipeline") !== "none";
  const isDirection = useClaims().role === "direction"; // le dédoublonnage (callable) est direction-only
  const { go, canGo } = useNav();
  // Collections chargées seulement si le rôle a l'accès (chaque purge est gouvernée par son module).
  const { rows: invoices } = useCollectionData<Invoice>(canImport ? "invoices" : null);
  const { rows: bcLines } = useCollectionData<BcLine>(canBc ? "bcLines" : null);
  const { rows: opps } = useCollectionData<Opportunity>(canPipe ? "opportunities" : null);

  const orphanIds = invoices.filter((r) => r.linked !== true && r.id).map((r) => r.id!) as string[];
  const orphanAmt = invoices.filter((r) => r.linked !== true).reduce((s, r) => s + (r.amountHt || 0), 0);
  // BC NON RÉPARABLES : ni FP, ni fournisseur, ni N° BC, ni montant XOF → ligne vide/fantôme.
  const junkBcIds = bcLines.filter((b) => b.id && !b.fp && !b.supplier && !b.bcNumber && !((b.amountXof || 0) > 0)).map((b) => b.id!) as string[];
  // Opportunités PERDUES (7) / ANNULÉES (9) : mortes. Purge OPTIONNELLE (retire de l'historique).
  const deadOppIds = opps.filter((o) => (o.stage === 7 || o.stage === 9) && o.id).map((o) => o.id!) as string[];
  const issues = data?.issues || [];
  const tone: Record<string, string> = { high: "clay", medium: "gold", low: "steel" };
  const days = (qh?.days || []).slice(-30);
  const score = data?.score;
  const totalAnomalies = (data?.issues || []).reduce((s, i) => s + i.count, 0);
  const first = days[0], last = days[days.length - 1];
  return (
    <div className="flex flex-col gap-4">
      <Card title="Rapport d'assainissement">
        <div className="flex flex-wrap items-center gap-x-8 gap-y-3">
          <div>
            <div className="text-[11px] text-muted">Score de complétude</div>
            <div className={cx("font-display tabnum text-2xl leading-tight", (score ?? 1) >= 0.9 ? "text-emerald" : (score ?? 1) >= 0.7 ? "text-gold" : "text-clay")}>{score != null ? pct(score) : "—"}</div>
          </div>
          <div>
            <div className="text-[11px] text-muted">Anomalies</div>
            <div className="font-display tabnum text-2xl leading-tight">{totalAnomalies.toLocaleString("fr-FR")} <span className="text-[13px] text-faint">/ {(data?.issues || []).length} types</span></div>
          </div>
          {days.length >= 2 && (
            <div>
              <div className="text-[11px] text-muted mb-1">Tendance du score (30 j) · {first && last ? `${pct(first.score)} → ${pct(last.score)}` : ""}</div>
              <Spark points={days.map((d) => d.score)} />
            </div>
          )}
        </div>
        <Tip>Le score progresse à mesure que vous corrigez/supprimez : un point est enregistré chaque jour (recompute). Les <b>anomalies par type</b> et le <b>drill-through</b> pour les traiter sont plus bas ; le <b>journal</b> des actions apparaît en fin de page.</Tip>
      </Card>

      <Card title="Purge en lot">
        <div className="flex flex-col gap-2.5">
          <PurgeRow label="Factures orphelines" collection="invoices" ids={orphanIds}
            hint={orphanAmt > 0 ? `${(orphanAmt / 1e9).toFixed(2)} Md non rattachés` : undefined}
            okMsg="Factures orphelines purgées (recalcul lancé)"
            confirm={`Supprimer définitivement ${orphanIds.length} facture(s) non rattachée(s) à une commande ? À ne faire que si elles ne doivent pas exister. Un futur import delta les recréera si la source les contient encore.`} />
          {canBc && (
            <PurgeRow label="BC non réparables" collection="bcLines" ids={junkBcIds}
              hint="ni FP, ni fournisseur, ni N° BC, ni montant"
              okMsg="BC vides purgés (recalcul lancé)"
              confirm={`Supprimer définitivement ${junkBcIds.length} ligne(s) BC vide(s) (aucun FP, fournisseur, N° BC ni montant) ? Ce sont des lignes fantômes non fiabilisables.`} />
          )}
          {canPipe && (
            <PurgeRow label="Opportunités perdues / annulées" collection="opportunities" ids={deadOppIds}
              hint="étapes 7-Perdu / 9-Annulé"
              okMsg="Opportunités mortes purgées (recalcul lancé)"
              confirm={`Supprimer définitivement ${deadOppIds.length} opportunité(s) perdue(s)/annulée(s) ? ATTENTION : elles disparaissent de l'historique (elles ne comptent plus dans les taux de conversion). Un futur import delta les recréera si la source les contient encore.`} />
          )}
          <Tip>Purges de MASSE des enregistrements clairement « déchet » (non rattachables / vides / morts). Chacune demande confirmation, ne touche que le lot indiqué, est auditée et gouvernée par les droits. Pour une facture <b>valide</b> non rattachée, préférez la <b>rattacher</b> (Factures → Rattacher) plutôt que la purger. Le delta reste prioritaire : une source ré-important un record le recrée.</Tip>
        </div>
      </Card>

      {isDirection && <DedupeCard />}

      <Card title={`Anomalies à corriger · ${issues.length}`}>
        {issues.length ? (
          <div className="flex flex-col gap-2">
            {issues.map((it, i) => {
              const fix = FIX(it.type);
              const actionable = !!fix && canGo(fix.module);
              return (
                <div key={i} className="flex items-start gap-2 text-[13px]">
                  <Badge tone={(tone[it.severity] || "neutral") as any}>{it.count}</Badge>
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    {actionable
                      ? <button onClick={() => go(fix!.module, { ...(fix!.segment ? { segment: fix!.segment } : {}), search: it.refs?.[0] })} className={cx("text-ink hover:text-gold underline decoration-dotted underline-offset-2 text-left")} title="Ouvrir l'écran pré-filtré pour corriger ou supprimer cette ligne">{it.label}</button>
                      : <span>{it.label}</span>}
                    {(it.refs || []).slice(0, 6).map((r, j) => (
                      <span key={j} className="rounded bg-panel2 text-faint px-1.5 py-0.5 text-[11px]">{r}</span>
                    ))}
                    {(it.refs || []).length > 6 && <span className="text-[11px] text-faint">+{(it.refs || []).length - 6}</span>}
                  </div>
                </div>
              );
            })}
          </div>
        ) : <EmptyState label="Aucune anomalie — base saine." />}
        <Tip>Cliquez une anomalie pour ouvrir l'écran <b>pré-filtré sur la ligne</b> : vous pouvez y <b>corriger</b> (champ manquant/erroné) ou <b>supprimer</b> l'enregistrement. Les corrections & suppressions relancent le recalcul ; les anomalies se résorbent en direct.</Tip>
      </Card>

      {isDirection && <CleanupJournal />}
    </div>
  );
};
