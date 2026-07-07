// Helpers et primitives partagés par les modules (extraits de index.tsx pour le découpage).
import { useState, type ChangeEvent, type DragEvent, type ReactNode } from "react";
import { AlertTriangle, Upload, Filter, X, CheckCircle2, AlertCircle, Clock } from "lucide-react";
import { orderBy, limit } from "firebase/firestore";
import { useDocData, useCollectionData } from "../lib/hooks";
import { useNav } from "../lib/nav";
import { useFilters } from "../lib/filters";
import { useCanSeeMargin, useClaims, useCan } from "../lib/rbac";
import { relTime, ageDays } from "../lib/format";
import { STALE_RECOMPUTE_DAYS } from "../lib/thresholds";
export { relTime }; // ré-export (importé depuis "./_shared" par admin/overview)
import { T, fmt, pct } from "../design/tokens";
import { Card, Badge, EmptyState, cx, useToast } from "../design/components";
import { Select } from "../design/inputs";
import { callImportDelta, callReingest, type ImportDeltaResult } from "../lib/writes";
import type { AlertsSummary, AmsSummary, PmsSummary, EntitySummary, Objective, CommandesSummary, CommandeChunk, Order } from "../types";

// --- R/O (Réalisé / Objectif) — partagé par les vues qui pilotent un périmètre ---
// Normalisation de périmètre pour le rapprochement objectif ↔ entité : trim + majuscules + SANS
// accents (l'import conserve les accents des clés client, ex. « SOCIÉTÉ GÉNÉRALE » vs un objectif
// saisi « Societe Generale » — sans ceci le R/O par client ne se rattache jamais).
const upScope = (s?: string) => (s || "").trim().toUpperCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");

/** Badge R/O : vert si ≥ 100 %, or sinon ; « — » si pas de cible ou réalisé indisponible. */
export function roBadge(real: number | undefined, target: number | undefined) {
  if (!target || target <= 0 || real == null || !Number.isFinite(real)) return <span className="text-faint">—</span>;
  return <Badge tone={real / target >= 1 ? "emerald" : "gold"}>{pct(real / target)}</Badge>;
}

/** Teinte GRADUÉE d'un ratio d'atteinte (0..1) : vert ≥ 90 %, or ≥ 60 %, clay en-deçà. Rend la couleur
 *  des jauges d'atterrissage DYNAMIQUE — au lieu du binaire « écart < 0 → rouge » qui les laissait rouges
 *  presque toute l'année (l'objectif n'étant atteint qu'en fin d'exercice). Mêmes 3 paliers que la jauge
 *  Qualité (GOOD/FAIR). On grade sur le ratio AFFICHÉ par la jauge (taux d'atteinte projeté/objectif),
 *  pour que la couleur de l'arc suive son propre remplissage. */
export const ATTEINTE = { GOOD: 0.9, FAIR: 0.6 };
export function atteinteTone(ratio: number): string {
  const r = Number(ratio) || 0;
  return r >= ATTEINTE.GOOD ? T.emerald : r >= ATTEINTE.FAIR ? T.gold : T.clay;
}

/** Objectifs de l'année {fy} indexés par périmètre. `.get(scope, scopeValue)` → objectif ou undefined.
 *  Les objectifs étant ANNUELS, le R/O n'a de sens que si la période sélectionnée est cette année-là. */
export function useObjectives(fy: number | string | undefined) {
  const { rows } = useCollectionData<Objective>("objectives");
  const map = new Map<string, Objective>();
  for (const o of rows || []) {
    if (fy == null || String(o.fiscalYear) !== String(fy)) continue;
    map.set(`${o.scope || "global"}|${upScope(o.scopeValue) || "ALL"}`, o);
  }
  return { get: (scope: string, scopeValue?: string) => map.get(`${scope}|${upScope(scopeValue) || "ALL"}`) };
}

// Lignes de commandes matérialisées, LUES DEPUIS LES CHUNKS (commandesRows/{i}) pour s'affranchir
// de la limite Firestore ~1 Mio/doc. Fusionne les chunks (ordre stable), avec repli sur les lignes
// inline d'un ancien agrégat (transition avant le premier recompute chunké). count depuis la méta.
// Référentiels éditables (Admin) : liste des BU / des Project Managers, avec repli sur des valeurs
// par défaut si le référentiel n'est pas encore renseigné. Alimente filtres et sélecteurs.
export const DEFAULT_BU = ["ICT", "CLOUD", "FORMATION", "AUTRE"];
export function useRefList(kind: "businessUnits" | "projectManagers", fallback: string[] = []) {
  const { data } = useDocData<{ list?: string[] }>(`config/${kind}`);
  const list = (data?.list || []).filter(Boolean);
  return list.length ? list : fallback;
}
export const useBusinessUnits = () => useRefList("businessUnits", DEFAULT_BU);
export const useProjectManagers = () => useRefList("projectManagers", []);

