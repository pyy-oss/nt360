// Console d'ASSAINISSEMENT (gouvernée « import ») : point unique pour nettoyer la base.
//  - Corriger À LA LIGNE : chaque anomalie ouvre l'écran cible pré-filtré (les éditeurs + la
//    suppression par ligne y vivent déjà — cf. remédiation guidée + assainissement lot 1).
//  - Purger EN LOT : le cas clairement « déchet » — les factures orphelines (rattachables à aucune
//    commande) — en une action, plus un raccourci vers le dédoublonnage (doublons).
// NON destructif par défaut : la purge demande confirmation et n'agit que sur des enregistrements
// non rattachables. Le delta reste prioritaire (une source ré-important le record le recrée).
import { useState, type FC, type ReactNode } from "react";
import { orderBy, limit } from "firebase/firestore";
import { useDocData, useCollectionData, useReloadOnWrite } from "../lib/hooks";
import { useCanImport, useClaims, useCan } from "../lib/rbac";
import { useNav } from "../lib/nav";
import { useRecordScope } from "../lib/scope";
import { Card, Tip, Badge, Busy, DangerBtn, Table, colText, colNum, cx, money, useToast } from "../design/components";
import { DateField } from "../design/inputs";
import { T, pct } from "../design/tokens";
import {
  deleteRecords, callDedupe, setFpAlias, reconClient, correctionQueue,
  setInvoiceFp, patchInvoice, patchOrder, patchOpportunity, patchBcLine, patchProjectSheet, createOrder, generateFromInvoices,
  aiSuggestCorrections,
  type DedupeResult, type ReconListItem, type ReconDossier, type ReconCluster, type CorrectionBucket, type CorrectionItem, type CorrectionRec, type RemediationPlan, type AiSuggestion,
} from "../lib/writes";

// Un N° FP est GÉNÉRABLE (commande/opp) s'il est canonique (FP/AAAA/N) — sinon « N° FP inconnu » relève
// d'abord d'une correction du N° FP. Aligné sur fpKey côté serveur (validation finale par le callable).
const looksCanonicalFp = (fp?: string) => /FP\/?\s*\d{4}(?!\d)\/?\s*\d+/i.test(String(fp || ""));
import { Props, relTime } from "./_shared";
import type { DataQualitySummary, QualityHistory, AuditLog, BcLine, Opportunity } from "../types";

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
  set_fp_alias: "Réconciliation FP",
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
        {res && !res.applied && totalDup > 0 && (
          // Suppression IRRÉVERSIBLE (cf. audit intégral F1) : confirmation via DangerBtn, masquée une
          // fois appliquée (!res.applied) pour éviter un second clic à vide (F2).
          <DangerBtn label={`Supprimer ${totalDup} doublon${totalDup > 1 ? "s" : ""}`} okMsg="Doublons supprimés" errMsg="Suppression refusée"
            confirm={`Supprimer définitivement ${totalDup.toLocaleString("fr-FR")} doublon(s) ? Le meilleur enregistrement de chaque groupe (source figée, plus récent) est conservé.`}
            fn={async () => { setRes(await callDedupe(undefined, true)); }} />
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
            colText("", (r: any) => r.capped ? <Badge tone="clay">volume &gt; plafond — ignoré</Badge> : ""),
          ]} rows={Object.entries(res.result).map(([col, s]) => ({ col, ...s }))} />
          {/* APERÇU avant suppression (op destructive) : pour chaque groupe, l'enregistrement CONSERVÉ et
              ceux ÉCARTÉS — l'admin voit exactement ce qui disparaît avant de confirmer. */}
          {!res.applied && Object.entries(res.result).some(([, s]) => (s.sample || []).length > 0) && (
            <div className="border-t border-hair pt-2">
              <div className="text-[11px] text-muted uppercase tracking-wide mb-1">Aperçu — enregistrement conservé ✓ / écartés ✗ (échantillon)</div>
              <div className="flex flex-col gap-1 max-h-56 overflow-auto">
                {Object.entries(res.result).flatMap(([col, s]) => (s.sample || []).map((g, i) => (
                  <div key={`${col}-${i}`} className="text-[12px] flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <span className="text-faint">{DEDUPE_LABEL[col] || col}</span>
                    <span className="text-emerald tabnum">✓ {g.keep.ref}{g.keep.source ? ` · ${g.keep.source}` : ""}</span>
                    {g.remove.map((d) => <span key={d.id} className="text-clay tabnum">✗ {d.ref}{d.source ? ` · ${d.source}` : ""}</span>)}
                  </div>
                )))}
              </div>
            </div>
          )}
          <Tip>{res.applied
            ? "Doublons supprimés — le meilleur enregistrement de chaque groupe (source figée, plus récent, plus complet) est conservé ; agrégats recalculés."
            : totalDup > 0 ? `${totalDup.toLocaleString("fr-FR")} doublon(s) détecté(s) — vérifiez l'aperçu (✓ conservé / ✗ écartés) puis cliquez « Supprimer ». Clé : N° FP canonique (opps/BC), numéro (factures).` : "Aucun doublon détecté."}</Tip>
        </div>
      ) : (
        <Tip>Analyse les factures, opportunités et BC fournisseurs (même clé métier ⇒ doublon), puis supprime les redondances en conservant le meilleur enregistrement de chaque groupe.</Tip>
      )}
    </Card>
  );
}

