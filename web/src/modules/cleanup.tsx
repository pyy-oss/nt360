// Console d'ASSAINISSEMENT (gouvernée « import ») : point unique pour nettoyer la base.
//  - Corriger À LA LIGNE : chaque anomalie ouvre l'écran cible pré-filtré (les éditeurs + la
//    suppression par ligne y vivent déjà — cf. remédiation guidée + assainissement lot 1).
//  - Purger EN LOT : le cas clairement « déchet » — les factures orphelines (rattachables à aucune
//    commande) — en une action, plus un raccourci vers le dédoublonnage (doublons).
// NON destructif par défaut : la purge demande confirmation et n'agit que sur des enregistrements
// non rattachables. Le delta reste prioritaire (une source ré-important le record le recrée).
import { useState, type FC, type ReactNode, type Dispatch, type SetStateAction } from "react";
import { orderBy, limit } from "firebase/firestore";
import { useDocData, useCollectionData, useReloadOnWrite } from "../lib/hooks";
import { useCanImport, useClaims, useCan } from "../lib/rbac";
import { useNav } from "../lib/nav";
import { useRecordScope } from "../lib/scope";
import { Card, Tip, Badge, Busy, DangerBtn, Table, colText, colNum, det, money, useToast, Modal, type Col } from "../design/components";
import { DateField, Select } from "../design/inputs";
import { T, pct, fmtFull } from "../design/tokens";
import { frDate } from "../lib/format";
import { plausibleYear } from "../lib/ids";
import {
  deleteRecords, callDedupe, setFpAlias, setDcAlias, reconClient, correctionQueue,
  setInvoiceFp, patchInvoice, patchOrder, patchOpportunity, patchBcLine, patchProjectSheet, createOrder, generateFromInvoices,
  setCancellation, fpDocId, importDcAliases, type DcMapImportResult,
  aiSuggestCorrections,
  type DedupeResult, type ReconListItem, type ReconDossier, type ReconCluster, type CorrectionBucket, type CorrectionItem, type CorrectionRec, type RemediationPlan, type AiSuggestion,
} from "../lib/writes";

// Un N° FP est GÉNÉRABLE (commande/opp) s'il est canonique (FP/AAAA/N) — sinon « N° FP inconnu » relève
// d'abord d'une correction du N° FP. Aligné sur fpKey côté serveur (validation finale par le callable).
const looksCanonicalFp = (fp?: string) => /FP\/?\s*\d{4}(?!\d)\/?\s*\d+/i.test(String(fp || ""));
// Année portée par le N° FP (FP/AAAA/N), BORNÉE — miroir de yearOfFp (domain/commandes.js). Sert au
// pré-remplissage HONNÊTE de « Année de PO » (l'année de l'affaire elle-même, jamais une année en dur).
const yearOfFp = (fp?: string) => { const m = /\/(\d{4})\//.exec(String(fp || "")); return m ? plausibleYear(m[1]) : 0; };
import { Props, relTime, STAGE_SHORT } from "./_shared";
import { Spark, ScoreRing } from "./_viz";
import type { DataQualitySummary, QualityHistory, AuditLog, BcLine, Opportunity } from "../types";

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

// Section REPLIABLE du Centre de correction — les outils de rapprochement / réconciliation / doublons
// vivent DANS le point unique (plus de cartes séparées à chercher sur la page). Même entête que les
// blocs d'anomalies (toggle « ▸ ouvrir / ▾ masquer »).
function CorrSection({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-t border-hair pt-2">
      <button type="button" onClick={() => setOpen((o) => !o)} className="w-full flex items-center gap-2 text-[13px] py-0.5 text-left">
        <span className="text-ink font-medium grow min-w-0 truncate">{title}</span>
        {hint && <span className="text-faint text-[11px] shrink-0">{hint}</span>}
        <span className="text-faint text-[11px] shrink-0">{open ? "▾ masquer" : "▸ ouvrir"}</span>
      </button>
      {open && <div className="mt-1.5 flex flex-col gap-3 pl-1">{children}</div>}
    </div>
  );
}

// Dédoublonnage intégré : analyse d'abord (aperçu), puis suppression (le meilleur représentant de
// chaque groupe est conservé). Réservé à la direction (le callable dedupe est direction-only).
function DedupeSection() {
  const [res, setRes] = useState<DedupeResult | null>(null);
  const totalDup = res ? Object.values(res.result).reduce((s, r) => s + r.duplicates, 0) : 0;
  // Collections dont le scan a été tronqué au plafond : « aucun doublon » n'y vaut que pour la partie
  // scannée (parité avec admin.tsx DedupeCard) — sans quoi le verdict affirmait à tort la base propre.
  const cappedCols = res ? Object.entries(res.result).filter(([, s]) => s.capped).map(([c]) => DEDUPE_LABEL[c] || c) : [];
  return (
    <CorrSection title="Doublons (factures / opportunités / BC)" hint="direction">
      <div className="flex gap-2 flex-wrap items-center">
        <Busy variant="ghost" label="Analyser" okMsg="Analyse terminée" errMsg="Analyse refusée" fn={async () => { setRes(await callDedupe(undefined, false)); }} />
        {res && !res.applied && totalDup > 0 && (
          // Suppression IRRÉVERSIBLE (cf. audit intégral F1) : confirmation via DangerBtn, masquée une
          // fois appliquée (!res.applied) pour éviter un second clic à vide (F2).
          <DangerBtn label={`Supprimer ${totalDup} doublon${totalDup > 1 ? "s" : ""}`} okMsg="Doublons supprimés" errMsg="Suppression refusée"
            confirm={`Supprimer définitivement ${totalDup.toLocaleString("fr-FR")} doublon(s) ? Le meilleur enregistrement de chaque groupe (source figée, plus récent) est conservé.`}
            fn={async () => { setRes(await callDedupe(undefined, true)); }} />
        )}
      </div>
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
            : totalDup > 0 ? `${totalDup.toLocaleString("fr-FR")} doublon(s) détecté(s) — vérifiez l'aperçu (✓ conservé / ✗ écartés) puis cliquez « Supprimer ». Clé : N° FP canonique (opps/BC), numéro (factures).`
            : cappedCols.length ? `Aucun doublon dans la partie scannée — analyse PARTIELLE (volume au-delà du plafond : ${cappedCols.join(", ")}). Des doublons peuvent subsister hors périmètre scanné.` : "Aucun doublon détecté."}</Tip>
        </div>
      ) : (
        <Tip>Analyse les factures, opportunités et BC fournisseurs (même clé métier ⇒ doublon), puis supprime les redondances en conservant le meilleur enregistrement de chaque groupe.</Tip>
      )}
    </CorrSection>
  );
}