export function useCommandesRows(enabled = true) {
  const canMargin = useCanSeeMargin();
  // enabled=false → aucun abonnement (name null) : la Vue d'ensemble / FP 360° ne chargent la liste
  // complète des commandes que lorsqu'elle est réellement nécessaire (filtre actif / recherche saisie).
  const { data: meta, loading: l1 } = useDocData<CommandesSummary>(enabled ? "summaries/commandes" : null);
  const { rows: chunks, loading: l2 } = useCollectionData<CommandeChunk>(enabled ? "commandesRows" : null, [orderBy("i", "asc")], "chunks");
  // Marge par ligne dans une collection SÉPARÉE (accès « Rentabilité ») : lue seulement si activé ET
  // si le rôle a le droit marge (sinon name null → pas d'abonnement), puis fusionnée par FP.
  const { rows: mchunks } = useCollectionData<CommandeChunk>(enabled && canMargin ? "commandesRowsMargin" : null, [orderBy("i", "asc")], canMargin ? "mchunks" : "off");
  const base: Order[] = chunks.length ? chunks.flatMap((c) => c.rows || []) : (meta?.rows || []);
  let rows = base;
  if (canMargin && mchunks.length) {
    const mBy = new Map<string, any>();
    for (const c of mchunks) for (const m of (c.rows as any[]) || []) if (m.fp) mBy.set(m.fp, m);
    rows = base.map((r) => { const m = r.fp ? mBy.get(r.fp) : null; return m ? { ...r, mb: m.mb, costTotal: m.costTotal, marginPct: m.marginPct } : r; });
  }
  return { rows, count: meta?.count ?? rows.length, loading: l1 || l2 };
}

// Module cible de chaque type d'alerte (pour rendre le centre d'alertes cliquable), avec le
// SEGMENT interne à pré-sélectionner sur la vue cible quand elle en propose un (ex. « en retard »
// sur Exécution BC) — le drill-through arrive ainsi filtré, pas sur la liste complète.
const ALERT_TARGET: Record<string, { module: string; segment?: string }> = {
  marge_negative: { module: "orderlist" }, achat_sup_vente: { module: "orderlist" }, raf_incoherent: { module: "orderlist" },
  factures_non_rattachees: { module: "invoicelist", segment: "orphan" }, facture_pre_po: { module: "invoicelist" }, surfacturation: { module: "invoicelist" },
  backlog_dormant: { module: "backlog" }, ligne_saturee: { module: "fournisseurs" }, ligne_tension: { module: "fournisseurs" },
  concentration_client: { module: "clients" }, bc_en_attente: { module: "bc", segment: "open" }, bc_en_retard: { module: "bc", segment: "late" },
  opp_dormante: { module: "opplist" },
};

// Cellule N° FP cliquable → ouvre FP 360° pré-renseigné (maillage transverse). Repli en texte
// simple si l'utilisateur n'a pas accès à FP 360° ou si le FP est vide.
export function FpLink({ fp }: { fp?: string | null }) {
  const { go, canGo } = useNav();
  if (!fp) return <>—</>;
  if (!canGo("fp360")) return <>{fp}</>;
  return (
    <button type="button" onClick={() => go("fp360", { fp })}
      className="text-ink hover:text-gold underline decoration-dotted underline-offset-2"
      title="Ouvrir FP 360°">{fp}</button>
  );
}