// CENTRE DE CORRECTION — point unique pour corriger, anomalie par anomalie, TOUS les enregistrements
// concernés (pas seulement rebondir vers un écran). Le callable correctionQueue (lecture, gouverné
// « import ») réutilise les prédicats de dataQuality.js ; chaque type route vers l'éditeur inline
// idoine, qui appelle le callable de correction gouverné par le MODULE de la donnée (setInvoiceFp,
// patchOrder, patchOpportunity, patchBcLine, patchProjectSheet, createOrder). Après correction on
// rescanne (l'anomalie se résorbe en direct).
const CORR_SEV: Record<string, "clay" | "gold" | "steel"> = { high: "clay", medium: "gold", low: "steel" };
// Cartographie type d'anomalie → mode de correction + droit requis (module de la donnée).
const FIX: Record<string, { kind: string; cap?: "import" | "pipeline" | "bc" | "rentabilite"; module?: string }> = {
  factures_orphelines: { kind: "fp-invoice", cap: "import" },
  factures_sans_date: { kind: "date-invoice", cap: "import" },
  factures_sans_echeance: { kind: "date-invoice-due", cap: "import" },
  surfacturation: { kind: "nav", module: "invoicelist" },
  // N° FP illisible : la correction (fixer le N° FP) se fait à la source, sur l'écran Commandes pré-filtré.
  commandes_fp_illisible: { kind: "nav", module: "orderlist" },
  commandes_sans_annee: { kind: "num-order-year", cap: "import" },
  commandes_sans_client: { kind: "text-order-client", cap: "import" },
  commandes_sans_am: { kind: "text-order-am", cap: "import" },
  am_invalide: { kind: "text-order-am", cap: "import" },
  opps_sans_dprev: { kind: "date-opp", cap: "pipeline" },
  opps_sans_montant: { kind: "num-opp-amount", cap: "pipeline" },
  opps_gagnees_sans_fp: { kind: "fp-opp", cap: "pipeline" },
  opps_gagnees_sans_pnl: { kind: "reconcile-pnl", cap: "import" },
  opps_fantomes: { kind: "nav", module: "opplist" },
  opps_agees: { kind: "nav", module: "opplist" },
  // Cohérence AMONT (opportunité ↔ commande) — non corrigeable en une valeur : drill vers l'écran concerné
  // (revoir le CAS retenu sur Commandes / requalifier l'opp sur Pipeline).
  ecart_valorisation: { kind: "nav", module: "orderlist" },
  opp_active_carnet: { kind: "nav", module: "opplist" },
  bc_sans_fp: { kind: "fp-bc", cap: "bc" },
  bc_sans_fournisseur: { kind: "text-bc-supplier", cap: "bc" },
  bc_montant_zero: { kind: "amount-bc", cap: "bc" },
  fiches_sans_vente: { kind: "num-sheet-sale", cap: "rentabilite" },
  opps_doublons: { kind: "dedupe" },
  bc_doublons: { kind: "dedupe" },
  // Incohérences ClickUp ↔ app (rapatriées ici — source unique). Non corrigeables en une valeur : drill vers
  // l'écran commandes pré-filtré (rattacher la facture / solder le RAF selon le cas).
  clickup_facture_sans_caf: { kind: "nav", module: "orderlist" },
  clickup_cloture_avec_raf: { kind: "nav", module: "orderlist" },
};

// Éditeur générique une valeur → un bouton (texte / nombre).
// `initial` = valeur RECOMMANDÉE pré-remplie (l'IA propose, l'humain vérifie puis enregistre) — jamais
// d'écriture automatique d'un montant (respecte « n'invente aucune donnée »). L'utilisateur peut modifier.
function FieldFix({ label, placeholder, kind = "text", save, initial }: { label: string; placeholder?: string; kind?: "text" | "number"; save: (v: string) => Promise<void>; initial?: string }) {
  const [v, setV] = useState(initial ?? "");
  return (
    <span className="inline-flex items-center gap-1">
      <input className="field w-32 !py-1 text-xs" inputMode={kind === "number" ? "decimal" : undefined} aria-label={label} placeholder={placeholder} value={v} onChange={(e) => setV(e.target.value)} />
      <Busy variant="ghost" label="OK" okMsg="Corrigé (recalcul lancé)" errMsg="Correction refusée" fn={() => save(v)} />
    </span>
  );
}
// Ligne de RECOMMANDATION concrète sous un item (💡) : valeur chiffrée + base de calcul. Pour les champs
// pré-remplissables, c'est juste la justification ; pour les cas non éditables ici (écart valo, surfacturation),
// c'est la recommandation elle-même. Rendu neutre, tokens existants.
function RecNote({ rec }: { rec: CorrectionRec }) {
  return (
    <div className="text-[11px] text-muted mt-0.5 pl-1">
      💡 <span className="text-ink">Recommandation</span>
      {rec.value != null && <> : <b className="tabnum">{rec.value.toLocaleString("fr-FR")}</b></>}
      <span className="text-faint"> — {rec.basis}</span>
    </div>
  );
}
function DateFix({ save }: { save: (v: string) => Promise<void> }) {
  const [v, setV] = useState("");
  return (
    <span className="inline-flex items-center gap-1">
      <DateField value={v} onChange={setV} ariaLabel="Date" className="!py-1 text-xs w-40" />
      <Busy variant="ghost" label="OK" okMsg="Date corrigée (recalcul lancé)" errMsg="Correction refusée" fn={() => { if (!v) throw new Error("date requise"); return save(v); }} />
    </span>
  );
}
const parseAmt = (s: string) => Number(String(s).replace(/\s/g, "").replace(",", "."));
// Conversion devise guidée (BC XOF nul) : taux pré-rempli depuis fxRates, aperçu live, un clic.
function BcConvertFix({ item, onDone }: { item: CorrectionItem; onDone: () => Promise<void> }) {
  const { data: fx } = useDocData<{ rates?: Record<string, number> }>("config/fxRates");
  const [rate, setRate] = useState("");
  const cur = (item.currency || "XOF").toUpperCase();
  const foreign = cur !== "XOF" && (item.amount || 0) > 0;
  if (!foreign) {
    return <FieldFix label="Montant XOF" kind="number" placeholder="XOF" save={async (v) => { const n = Number(String(v).replace(/[^\d]/g, "")); if (!(n > 0)) throw new Error("XOF > 0"); await patchBcLine({ id: item.id!, amountXof: n }); await onDone(); }} />;
  }
  const cfg = Number(fx?.rates?.[cur] || 0);
  const r = rate.trim() !== "" ? (Number(rate.replace(",", ".")) || 0) : cfg;
  const preview = r > 0 ? Math.round((item.amount || 0) * r) : 0;
  return (
    <span className="inline-flex items-center gap-1 flex-wrap text-xs">
      <span className="text-faint">{(item.amount || 0).toLocaleString("fr-FR")} {cur} ×</span>
      <input className="field w-16 !py-1 text-xs text-right" inputMode="decimal" aria-label={`Taux ${cur} → XOF`} placeholder={cfg ? String(cfg) : "taux"} value={rate} onChange={(e) => setRate(e.target.value)} />
      {preview > 0 && <span className="text-ink">= {preview.toLocaleString("fr-FR")} XOF</span>}
      <Busy variant="ghost" label="Convertir" okMsg="Converti (recalcul lancé)" errMsg="Conversion refusée"
        fn={async () => { if (!(r > 0)) throw new Error("taux > 0"); await patchBcLine({ id: item.id!, amountXof: Math.round((item.amount || 0) * r), fxRate: r }); await onDone(); }} />
    </span>
  );
}