// CENTRE DE CORRECTION — point unique pour corriger, anomalie par anomalie, TOUS les enregistrements
// concernés (pas seulement rebondir vers un écran). Le callable correctionQueue (lecture, gouverné
// « import ») réutilise les prédicats de dataQuality.js ; chaque type route vers l'éditeur inline
// idoine, qui appelle le callable de correction gouverné par le MODULE de la donnée (setInvoiceFp,
// patchOrder, patchOpportunity, patchBcLine, patchProjectSheet, createOrder). Après correction on
// rescanne (l'anomalie se résorbe en direct).
const CORR_SEV: Record<string, "clay" | "gold" | "steel"> = { high: "clay", medium: "gold", low: "steel" };
// Cartographie type d'anomalie → mode de correction + droit requis (module de la donnée) + ENTITÉ de
// l'enregistrement (`ent`) : elle porte les ACTIONS de ligne (modale de correction, requalification,
// annulation, renvoi vers l'écran source) — corriger ICI, sans se promener dans l'application.
type FixEnt = "order" | "opp" | "invoice" | "bc" | "sheet";
const FIX: Record<string, { kind: string; cap?: "import" | "pipeline" | "bc" | "rentabilite"; module?: string; ent?: FixEnt }> = {
  factures_orphelines: { kind: "fp-invoice", cap: "import", ent: "invoice" },
  factures_sans_date: { kind: "date-invoice", cap: "import", ent: "invoice" },
  factures_sans_echeance: { kind: "date-invoice-due", cap: "import", ent: "invoice" },
  surfacturation: { kind: "nav", module: "invoicelist", ent: "order" },
  // N° FP illisible : la correction (fixer le N° FP) se fait à la source, sur l'écran Commandes pré-filtré
  // (patchOrder/annulation ciblent orders/{safeId(fp)} — un FP illisible n'y est pas adressable sûrement).
  commandes_fp_illisible: { kind: "nav", module: "orderlist" },
  commandes_sans_annee: { kind: "num-order-year", cap: "import", ent: "order" },
  commandes_sans_client: { kind: "text-order-client", cap: "import", ent: "order" },
  commandes_sans_am: { kind: "text-order-am", cap: "import", ent: "order" },
  am_invalide: { kind: "text-order-am", cap: "import", ent: "order" },
  opps_sans_dprev: { kind: "date-opp", cap: "pipeline", ent: "opp" },
  opps_sans_montant: { kind: "num-opp-amount", cap: "pipeline", ent: "opp" },
  opps_gagnees_sans_fp: { kind: "fp-opp", cap: "pipeline", ent: "opp" },
  opps_gagnees_sans_pnl: { kind: "reconcile-pnl", cap: "import", ent: "opp" },
  opps_fantomes: { kind: "nav", module: "opplist", ent: "opp" },
  opps_agees: { kind: "nav", module: "opplist", ent: "opp" },
  // Cohérence AMONT (opportunité ↔ commande) : la modale « modifier » (CAS ligne P&L) / « requalifier »
  // porte désormais la correction ; « ouvrir » reste pour le contexte complet.
  ecart_valorisation: { kind: "nav", module: "orderlist", ent: "order" },
  opp_active_carnet: { kind: "nav", module: "opplist", ent: "opp" },
  bc_sans_fp: { kind: "fp-bc", cap: "bc", ent: "bc" },
  // FP renseigné mais inconnu du carnet : même correction qu'un FP absent (poser le BON N° FP).
  bc_fp_inconnu: { kind: "fp-bc", cap: "bc", ent: "bc" },
  bc_sans_fournisseur: { kind: "text-bc-supplier", cap: "bc", ent: "bc" },
  bc_montant_zero: { kind: "amount-bc", cap: "bc", ent: "bc" },
  fiches_sans_vente: { kind: "num-sheet-sale", cap: "rentabilite", ent: "sheet" },
  opps_doublons: { kind: "dedupe" },
  bc_doublons: { kind: "dedupe" },
  // Incohérences ClickUp ↔ app (rapatriées ici — source unique). « facturé sans CAF » = facture à
  // rattacher (drill) ; « clôturé avec RAF » = solder le RAF, en un clic ici (patchOrder raf: 0).
  clickup_facture_sans_caf: { kind: "nav", module: "orderlist", ent: "order" },
  clickup_cloture_avec_raf: { kind: "raf-order-zero", cap: "import", ent: "order" },
};
// Écran source d'une entité (« ouvrir » pré-filtré) — modifier là-bas quand la ligne ne suffit pas.
const ENT_MODULE: Record<FixEnt, string> = { order: "orderlist", opp: "opplist", invoice: "invoicelist", bc: "bc", sheet: "fiches" };
// Provenance lisible d'un enregistrement (source technique → libellé court).
const SRC_LABEL: Record<string, string> = { pnl: "P&L", opp_won: "opp gagnée", fiche: "fiche", saisie: "saisie", odoo: "Odoo", salesData: "LIVE" };

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
// RECOMMANDATION concrète (valeur chiffrée + base de calcul), rendue COMPACTE dans la colonne
// « Recommandation » du tableau. Pour les champs pré-remplissables c'est la justification ; pour les cas
// non éditables ici (écart valo, surfacturation) c'est la recommandation elle-même. Tokens existants.
function RecInline({ rec }: { rec: CorrectionRec }) {
  return (
    <span className="text-[12px]">
      {rec.value != null && <b className="tabnum text-ink">{rec.value.toLocaleString("fr-FR")} </b>}
      <span className="text-faint">{rec.basis}</span>
    </span>
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

// Proposition IA rendue COMPACTE dans la colonne « IA » du tableau : confiance + « vérifiée » + boutons
// (« Appliquer » = écriture gouvernée / « Ignorer »). Le libellé de la proposition et sa justification vont
// dans la colonne de détail (dépliable) — la ligne principale reste étroite et alignée.
function AiInline({ item, s, canFix, onDone, onDismiss }: { item: CorrectionItem; s: AiSuggestion; canFix: boolean; onDone: () => Promise<void>; onDismiss: () => void }) {
  const conf = Math.round(s.confidence * 100);
  const tone = s.verified ? "emerald" : s.confidence >= 0.75 ? "emerald" : s.confidence >= 0.5 ? "gold" : "steel";
  const applicable = s.action !== "review" && canFix;
  return (
    <span className="inline-flex items-center gap-1.5 flex-wrap justify-end">
      <Badge tone={tone}>{conf}%</Badge>
      {s.verified && <span title={s.verifyReason || "Confirmée par une relecture adverse"}><Badge tone="emerald">✓</Badge></span>}
      {applicable && (
        <Busy variant="ghost" label="Appliquer" okMsg="Appliqué (recalcul lancé)" errMsg="Application refusée"
          fn={async () => { await applyAiSuggestion(item, s); await onDone(); }} />
      )}
      <button type="button" className="text-faint hover:underline text-[11px]" onClick={onDismiss}>Ignorer</button>
    </span>
  );
}

// Justification IA (proposition lisible + rationale) — rendue dans la colonne de DÉTAIL du tableau.
function AiDetail({ s }: { s: AiSuggestion }) {
  return (
    <span className="text-[12px]">
      <span className="text-ink">{aiProposalText(s)}</span>
      {s.rationale && <span className="text-faint"> — {s.rationale}</span>}
    </span>
  );
}

const Fld = ({ label, children }: { label: string; children: ReactNode }) => (
  <label className="flex flex-col gap-1 text-[12px] text-muted">{label}{children}</label>
);

// MODALE de correction d'une COMMANDE (ligne P&L) — tout corriger ici, sans quitter le Centre. Chaque
// champ est PRÉ-REMPLI avec la valeur actuelle (année : celle du N° FP en repli — jamais une année en
// dur) ; seuls les champs MODIFIÉS sont envoyés (patchOrder, gouverné « import », audité, recalcul).
function OrderFixModal({ item, onClose, onDone }: { item: CorrectionItem; onClose: () => void; onDone: () => Promise<void> }) {
  const init = {
    yearPo: plausibleYear(item.yearPo) ? String(plausibleYear(item.yearPo)) : yearOfFp(item.fp) ? String(yearOfFp(item.fp)) : "",
    client: item.client || "", am: item.am || "", designation: item.designation || item.affaire || "",
    cas: (item.casPnl ?? item.cas) ? String(item.casPnl ?? item.cas) : "",
    raf: item.raf != null ? String(item.raf) : "",
  };
  const [f, setF] = useState(init);
  const changed = (k: keyof typeof init) => f[k].trim() !== init[k].trim();
  const anyChanged = (Object.keys(init) as (keyof typeof init)[]).some(changed);
  const set = (k: keyof typeof init) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const save = async () => {
    const patch: Parameters<typeof patchOrder>[0] = { fp: item.fp! };
    if (changed("yearPo")) { const y = Math.trunc(Number(f.yearPo)); if (!(y >= 2000)) throw new Error("année invalide"); patch.yearPo = y; }
    if (changed("client") && f.client.trim()) patch.client = f.client.trim();
    if (changed("am") && f.am.trim()) patch.am = f.am.trim();
    if (changed("designation") && f.designation.trim()) patch.designation = f.designation.trim();
    if (changed("cas")) { const n = parseAmt(f.cas); if (!(n > 0)) throw new Error("CAS > 0 requis"); patch.cas = n; }
    if (changed("raf")) { const n = parseAmt(f.raf); if (!(n >= 0)) throw new Error("RAF ≥ 0 requis"); patch.raf = n; }
    await patchOrder(patch);
    onClose(); await onDone();
  };
  return (
    <Modal open onClose={onClose} size="form" title={<>Corriger la commande <span className="text-gold">{item.fp}</span></>}
      actions={<>
        <button className="btn-ghost" onClick={onClose}>Fermer</button>
        {anyChanged && <Busy label="Enregistrer" okMsg="Commande corrigée (recalcul lancé)" errMsg="Correction refusée" fn={save} />}
      </>}>
      <div className="grid grid-cols-2 gap-3 mt-1">
        <Fld label="Année de PO"><input className="field !py-1.5" inputMode="numeric" aria-label={`Année de PO ${item.fp}`} placeholder="AAAA" value={f.yearPo} onChange={set("yearPo")} /></Fld>
        <Fld label="Client"><input className="field !py-1.5" aria-label={`Client ${item.fp}`} placeholder="nom du client" value={f.client} onChange={set("client")} /></Fld>
        <Fld label="AM"><input className="field !py-1.5" aria-label={`AM ${item.fp}`} placeholder="commercial" value={f.am} onChange={set("am")} /></Fld>
        <Fld label="Affaire (désignation)"><input className="field !py-1.5" aria-label={`Désignation ${item.fp}`} placeholder="désignation" value={f.designation} onChange={set("designation")} /></Fld>
        <Fld label="CAS (ligne P&L)"><input className="field !py-1.5" inputMode="decimal" aria-label={`CAS ${item.fp}`} placeholder="montant" value={f.cas} onChange={set("cas")} /></Fld>
        <Fld label="RAF"><input className="field !py-1.5" inputMode="decimal" aria-label={`RAF ${item.fp}`} placeholder="reste à facturer" value={f.raf} onChange={set("raf")} /></Fld>
      </div>
      {(item.source === "opp_won" || item.source === "fiche") && (
        <p className="text-[11px] text-faint mt-2">Le CAS retenu au carnet vient de {item.source === "fiche" ? "la fiche affaire" : "l'opp gagnée"} ; le CAS saisi ici corrige la <b>ligne P&L d'origine</b> (l'écart signalé se résorbe en alignant l'un ou l'autre).</p>
      )}
    </Modal>
  );
}

// MODALE de REQUALIFICATION / correction d'une OPPORTUNITÉ — étape (gagnée / perdue / suspendue /
// annulée), montant, D Prev, N° FP, motif de perte. patchOpportunity (gouverné « pipeline », audité,
// recalcul) ; seuls les champs modifiés sont envoyés.
function OppFixModal({ item, onClose, onDone }: { item: CorrectionItem; onClose: () => void; onDone: () => Promise<void> }) {
  const init = {
    stage: item.stage ? String(item.stage) : "", amount: item.amount ? String(item.amount) : "",
    closingDate: String(item.closingDate || "").slice(0, 10), fp: item.fp || "", lostReason: "",
  };
  const [f, setF] = useState(init);
  const changed = (k: keyof typeof init) => f[k].trim() !== init[k].trim();
  const anyChanged = (Object.keys(init) as (keyof typeof init)[]).some(changed);
  const save = async () => {
    const patch: Parameters<typeof patchOpportunity>[0] = { id: item.id! };
    if (changed("stage")) { const s = Number(f.stage); if (!(s >= 1 && s <= 9)) throw new Error("étape invalide"); patch.stage = s; }
    if (changed("amount")) { const n = parseAmt(f.amount); if (!(n > 0)) throw new Error("montant > 0 requis"); patch.amount = n; }
    if (changed("closingDate") && f.closingDate) patch.closingDate = f.closingDate;
    if (changed("fp") && f.fp.trim()) patch.fp = f.fp.trim();
    if (f.lostReason.trim()) patch.lostReason = f.lostReason.trim();
    await patchOpportunity(patch);
    onClose(); await onDone();
  };
  return (
    <Modal open onClose={onClose} size="form" title={<>Requalifier l'opportunité <span className="text-gold">{item.fp || item.client || "—"}</span></>}
      actions={<>
        <button className="btn-ghost" onClick={onClose}>Fermer</button>
        {anyChanged && <Busy label="Enregistrer" okMsg="Opportunité mise à jour (recalcul lancé)" errMsg="Correction refusée" fn={save} />}
      </>}>
      <div className="grid grid-cols-2 gap-3 mt-1">
        <Fld label="Étape">
          <Select className="!py-1.5" value={f.stage} onChange={(v) => setF({ ...f, stage: v })} ariaLabel="Étape de l'opportunité" placeholder="Étape…"
            options={Object.entries(STAGE_SHORT).map(([v, l]) => ({ value: v, label: `${v} — ${l}` }))} />
        </Fld>
        <Fld label="Montant"><input className="field !py-1.5" inputMode="decimal" aria-label="Montant de l'opportunité" placeholder="montant" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Fld>
        <Fld label="D Prev"><DateField value={f.closingDate} onChange={(v) => setF({ ...f, closingDate: v })} ariaLabel="D Prev" className="!py-1.5" /></Fld>
        <Fld label="N° FP"><input className="field !py-1.5" aria-label="N° FP de l'opportunité" placeholder="FP/2026/…" value={f.fp} onChange={(e) => setF({ ...f, fp: e.target.value })} /></Fld>
        {Number(f.stage) === 7 && (
          <Fld label="Motif de perte"><input className="field !py-1.5" aria-label="Motif de perte" placeholder="prix, délai, concurrent…" value={f.lostReason} onChange={(e) => setF({ ...f, lostReason: e.target.value })} /></Fld>
        )}
      </div>
      <p className="text-[11px] text-faint mt-2">Requalifier en <b>7 — Perdu</b> / <b>9 — Annulé</b> sort l'opportunité du pipeline ; <b>8 — Suspendu</b> la met en pause. Une opp active sur un FP déjà au carnet se clôture ici (la commande existe déjà).</p>
    </Modal>
  );
}

// Une ligne à corriger : réf + client + CONTEXTE IDENTIFIANT (affaire, montant, AM, date, source — sans
// lui la ligne est inexploitable) + le contrôle idoine selon le type + ACTIONS de ligne (modale de
// correction, annulation, renvoi vers l'écran source). `canFix` = droit d'écriture sur le module de la
// donnée (sinon la ligne reste visible, mais en lecture avec une note). `suggestion`
// (optionnelle) = proposition IA à afficher sous la ligne (appliquée uniquement sur clic humain).
// CONTRÔLE de correction spécifique au TYPE d'anomalie (éditeur inline) — rendu dans la colonne
// « Correction » du tableau. Ne rend QUE le contrôle : le contexte (affaire, montant, AM…) et les actions
// de ligne sont des COLONNES distinctes (alignées). `canFix` = droit d'écriture sur le module de la donnée.
function FixControl({ item, kind, canFix, onDone }: { item: CorrectionItem; kind: string; canFix: boolean; onDone: () => Promise<void> }) {
  const done = () => onDone();
  if (kind === "nav") return <span className="text-faint text-[11px]">→ actions</span>;
  if (kind === "dedupe") return <span className="text-faint text-[11px]">→ Doublons (direction)</span>;
  if (!canFix) return <span className="text-faint text-[11px]">hors de vos droits</span>;
  switch (kind) {
    case "fp-invoice": return (
      <span className="inline-flex items-center gap-2 flex-wrap">
        <FieldFix label="N° FP" placeholder="FP/2026/…" save={async (v) => { if (!v.trim()) throw new Error("N° FP requis"); await setInvoiceFp(item.id!, v.trim()); await done(); }} />
        {looksCanonicalFp(item.fp) && (
          <Busy variant="ghost" label="→ Générer" okMsg="Commande + opp gagnée créées (recalcul lancé)" errMsg="Génération refusée"
            fn={async () => { await generateFromInvoices({ ids: [item.id!] }); await done(); }} />
        )}
      </span>);
    case "date-invoice": return <DateFix save={async (v) => { await patchInvoice({ id: item.id!, date: v }); await done(); }} />;
    case "date-invoice-due": return <DateFix save={async (v) => { await patchInvoice({ id: item.id!, dueDate: v }); await done(); }} />;
    // Pré-rempli avec l'année portée par le N° FP lui-même (FP/AAAA/N) — jamais une année en dur.
    case "num-order-year": return <FieldFix label="Année PO" kind="number" placeholder="AAAA" initial={yearOfFp(item.fp) ? String(yearOfFp(item.fp)) : undefined} save={async (v) => { const y = Math.trunc(Number(v)); if (!(y >= 2000)) throw new Error("année invalide"); await patchOrder({ fp: item.fp!, yearPo: y }); await done(); }} />;
    // « Projet ClickUp clôturé mais RAF non nul » : l'action attendue est de SOLDER — un clic, ici.
    // fmtFull (chaîne) et PAS money() (JSX) dans le gabarit du label : interpolé dans un template literal,
    // money() affichait « [object Object] » (piège documenté — audit Admin).
    case "raf-order-zero": return (
      <Busy variant="ghost" label={`Solder le RAF${(item.raf || 0) > 0 ? ` (${fmtFull(item.raf!)} → 0)` : ""}`} okMsg="RAF soldé (recalcul lancé)" errMsg="Correction refusée"
        fn={async () => { if (!item.fp) throw new Error("N° FP manquant"); await patchOrder({ fp: item.fp, raf: 0 }); await done(); }} />);
    case "text-order-client": return <FieldFix label="Client" placeholder="Client" save={async (v) => { if (!v.trim()) throw new Error("client requis"); await patchOrder({ fp: item.fp!, client: v.trim() }); await done(); }} />;
    case "text-order-am": return <FieldFix label="Commercial (AM)" placeholder="Commercial" save={async (v) => { if (!v.trim()) throw new Error("AM requis"); await patchOrder({ fp: item.fp!, am: v.trim() }); await done(); }} />;
    case "fp-opp": return <FieldFix label="N° FP" placeholder="FP/2026/…" save={async (v) => { if (!v.trim()) throw new Error("N° FP requis"); await patchOpportunity({ id: item.id!, fp: v.trim() }); await done(); }} />;
    case "date-opp": return <DateFix save={async (v) => { await patchOpportunity({ id: item.id!, closingDate: v }); await done(); }} />;
    case "num-opp-amount": return <FieldFix label="Montant" kind="number" placeholder="montant" initial={item.rec?.field === "amount" && item.rec.value != null ? String(item.rec.value) : undefined} save={async (v) => { const n = parseAmt(v); if (!(n > 0)) throw new Error("montant > 0"); await patchOpportunity({ id: item.id!, amount: n }); await done(); }} />;
    case "fp-bc": return <FieldFix label="N° FP" placeholder="FP/2026/…" save={async (v) => { if (!v.trim()) throw new Error("N° FP requis"); await patchBcLine({ id: item.id!, fp: v.trim() }); await done(); }} />;
    case "text-bc-supplier": return <FieldFix label="Fournisseur" placeholder="Fournisseur" save={async (v) => { if (!v.trim()) throw new Error("fournisseur requis"); await patchBcLine({ id: item.id!, supplier: v.trim() }); await done(); }} />;
    case "amount-bc": return <BcConvertFix item={item} onDone={done} />;
    case "num-sheet-sale": return <FieldFix label="Prix de vente" kind="number" placeholder="vente HT" initial={item.rec?.field === "saleTotal" && item.rec.value != null ? String(item.rec.value) : undefined} save={async (v) => { const n = parseAmt(v); if (!(n > 0)) throw new Error("montant > 0"); await patchProjectSheet({ fp: item.fp!, saleTotal: n }); await done(); }} />;
    case "reconcile-pnl": return (
      <span className="inline-flex items-center gap-2 flex-wrap">
        <Busy variant="ghost" label="Inscrire au P&L" okMsg="Commande créée (recalcul lancé)" errMsg="Création refusée"
          fn={async () => { if (!item.fp) throw new Error("N° FP manquant"); if (!((item.amount || 0) > 0)) throw new Error("montant de l'opp manquant"); await createOrder({ fp: item.fp, cas: item.amount!, client: item.client, am: item.am, designation: item.designation }); await done(); }} />
        <span className="text-faint text-[11px]">ou « Dossier client » (réconcilier vers un FP existant)</span>
      </span>);
    default: return <span className="text-faint text-[11px]">correction à la source</span>;
  }
}

// ACTIONS DE LIGNE par entité (colonne « Actions ») — écritures gouvernées par le module de la donnée
// (caps) ; « modifier »/« requalifier » ouvrent la modale (édition remontée au bloc via onEdit) ; « ouvrir »
// renvoie à l'écran source pré-filtré (canGo).
function RowActions({ item, ent, kind, module, caps, onDone, onEdit }: { item: CorrectionItem; ent?: FixEnt; kind: string; module?: string; caps: Record<"import" | "pipeline" | "bc" | "rentabilite", boolean>; onDone: () => Promise<void>; onEdit: () => void }) {
  const { go, canGo } = useNav();
  const done = () => onDone();
  if (!(ent || kind === "nav")) return <span className="text-faint text-[11px]">—</span>;
  const ref = item.numero || item.fp || item.bcNumber || item.client || "—";
  const affaire = item.designation || item.affaire || "";
  const navModule = ent ? ENT_MODULE[ent] : module;
  const navSearch = ent === "invoice" ? (item.numero || item.fp || "") : ent === "bc" ? (item.bcNumber || item.fp || "") : (item.fp || item.client || "");
  return (
    <span className="inline-flex items-center gap-1.5 flex-wrap justify-end">
      {ent === "order" && item.fp && caps.import && (
        <>
          <button type="button" className="text-gold hover:underline text-[11px]" onClick={onEdit} title="Corriger la commande (année, client, AM, CAS, RAF) sans quitter le Centre">modifier</button>
          <DangerBtn label="Annuler" okMsg="Commande annulée (recalcul lancé)" errMsg="Annulation refusée"
            confirm={`Annuler la commande ${item.fp}${item.client ? ` (${item.client})` : ""} ? Elle sort du carnet et du P&L. Overlay non destructif : rétablissable depuis Commandes → Annulées, et il survit aux ré-imports.`}
            fn={async () => { await setCancellation("orders", fpDocId(item.fp!), true, { label: affaire || undefined, client: item.client }); await done(); }} />
        </>
      )}
      {ent === "opp" && item.id && caps.pipeline && (
        <button type="button" className="text-gold hover:underline text-[11px]" onClick={onEdit} title="Requalifier (perdue / suspendue / annulée) ou corriger l'opportunité sans quitter le Centre">requalifier</button>
      )}
      {ent === "invoice" && item.id && caps.import && (
        <DangerBtn label="Annuler" okMsg="Facture annulée (recalcul lancé)" errMsg="Annulation refusée"
          confirm={`Annuler la facture ${item.numero || item.id}${item.client ? ` (${item.client})` : ""} ? Elle sort du CA facturé et du cash. Overlay non destructif : rétablissable depuis Factures → Annulées.`}
          fn={async () => { await setCancellation("invoices", item.id!, true, { label: item.numero, client: item.client }); await done(); }} />
      )}
      {navModule && canGo(navModule) && (
        <button type="button" className="text-faint hover:underline text-[11px]" onClick={() => go(navModule, { search: navSearch || ref })} title="Ouvrir l'écran source pré-filtré">ouvrir</button>
      )}
    </span>
  );
}

// Bloc d'un type d'anomalie : entête (sévérité, libellé, compte) repliable → lignes corrigeables.
// Clé stable d'un enregistrement — MÊME priorité que le serveur (domain/aiCorrection.refOf : id d'abord)
// pour apparier les propositions IA (indexées par « ref ») aux lignes affichées.
const refKeyOf = (it: CorrectionItem) => String(it.id || it.numero || it.fp || it.bcNumber || it.client || "");
// Seuil de confiance pour l'application EN LOT : on n'auto-applique que les propositions très fiables ;
// en dessous, elles restent visibles pour un arbitrage ligne à ligne. Réglé prudent (l'IA propose).
const AI_BULK_CONF = 0.85;
// Bilan d'une analyse IA d'un bloc (propositions actionnables, vérifiées, lot tronqué).
type BucketAiInfo = { actionable: number; truncated: boolean; verified: boolean; verifiedCount: number };
// Une proposition est APPLICABLE EN LOT si elle est actionnable ET fiable : vérifiée quand la relecture
// adverse a tourné, sinon confiance ≥ seuil. Prédicat PARTAGÉ par le lot d'un bloc et l'application globale.
const aiBulkEligible = (s: AiSuggestion | undefined, verifRan: boolean): boolean =>
  !!s && s.action !== "review" && (verifRan ? !!s.verified : s.confidence >= AI_BULK_CONF);

// `sugg`/`aiInfo` sont REMONTÉS au CorrectionCenter (clés par type d'anomalie) : une seule commande « Analyser
// tout à l'IA » alimente tous les blocs, et « Appliquer toutes les vérifiées » agit sur toute la base.
function CorrectionBlock({ bucket, open, onToggle, canFix, caps, onDone, sugg, setSugg, aiInfo, setAiInfo }: { bucket: CorrectionBucket; open: boolean; onToggle: () => void; canFix: boolean; caps: Record<"import" | "pipeline" | "bc" | "rentabilite", boolean>; onDone: () => Promise<void>; sugg: Record<string, AiSuggestion>; setSugg: Dispatch<SetStateAction<Record<string, AiSuggestion>>>; aiInfo: BucketAiInfo | null; setAiInfo: (v: BucketAiInfo | null) => void }) {
  const cfg = FIX[bucket.type] || { kind: "" };
  const [confirmBulk, setConfirmBulk] = useState(false);
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
  const bulkItems = () => bucket.items.filter((it) => aiBulkEligible(sugg[refKeyOf(it)], verifRan));
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
  // Édition (modale) REMONTÉE au bloc : le tableau rend N lignes ; une seule modale, pilotée par la ligne
  // sur laquelle on a cliqué « modifier »/« requalifier ».
  const [editItem, setEditItem] = useState<CorrectionItem | null>(null);
  const displayRef = (it: CorrectionItem) => String(it.numero || it.fp || it.bcNumber || it.client || "—");
  const amtOf = (it: CorrectionItem) => it.amount ?? it.cas ?? it.amountHt ?? it.amountXof ?? it.saleTotal ?? 0;
  const dismiss = (it: CorrectionItem) => setSugg((m) => { const n = { ...m }; delete n[refKeyOf(it)]; return n; });
  // COLONNES ALIGNÉES (fini le flex-wrap en zig-zag) : essentiels en ligne (Réf, Client, Montant, Correction,
  // Actions, IA), contexte + reco + justif IA repliés dans le détail dépliable. Les colonnes d'action (entête
  // vide) restent toujours en ligne (splitCols). Recherche/tri/pagination fournis par <Table>.
  const cols: Col[] = [
    colText("Réf", (it: CorrectionItem) => <span className="tabnum text-faint">{displayRef(it)}</span>, displayRef),
    colText("Client", (it: CorrectionItem) => { const r = displayRef(it); return it.client && it.client !== r ? it.client : <span className="text-faint">—</span>; }, (it: CorrectionItem) => it.client || ""),
    det(colText("Affaire", (it: CorrectionItem) => { const a = it.designation || it.affaire; return a ? <span className="truncate max-w-[30ch] inline-block align-bottom" title={a}>{a}</span> : <span className="text-faint">—</span>; }, (it: CorrectionItem) => it.designation || it.affaire || "")),
    colNum("Montant", (it: CorrectionItem) => { const a = amtOf(it); return a > 0 ? money(a) : <span className="text-faint">—</span>; }, amtOf),
    ...(cfg.ent === "opp" ? [det(colText("Étape", (it: CorrectionItem) => it.stage != null ? (it.stageLabel || STAGE_SHORT[it.stage] || `étape ${it.stage}`) : "—", (it: CorrectionItem) => it.stage ?? 0))] : []),
    det(colText("AM", (it: CorrectionItem) => it.am || "—", (it: CorrectionItem) => it.am || "")),
    det(colText("Date", (it: CorrectionItem) => { const w = it.closingDate || it.date; return w ? <span className="tabnum">{frDate(w)}</span> : "—"; }, (it: CorrectionItem) => it.closingDate || it.date || "")),
    det(colText("Source", (it: CorrectionItem) => it.source ? (SRC_LABEL[it.source] || it.source) : "—", (it: CorrectionItem) => it.source || "")),
    det(colText("Recommandation", (it: CorrectionItem) => it.rec ? <RecInline rec={it.rec} /> : <span className="text-faint">—</span>)),
    det(colText("Proposition IA", (it: CorrectionItem) => { const s = sugg[refKeyOf(it)]; return s ? <AiDetail s={s} /> : <span className="text-faint">—</span>; })),
    colText("", (it: CorrectionItem) => <FixControl item={it} kind={cfg.kind} canFix={canFix} onDone={onDone} />),
    colText("", (it: CorrectionItem) => <RowActions item={it} ent={cfg.ent} kind={cfg.kind} module={cfg.module} caps={caps} onDone={onDone} onEdit={() => setEditItem(it)} />),
    colText("", (it: CorrectionItem) => { const s = sugg[refKeyOf(it)]; return s ? <AiInline item={it} s={s} canFix={canFix} onDone={onDone} onDismiss={() => dismiss(it)} /> : null; }),
  ];
  return (
    <div className="border-t border-hair pt-2">
      <div className="w-full flex items-center gap-2 text-[13px] py-0.5">
        <button type="button" onClick={onToggle} className="flex items-center gap-2 text-left grow min-w-0">
          <Badge tone={CORR_SEV[bucket.severity]}>{bucket.count}</Badge>
          <span className="text-ink truncate">{bucket.label}</span>
        </button>
        {canFix && cfg.kind !== "nav" && (
          <Busy variant="ghost" label="IA" okMsg="Propositions IA prêtes" errMsg="Analyse IA refusée" fn={runAi} />
        )}
        {bulkGen && !confirmBulk && (
          <button type="button" className="text-gold hover:underline text-[11px] shrink-0" onClick={() => setConfirmBulk(true)} title="Créer commande + opp gagnée pour toutes les factures non rattachées (FP canonique)">tout générer</button>
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
        <div className="mt-2 flex flex-col gap-2 pl-1">
          {aiInfo && (
            <div className="flex items-center gap-2 flex-wrap text-[11px] text-faint">
              <span>
                IA : {aiInfo.actionable} proposition{aiInfo.actionable > 1 ? "s" : ""}
                {aiInfo.verified ? <> — <b className="text-emerald">{aiInfo.verifiedCount} vérifiée{aiInfo.verifiedCount > 1 ? "s" : ""}</b> par relecture adverse</> : <> applicable{aiInfo.actionable > 1 ? "s" : ""}</>}. <b>Vérifiez</b> puis « Appliquer » (écriture gouvernée). Dépliez une ligne (⌄) pour voir la proposition et sa justification.
                {aiInfo.truncated && " Lot tronqué (60 max) — relancez après correction."}
              </span>
              {canFix && bulkItems().length > 0 && (
                <Busy variant="ghost" label={`Appliquer les ${verifRan ? "vérifiées" : "fiables"} (${bulkItems().length})`}
                  okMsg="Propositions appliquées" errMsg="Application refusée" fn={applyBulk} />
              )}
            </div>
          )}
          <Table columns={cols} rows={bucket.items} colsKey={`corr-${bucket.type}`} rowKey={refKeyOf} pageSize={10} empty="Aucune ligne à corriger."
            searchKeys={[displayRef, (it: CorrectionItem) => it.client || "", (it: CorrectionItem) => it.designation || it.affaire || ""]} />
          {bucket.count > bucket.items.length && (
            <div className="text-[11px] text-faint">… {bucket.count - bucket.items.length} de plus — corrigez ceux-ci puis « Rafraîchir ».</div>
          )}
          {editItem && cfg.ent === "order" && <OrderFixModal item={editItem} onClose={() => setEditItem(null)} onDone={onDone} />}
          {editItem && cfg.ent === "opp" && <OppFixModal item={editItem} onClose={() => setEditItem(null)} onDone={onDone} />}
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

function CorrectionCenter({ isDirection }: { isDirection: boolean }) {
  const [buckets, setBuckets] = useState<CorrectionBucket[] | null>(null);
  const [plan, setPlan] = useState<RemediationPlan | null>(null);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [scoped, setScoped] = useState(false); // assiette opps CADRÉE par visibilité (OWD privé, non-admin)
  // Propositions IA REMONTÉES ici, clés par type d'anomalie (chaque bloc reçoit sa tranche). Permet l'analyse
  // et l'application IA à l'échelle de TOUTE la base (« effort minimal ») en plus du bloc par bloc.
  const [suggByType, setSuggByType] = useState<Record<string, Record<string, AiSuggestion>>>({});
  const [aiInfoByType, setAiInfoByType] = useState<Record<string, BucketAiInfo>>({});
  const [aiRunning, setAiRunning] = useState(false);
  const toast = useToast();
  const caps = { import: useCanImport(), pipeline: useCan("pipeline") === "write", bc: useCan("bc") === "write", rentabilite: useCan("rentabilite") === "write" };
  const load = async () => { const r = await correctionQueue(); setBuckets(r.buckets); setPlan(r.plan || null); setScoped(!!r.scoped); };
  const canFixBucket = (b: CorrectionBucket) => { const cap = FIX[b.type]?.cap; return cap ? !!caps[cap] : true; };
  // Setter par type, style dispatch (accepte valeur ou updater) — donné à chaque bloc pour piloter SA tranche.
  const setSuggFor = (type: string): Dispatch<SetStateAction<Record<string, AiSuggestion>>> => (v) =>
    setSuggByType((all) => ({ ...all, [type]: typeof v === "function" ? (v as (m: Record<string, AiSuggestion>) => Record<string, AiSuggestion>)(all[type] || {}) : v }));
  const setAiInfoFor = (type: string) => (v: BucketAiInfo | null) =>
    setAiInfoByType((all) => { const n = { ...all }; if (v) n[type] = v; else delete n[type]; return n; });
  // Blocs éligibles à l'IA : ceux dont la correction se fait ICI (pas « nav »/« dedupe ») et dans les droits.
  const aiBuckets = () => (buckets || []).filter((b) => { const k = FIX[b.type]?.kind; return k !== "nav" && k !== "dedupe" && canFixBucket(b); });
  // ANALYSE IA GLOBALE : lance l'assistant sur CHAQUE bloc éligible (séquentiel — chaque appel est un tour LLM
  // + vérification adverse), alimente `suggByType`. Une seule commande pour toute la base.
  const analyzeAll = async () => {
    setAiRunning(true);
    let totalActionable = 0, totalVerified = 0, blocks = 0;
    try {
      for (const b of aiBuckets()) {
        const r = await aiSuggestCorrections(b.type, b.items);
        const map: Record<string, AiSuggestion> = {};
        for (const s of r.suggestions) map[s.ref] = s;
        setSuggByType((all) => ({ ...all, [b.type]: map }));
        setAiInfoByType((all) => ({ ...all, [b.type]: { actionable: r.suggestions.filter((s) => s.action !== "review").length, truncated: r.truncated, verified: !!r.verified, verifiedCount: r.verifiedCount || 0 } }));
        totalActionable += r.suggestions.filter((s) => s.action !== "review").length;
        totalVerified += r.verifiedCount || 0;
        blocks++;
      }
      toast(`IA : ${totalActionable} proposition${totalActionable > 1 ? "s" : ""} sur ${blocks} bloc${blocks > 1 ? "s" : ""}${totalVerified ? ` — ${totalVerified} vérifiée${totalVerified > 1 ? "s" : ""}` : ""}. Vérifiez puis appliquez.`, "ok");
    } catch { toast("Analyse IA globale refusée", "err"); }
    finally { setAiRunning(false); }
  };
  // Toutes les propositions APPLICABLES (fiables/vérifiées) à travers TOUS les blocs — mêmes critères que le
  // lot d'un bloc (aiBulkEligible). Sert au compteur du bouton global et à l'application.
  const globalTargets = () => (buckets || []).flatMap((b) => {
    const map = suggByType[b.type]; if (!map) return [];
    const verifRan = !!aiInfoByType[b.type]?.verified;
    return b.items.filter((it) => aiBulkEligible(map[refKeyOf(it)], verifRan)).map((it) => ({ it, s: map[refKeyOf(it)]! }));
  });
  // APPLIQUE toute la base : chaque proposition passe par SON écriture gouvernée (RBAC/audit/recalcul inchangés),
  // séquentiellement, tolérant aux échecs par ligne. Un seul recalcul final (load).
  const applyAll = async () => {
    const targets = globalTargets();
    let ok = 0, fails = 0;
    for (const { it, s } of targets) { try { await applyAiSuggestion(it, s); ok++; } catch { fails++; } }
    await load();
    toast(`${ok} correction${ok > 1 ? "s" : ""} IA appliquée${ok > 1 ? "s" : ""} sur toute la base${fails ? ` — ${fails} refusée${fails > 1 ? "s" : ""} (à traiter à la main)` : ""}`, fails ? "err" : "ok");
  };
  const globalCount = globalTargets().length;
  return (
    <Card title="Centre de correction" actions={
      <div className="flex items-center gap-2">
        {buckets && buckets.length > 0 && <button type="button" onClick={() => exportBucketsCsv(buckets)} className="btn-ghost !px-2.5 !py-1 text-xs">Exporter (CSV)</button>}
        <Busy variant="ghost" label={buckets ? "Rafraîchir" : "Analyser"} okMsg="Analyse terminée" errMsg="Analyse refusée" fn={load} />
      </div>
    }>
      <div className="flex flex-col gap-2">
        {buckets == null && <Tip>Point <b>unique</b> des anomalies : liste, <b>anomalie par anomalie</b>, les enregistrements concrets à corriger — avec le contexte de l'affaire, l'éditeur idoine <b>directement ici</b> (N° FP, année, montant, fournisseur, conversion devise…), les <b>actions de ligne</b> (modifier, requalifier, annuler, ouvrir), une <b>recommandation chiffrée</b> quand elle est déductible, et l'<b>assistant IA</b>. Cliquez <b>Analyser</b>.</Tip>}
        {scoped && buckets && (
          <div className="flex items-center gap-2 text-[12px] text-muted border border-hair rounded-lg px-3 py-1.5">
            <Badge tone="gold">périmètre</Badge>
            <span>Sous confidentialité par enregistrement (OWD privé), les anomalies d'<b>opportunités</b> listées ici sont cadrées sur votre périmètre (propriétaire + hiérarchie). Le total du bandeau « Qualité des données » ci-dessus est global — d'où un écart normal entre les deux.</span>
          </div>
        )}
        {buckets && buckets.length === 0 && <div className="text-[13px] text-emerald">Aucune anomalie à corriger — base saine.</div>}
        {plan && buckets && buckets.length > 0 && <RemediationPlanCard plan={plan} onGo={(t) => setOpen((o) => ({ ...o, [t]: true }))} />}
        {/* IA GLOBALE — « effort minimal » : analyser toute la base d'un coup, puis appliquer toutes les
            propositions fiables/vérifiées en un clic. Chaque écriture reste GOUVERNÉE (mêmes callables, droits,
            audit, recalcul). L'IA propose, l'humain déclenche. */}
        {buckets && buckets.length > 0 && aiBuckets().length > 0 && (
          <div className="flex items-center gap-2 flex-wrap rounded-md border border-gold/25 bg-gold/5 px-3 py-2">
            <span className="text-[12px] font-medium text-ink">Assistant IA — toute la base</span>
            <Busy variant="ghost" label={aiRunning ? "Analyse en cours…" : "Analyser tout à l'IA"} okMsg="Analyse IA terminée" errMsg="Analyse IA refusée" fn={analyzeAll} />
            {globalCount > 0 && (
              <Busy label={`Appliquer toutes les vérifiées (${globalCount})`} okMsg="Propositions appliquées (recalcul lancé)" errMsg="Application refusée" fn={applyAll} />
            )}
            <span className="text-[11px] text-faint grow min-w-[12ch]">Propose une correction justifiée par anomalie sur tous les blocs, puis vérifie par relecture adverse ; l'application n'exécute que les propositions vérifiées (fiables). Dépliez une ligne pour voir chaque proposition.</span>
          </div>
        )}
        {buckets && buckets.map((b) => (
          <CorrectionBlock key={b.type} bucket={b} open={!!open[b.type]} onToggle={() => setOpen((o) => ({ ...o, [b.type]: !o[b.type] }))} canFix={canFixBucket(b)} caps={caps} onDone={load}
            sugg={suggByType[b.type] || {}} setSugg={setSuggFor(b.type)} aiInfo={aiInfoByType[b.type] || null} setAiInfo={setAiInfoFor(b.type)} />
        ))}
        {buckets && buckets.length > 0 && <Tip>Chaque correction appelle le service gouverné par le <b>module de la donnée</b> (droits respectés) et relance le recalcul ; l'anomalie se résorbe après « Rafraîchir ». « <b>modifier</b> » / « <b>requalifier</b> » ouvrent la modale de correction ici même ; « <b>annuler</b> » sort l'enregistrement des chiffres (overlay rétablissable) ; « <b>ouvrir</b> » renvoie à l'écran source pré-filtré.</Tip>}
        {/* OUTILS DE RAPPROCHEMENT — intégrés au point unique (plus de cartes séparées sur la page). */}
        <ClientReconcileSection />
        <FpReconcileSection />
        <DcReconcileSection />
        {isDirection && <DedupeSection />}
      </div>
    </Card>
  );
}

// RÉCONCILIATION FP — une même commande peut être déjà au P&L sous un N° FP différent de celui de
// l'opp gagnée (le FP P&L, lié à la facturation, fait autorité). On déclare l'équivalence
// `source → cible P&L` : à chaque recalcul, les lignes portant la source sont ré-étiquetées vers la
// cible EN MÉMOIRE (overlay config/fpAliases, non destructif → survit aux ré-imports delta, comme les
// alias clients). La cible reste seule au P&L ; la source cesse d'apparaître comme une commande à part.
function FpReconcileSection() {
  const { data } = useDocData<{ map?: Record<string, string> }>("config/fpAliases");
  const map = data?.map || {};
  const entries = Object.entries(map);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const ready = from.trim() && to.trim() && from.trim() !== to.trim();
  return (
    <CorrSection title="Réconciliation N° FP (opp gagnée ↔ P&L)" hint={entries.length ? `${entries.length} alias` : undefined}>
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
    </CorrSection>
  );
}

// RAPPROCHEMENT DC → N° FP (BC fournisseur Odoo, ADR-054) — quand Odoo envoie un BC dont le N° FP est
// absent/placeholder mais qui porte un DC (identifiant propre du BC), on déclare l'équivalence DC → affaire.
// Le webhook entrant rattache alors le BC à ce N° FP (overlay config/dcAliases, non destructif, survit aux
// ré-imports). Même esprit que la réconciliation N° FP, keyé par le DC. Le cas NORMAL (Odoo envoie FP+DC)
// n'a pas besoin de cet overlay : le FP explicite prime toujours.
function DcReconcileSection() {
  const { data } = useDocData<{ map?: Record<string, string> }>("config/dcAliases");
  const map = data?.map || {};
  const entries = Object.entries(map);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const ready = from.trim() && to.trim();
  // SEED par fichier (table FP–DC, deux colonnes ordre libre) : aperçu d'abord, application ensuite.
  const [seedFile, setSeedFile] = useState<File | null>(null);
  const [seedPreview, setSeedPreview] = useState<DcMapImportResult | null>(null);
  return (
    <CorrSection title="Rapprochement DC → N° FP (BC fournisseur Odoo)" hint={entries.length ? `${entries.length} rapprochements` : undefined}>
      <div className="flex flex-col gap-3">
        <div className="flex items-end gap-2 flex-wrap text-[13px]">
          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-muted">DC (identifiant du BC Odoo)</span>
            <input className="field w-40 !py-1" aria-label="DC identifiant du BC Odoo" placeholder="DC…" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <span className="text-faint pb-1.5">→</span>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-muted">N° FP de l'affaire</span>
            <input className="field w-40 !py-1" aria-label="N° FP de l'affaire" placeholder="FP/2026/…" value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
          {ready && (
            <Busy variant="ghost" label="Rapprocher" okMsg="Rapprochement enregistré (recalcul lancé)" errMsg="Rapprochement refusé"
              fn={async () => { await setDcAlias(from.trim(), to.trim()); setFrom(""); setTo(""); }} />
          )}
        </div>
        {/* SEED INITIAL — import de la table de correspondance FP–DC exportée d'Odoo (le DC y est généré
            depuis le FP : la correspondance existe à la source). Aperçu (dry-run) puis application ;
            un rapprochement DÉJÀ posé prime toujours sur le fichier (conflits signalés, jamais écrasés). */}
        <div className="flex flex-col gap-2 border-t border-hair pt-2.5">
          <div className="flex items-center gap-2 flex-wrap text-[12px]">
            <span className="text-[11px] text-muted">Seed initial — table FP–DC (.xlsx/.csv, deux colonnes, ordre libre)</span>
            <input type="file" accept=".xlsx,.csv" aria-label="Table de correspondance FP–DC" className="text-[12px]"
              onChange={(e) => { setSeedFile(e.target.files?.[0] || null); setSeedPreview(null); }} />
            {seedFile && !seedPreview && (
              <Busy variant="ghost" label="Aperçu" okMsg="Aperçu prêt — vérifiez puis appliquez" errMsg="Fichier illisible"
                fn={async () => { setSeedPreview(await importDcAliases(seedFile, false)); }} />
            )}
          </div>
          {seedPreview && (
            <div className="flex flex-col gap-1 text-[12px]">
              <div className="flex items-center gap-2 flex-wrap">
                <Badge tone={seedPreview.toAdd > 0 ? "emerald" : "steel"}>{seedPreview.toAdd} à ajouter</Badge>
                {seedPreview.unchanged > 0 && <Badge tone="steel">{seedPreview.unchanged} déjà en place</Badge>}
                {seedPreview.conflicts > 0 && <Badge tone="gold">{seedPreview.conflicts} conflit(s) — existant conservé</Badge>}
                {seedPreview.skipped > 0 && <Badge tone="steel">{seedPreview.skipped} écartée(s)</Badge>}
                {seedPreview.truncated && <Badge tone="clay">fichier tronqué (5 000 lignes max)</Badge>}
                {seedPreview.toAdd > 0 && seedFile && (
                  <Busy variant="ghost" label={`Appliquer les ${seedPreview.toAdd}`} errMsg="Import refusé"
                    okMsg={(r: DcMapImportResult) => `Table FP–DC importée (recalcul lancé)${r?.backfilled ? ` — ${r.backfilled} BC rattaché(s)` : ""}${r?.backfillTruncated ? " — rattachement partiel (volume) : ré-appliquez le seed pour le reliquat" : ""}`}
                    fn={async () => { const r = await importDcAliases(seedFile, true); setSeedFile(null); setSeedPreview(null); return r; }} />
                )}
                <button type="button" className="text-faint hover:underline text-[11px]" onClick={() => { setSeedFile(null); setSeedPreview(null); }}>annuler</button>
              </div>
              {seedPreview.sample.length > 0 && (
                <div className="text-[11px] text-faint">Ex. : {seedPreview.sample.slice(0, 4).map((s) => `${s.dc} → ${s.fp}`).join(" · ")}{seedPreview.toAdd > 4 ? " · …" : ""}</div>
              )}
              {seedPreview.conflictsDetail.slice(0, 4).map((c) => (
                <div key={c.dc} className="text-[11px] text-gold">Conflit {c.dc} : conservé {c.existing} (fichier : {c.incoming}) — modifiez à la main si le fichier a raison.</div>
              ))}
              {seedPreview.skippedDetail.slice(0, 3).map((s, i) => (
                <div key={i} className="text-[11px] text-faint">Écartée : {s.reason} — {s.detail}</div>
              ))}
            </div>
          )}
        </div>
        {entries.length > 0 && (
          <Table columns={[
            colText("DC", (r: [string, string]) => <span className="tabnum text-faint">{r[0]}</span>, (r: [string, string]) => r[0]),
            colText("rattaché à (N° FP)", (r: [string, string]) => <span className="tabnum text-ink">{r[1]}</span>, (r: [string, string]) => r[1]),
            colText("", (r: [string, string]) => (
              <DangerBtn label="Retirer" okMsg="Rapprochement retiré (recalcul lancé)" errMsg="Retrait refusé"
                confirm={`Retirer le rapprochement ${r[0]} → ${r[1]} ? Un BC Odoo portant ce DC sans N° FP ne sera plus rattaché à cette affaire.`}
                fn={() => setDcAlias(r[0], "")} />
            )),
          ]} rows={entries} />
        )}
        <Tip>Filet pour les BC fournisseurs <b>Odoo</b> : quand un BC arrive avec un <b>DC</b> mais sans N° FP exploitable, ce rapprochement le rattache à l'affaire. Le cas normal (Odoo envoie FP <i>et</i> DC) n'en a pas besoin — le N° FP fourni fait foi. Dans Odoo, le DC est <b>généré depuis le FP</b> (« Générer DC ») puis porte <b>toutes les dépenses du projet</b> (BC, décaissements, astreintes…) : le <b>seed initial</b> ci-dessus importe la table de correspondance d'un coup pour l'historique. Overlay non destructif : il survit aux ré-imports. Pour <b>récupérer un BC tout de suite</b>, faites-le <b>renvoyer côté Odoo</b> via le webhook entrant — Server Action unitaire par DC ou backfill en masse (<code>docs/ODOO_WEBHOOK.md</code> §4ter/§4bis, idempotent) ; l'arrivée se vérifie dans <b>Admin → Intégration</b> (« dernier envoi reçu »).</Tip>
      </div>
    </CorrSection>
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

function ClientReconcileSection() {
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
    <CorrSection title="Dossier client — rapprochement Opp / Commande / Facture">
      <div className="flex items-center gap-2 flex-wrap">
        <input className="field w-44 !py-1 text-xs" aria-label="Ouvrir le dossier d'un client" placeholder="Nom du client…"
          value={q} onChange={(e) => setQ(e.target.value)} />
        {q.trim() && <Busy variant="ghost" label="Ouvrir" okMsg="Dossier chargé" errMsg="Chargement refusé" fn={() => openClient(q.trim())} />}
        <Busy variant="ghost" label="Clients à rapprocher" okMsg="Analyse terminée" errMsg="Analyse refusée" fn={refreshList} />
      </div>
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
          ) : <div className="text-[13px] text-muted">Aucun client à rapprocher — tous les N° FP concordent.</div>
        )}
        {scanned && <div className="text-[11px] text-faint">Analyse : {scanned.orders} commandes · {scanned.invoices} factures · {scanned.opps} opportunités.</div>}

        {/* Détail d'un client : propositions actionnables + vue alignée par N° FP. */}
        {dossier && (
          <div className="flex flex-col gap-3 border-t border-hair pt-3">
            <div className="text-sm font-medium text-ink">{dossier.client}</div>

            {dossier.suggestions.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <div className="text-[11px] text-muted uppercase tracking-wide">Réconciliations proposées</div>
                <Table columns={[
                  colText("N° FP source", (s: any) => <span className="tabnum text-faint">{s.from}</span>, (s: any) => s.from),
                  colText("→ cible (P&L)", (s: any) => <span className="tabnum text-ink">{s.to}</span>, (s: any) => s.to),
                  colText("Type", (s: any) => <Badge tone={s.targetHasInvoice ? "emerald" : "steel"}>{s.targetHasInvoice ? "FP facture" : "FP commande"}</Badge>),
                  colText("Signal", (s: any) => RECON_CONF[s.confidence] ? <Badge tone={RECON_CONF[s.confidence].tone}>{RECON_CONF[s.confidence].label}</Badge> : <span className="text-faint">—</span>),
                  det(colText("Motif", (s: any) => RECON_REASON[s.reason] || s.reason)),
                  colText("", (s: any) => (
                    <Busy variant="ghost" label="Réconcilier" okMsg="Réconciliation enregistrée (recalcul lancé)" errMsg="Réconciliation refusée"
                      fn={async () => { await setFpAlias(s.from, s.to); await openClient(dossier.client); await refreshList(); }} />
                  )),
                ]} rows={dossier.suggestions} />
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
    </CorrSection>
  );
}

// Entête PREMIUM du cockpit « Qualité & Correction » : score (anneau), anomalies, volumes ingérés et
// tendance 30 j — réunit ce qu'affichait l'ancien écran « Qualité des données » (Référentiels), désormais
// intégré ici (point unique). Bande gradient discrète, thème-aware via les tokens.
function QualityHero({ data, days, loading }: { data?: DataQualitySummary | null; days: { score: number }[]; loading?: boolean }) {
  // Garde de chargement : sans elle, `score ?? 1` affichait « 100 % · 0 anomalie » (base saine optimiste
  // et fausse) tant que le summary n'était pas résolu, puis basculait sur le vrai score — flash trompeur.
  if (loading && !data) return (
    <div className="relative overflow-hidden rounded-2xl border border-hair bg-gradient-to-br from-panel2/50 to-panel px-5 py-4">
      <div className="h-16 animate-pulse rounded-xl bg-hair/40" />
    </div>
  );
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
  const { data, loading: dqLoading } = useDocData<DataQualitySummary>("summaries/dataQuality");
  const { data: qh } = useDocData<QualityHistory>("summaries/qualityHistory");
  const canImport = useCanImport();
  const canBc = useCan("bc") !== "none";
  const canPipe = useCan("pipeline") !== "none";
  const isDirection = useClaims().role === "direction"; // le dédoublonnage (callable) est direction-only
  // Collections chargées seulement si le rôle a l'accès (chaque purge est gouvernée par son module).
  // NB : plus de chargement des `invoices` ici — les factures non rattachées sont traitées au Centre de
  // correction (prédicat FP CANONIQUE côté serveur), pas via le drapeau `linked` (jamais persisté à
  // l'ingestion → obsolète : il flaguait à tort quasi toutes les factures). Alignement des vues qualité.
  const { rows: bcLines, truncated: bcTrunc } = useCollectionData<BcLine>(canBc ? "bcLines" : null);
  const oppScope = useRecordScope("opportunities"); // cadrage propriétaire+hiérarchie sous OWD « private »
  const { rows: opps, truncated: oppTrunc } = useCollectionData<Opportunity>(canPipe && oppScope.ready ? "opportunities" : null, oppScope.constraints, oppScope.scoped ? "s" : "");
  // Troncature SIGNALÉE (jamais silencieuse) : l'abonnement temps réel est plafonné (DEFAULT_SUB_CAP).
  // Au-delà, les compteurs de purge ci-dessous portent sur un sous-ensemble → on avertit plutôt que
  // de laisser croire la base entièrement balayée (cf. Qualité serveur = assiette complète).
  const purgeTrunc = bcTrunc || oppTrunc;

  // BC NON RÉPARABLES : ni FP, ni fournisseur, ni N° BC, ni montant XOF → ligne vide/fantôme.
  const junkBcIds = bcLines.filter((b) => b.id && !b.fp && !b.supplier && !b.bcNumber && !((b.amountXof || 0) > 0)).map((b) => b.id!) as string[];
  // Opportunités PERDUES (7) / ANNULÉES (9) : mortes. Purge OPTIONNELLE (retire de l'historique).
  const deadOppIds = opps.filter((o) => (o.stage === 7 || o.stage === 9) && o.id).map((o) => o.id!) as string[];
  const days = (qh?.days || []).slice(-30);
  return (
    <div className="flex flex-col gap-4">
      <QualityHero data={data} days={days} loading={dqLoading} />

      <Card title="Purge en lot">
        <div className="flex flex-col gap-2.5">
          {purgeTrunc && (
            <div className="flex items-center gap-2 text-[12px] text-clay border-b border-hair pb-2">
              <Badge tone="clay">volume &gt; plafond</Badge>
              <span>Les compteurs et listes de purge ci-dessous sont <b>partiels</b> (abonnement temps réel plafonné). Relancez après une première purge, ou passez par le Centre de correction (assiette complète, bornée côté serveur).</span>
            </div>
          )}
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

      {/* Point unique : les outils de rapprochement (Dossier client, réconciliations FP/DC) et les
          doublons vivent en SECTIONS dans le Centre de correction — plus de cartes séparées. */}
      {canImport && <CorrectionCenter isDirection={isDirection} />}

      {isDirection && <CleanupJournal />}
    </div>
  );
};