// Garde-fou de FRAÎCHEUR (affiché sur toutes les vues) : alerte quand le dernier recalcul est trop
// ancien (les indicateurs « en retard / à venir / ce mois » sont datés par rapport à lui et peuvent
// avoir dérivé), et quand l'exercice courant (dérivé des données = max année de PO) est en retard
// sur l'année civile (imports en retard → atterrissage et closing ne parlent pas du même exercice).
export function FreshnessGuard() {
  const { data: cfg } = useDocData<{ lastRecomputeAt?: any; currentFy?: number }>("config/periods");
  if (!cfg) return null;
  const age = ageDays(cfg.lastRecomputeAt, Date.now());
  const stale = age >= STALE_RECOMPUTE_DAYS;
  const realYear = new Date().getFullYear();
  const fyLag = !!cfg.currentFy && cfg.currentFy < realYear;
  if (!stale && !fyLag) return null;
  const box = stale ? "border-clay/40 bg-clay/10" : "border-gold/40 bg-gold/10";
  return (
    <div role="status" className={cx("mb-4 flex flex-col gap-1.5 rounded-lg border px-3 py-2 text-[13px] text-ink", box)}>
      {stale && (
        <div className="flex items-start gap-2">
          <AlertTriangle size={14} aria-hidden="true" className="mt-0.5 shrink-0 text-clay" />
          <span><b>Données possiblement obsolètes</b> — dernier recalcul {relTime(cfg.lastRecomputeAt) || `il y a ${age} j`}. Les indicateurs « en retard / à venir / à clôturer ce mois » sont datés par rapport à ce recalcul et peuvent avoir dérivé. Lance « Recalculer » (Vue d'ensemble) ou vérifie le recompute planifié (05:00).</span>
        </div>
      )}
      {fyLag && (
        <div className="flex items-start gap-2">
          <AlertTriangle size={14} aria-hidden="true" className="mt-0.5 shrink-0 text-gold" />
          <span><b>Exercice courant = {cfg.currentFy}</b> alors que l'année civile est {realYear} — aucune commande {realYear} importée. L'atterrissage raisonne sur {cfg.currentFy}, tandis que le closing compare au calendrier réel : importe les commandes {realYear} pour réaligner.</span>
        </div>
      )}
    </div>
  );
}

export type Props = { period: string };
export const grid4 = "grid gap-2 sm:gap-3 grid-cols-2 lg:grid-cols-4";
export const cols2 = "grid gap-2 sm:gap-3 md:grid-cols-2";

export const objToArr = (o: Record<string, number> = {}) =>
  Object.entries(o).map(([name, v]) => ({ name, v: Number(v) || 0 })).sort((a, b) => b.v - a.v);
export const monthsAsc = (o: Record<string, number> = {}) =>
  Object.entries(o).map(([name, v]) => ({ name, v: Number(v) || 0 })).sort((a, b) => a.name.localeCompare(b.name));
export const topArr = (a: { key: string; value: number }[] = []) => a.map((x) => ({ name: x.key, v: x.value }));
export const toDonut = (o: Record<string, number> = {}) => objToArr(o).map((x) => ({ name: x.name, value: x.v }));

export const STAGE_SHORT: Record<number, string> = { 1: "Qualif", 2: "Montage", 3: "Transmise", 4: "Négo", 5: "Contrat", 6: "Gagné", 7: "Perdu", 8: "Suspendu", 9: "Annulé" };

// Libellés FR des statuts techniques (jamais de code brut à l'écran).
export const BC_LABEL: Record<string, string> = { a_emettre: "À émettre", emis: "Émis", livre: "Livré", facture: "Facturé", solde: "Soldé" };
export const SUP_LABEL: Record<string, string> = { saturation: "Saturé", tension: "Tendu", ok: "OK", non_suivi: "Non suivi" };
export const BC_STAGES = ["a_emettre", "emis", "livre", "facture", "solde"];
export const bcLabel = (s?: string) => BC_LABEL[s || "a_emettre"] || (s || "a_emettre");

const buTone: Record<string, string> = { ICT: "emerald", CLOUD: "steel", FORMATION: "gold", AUTRE: "neutral" };
export const buBadge = (bu: string) => <Badge tone={(buTone[bu] || "neutral") as any}>{bu || "—"}</Badge>;

// Barres horizontales maison (listes AM / top clients / fournisseurs).
export function HBars({ rows, colorFn, max }: { rows: { name: string; v: number; sub?: string }[]; colorFn?: (r: any) => string; max?: number }) {
  if (!rows.length) return <EmptyState />;
  const mx = max ?? Math.max(1, ...rows.map((r) => r.v));
  return (
    <div className="flex flex-col gap-2.5 mt-1">
      {rows.map((r, i) => (
        <div key={i}>
          <div className="flex justify-between text-[12.5px] mb-1">
            <span className="truncate max-w-[220px] text-ink">{r.name}</span>
            <span className="text-muted tabnum">{fmt(r.v)}{r.sub != null && <span className="text-faint"> · {r.sub}</span>}</span>
          </div>
          <div className="h-[7px] rounded bg-panel2">
            <div className="h-full rounded" style={{ width: `${Math.max((r.v / mx) * 100, 1)}%`, background: colorFn ? colorFn(r) : T.emerald }} />
          </div>
        </div>
      ))}
    </div>
  );
}

// Libellés FR des types de fichiers reconnus à l'import (mapping kind serveur → module alimenté).
const IMPORT_KIND_LABEL: Record<string, string> = {
  pnl: "Commandes (P&L)",
  fiche: "Fiche affaire (P&L Projet)",
  facturationDf: "Factures",
  salesData: "Pipeline / Opportunités",
  logistics: "BC fournisseurs (Exécution BC)",
};
const kindLabel = (k: string) => IMPORT_KIND_LABEL[k] || k;
const MAX_MB = 20; // garde-fou : 20 Mo × base64 (~1,33) ≈ 27 Mo, sous la limite d'appel (~32 Mo).

// Journal d'import (collection `imports`) pour l'ÉTAT durable « dernier import ».
type ImportLog = { id?: string; filename?: string; kinds?: string[]; rowsOk?: number; rowsSkipped?: number; fileCount?: number; ts?: any };
type ImportPhase = "" | "reading" | "processing";
type ImportOutcome = { ok: true; res: ImportDeltaResult } | { ok: false; error: string } | null;

const PHASE_LABEL: Record<Exclude<ImportPhase, "">, string> = {
  reading: "Lecture du fichier…",
  processing: "Envoi, traitement & recalcul…",
};

// Hook d'import partagé : garde-fou taille, phases de progression (lecture → traitement), et
// résultat/erreur persistant. L'upsert serveur est idempotent (ré-import = remplace, pas de doublon).
function useImport() {
  const [phase, setPhase] = useState<ImportPhase>("");
  const [outcome, setOutcome] = useState<ImportOutcome>(null);
  const run = async (file: File): Promise<ImportOutcome> => {
    setOutcome(null);
    if (file.size > MAX_MB * 1024 * 1024) {
      const o: ImportOutcome = { ok: false, error: `Fichier trop volumineux (${(file.size / 1048576).toFixed(0)} Mo, max ~${MAX_MB} Mo). Divise l'import — ex. un ZIP par lots de fiches.` };
      setOutcome(o); return o;
    }
    try {
      const res = await callImportDelta(file, setPhase);
      const o: ImportOutcome = { ok: true, res }; setOutcome(o); return o;
    } catch (err: any) {
      const detail = String(err?.message || err?.code || "").replace(/^functions\//, "");
      const o: ImportOutcome = { ok: false, error: detail || "Import refusé" }; setOutcome(o); return o;
    } finally {
      setPhase("");
    }
  };
  return { run, phase, busy: phase !== "", outcome, reset: () => setOutcome(null) };
}

// Barre de progression par phase (indéterminée pendant le traitement serveur).
function ImportProgress({ phase }: { phase: Exclude<ImportPhase, ""> }) {
  const w = phase === "reading" ? "35%" : "80%";
  return (
    <div className="mt-3" role="status" aria-live="polite">
      <div className="flex items-center gap-2 text-xs text-muted"><Upload size={13} className="animate-pulse" aria-hidden="true" />{PHASE_LABEL[phase]}</div>
      <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-panel2">
        <div className={cx("h-full rounded-full bg-gold transition-all duration-500", phase === "processing" && "animate-pulse")} style={{ width: w }} />
      </div>
      <div className="mt-1 text-[11px] text-faint">Un gros fichier / ZIP peut prendre plusieurs dizaines de secondes — ne ferme pas l'onglet.</div>
    </div>
  );
}

// Panneau de résultat persistant : ce qui a été reconnu (FORMAT), lignes traitées / ignorées, et
// détail PAR fichier avec la CAUSE d'un éventuel échec (≠ toast éphémère).
function ImportResult({ outcome }: { outcome: NonNullable<ImportOutcome> }) {
  if (!outcome.ok) {
    return (
      <div className="mt-3 rounded-lg border border-clay/40 bg-clay/10 p-3 text-[13px]">
        <div className="flex items-center gap-1.5 font-semibold text-clay"><AlertCircle size={15} aria-hidden="true" /> Import refusé</div>
        <div className="mt-1 text-muted">{outcome.error}</div>
      </div>
    );
  }
  const r = outcome.res;
  const files = r.files || [];
  const failed = files.filter((f) => f.error);
  const okFiles = files.filter((f) => !f.error);
  return (
    <div className="mt-3 rounded-lg border border-emerald/40 bg-emerald/10 p-3 text-[13px]">
      <div className="flex items-center gap-1.5 font-semibold text-emerald"><CheckCircle2 size={15} aria-hidden="true" /> Import réussi</div>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {(r.kinds || []).map((k) => <Badge key={k} tone="emerald">{kindLabel(k)}</Badge>)}
        {!(r.kinds || []).length && <span className="text-muted">Aucun type reconnu</span>}
      </div>
      <div className="mt-2 text-muted">
        <b className="text-ink tabnum">{(r.rowsOk || 0).toLocaleString("fr-FR")}</b> ligne(s) intégrée(s)
        {(r.rowsSkipped || 0) > 0 && <> · <b className="text-ink tabnum">{r.rowsSkipped!.toLocaleString("fr-FR")}</b> ignorée(s)</>}
        {(r.fileCount || 0) > 1 && <> · {r.fileCount} classeurs</>}
      </div>
      {(r.rowsSkipped || 0) > 0 && <div className="mt-1 text-[11px] text-faint">Lignes ignorées = doublons de clé, lignes vides ou champs clés manquants (ex. N° FP).</div>}
      {files.length > 1 && (
        <ul className="mt-2 flex flex-col gap-0.5 text-[12px]">
          {okFiles.map((f) => (
            <li key={f.file} className="flex items-center gap-1.5 text-muted"><CheckCircle2 size={12} className="text-emerald shrink-0" aria-hidden="true" /><span className="truncate">{f.file}</span><span className="text-faint">· {(f.kinds || []).map(kindLabel).join(", ") || "—"} · {(f.rowsOk || 0)} l.</span></li>
          ))}
          {failed.map((f) => (
            <li key={f.file} className="flex items-center gap-1.5 text-clay"><AlertCircle size={12} className="shrink-0" aria-hidden="true" /><span className="truncate">{f.file}</span><span>· {f.error}</span></li>
          ))}
        </ul>
      )}
      {failed.length > 0 && files.length <= 1 && <div className="mt-1 text-clay text-[12px]">{failed.map((f) => `${f.file} : ${f.error}`).join(" · ")}</div>}
    </div>
  );
}

// Bouton d'import compact (barres d'action des vues). Feedback via toast + libellé de phase.
// Le rôle est revérifié côté serveur (l'UI n'est qu'un garde-fou).
export function ImportButton({ label = "Importer un fichier" }: { label?: string }) {
  const toast = useToast();
  const { run, phase, busy } = useImport();
  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // autorise le ré-import du même fichier
    if (!file) return;
    const o = await run(file);
    if (o?.ok) {
      const kinds = (o.res.kinds || []).map(kindLabel).join(", ") || "aucun type";
      const filesPart = (o.res.fileCount || 0) > 1 ? ` · ${o.res.fileCount} classeurs` : "";
      toast(`Import réussi : ${o.res.rowsOk} ligne(s)${o.res.rowsSkipped ? ` · ${o.res.rowsSkipped} ignorée(s)` : ""}${filesPart} · ${kinds}`, "ok");
    } else if (o) toast(`Import refusé : ${o.error}`, "err");
  };
  return (
    <label
      title="Importer un XLSX (P&L, Fiche affaire, Facturation DF ou LIVE/Sales) ou un ZIP de classeurs — type détecté automatiquement."
      className={cx("btn-ghost !px-2.5 !py-1 text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer", busy && "opacity-60 pointer-events-none")}
    >
      <Upload size={14} aria-hidden="true" />
      {busy ? (phase === "reading" ? "Lecture…" : "Traitement…") : label}
      <input type="file" accept=".xlsx,.xls,.zip" className="sr-only" onChange={onFile} disabled={busy} aria-label="Choisir un fichier XLSX ou ZIP à importer" />
    </label>
  );
}

// Carte d'import complète (onglet Habilitations) : dépôt (clic ou glisser-déposer), progression par
// phase, résultat persistant (format reconnu / lignes / cause d'échec par fichier), état « dernier
// import » (journal), et rappel des formats reconnus. Peuple tous les modules à partir des exports.
export function DataImportCard() {
  const { run, phase, busy, outcome } = useImport();
  const [drag, setDrag] = useState(false);
  const isDirection = useClaims().role === "direction";
  const { rows: recent } = useCollectionData<ImportLog>("imports", [orderBy("ts", "desc"), limit(5)], "recent5");
  const last = recent[0];

  const handle = (file?: File | null) => { if (file) run(file); };
  const onDrop = (e: DragEvent) => { e.preventDefault(); setDrag(false); if (!busy) handle(e.dataTransfer.files?.[0]); };

  return (
    <Card title="Import de données">
      <label
        onDragOver={(e) => { e.preventDefault(); if (!busy) setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={onDrop}
        className={cx(
          "flex flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed px-4 py-6 text-center transition-colors",
          busy ? "border-line opacity-70 pointer-events-none" : "cursor-pointer border-line hover:border-gold/50 hover:bg-panel2",
          drag && "border-gold/70 bg-panel2"
        )}
      >
        <Upload size={20} className="text-faint" aria-hidden="true" />
        <div className="text-[13px] text-ink font-semibold">Dépose un fichier <b>Excel</b> ou un <b>ZIP</b>, ou clique pour choisir</div>
        <div className="text-[11px] text-faint">Type détecté automatiquement · ré-importer ne crée jamais de doublon · max ~{MAX_MB} Mo</div>
        <input type="file" accept=".xlsx,.xls,.zip" className="sr-only" disabled={busy}
          onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; handle(f); }}
          aria-label="Choisir un fichier XLSX ou ZIP à importer" />
      </label>

      {busy && phase && <ImportProgress phase={phase} />}
      {!busy && outcome && <ImportResult outcome={outcome} />}

      {/* Ré-ingestion des classeurs DÉJÀ dans gs://nt360 (sans re-upload). Utile après une évolution
          de parseur : re-calcule les champs dérivés (ex. désignation) sur l'existant. Direction. */}
      {isDirection && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line bg-panel2/40 px-3 py-2">
          <span className="text-[12px] text-muted">Re-parser les fichiers déjà présents dans le stockage (sans re-uploader) — recalcule les champs dérivés après une évolution de format.</span>
          <ReingestButton />
        </div>
      )}

      {/* ÉTAT durable : dernier import (journal serveur), avec l'historique récent repliable. */}
      {last && (
        <div className="mt-3 flex items-center gap-1.5 text-[12px] text-muted">
          <Clock size={13} className="text-faint shrink-0" aria-hidden="true" />
          Dernier import : <b className="text-ink">{last.filename || "—"}</b>
          <span className="text-faint">{relTime(last.ts)} · {(last.kinds || []).map(kindLabel).join(", ") || "aucun type"} · {(last.rowsOk || 0).toLocaleString("fr-FR")} l.</span>
        </div>
      )}
      {recent.length > 1 && (
        <details className="mt-1 text-[12px]">
          <summary className="cursor-pointer select-none text-faint hover:text-ink">Historique récent</summary>
          <ul className="mt-1.5 flex flex-col gap-1">
            {recent.map((r) => (
              <li key={r.id} className="flex items-center gap-1.5 text-muted">
                <span className="text-faint tabnum w-20 shrink-0">{relTime(r.ts)}</span>
                <span className="truncate text-ink">{r.filename || "—"}</span>
                <span className="text-faint">· {(r.kinds || []).map(kindLabel).join(", ") || "—"} · {(r.rowsOk || 0).toLocaleString("fr-FR")} l.{r.rowsSkipped ? ` · ${r.rowsSkipped} ign.` : ""}</span>
              </li>
            ))}
          </ul>
        </details>
      )}

      <details className="mt-2 text-[13px] text-muted">
        <summary className="cursor-pointer select-none text-faint hover:text-ink">Formats reconnus</summary>
        <ul className="mt-2 grid gap-1 sm:grid-cols-2">
          <li>• <b className="text-ink">P&amp;L</b> → Commandes · Rentabilité</li>
          <li>• <b className="text-ink">Fiche affaire</b> → P&amp;L Projet</li>
          <li>• <b className="text-ink">Import BC</b> (Logistics / PDF) → Exécution BC</li>
          <li>• <b className="text-ink">Facturation DF</b> → Factures</li>
          <li>• <b className="text-ink">LIVE / Sales</b> → Pipeline · Opportunités</li>
        </ul>
        <p className="mt-1 text-faint">Fiches affaire en lot : plusieurs onglets d'un classeur, ou plusieurs classeurs dans un ZIP.</p>
      </details>
    </Card>
  );
}