// APPLICATION d'une proposition IA → route vers l'écriture GOUVERNÉE idoine (jamais d'écriture directe :
// mêmes callables que la correction manuelle, donc mêmes droits/audit/recalcul). L'IA ne fait que
// pré-remplir l'action ; c'est ce clic humain qui exécute. Une action « review » n'applique rien.
async function applyAiSuggestion(item: CorrectionItem, s: AiSuggestion): Promise<void> {
  const f = s.fields || {};
  switch (s.action) {
    case "set_invoice_fp":
      if (!item.id || !f.fp) throw new Error("proposition incomplète");
      return void (await setInvoiceFp(item.id, String(f.fp)));
    case "generate_from_invoice":
      if (!item.id) throw new Error("facture sans identifiant");
      return void (await generateFromInvoices({ ids: [item.id] }));
    case "patch_order": {
      if (!item.fp) throw new Error("commande sans N° FP");
      const patch: { fp: string; yearPo?: number; client?: string; am?: string } = { fp: item.fp };
      if (f.yearPo != null) patch.yearPo = Number(f.yearPo);
      if (f.client != null) patch.client = String(f.client);
      if (f.am != null) patch.am = String(f.am);
      return void (await patchOrder(patch));
    }
    case "patch_opportunity":
      if (!item.id || !f.fp) throw new Error("proposition incomplète");
      return void (await patchOpportunity({ id: item.id, fp: String(f.fp) }));
    case "patch_bc_line": {
      if (!item.id) throw new Error("ligne BC sans identifiant");
      const patch: { id: string; fp?: string; supplier?: string } = { id: item.id };
      if (f.fp != null) patch.fp = String(f.fp);
      if (f.supplier != null) patch.supplier = String(f.supplier);
      return void (await patchBcLine(patch));
    }
    default:
      throw new Error("cette proposition est informative (à traiter manuellement)");
  }
}

// Libellé lisible d'une proposition IA (ce que « Appliquer » va écrire) — pour que l'humain valide en connaissance.
const AI_ACTION_LABEL: Record<string, string> = {
  set_invoice_fp: "Rattacher au N° FP",
  generate_from_invoice: "Générer commande + opp",
  patch_order: "Corriger la commande",
  patch_opportunity: "Poser le N° FP",
  patch_bc_line: "Corriger la ligne BC",
  review: "À vérifier",
};
function aiProposalText(s: AiSuggestion): string {
  const f = s.fields || {};
  const vals = Object.entries(f).map(([k, v]) => `${k} = ${v}`).join(", ");
  return AI_ACTION_LABEL[s.action] + (vals ? ` (${vals})` : "");
}

// Proposition IA sous une ligne : confiance + justification + « Appliquer » (écriture gouvernée) / « Ignorer ».
function AiSuggestionRow({ item, s, canFix, onDone, onDismiss }: { item: CorrectionItem; s: AiSuggestion; canFix: boolean; onDone: () => Promise<void>; onDismiss: () => void }) {
  const conf = Math.round(s.confidence * 100);
  const tone = s.verified ? "emerald" : s.confidence >= 0.75 ? "emerald" : s.confidence >= 0.5 ? "gold" : "steel";
  const applicable = s.action !== "review" && canFix;
  return (
    <div className={cx("ml-6 mt-0.5 flex items-start gap-2 text-[11px] rounded px-2 py-1 border", s.verified ? "bg-emerald/5 border-emerald/25" : "bg-gold/5 border-gold/20")}>
      <span aria-hidden className="shrink-0">🧠</span>
      <div className="flex flex-col gap-0.5 grow min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          <Badge tone={tone}>{conf}%</Badge>
          {s.verified && <span title={s.verifyReason || "Confirmée par une relecture adverse"}><Badge tone="emerald">✓ vérifiée</Badge></span>}
          <span className="text-ink">{aiProposalText(s)}</span>
        </div>
        {s.rationale && <span className="text-faint">{s.rationale}</span>}
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        {applicable && (
          <Busy variant="ghost" label="Appliquer" okMsg="Appliqué (recalcul lancé)" errMsg="Application refusée"
            fn={async () => { await applyAiSuggestion(item, s); await onDone(); }} />
        )}
        <button type="button" className="text-faint hover:underline" onClick={onDismiss}>Ignorer</button>
      </div>
    </div>
  );
}

// Une ligne à corriger : réf + client + le contrôle idoine selon le type. `canFix` = droit d'écriture
// sur le module de la donnée (sinon la ligne reste visible, mais en lecture avec une note). `suggestion`
// (optionnelle) = proposition IA à afficher sous la ligne (appliquée uniquement sur clic humain).
function ItemFix({ item, kind, module, canFix, onDone, suggestion, onDismissSuggestion }: { item: CorrectionItem; kind: string; module?: string; canFix: boolean; onDone: () => Promise<void>; suggestion?: AiSuggestion; onDismissSuggestion?: () => void }) {
  const { go, canGo } = useNav();
  const ref = item.numero || item.fp || item.bcNumber || item.client || "—";
  const done = () => onDone();
  const row = (control: ReactNode) => (
    <div>
      <div className="flex items-center gap-2 flex-wrap text-[13px]">
        <span className="tabnum text-faint">{ref}</span>
        {item.client && item.client !== ref && <span className="text-muted">{item.client}</span>}
        {control}
      </div>
      {/* Recommandation concrète déterministe (valeur + base) — pré-remplit le champ ci-dessus ou guide l'action. */}
      {item.rec && <RecNote rec={item.rec} />}
      {suggestion && <AiSuggestionRow item={item} s={suggestion} canFix={canFix} onDone={onDone} onDismiss={() => onDismissSuggestion?.()} />}
    </div>
  );
  // Renvois (drill) — pas d'écriture, gouvernés par canGo.
  if (kind === "nav") return row(canGo(module!) ? <button type="button" className="text-gold hover:underline text-[11px]" onClick={() => go(module!, { search: ref })} title="Ouvrir l'écran pré-filtré">ouvrir</button> : <span className="text-faint text-[11px]">accès requis</span>);
  if (kind === "dedupe") return row(<span className="text-faint text-[11px]">→ carte « Doublons » (direction)</span>);
  if (!canFix) return row(<span className="text-faint text-[11px]">correction hors de vos droits</span>);
  switch (kind) {
    case "fp-invoice": return row(
      <span className="inline-flex items-center gap-2 flex-wrap">
        <FieldFix label="N° FP" placeholder="FP/2026/…" save={async (v) => { if (!v.trim()) throw new Error("N° FP requis"); await setInvoiceFp(item.id!, v.trim()); await done(); }} />
        {looksCanonicalFp(item.fp) && (
          <Busy variant="ghost" label="→ Générer commande+opp" okMsg="Commande + opp gagnée créées (recalcul lancé)" errMsg="Génération refusée"
            fn={async () => { await generateFromInvoices({ ids: [item.id!] }); await done(); }} />
        )}
      </span>);
    case "date-invoice": return row(<DateFix save={async (v) => { await patchInvoice({ id: item.id!, date: v }); await done(); }} />);
    case "date-invoice-due": return row(<DateFix save={async (v) => { await patchInvoice({ id: item.id!, dueDate: v }); await done(); }} />);
    case "num-order-year": return row(<FieldFix label="Année PO" kind="number" placeholder="2026" save={async (v) => { const y = Math.trunc(Number(v)); if (!(y >= 2000)) throw new Error("année invalide"); await patchOrder({ fp: item.fp!, yearPo: y }); await done(); }} />);
    case "text-order-client": return row(<FieldFix label="Client" placeholder="Client" save={async (v) => { if (!v.trim()) throw new Error("client requis"); await patchOrder({ fp: item.fp!, client: v.trim() }); await done(); }} />);
    case "text-order-am": return row(<FieldFix label="Commercial (AM)" placeholder="Commercial" save={async (v) => { if (!v.trim()) throw new Error("AM requis"); await patchOrder({ fp: item.fp!, am: v.trim() }); await done(); }} />);
    case "fp-opp": return row(<FieldFix label="N° FP" placeholder="FP/2026/…" save={async (v) => { if (!v.trim()) throw new Error("N° FP requis"); await patchOpportunity({ id: item.id!, fp: v.trim() }); await done(); }} />);
    case "date-opp": return row(<DateFix save={async (v) => { await patchOpportunity({ id: item.id!, closingDate: v }); await done(); }} />);
    case "num-opp-amount": return row(<FieldFix label="Montant" kind="number" placeholder="montant" initial={item.rec?.field === "amount" && item.rec.value != null ? String(item.rec.value) : undefined} save={async (v) => { const n = parseAmt(v); if (!(n > 0)) throw new Error("montant > 0"); await patchOpportunity({ id: item.id!, amount: n }); await done(); }} />);
    case "fp-bc": return row(<FieldFix label="N° FP" placeholder="FP/2026/…" save={async (v) => { if (!v.trim()) throw new Error("N° FP requis"); await patchBcLine({ id: item.id!, fp: v.trim() }); await done(); }} />);
    case "text-bc-supplier": return row(<FieldFix label="Fournisseur" placeholder="Fournisseur" save={async (v) => { if (!v.trim()) throw new Error("fournisseur requis"); await patchBcLine({ id: item.id!, supplier: v.trim() }); await done(); }} />);
    case "amount-bc": return row(<BcConvertFix item={item} onDone={done} />);
    case "num-sheet-sale": return row(<FieldFix label="Prix de vente" kind="number" placeholder="vente HT" initial={item.rec?.field === "saleTotal" && item.rec.value != null ? String(item.rec.value) : undefined} save={async (v) => { const n = parseAmt(v); if (!(n > 0)) throw new Error("montant > 0"); await patchProjectSheet({ fp: item.fp!, saleTotal: n }); await done(); }} />);
    case "reconcile-pnl": return row(
      <span className="inline-flex items-center gap-2">
        <Busy variant="ghost" label="Inscrire au P&L" okMsg="Commande créée (recalcul lancé)" errMsg="Création refusée"
          fn={async () => { if (!item.fp) throw new Error("N° FP manquant"); if (!((item.amount || 0) > 0)) throw new Error("montant de l'opp manquant"); await createOrder({ fp: item.fp, cas: item.amount!, client: item.client, am: item.am, designation: item.designation }); await done(); }} />
        <span className="text-faint text-[11px]">ou « Dossier client » pour réconcilier vers un FP existant</span>
      </span>);
    default: return row(<span className="text-faint text-[11px]">correction à la source</span>);
  }
}

// Bloc d'un type d'anomalie : entête (sévérité, libellé, compte) repliable → lignes corrigeables.
// Clé stable d'un enregistrement — MÊME priorité que le serveur (domain/aiCorrection.refOf : id d'abord)
// pour apparier les propositions IA (indexées par « ref ») aux lignes affichées.
const refKeyOf = (it: CorrectionItem) => String(it.id || it.numero || it.fp || it.bcNumber || it.client || "");
// Seuil de confiance pour l'application EN LOT : on n'auto-applique que les propositions très fiables ;
// en dessous, elles restent visibles pour un arbitrage ligne à ligne. Réglé prudent (l'IA propose).
const AI_BULK_CONF = 0.85;