// Bouton de ré-ingestion (Direction) : confirme, appelle `reingest`, puis toast détaillé issu du
// rapport serveur (objets ingérés, lignes, échecs). Ré-ingérer n'est pas destructif (upsert
// merge), mais lance un recompute complet — d'où la confirmation et l'état occupé dédié.
// Codes d'erreur qui traduisent un VRAI refus (droit, argument) — à distinguer d'une coupure
// d'infrastructure sur un appel long. La ré-ingestion dure quelques minutes : le frontal Google
// peut couper la connexion (503 → « internal » / « unavailable » / « deadline-exceeded ») ALORS QUE
// la fonction continue et aboutit côté serveur. Dans ce cas on n'affiche PAS « refusé » (faux négatif).
const REINGEST_REFUSAL = new Set(["permission-denied", "unauthenticated", "invalid-argument", "failed-precondition", "not-found"]);
function ReingestButton() {
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const onClick = async () => {
    if (busy) return;
    if (!window.confirm("Re-parser tous les classeurs sources de gs://nt360 ?\nÉcrase les champs recalculés (ex. désignation) sur l'existant, puis relance un recalcul complet. Aucune donnée n'est supprimée.\n\nL'opération prend quelques minutes ; son résultat apparaît dans le journal d'import ci-dessous.")) return;
    setBusy(true);
    // Feedback immédiat : l'opération est longue, on ne laisse pas l'utilisateur devant un bouton figé.
    toast("Ré-ingestion lancée — suivez l'avancement dans le journal d'import ci-dessous.", "info");
    try {
      const r = await callReingest();
      const failPart = r.objectsFailed ? ` · ${r.objectsFailed} ignoré(s)` : "";
      const kindsPart = r.kinds?.length ? ` · ${r.kinds.join(", ")}` : "";
      toast(`Ré-ingestion terminée : ${r.objectsIngested}/${r.objectsScanned} fichier(s) · ${r.rowsOk.toLocaleString("fr-FR")} ligne(s)${failPart}${kindsPart}`, r.objectsFailed && !r.objectsIngested ? "err" : "ok");
    } catch (e: any) {
      const code = String(e?.code || "").replace(/^functions\//, "");
      if (REINGEST_REFUSAL.has(code)) {
        const detail = String(e?.message || code || "").replace(/^functions\//, "");
        toast(`Ré-ingestion refusée — ${detail}`, "err");
      } else {
        // Coupure probable d'un appel long : la fonction poursuit côté serveur → pas un échec.
        toast("Ré-ingestion en cours côté serveur (traitement long) — le résultat apparaîtra dans le journal d'import.", "info");
      }
    } finally {
      setBusy(false);
    }
  };
  return (
    <button type="button" onClick={onClick} disabled={busy} className="btn-ghost !px-2.5 !py-1 text-xs font-semibold shrink-0">
      {busy ? "Ré-ingestion…" : "Ré-ingérer depuis le stockage"}
    </button>
  );
}

// Barre de filtre transverse (BU / AM / client) — options AM/clients issues des référentiels.
// N'affecte que les listes détaillées (les agrégats restent globaux), d'où le libellé « listes ».
export function FilterBar() {
  const { f, set, clear, active } = useFilters();
  const { data: ams } = useDocData<AmsSummary>("summaries/ams");
  const { data: cli } = useDocData<EntitySummary>("summaries/clients_all");
  const { data: pms } = useDocData<PmsSummary>("summaries/pms");
  const amOpts = (ams?.rows || []).map((r) => r.am).filter(Boolean);
  const cliOpts = (cli?.rows || []).map((r) => r.key).filter(Boolean);
  const pmOpts = (pms?.rows || []).map((r) => r.pm).filter(Boolean);
  const BU = useBusinessUnits();
  const sel = "!py-1 text-xs";
  return (
    <div className="flex items-center gap-2 flex-wrap text-xs">
      <span className="inline-flex items-center gap-1 text-faint"><Filter size={13} aria-hidden="true" /> Filtre <span className="hidden sm:inline">(listes)</span></span>
      <Select className={sel} ariaLabel="Filtrer par BU" value={f.bu} onChange={(v) => set({ bu: v })} placeholder="BU · toutes"
        options={[{ value: "", label: "BU · toutes" }, ...BU.map((b) => ({ value: b, label: b }))]} />
      <Select className={sel} ariaLabel="Filtrer par commercial" value={f.am} onChange={(v) => set({ am: v })} placeholder="AM · tous"
        options={[{ value: "", label: "AM · tous" }, ...amOpts.map((a) => ({ value: a, label: a }))]} />
      <Select className={sel} ariaLabel="Filtrer par client" value={f.client} onChange={(v) => set({ client: v })} placeholder="Client · tous"
        options={[{ value: "", label: "Client · tous" }, ...cliOpts.map((c) => ({ value: c, label: c }))]} />
      {/* Filtre PM affiché seulement s'il existe des affectations (sinon inutile). */}
      {pmOpts.length > 0 && <Select className={sel} ariaLabel="Filtrer par Project Manager" value={f.pm} onChange={(v) => set({ pm: v })} placeholder="PM · tous"
        options={[{ value: "", label: "PM · tous" }, ...pmOpts.map((p) => ({ value: p, label: p }))]} />}
      {active && <button onClick={clear} className="inline-flex items-center gap-1 text-clay hover:underline" aria-label="Effacer le filtre"><X size={13} /> Effacer</button>}
    </div>
  );
}

// Bandeau discret rappelant qu'un filtre transverse est actif sur une vue liste.
export function FilterNote({ dims }: { dims?: string }) {
  const { f, active } = useFilters();
  if (!active) return null;
  const parts = [f.bu && `BU ${f.bu}`, f.am && `AM ${f.am}`, f.client && `Client ${f.client}`, f.pm && `PM ${f.pm}`].filter(Boolean);
  return <div className="text-[11px] text-gold">Filtre actif : {parts.join(" · ")}{dims ? ` — ${dims}` : ""}</div>;
}

// Centre d'alertes (bandeau) — actionnable : chaque alerte ouvre le module concerné
// (si l'utilisateur y a accès) et affiche ses références (FP / fournisseurs).
export function AlertsBanner() {
  const canMargin = useCanSeeMargin();
  const { data } = useDocData<AlertsSummary>("summaries/alerts");
  // Alertes CLOISONNÉES par module (serveur) : chaque summary n'est lu que si le rôle a le droit du
  // module correspondant → un rôle « overview » seul ne voit plus les données fournisseurs/facturation/
  // backlog/BC/pipeline. Recomposées dans le même bandeau. Cf. audit P0-C.
  const { data: dataMargin } = useDocData<AlertsSummary>(canMargin ? "summaries/alertsMargin" : null);
  const { data: dFac } = useDocData<AlertsSummary>(useCan("facturation") !== "none" ? "summaries/alertsFacturation" : null);
  const { data: dFrn } = useDocData<AlertsSummary>(useCan("fournisseurs") !== "none" ? "summaries/alertsFournisseurs" : null);
  const { data: dBl } = useDocData<AlertsSummary>(useCan("backlog") !== "none" ? "summaries/alertsBacklog" : null);
  const { data: dBc } = useDocData<AlertsSummary>(useCan("bc") !== "none" ? "summaries/alertsBc" : null);
  const { data: dPl } = useDocData<AlertsSummary>(useCan("pipeline") !== "none" ? "summaries/alertsPipeline" : null);
  const { go, canGo } = useNav();
  const rank: Record<string, number> = { high: 0, medium: 1, low: 2 };
  const items = [data, dataMargin, dFac, dFrn, dBl, dBc, dPl]
    .flatMap((d) => d?.items || [])
    .sort((a, b) => (rank[a.severity] ?? 3) - (rank[b.severity] ?? 3));
  if (!items.length) return null;
  const tone: Record<string, string> = { high: "clay", medium: "gold", low: "steel" };
  return (
    <Card title={`Centre d'alertes · ${items.length}`}>
      <div className="flex flex-col gap-2">
        {items.map((a, i) => {
          const target = ALERT_TARGET[a.type];
          const actionable = !!target && canGo(target.module);
          const refs = (a.refs || []).filter(Boolean);
          return (
            <div key={i} className="flex items-start gap-2 text-[13px]">
              <AlertTriangle size={14} aria-hidden="true" className={cx("mt-0.5 shrink-0", a.severity === "high" ? "text-clay" : a.severity === "medium" ? "text-gold" : "text-steel")} />
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                {actionable
                  ? <button onClick={() => go(target.module, target.segment ? { segment: target.segment } : undefined)} className="text-ink hover:text-gold underline decoration-dotted underline-offset-2 text-left" title="Ouvrir le module concerné">{a.message}</button>
                  : <span>{a.message}</span>}
                <Badge tone={(tone[a.severity] || "neutral") as any}>{a.count}</Badge>
                {refs.slice(0, 6).map((r, j) => (
                  <span key={j} className="rounded bg-panel2 text-faint px-1.5 py-0.5 text-[11px]">{r}</span>
                ))}
                {refs.length > 6 && <span className="text-[11px] text-faint">+{refs.length - 6}</span>}
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  ) as ReactNode;
}