function CorrectionBlock({ bucket, open, onToggle, canFix, onDone }: { bucket: CorrectionBucket; open: boolean; onToggle: () => void; canFix: boolean; onDone: () => Promise<void> }) {
  const cfg = FIX[bucket.type] || { kind: "" };
  const [confirmBulk, setConfirmBulk] = useState(false);
  // Propositions IA indexées par ref (l'IA propose, l'humain applique via les écritures gouvernées).
  const [sugg, setSugg] = useState<Record<string, AiSuggestion>>({});
  const [aiInfo, setAiInfo] = useState<{ actionable: number; truncated: boolean; verified: boolean; verifiedCount: number } | null>(null);
  const toast = useToast();
  // Génération EN MASSE réservée aux factures non rattachées (crée commande + opp gagnée pour TOUTES les
  // orphelines à FP canonique absentes du carnet — les FP inconnus/déjà présents sont ignorés côté serveur).
  const bulkGen = bucket.type === "factures_orphelines" && canFix;
  // Analyse IA du lot : propose une correction justifiée par ligne (rapprochement FP, dérivation d'année…) PUIS
  // la VÉRIFIE par un 2e passage adverse (fiabilité max). Réservée aux data-stewards (droit « import »).
  const runAi = async () => {
    const r = await aiSuggestCorrections(bucket.type, bucket.items);
    const map: Record<string, AiSuggestion> = {};
    for (const s of r.suggestions) map[s.ref] = s;
    setSugg(map);
    setAiInfo({ actionable: r.suggestions.filter((s) => s.action !== "review").length, truncated: r.truncated, verified: !!r.verified, verifiedCount: r.verifiedCount || 0 });
    if (!open) onToggle();
  };
  // Cibles de l'application en lot « effort minimal » : quand la vérification adverse a tourné, on n'applique
  // QUE les propositions VÉRIFIÉES (fiabilité max) ; sinon, repli sur les propositions à haute confiance (≥ seuil).
  const verifRan = !!aiInfo?.verified;
  const bulkItems = () => bucket.items.filter((it) => {
    const s = sugg[refKeyOf(it)];
    if (!s || s.action === "review") return false;
    return verifRan ? !!s.verified : s.confidence >= AI_BULK_CONF;
  });
  // Applique EN LOT : chacune passe par SON écriture gouvernée (RBAC/audit/recalcul inchangés), séquentiellement,
  // tolérant aux échecs par ligne (une correction refusée n'annule pas les autres).
  const applyBulk = async () => {
    const targets = bulkItems();
    let ok = 0; const fails: string[] = [];
    for (const it of targets) {
      const s = sugg[refKeyOf(it)];
      try { await applyAiSuggestion(it, s); ok++; }
      catch { fails.push(refKeyOf(it)); }
    }
    await onDone();
    toast(`${ok} correction${ok > 1 ? "s" : ""} IA appliquée${ok > 1 ? "s" : ""}${fails.length ? ` — ${fails.length} refusée${fails.length > 1 ? "s" : ""} (à traiter à la main)` : ""}`, fails.length ? "err" : "ok");
  };
  return (
    <div className="border-t border-hair pt-2">
      <div className="w-full flex items-center gap-2 text-[13px] py-0.5">
        <button type="button" onClick={onToggle} className="flex items-center gap-2 text-left grow min-w-0">
          <Badge tone={CORR_SEV[bucket.severity]}>{bucket.count}</Badge>
          <span className="text-ink truncate">{bucket.label}</span>
        </button>
        {canFix && cfg.kind !== "nav" && (
          <Busy variant="ghost" label="🧠 IA" okMsg="Propositions IA prêtes" errMsg="Analyse IA refusée" fn={runAi} />
        )}
        {bulkGen && !confirmBulk && (
          <button type="button" className="text-gold hover:underline text-[11px] shrink-0" onClick={() => setConfirmBulk(true)} title="Créer commande + opp gagnée pour toutes les factures non rattachées (FP canonique)">⚡ tout générer</button>
        )}
        {bulkGen && confirmBulk && (
          <span className="inline-flex items-center gap-1.5 shrink-0 text-[11px]">
            <span className="text-faint">Générer toutes ?</span>
            <Busy variant="ghost" label="Oui" okMsg="Commandes + opps créées (recalcul lancé)" errMsg="Génération refusée"
              fn={async () => { await generateFromInvoices({ all: true }); setConfirmBulk(false); await onDone(); }} />
            <button type="button" className="text-faint hover:underline" onClick={() => setConfirmBulk(false)}>non</button>
          </span>
        )}
        <button type="button" onClick={onToggle} className="text-faint text-[11px] shrink-0">{open ? "▾ masquer" : "▸ corriger"}</button>
      </div>
      {open && (
        <div className="mt-1.5 flex flex-col gap-1.5 pl-1">
          {aiInfo && (
            <div className="flex items-center gap-2 flex-wrap text-[11px] text-faint">
              <span>
                🧠 IA : {aiInfo.actionable} proposition{aiInfo.actionable > 1 ? "s" : ""}
                {aiInfo.verified ? <> — <b className="text-emerald">{aiInfo.verifiedCount} vérifiée{aiInfo.verifiedCount > 1 ? "s" : ""}</b> par relecture adverse</> : <> applicable{aiInfo.actionable > 1 ? "s" : ""}</>}. <b>Vérifiez</b> puis « Appliquer » (écriture gouvernée).
                {aiInfo.truncated && " Lot tronqué (60 max) — relancez après correction."}
              </span>
              {canFix && bulkItems().length > 0 && (
                <Busy variant="ghost" label={`⚡ Appliquer les ${verifRan ? "vérifiées" : "fiables"} (${bulkItems().length})`}
                  okMsg="Propositions appliquées" errMsg="Application refusée" fn={applyBulk} />
              )}
            </div>
          )}
          {bucket.items.map((it, i) => (
            <ItemFix key={it.id || it.fp || `${bucket.type}-${i}`} item={it} kind={cfg.kind} module={cfg.module} canFix={canFix} onDone={onDone}
              suggestion={sugg[refKeyOf(it)]} onDismissSuggestion={() => setSugg((m) => { const n = { ...m }; delete n[refKeyOf(it)]; return n; })} />
          ))}
          {bucket.count > bucket.items.length && (
            <div className="text-[11px] text-faint">… {bucket.count - bucket.items.length} de plus — corrigez ceux-ci puis « Rafraîchir ».</div>
          )}
        </div>
      )}
    </div>
  );
}

// Export CSV des anomalies listées (à corriger dans l'app, ou à la source puis ré-importer). Rapatrié
// depuis l'ancien cockpit Qualité (operations) → le Centre de correction reste le point unique.
function exportBucketsCsv(buckets: CorrectionBucket[]) {
  const esc = (s: string) => `"${String(s).replace(/"/g, '""')}"`;
  const refOfItem = (it: CorrectionItem) => it.numero || it.fp || it.bcNumber || it.client || "";
  const rows = [["type", "severite", "compte", "libelle", "references"].join(",")].concat(
    buckets.map((b) => [b.type, b.severity, String(b.count), esc(b.label), esc(b.items.map(refOfItem).filter(Boolean).join(" | "))].join(",")),
  );
  const blob = new Blob(["﻿" + rows.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = "anomalies_donnees.csv"; a.rel = "noopener";
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Plan d'assainissement PRIORISÉ (par impact FCFA) — « par où commencer ». Rend la liste actionnable comme
// une feuille de route : la catégorie au plus fort impact d'abord. Impact extrapolé signalé (« ~ »).
function RemediationPlanCard({ plan, onGo }: { plan: RemediationPlan; onGo: (type: string) => void }) {
  if (!plan.rows.length) return null;
  const top3 = plan.rows.filter((r) => r.impact > 0).slice(0, 3);
  if (!top3.length) return null;
  return (
    <div className="rounded-md border border-gold/30 bg-gold/5 px-3 py-2.5">
      <div className="text-[12px] font-medium text-ink mb-1.5">🗺️ Plan d'assainissement — par où commencer <span className="text-faint font-normal">(impact FCFA le plus fort d'abord)</span></div>
      <ol className="flex flex-col gap-1">
        {top3.map((r, i) => (
          <li key={r.type} className="flex items-center gap-2 text-[12px]">
            <span className="text-faint tabnum">{i + 1}.</span>
            <button type="button" className="text-gold hover:underline text-left" onClick={() => onGo(r.type)}>{r.label}</button>
            <span className="text-muted">· {r.count.toLocaleString("fr-FR")} à traiter</span>
            <span className="text-ink tabnum">· impact {r.estimated ? "~" : ""}{Math.round(r.impact).toLocaleString("fr-FR")} FCFA</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function CorrectionCenter() {
  const [buckets, setBuckets] = useState<CorrectionBucket[] | null>(null);
  const [plan, setPlan] = useState<RemediationPlan | null>(null);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const caps = { import: useCanImport(), pipeline: useCan("pipeline") === "write", bc: useCan("bc") === "write", rentabilite: useCan("rentabilite") === "write" } as const;
  const load = async () => { const r = await correctionQueue(); setBuckets(r.buckets); setPlan(r.plan || null); };
  const canFixBucket = (b: CorrectionBucket) => { const cap = FIX[b.type]?.cap; return cap ? !!caps[cap] : true; };
  return (
    <Card title="Centre de correction" actions={
      <div className="flex items-center gap-2">
        {buckets && buckets.length > 0 && <button type="button" onClick={() => exportBucketsCsv(buckets)} className="btn-ghost !px-2.5 !py-1 text-xs">Exporter (CSV)</button>}
        <Busy variant="ghost" label={buckets ? "Rafraîchir" : "Analyser"} okMsg="Analyse terminée" errMsg="Analyse refusée" fn={load} />
      </div>
    }>
      <div className="flex flex-col gap-2">
        {buckets == null && <Tip>Point <b>unique</b> des anomalies : liste, <b>anomalie par anomalie</b>, les enregistrements concrets à corriger — avec l'éditeur idoine <b>directement ici</b> (N° FP, année, montant, fournisseur, conversion devise…), une <b>💡 recommandation chiffrée</b> quand elle est déductible, et l'assistant <b>🧠 IA</b>. Cliquez <b>Analyser</b>.</Tip>}
        {buckets && buckets.length === 0 && <div className="text-[13px] text-emerald">Aucune anomalie à corriger — base saine. 🎉</div>}
        {plan && buckets && buckets.length > 0 && <RemediationPlanCard plan={plan} onGo={(t) => setOpen((o) => ({ ...o, [t]: true }))} />}
        {buckets && buckets.map((b) => (
          <CorrectionBlock key={b.type} bucket={b} open={!!open[b.type]} onToggle={() => setOpen((o) => ({ ...o, [b.type]: !o[b.type] }))} canFix={canFixBucket(b)} onDone={load} />
        ))}
        {buckets && buckets.length > 0 && <Tip>Chaque correction appelle le service gouverné par le <b>module de la donnée</b> (droits respectés) et relance le recalcul ; l'anomalie se résorbe après « Rafraîchir ». Les <b>doublons</b> se traitent via la carte dédiée ; « <b>ouvrir</b> » renvoie à l'écran pré-filtré pour les cas non corrigeables en une valeur.</Tip>}
      </div>
    </Card>
  );
}

// RÉCONCILIATION FP — une même commande peut être déjà au P&L sous un N° FP différent de celui de
// l'opp gagnée (le FP P&L, lié à la facturation, fait autorité). On déclare l'équivalence
// `source → cible P&L` : à chaque recalcul, les lignes portant la source sont ré-étiquetées vers la
// cible EN MÉMOIRE (overlay config/fpAliases, non destructif → survit aux ré-imports delta, comme les
// alias clients). La cible reste seule au P&L ; la source cesse d'apparaître comme une commande à part.
function FpReconcileCard() {
  const { data } = useDocData<{ map?: Record<string, string> }>("config/fpAliases");
  const map = data?.map || {};
  const entries = Object.entries(map);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const ready = from.trim() && to.trim() && from.trim() !== to.trim();
  return (
    <Card title="Réconciliation N° FP (opp gagnée ↔ P&L)">
      <div className="flex flex-col gap-3">
        <div className="flex items-end gap-2 flex-wrap text-[13px]">
          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-muted">N° FP source (à réconcilier)</span>
            <input className="field w-40 !py-1" aria-label="N° FP source à réconcilier" placeholder="FP/2026/…" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <span className="text-faint pb-1.5">→</span>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-muted">N° FP cible (déjà au P&L)</span>
            <input className="field w-40 !py-1" aria-label="N° FP cible déjà au P&L" placeholder="FP/2026/…" value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
          {ready && (
            <Busy variant="ghost" label="Réconcilier" okMsg="Réconciliation enregistrée (recalcul lancé)" errMsg="Réconciliation refusée"
              fn={async () => { await setFpAlias(from.trim(), to.trim()); setFrom(""); setTo(""); }} />
          )}
        </div>
        {entries.length > 0 && (
          <Table columns={[
            colText("N° FP source", (r: [string, string]) => <span className="tabnum text-faint">{r[0]}</span>, (r: [string, string]) => r[0]),
            colText("réconcilié vers (P&L)", (r: [string, string]) => <span className="tabnum text-ink">{r[1]}</span>, (r: [string, string]) => r[1]),
            colText("", (r: [string, string]) => (
              <DangerBtn label="Retirer" okMsg="Réconciliation retirée (recalcul lancé)" errMsg="Retrait refusé"
                confirm={`Retirer la réconciliation ${r[0]} → ${r[1]} ? Le N° FP source réapparaîtra comme une commande distincte s'il porte des lignes.`}
                fn={() => setFpAlias(r[0], "")} />
            )),
          ]} rows={entries} />
        )}
        <Tip>Quand une commande est <b>déjà au P&L sous un autre N° FP</b> (le P&L, lié à la facturation, est la référence) : indiquez le N° FP de l'<b>opp/commande à réconcilier</b> puis le N° FP <b>P&L définitif</b>. Overlay non destructif (survit aux ré-imports) : à chaque recalcul, les lignes de la source sont rattachées à la cible ; on évite ainsi de compter deux fois la même affaire. Laissez le N° FP cible vide en retirant une réconciliation pour l'annuler.</Tip>
      </div>
    </Card>
  );
}

// DOSSIER CLIENT — rapprochement Opportunité / Commande P&L / Facture par client, pour repérer et
// corriger d'un clic les N° FP divergents. S'appuie sur le callable reconClient (lecture seule,
// gouverné « import ») qui aligne les trois flux par N° FP canonique et propose les réconciliations
// (FP FACTURE prioritaire). L'action « Réconcilier » appelle setFpAlias (overlay non destructif).
const RECON_REASON: Record<string, string> = {
  opp_gagnee_sans_pnl: "opp gagnée sans commande P&L",
  facture_sous_autre_fp: "facturée sous un autre N° FP",
};
// Niveau de confiance de la proposition (signal ayant déclenché le rapprochement).
const RECON_CONF: Record<string, { label: string; tone: "emerald" | "gold" | "clay" }> = {
  montant: { label: "montant concordant", tone: "emerald" },
  designation: { label: "même affaire", tone: "gold" },
  partielle: { label: "facture partielle", tone: "clay" },
};

// État d'un cluster (une affaire sous un N° FP) pour la colonne de synthèse.
function clusterState(c: ReconCluster): { label: string; tone: "clay" | "gold" | "emerald" | "neutral" } {
  if (c.won && !c.hasOrder) return { label: "opp gagnée orpheline", tone: "clay" };
  if (c.hasInvoice && !c.hasOrder) return { label: "facturé sans commande", tone: "clay" };
  if (c.hasOrder && !c.hasInvoice) return { label: "non facturé", tone: "gold" };
  if (c.hasOrder && c.hasInvoice) return { label: "rapproché", tone: "emerald" };
  return { label: "—", tone: "neutral" };
}

function ClientReconcileCard() {
  const [list, setList] = useState<ReconListItem[] | null>(null);
  const [scanned, setScanned] = useState<{ orders: number; invoices: number; opps: number } | null>(null);
  const [dossier, setDossier] = useState<ReconDossier | null>(null);
  const [q, setQ] = useState("");
  const toast = useToast();

  const refreshList = async () => { const r = await reconClient(); setList(r.clients || []); setScanned(r.scanned || null); };
  const openClient = async (client: string) => { const r = await reconClient(client); setDossier(r.dossier || null); if (!r.dossier) toast(`Aucun dossier pour « ${client} »`, "err"); };
  // RÉACTIVITÉ : un dossier ouvert reflète toute mutation de l'app (réconciliation, correction d'une
  // commande/opp/facture depuis une autre carte…) sans rechargement manuel. Rechargement d'UN client (borné).
  useReloadOnWrite(() => { if (dossier) openClient(dossier.client); }, !!dossier);

  return (
    <Card title="Dossier client — rapprochement Opp / Commande / Facture" actions={
      <div className="flex items-center gap-2 flex-wrap">
        <input className="field w-44 !py-1 text-xs" aria-label="Ouvrir le dossier d'un client" placeholder="Nom du client…"
          value={q} onChange={(e) => setQ(e.target.value)} />
        {q.trim() && <Busy variant="ghost" label="Ouvrir" okMsg="Dossier chargé" errMsg="Chargement refusé" fn={() => openClient(q.trim())} />}
        <Busy variant="ghost" label="Clients à rapprocher" okMsg="Analyse terminée" errMsg="Analyse refusée" fn={refreshList} />
      </div>
    }>
      <div className="flex flex-col gap-3">
        {/* Triage : clients porteurs d'un écart, du plus au moins prioritaire. */}
        {list && (
          list.length ? (
            <Table columns={[
              colText("Client", (r: ReconListItem) => (
                <button type="button" className="text-ink hover:text-gold underline decoration-dotted underline-offset-2"
                  onClick={() => openClient(r.client)} title="Ouvrir le dossier">{r.client}</button>
              ), (r: ReconListItem) => r.client),
              colNum("Opp.", (r: ReconListItem) => r.counts.opps),
              colNum("Cmd.", (r: ReconListItem) => r.counts.orders),
              colNum("Fact.", (r: ReconListItem) => r.counts.invoices),
              colText("À rapprocher", (r: ReconListItem) => (
                <div className="flex gap-1">
                  {r.suggestions > 0 && <Badge tone="emerald">{r.suggestions} proposée{r.suggestions > 1 ? "s" : ""}</Badge>}
                  {r.wonNoPnl > 0 && <Badge tone="clay">{r.wonNoPnl} opp orpheline{r.wonNoPnl > 1 ? "s" : ""}</Badge>}
                </div>
              ), (r: ReconListItem) => r.suggestions),
            ]} rows={list} />
          ) : <div className="text-[13px] text-muted">Aucun client à rapprocher — tous les N° FP concordent. 🎉</div>
        )}
        {scanned && <div className="text-[11px] text-faint">Analyse : {scanned.orders} commandes · {scanned.invoices} factures · {scanned.opps} opportunités.</div>}

        {/* Détail d'un client : propositions actionnables + vue alignée par N° FP. */}
        {dossier && (
          <div className="flex flex-col gap-3 border-t border-hair pt-3">
            <div className="text-sm font-medium text-ink">{dossier.client}</div>

            {dossier.suggestions.length > 0 && (
              <div className="flex flex-col gap-2">
                <div className="text-[11px] text-muted uppercase tracking-wide">Réconciliations proposées</div>
                {dossier.suggestions.map((s, i) => (
                  <div key={i} className="flex items-center gap-2 flex-wrap text-[13px]">
                    <span className="tabnum text-faint">{s.from}</span>
                    <span className="text-faint">→</span>
                    <span className="tabnum text-ink">{s.to}</span>
                    <Badge tone={s.targetHasInvoice ? "emerald" : "steel"}>{s.targetHasInvoice ? "FP facture" : "FP commande"}</Badge>
                    {RECON_CONF[s.confidence] && <Badge tone={RECON_CONF[s.confidence].tone}>{RECON_CONF[s.confidence].label}</Badge>}
                    <span className="text-muted">{RECON_REASON[s.reason] || s.reason}</span>
                    <Busy variant="ghost" label="Réconcilier" okMsg="Réconciliation enregistrée (recalcul lancé)" errMsg="Réconciliation refusée"
                      fn={async () => { await setFpAlias(s.from, s.to); await openClient(dossier.client); await refreshList(); }} />
                  </div>
                ))}
              </div>
            )}

            <Table columns={[
              colText("N° FP", (c: ReconCluster) => <span className="tabnum">{c.fp}</span>, (c: ReconCluster) => c.fp),
              colText("Opportunité", (c: ReconCluster) => c.opps.length
                ? <span className="inline-flex items-center gap-1">{money(c.oppAmount)}{c.won && <Badge tone="gold">gagnée</Badge>}</span> : <span className="text-faint">—</span>,
                (c: ReconCluster) => c.oppAmount),
              colNum("Commande (CAS)", (c: ReconCluster) => c.hasOrder ? money(c.orderCas) : <span className="text-faint">—</span>, (c: ReconCluster) => c.orderCas),
              colNum("Facturé", (c: ReconCluster) => c.hasInvoice ? money(c.invoiceTotal) : <span className="text-faint">—</span>, (c: ReconCluster) => c.invoiceTotal),
              colText("État", (c: ReconCluster) => { const st = clusterState(c); return <Badge tone={st.tone as any}>{st.label}</Badge>; }),
            ]} rows={dossier.clusters} />
          </div>
        )}

        <Tip>Vue par <b>client</b> alignant <b>opportunités, commandes P&amp;L et factures</b> sur le même N° FP. Le <b>FP de la facture fait foi</b> (facturation) devant le FP commande, lui-même devant le FP opp. « <b>Clients à rapprocher</b> » liste ceux dont un flux est sous un N° FP divergent ; ouvrez un dossier puis cliquez « <b>Réconcilier</b> » sur une proposition (overlay non destructif, recalcul immédiat). Chaque proposition indique son signal : <b>montant concordant</b>, <b>même affaire</b> (désignation) ou <b>facture partielle</b> (acompte, appariement unique) — toujours à confirmer d'un clic.</Tip>
      </div>
    </Card>
  );
}

// Anneau de score compact (conic-gradient) — pour l'entête premium du cockpit Qualité & Correction.
function ScoreRing({ value, color }: { value: number; color: string }) {
  const v = Math.max(0, Math.min(1, value));
  const deg = Math.round(v * 360);
  return (
    <div className="relative shrink-0" style={{ width: 68, height: 68 }} aria-hidden>
      <div className="absolute inset-0 rounded-full" style={{ background: `conic-gradient(${color} ${deg}deg, rgb(var(--hair)) ${deg}deg)` }} />
      <div className="absolute inset-[6px] rounded-full bg-panel flex items-center justify-center">
        <span className="font-display tabnum text-lg leading-none" style={{ color }}>{Math.round(v * 100)}</span>
      </div>
    </div>
  );
}

// Entête PREMIUM du cockpit « Qualité & Correction » : score (anneau), anomalies, volumes ingérés et
// tendance 30 j — réunit ce qu'affichait l'ancien écran « Qualité des données » (Référentiels), désormais
// intégré ici (point unique). Bande gradient discrète, thème-aware via les tokens.
function QualityHero({ data, days }: { data?: DataQualitySummary | null; days: { score: number }[] }) {
  const score = data?.score ?? 1;
  const color = score >= 0.9 ? T.emerald : score >= 0.7 ? T.gold : T.clay;
  const totalAnomalies = (data?.issues || []).reduce((s, i) => s + i.count, 0);
  const types = (data?.issues || []).length;
  const c = data?.counts || {};
  const first = days[0], last = days[days.length - 1];
  const vol: [string, number][] = [
    ["Commandes", c.orders || 0], ["Factures", c.invoices || 0],
    ["Opportunités", c.opportunities || 0], ["Lignes BC", c.bcLines || 0],
  ];
  return (
    <div className="relative overflow-hidden rounded-2xl border border-hair bg-gradient-to-br from-panel2/50 to-panel px-5 py-4">
      <div className="flex flex-wrap items-center gap-x-8 gap-y-4">
        <div className="flex items-center gap-3.5">
          <ScoreRing value={score} color={color} />
          <div>
            <div className="text-[10px] uppercase tracking-[0.14em] text-faint">Qualité des données</div>
            <div className="font-display text-2xl leading-tight" style={{ color }}>{pct(score)}</div>
            <div className="text-[11px] text-muted">score de complétude</div>
          </div>
        </div>
        <div className="h-10 w-px bg-hair hidden sm:block" />
        <div>
          <div className="text-[10px] uppercase tracking-[0.14em] text-faint">Anomalies</div>
          <div className="font-display tabnum text-2xl leading-tight text-ink">{totalAnomalies.toLocaleString("fr-FR")}</div>
          <div className="text-[11px] text-muted">{types} type{types > 1 ? "s" : ""} à traiter</div>
        </div>
        <div className="h-10 w-px bg-hair hidden md:block" />
        <div className="grid grid-cols-2 gap-x-5 gap-y-1.5">
          {vol.map(([label, n]) => (
            <div key={label} className="flex items-baseline gap-1.5">
              <span className="font-display tabnum text-sm text-ink">{n.toLocaleString("fr-FR")}</span>
              <span className="text-[10px] text-faint">{label}</span>
            </div>
          ))}
        </div>
        {days.length >= 2 && (
          <div className="ml-auto">
            <div className="text-[10px] uppercase tracking-[0.14em] text-faint mb-1">Tendance 30 j {first && last ? `· ${pct(first.score)} → ${pct(last.score)}` : ""}</div>
            <Spark points={days.map((d) => d.score)} />
          </div>
        )}
      </div>
    </div>
  );
}

export const Cleanup: FC<Props> = () => {
  const { data } = useDocData<DataQualitySummary>("summaries/dataQuality");
  const { data: qh } = useDocData<QualityHistory>("summaries/qualityHistory");
  const canImport = useCanImport();
  const canBc = useCan("bc") !== "none";
  const canPipe = useCan("pipeline") !== "none";
  const isDirection = useClaims().role === "direction"; // le dédoublonnage (callable) est direction-only
  // Collections chargées seulement si le rôle a l'accès (chaque purge est gouvernée par son module).
  // NB : plus de chargement des `invoices` ici — les factures non rattachées sont traitées au Centre de
  // correction (prédicat FP CANONIQUE côté serveur), pas via le drapeau `linked` (jamais persisté à
  // l'ingestion → obsolète : il flaguait à tort quasi toutes les factures). Alignement des vues qualité.
  const { rows: bcLines } = useCollectionData<BcLine>(canBc ? "bcLines" : null);
  const oppScope = useRecordScope("opportunities"); // cadrage propriétaire+hiérarchie sous OWD « private »
  const { rows: opps } = useCollectionData<Opportunity>(canPipe && oppScope.ready ? "opportunities" : null, oppScope.constraints, oppScope.scoped ? "s" : "");

  // BC NON RÉPARABLES : ni FP, ni fournisseur, ni N° BC, ni montant XOF → ligne vide/fantôme.
  const junkBcIds = bcLines.filter((b) => b.id && !b.fp && !b.supplier && !b.bcNumber && !((b.amountXof || 0) > 0)).map((b) => b.id!) as string[];
  // Opportunités PERDUES (7) / ANNULÉES (9) : mortes. Purge OPTIONNELLE (retire de l'historique).
  const deadOppIds = opps.filter((o) => (o.stage === 7 || o.stage === 9) && o.id).map((o) => o.id!) as string[];
  const days = (qh?.days || []).slice(-30);
  return (
    <div className="flex flex-col gap-4">
      <QualityHero data={data} days={days} />

      <Card title="Purge en lot">
        <div className="flex flex-col gap-2.5">
          {canImport && (
            <div className="flex items-center justify-between gap-2 text-[13px] border-b border-hair pb-2">
              <span className="text-ink">Factures non rattachées</span>
              <span className="text-faint text-[11px]">→ à traiter au <b className="text-ink">Centre de correction</b> (générer la commande, ou corriger le N° FP) — canonique, sans perte de donnée.</span>
            </div>
          )}
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

      {canImport && <CorrectionCenter />}

      {canImport && <ClientReconcileCard />}

      {canImport && <FpReconcileCard />}

      {isDirection && <DedupeCard />}

      {isDirection && <CleanupJournal />}
    </div>
  );
};
