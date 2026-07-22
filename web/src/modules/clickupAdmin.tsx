// Intégration ClickUp — configuration + actions (bidirectionnel commandes & BC, temps réel/webhooks,
// diagnostic qualité, dédoublonnage). DÉPLACÉ depuis Habilitations vers le cockpit ClickUp (ADR-047) :
// la config et les actions vivent désormais AVEC les KPI de pilotage. MÊME garde direction-only à l'appel
// (le cockpit ne rend <ClickupCard/> que pour la direction) ; callables et droits inchangés. Additif.
import { useState, type ReactNode } from "react";
import { useDocData } from "../lib/hooks";
import { Card, Table, Badge, Tip, Busy, Toggle, colText, cx, useToast, useConfirm } from "../design/components";
import { Select } from "../design/inputs";
import { trackWrite } from "../lib/activity";
import { setClickupConfig, syncClickupCaf, syncFromClickup, reconcileClickupLinks, clickupHealth, pushAllOrdersToClickup, pushOrderToClickup, dedupeClickupTasks, dedupeBcTasks, enrichClickup, reconcileBcLinks, importBcFromClickup, syncBcFromClickup, pushAllBcToClickup, setupClickupWebhook, deleteClickupWebhook } from "../lib/writes";
import { T, fmt } from "../design/tokens";
import { ScoreRing } from "./_viz";
import type { ClickupHealthSummary } from "../types";

// Intégration ClickUp : activation + liste cible. Le token vit dans Secret Manager (CLICKUP_TOKEN),
// jamais dans l'app. Le push d'une commande se fait depuis la liste Commandes (bouton « ClickUp »).
const CLICKUP_LISTS = [
  { id: "901215917683", label: "Côte d'Ivoire" },
  { id: "901215918697", label: "Burkina Faso" },
  { id: "901215918699", label: "Guinée" },
  { id: "901216066964", label: "Sandbox (test)" },
];
// Cockpit de QUALITÉ de l'intégration ClickUp : couverture, tâches orphelines, écarts CAF, synchro.
// `listId` = liste cible des push unitaires ; `onBulkPush` = raccourci « tout créer » (push en masse).
function ClickupHealthPanel({ health, listId, onBulkPush }: { health?: ClickupHealthSummary | null; listId?: string; onBulkPush?: () => void }) {
  if (!health) return null;
  // Bandeau d'échec de la dernière vérification (raison PERSISTÉE par le callable clickupHealth) — rend
  // la cause VISIBLE au lieu d'un KO muet dans le journal. Affiché même si aucune synchro n'a jamais réussi.
  const errBanner = health.lastError ? (
    <div className="mb-2 rounded-lg border border-clay/40 bg-clay/5 px-3 py-2 text-[12px] text-clay">
      Dernière vérification ClickUp échouée : <b>{health.lastError}</b>
    </div>
  ) : null;
  if (health.commandesTotal == null) return errBanner ? <div className="mt-3">{errBanner}</div> : null;
  const Metric = ({ label, value, tone, sub }: { label: string; value: string | number; tone?: string; sub?: string }) => (
    <div className="rounded-lg bg-panel2 border border-line px-3 py-2">
      <div className="text-[11px] text-muted">{label}</div>
      <div className={cx("font-display tabnum text-lg leading-tight", tone)}>{value}</div>
      {sub && <div className="text-[11px] text-faint">{sub}</div>}
    </div>
  );
  const cov = health.coverage || 0;
  return (
    <div className="mt-3">
      {errBanner}
      {/* Couverture en ANNEAU (ScoreRing partagé — même vocabulaire que les entêtes cockpit) : la métrique
          de tête se voit en un coup d'œil ; l'ancienne case « Couverture » disparaît (un chiffre, un endroit). */}
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-3 shrink-0">
          <ScoreRing value={cov / 100} color={cov >= 90 ? T.emerald : cov >= 50 ? T.gold : T.clay} />
          <div>
            <div className="text-[10px] uppercase tracking-[0.14em] text-faint">Couverture</div>
            <div className="text-[11px] text-muted">{health.linked}/{health.commandesTotal}<br />commandes liées</div>
          </div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2 grow min-w-0">
        <Metric label="Commandes non liées" value={health.unlinked || 0} tone={(health.unlinked || 0) > 0 ? "text-gold" : "text-emerald"} sub={`dont ${health.unlinkedMatchable || 0} rattachables`} />
        <Metric label="Synchronisées (statut/dates)" value={health.synced || 0} sub={`sur ${health.linked} liées`} />
        <Metric label="Tâches ClickUp" value={health.tasksTotal || 0} sub={`${health.tasksWithFp || 0} avec N° FP`} />
        <Metric label="Tâches orphelines" value={health.orphanTasks || 0} tone={(health.orphanTasks || 0) > 0 ? "text-gold" : "text-emerald"} sub="sans N° FP ou hors commandes actives" />
        <Metric label="Écarts CAF" value={health.cafGapCount || 0} tone={(health.cafGapCount || 0) > 0 ? "text-clay" : "text-emerald"} sub={`${fmt(health.cafGapTotal)} d'écart`} />
        {/* Dérive : lien app→tâche dont la tâche n'existe plus côté ClickUp (supprimée/déplacée). Non fiable si scan tronqué. */}
        <Metric label="Liens fantômes" value={health.phantomLinks || 0} tone={(health.phantomLinks || 0) > 0 ? "text-clay" : "text-emerald"} sub={health.truncated ? "scan tronqué (indicatif)" : "tâche liée introuvable"} />
        {(() => {
          const wh = health.webhook; const active = wh?.active === true && wh?.present === true;
          const val = wh?.error ? "?" : wh?.registered ? (active ? "actif" : "inactif") : "non configuré";
          const tone = wh?.error ? "text-gold" : !wh?.registered ? "text-faint" : active ? "text-emerald" : "text-clay";
          const sub = wh?.error ? "vérif échouée" : !wh?.registered ? "aucun webhook" : wh?.present ? (wh?.status ? `état : ${wh.status}` : "présent") : "absent côté ClickUp";
          return <Metric label="Webhook temps réel" value={val} tone={tone} sub={sub} />;
        })()}
        </div>
      </div>
      {/* Deux sens OPPOSÉS, donc distincts : « non liées » = commandes app sans tâche (à pousser) ;
          « orphelines » = tâches ClickUp sans commande active correspondante. Un total nul de rattachables
          avec des orphelines n'est pas incohérent — ce sont deux populations disjointes. */}
      <div className="text-[11px] text-faint mt-1.5">
        « Non liées » = commandes de l'app sans tâche ClickUp. « Orphelines » = tâches ClickUp sans commande active (sens inverse) — les deux comptes sont indépendants.
      </div>
      {(health.unlinkedSample?.length || health.orphanSample?.length) ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mt-2">
          {!!health.unlinkedSample?.length && (
            <div>
              {/* Action UNITAIRE par ligne (créer/lier UNE tâche) + raccourci EN MASSE en tête — plus
                  besoin de quitter le diagnostic. Le push unitaire ADOPTE une tâche existante (Opp ID
                  = FP) au lieu de dupliquer ; l'échantillon se rafraîchit au prochain diagnostic. */}
              <div className="flex items-center gap-2 mb-1">
                <div className="text-[11px] text-muted grow">Commandes non liées (échantillon)</div>
                {onBulkPush && (health.unlinkedEligible ?? health.unlinked ?? 0) > 0 && (
                  <button type="button" className="text-gold hover:underline text-[11px]" onClick={onBulkPush}
                    title="Créer les tâches des commandes non liées ÉLIGIBLES (un DC doit être lié au N° FP ; les tâches existantes sont adoptées, pas dupliquées)">
                    ⚡ tout créer ({health.unlinkedEligible ?? health.unlinked})
                  </button>
                )}
              </div>
              {/* Éligibilité ClickUp (ADR-079) : une commande n'est synchronisable que si un DC (Odoo) est
                  lié à son N° FP. Les non éligibles sont signalées et leur bouton remplacé par un renvoi. */}
              {(health.unlinkedNoDc || 0) > 0 && (
                <div className="text-[11px] text-clay mb-1">{health.unlinkedNoDc} non éligible(s) : aucun DC lié au N° FP — générez le DC dans Odoo, ou rapprochez-le (Assainissement → Rapprochement DC → N° FP).</div>
              )}
              <Table colsKey="clickup-unlinked" columns={[
                colText("FP", (r: { fp?: string }) => r.fp || "—"),
                colText("Client", (r: { client?: string }) => r.client || "—"),
                colText("DC lié", (r: { hasDc?: boolean }) => (r.hasDc === false ? <Badge tone="clay">non</Badge> : <Badge tone="emerald">oui</Badge>)),
                colText("Tâche existante", (r: { matchable?: boolean }) => (r.matchable ? <Badge tone="gold">à rattacher</Badge> : <span className="text-faint">non</span>)),
                colText("", (r: { fp?: string; client?: string; matchable?: boolean; hasDc?: boolean }) => !r.fp ? null : r.hasDc === false ? (
                  <span className="text-faint text-[11px]" title="Un DC doit être lié au N° FP pour synchroniser (ADR-079)">DC requis</span>
                ) : (
                  <Busy variant="ghost" label={r.matchable ? "Lier la tâche" : "Créer la tâche"}
                    okMsg="Tâche ClickUp créée/liée — relancez « Diagnostic qualité » pour rafraîchir la liste" errMsg="Push refusé"
                    fn={async () => { await pushOrderToClickup({ fp: r.fp, client: r.client }, { listId }); }} />
                )),
              ]} rows={health.unlinkedSample} />
            </div>
          )}
          {!!health.orphanSample?.length && (
            <div>
              <div className="text-[11px] text-muted mb-1">Tâches ClickUp orphelines (échantillon)</div>
              <Table colsKey="clickup-orphans" columns={[
                colText("Tâche", (r: { name?: string; id?: string }) => <a href={`https://app.clickup.com/t/${r.id}`} target="_blank" rel="noopener" className="text-emerald hover:underline">{r.name || r.id}</a>),
                colText("N° FP", (r: { fp?: string | null }) => r.fp || <span className="text-faint">aucun</span>),
              ]} rows={health.orphanSample} />
            </div>
          )}
        </div>
      ) : null}
      {health.at && <div className="text-[11px] text-faint mt-1">Dernier diagnostic : {new Date((health.at.seconds || 0) * 1000).toLocaleString("fr-FR")}</div>}
    </div>
  );
}
// URL par défaut de la fonction HTTP clickupWebhook (2nd gen, région us-central1). Modifiable si la
// région/projet diffèrent — l'admin colle l'URL exacte affichée par le déploiement.
const CLICKUP_WEBHOOK_ENDPOINT = "https://us-central1-propulse-business-87f7a.cloudfunctions.net/clickupWebhook";
// Sous-rangée d'actions ClickUp libellée — donne une hiérarchie au mur de boutons (Synchroniser /
// Pousser / Diagnostic) et matérialise l'ordre recommandé (Rattacher AVANT push en masse).
function ClickupActionRow({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-[13px]">
      <span className="w-full sm:w-40 shrink-0 text-[11px] text-faint leading-tight">
        {label}{hint && <span className="block text-gold/80">{hint}</span>}
      </span>
      {children}
    </div>
  );
}
export function ClickupCard() {
  const { data } = useDocData<{ enabled?: boolean; defaultListId?: string; parListId?: string; teamId?: string; webhookActive?: boolean; webhookEndpoint?: string }>("config/clickup");
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [listId, setListId] = useState<string | null>(null);
  const [parList, setParList] = useState<string | null>(null);
  const [ask, confirmNode] = useConfirm();
  const [cafBusy, setCafBusy] = useState(false);
  const [pullBusy, setPullBusy] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [recBusy, setRecBusy] = useState(false);
  const [healthBusy, setHealthBusy] = useState(false);
  const [dedupeBusy, setDedupeBusy] = useState(false);
  const [enrichBusy, setEnrichBusy] = useState(false);
  const [bcRecBusy, setBcRecBusy] = useState(false);
  const [bcBulkBusy, setBcBulkBusy] = useState(false);
  const [bcPullBusy, setBcPullBusy] = useState(false);
  const [bcImportBusy, setBcImportBusy] = useState(false);
  const [bcDedupeBusy, setBcDedupeBusy] = useState(false);
  const [whBusy, setWhBusy] = useState(false);
  const [endpoint, setEndpoint] = useState<string | null>(null);
  const { data: health } = useDocData<ClickupHealthSummary>("summaries/clickupHealth");
  const { data: bcCu } = useDocData<{ totalBc?: number; linkedCount?: number; overdueCount?: number }>("summaries/clickupBc");
  const toast = useToast();
  const on = enabled ?? (data?.enabled !== false);
  const list = listId ?? (data?.defaultListId || "901215917683");
  const parCertList = parList ?? (data?.parListId || "");
  const save = async () => { await setClickupConfig({ enabled: on, defaultListId: list, parListId: parCertList.trim() }); setEnabled(null); setListId(null); setParList(null); };
  const forceCaf = async () => {
    if (cafBusy) return;
    setCafBusy(true);
    try {
      const r = await trackWrite(syncClickupCaf(), "Synchro CAF");
      toast(`CAF synchronisé — ${r.pushed} poussé(s) / ${r.total} tâche(s)${r.failed ? `, ${r.failed} échec(s)` : ""}`, r.failed ? "err" : "ok");
    } catch (e: any) {
      const detail = String(e?.message || e?.code || "").replace(/^functions\//, "");
      toast(detail ? `CAF refusé — ${detail}` : "CAF : échec", "err");
    } finally { setCafBusy(false); }
  };
  const pull = async () => {
    if (pullBusy) return;
    setPullBusy(true);
    try {
      const r = await trackWrite(syncFromClickup(), "Synchro ClickUp");
      toast(`Remonté depuis ClickUp — ${r.pulled} / ${r.total} tâche(s)${r.pmUpdated ? `, ${r.pmUpdated} PM` : ""}${r.failed ? `, ${r.failed} échec(s)` : ""}`, r.failed ? "err" : "ok");
    } catch (e: any) {
      const detail = String(e?.message || e?.code || "").replace(/^functions\//, "");
      toast(detail ? `Synchro refusée — ${detail}` : "Synchro : échec", "err");
    } finally { setPullBusy(false); }
  };
  const reconcile = async () => {
    if (recBusy) return;
    setRecBusy(true);
    try {
      const r = await trackWrite(reconcileClickupLinks({ listId: list }), "Rattachement ClickUp");
      toast(`Rattachement — ${r.matched} tâche(s) existante(s) reliée(s), ${r.already} déjà liée(s) / ${r.total} commande(s)`, "ok");
    } catch (e: any) {
      const detail = String(e?.message || e?.code || "").replace(/^functions\//, "");
      toast(detail ? `Rattachement refusé — ${detail}` : "Rattachement : échec", "err");
    } finally { setRecBusy(false); }
  };
  const refreshHealth = async () => {
    if (healthBusy) return;
    setHealthBusy(true);
    try {
      const r = await trackWrite(clickupHealth({ listId: list }), "Diagnostic ClickUp");
      toast(`Diagnostic — ${r.linked}/${r.commandesTotal} liées (${r.coverage}%), ${r.orphanTasks} tâche(s) orpheline(s)`, "ok");
    } catch (e: any) {
      const detail = String(e?.message || e?.code || "").replace(/^functions\//, "");
      toast(detail ? `Diagnostic refusé — ${detail}` : "Diagnostic : échec", "err");
    } finally { setHealthBusy(false); }
  };
  const bulkPush = async (force: boolean) => {
    if (bulkBusy) return;
    const label = force ? "Resynchroniser TOUTES les tâches liées (cœur + CAF) ?" : "Créer les tâches ClickUp de toutes les commandes non liées ? (les tâches existantes sont adoptées, pas dupliquées)";
    if (!(await ask(<>{label}<p className="mt-2 text-faint">Astuce : lancez d'abord « Rattacher les tâches existantes ».</p></>, { title: "Push en masse ClickUp", confirmLabel: force ? "Tout resynchroniser" : "Créer les tâches" }))) return;
    setBulkBusy(true);
    try {
      const r = await trackWrite(pushAllOrdersToClickup({ force, listId: list }), "Push ClickUp");
      toast(`Push en masse — ${r.created} créée(s), ${r.adopted || 0} rattachée(s), ${r.updated} maj, ${r.skipped} ignorée(s)${r.failed ? `, ${r.failed} échec(s)` : ""} / ${r.total}`, r.failed ? "err" : "ok");
    } catch (e: any) {
      const detail = String(e?.message || e?.code || "").replace(/^functions\//, "");
      // Un timeout client est possible sur un gros volume : le traitement se poursuit côté serveur.
      toast(detail.includes("deadline") || detail.includes("timeout") ? "Push lancé — traitement en cours côté serveur (voir ClickUp)" : (detail ? `Push refusé — ${detail}` : "Push : échec"), detail.includes("deadline") ? "ok" : "err");
    } finally { setBulkBusy(false); }
  };
  // Nettoyage des doublons ClickUp (créés par des push concurrents) : d'abord un APERÇU (dry-run) qui
  // compte TOUTES les tâches supprimables (toutes époques — pas seulement celles du jour, sinon les
  // doublons anciens restent invisibles et non nettoyables), puis confirmation avant suppression réelle.
  // `windowHours: 0` = toutes époques (intention EXPLICITE). La tâche liée/la plus ancienne est conservée.
  const dedupeTasks = async () => {
    if (dedupeBusy) return;
    setDedupeBusy(true);
    try {
      const preview = await dedupeClickupTasks({ listId: list, windowHours: 0 });
      if (!preview.deletable) { toast(`Aucun doublon à nettoyer (${preview.duplicates} doublon(s) détecté(s)).`, "ok"); return; }
      const ok = await ask(
        <>Supprimer <b>{preview.deletable}</b> tâche(s) ClickUp <b>dupliquée(s)</b> (toutes époques), sur <b>{preview.groups}</b> N° FP ?<p className="mt-2 text-faint">La tâche <b>liée</b> (ou la plus ancienne) est <b>conservée</b> pour chaque FP. Action tracée et irréversible côté ClickUp.</p></>,
        { title: "Nettoyer les doublons ClickUp", confirmLabel: `Supprimer ${preview.deletable}`, tone: "clay" });
      if (!ok) return;
      const r = await trackWrite(dedupeClickupTasks({ apply: true, listId: list, windowHours: 0 }), "Nettoyage doublons ClickUp");
      toast(`Doublons nettoyés — ${r.deleted} supprimée(s)${r.failed ? `, ${r.failed} échec(s)` : ""} sur ${r.groups} N° FP.`, r.failed ? "err" : "ok");
    } catch (e: any) {
      const detail = String(e?.message || e?.code || "").replace(/^functions\//, "");
      toast(detail.includes("deadline") || detail.includes("timeout") ? "Nettoyage lancé — traitement en cours côté serveur (voir ClickUp)" : (detail ? `Nettoyage refusé — ${detail}` : "Nettoyage : échec"), detail.includes("deadline") ? "ok" : "err");
    } finally { setDedupeBusy(false); }
  };
  const enrich = async () => {
    if (enrichBusy) return;
    setEnrichBusy(true);
    try {
      const r = await trackWrite(enrichClickup(), "Enrichissement ClickUp");
      toast(`Enrichissement — ${r.enriched} synthèse(s), ${r.subtasked} jalons→sous-tâches, ${r.checklisted} checklist(s) BC, ${r.tagged} tag(s)${r.failed ? `, ${r.failed} échec(s)` : ""} / ${r.total}`, r.failed ? "err" : "ok");
    } catch (e: any) {
      const detail = String(e?.message || e?.code || "").replace(/^functions\//, "");
      toast(detail ? `Enrichissement refusé — ${detail}` : "Enrichissement : échec", "err");
    } finally { setEnrichBusy(false); }
  };
  const bcReconcile = async () => {
    if (bcRecBusy) return;
    setBcRecBusy(true);
    try {
      const r = await trackWrite(reconcileBcLinks(), "Rattachement BC ClickUp");
      toast(`BC rattachés — ${r.matched} tâche(s) reliée(s), ${r.already} déjà liée(s) / ${r.total} BC`, "ok");
    } catch (e: any) {
      const detail = String(e?.message || e?.code || "").replace(/^functions\//, "");
      toast(detail ? `Rattachement BC refusé — ${detail}` : "Rattachement BC : échec", "err");
    } finally { setBcRecBusy(false); }
  };
  const bcImport = async () => {
    if (bcImportBusy) return;
    if (!(await ask(<>Importer dans l'app les BC saisis directement dans ClickUp (non encore présents) ?<p className="mt-2 text-faint">Les BC déjà connus par un import (Logistics/PDF) sont ignorés. Les BC importés sont créés au statut « émis » (engagement, sans impact sur le solde du compte).</p></>, { title: "Importer les BC depuis ClickUp", confirmLabel: "Importer" }))) return;
    setBcImportBusy(true);
    try {
      const r = await trackWrite(importBcFromClickup(), "Import BC ClickUp");
      toast(`Import BC — ${r.created} créé(s), ${r.skippedKnown} déjà connu(s), ${r.skippedIncomplete} incomplet(s) / ${r.scanned} tâche(s)`, "ok");
    } catch (e: any) {
      const detail = String(e?.message || e?.code || "").replace(/^functions\//, "");
      toast(detail ? `Import BC refusé — ${detail}` : "Import BC : échec", "err");
    } finally { setBcImportBusy(false); }
  };
  const bcPull = async () => {
    if (bcPullBusy) return;
    setBcPullBusy(true);
    try {
      const r = await trackWrite(syncBcFromClickup(), "Synchro BC ClickUp");
      toast(`Avancement BC remonté — ${r.pulled} / ${r.total} tâche(s)${r.failed ? `, ${r.failed} échec(s)` : ""}`, r.failed ? "err" : "ok");
    } catch (e: any) {
      const detail = String(e?.message || e?.code || "").replace(/^functions\//, "");
      toast(detail ? `Synchro BC refusée — ${detail}` : "Synchro BC : échec", "err");
    } finally { setBcPullBusy(false); }
  };
  // Dédoublonnage des tâches BC ClickUp (Lot 4b) : groupé par N° BC CANONIQUE (pas par FP — plusieurs BC
  // partagent un FP). Aperçu (toutes époques) → confirmation → suppression. La tâche liée/la plus ancienne
  // est conservée par N° BC. Mêmes garanties que le dédoublonnage des commandes.
  const bcDedupe = async () => {
    if (bcDedupeBusy) return;
    setBcDedupeBusy(true);
    try {
      const preview = await dedupeBcTasks({ windowHours: 0 });
      if (!preview.deletable) { toast(`Aucun doublon BC à nettoyer (${preview.duplicates} doublon(s) détecté(s)).`, "ok"); return; }
      const ok = await ask(
        <>Supprimer <b>{preview.deletable}</b> tâche(s) BC ClickUp <b>dupliquée(s)</b> (toutes époques), sur <b>{preview.groups}</b> N° BC ?<p className="mt-2 text-faint">La tâche <b>liée</b> (ou la plus ancienne) est <b>conservée</b> pour chaque N° BC. Action tracée et irréversible côté ClickUp.</p></>,
        { title: "Nettoyer les doublons BC ClickUp", confirmLabel: `Supprimer ${preview.deletable}`, tone: "clay" });
      if (!ok) return;
      const r = await trackWrite(dedupeBcTasks({ apply: true, windowHours: 0 }), "Nettoyage doublons BC ClickUp");
      toast(`Doublons BC nettoyés — ${r.deleted} supprimée(s)${r.failed ? `, ${r.failed} échec(s)` : ""} sur ${r.groups} N° BC.`, r.failed ? "err" : "ok");
    } catch (e: any) {
      const detail = String(e?.message || e?.code || "").replace(/^functions\//, "");
      toast(detail.includes("deadline") || detail.includes("timeout") ? "Nettoyage BC lancé — traitement en cours côté serveur (voir ClickUp)" : (detail ? `Nettoyage BC refusé — ${detail}` : "Nettoyage BC : échec"), detail.includes("deadline") ? "ok" : "err");
    } finally { setBcDedupeBusy(false); }
  };
  const bcBulkPush = async (force: boolean) => {
    if (bcBulkBusy) return;
    const label = force ? "Resynchroniser TOUTES les tâches BC liées ?" : "Créer les tâches ClickUp de tous les BC non liés ? (les tâches existantes sont adoptées par N° de Commande, pas dupliquées)";
    if (!(await ask(<>{label}<p className="mt-2 text-faint">Astuce : lancez d'abord « Rattacher les BC existants ».</p></>, { title: "Push BC en masse ClickUp", confirmLabel: force ? "Tout resynchroniser" : "Créer les tâches" }))) return;
    setBcBulkBusy(true);
    try {
      const r = await trackWrite(pushAllBcToClickup({ force }), "Push BC ClickUp");
      toast(`Push BC — ${r.created} créé(s), ${r.adopted || 0} rattaché(s), ${r.updated} maj, ${r.skipped} ignoré(s)${r.failed ? `, ${r.failed} échec(s)` : ""} / ${r.total}`, r.failed ? "err" : "ok");
    } catch (e: any) {
      const detail = String(e?.message || e?.code || "").replace(/^functions\//, "");
      toast(detail.includes("deadline") || detail.includes("timeout") ? "Push BC lancé — traitement en cours côté serveur (voir ClickUp)" : (detail ? `Push BC refusé — ${detail}` : "Push BC : échec"), detail.includes("deadline") ? "ok" : "err");
    } finally { setBcBulkBusy(false); }
  };
  const ep = endpoint ?? (data?.webhookEndpoint || CLICKUP_WEBHOOK_ENDPOINT);
  const setupWebhook = async () => {
    if (whBusy) return;
    setWhBusy(true);
    try {
      const r = await trackWrite(setupClickupWebhook(ep), "Webhook ClickUp");
      toast(`Webhook temps réel ${r.created ? "créé" : "mis à jour"}${r.hasSecret ? "" : " (secret manquant — recréez-le)"}`, r.hasSecret ? "ok" : "err");
    } catch (e: any) {
      const detail = String(e?.message || e?.code || "").replace(/^functions\//, "");
      toast(detail ? `Webhook refusé — ${detail}` : "Webhook : échec", "err");
    } finally { setWhBusy(false); }
  };
  const removeWebhook = async () => {
    if (whBusy) return;
    if (!(await ask("Désactiver les webhooks temps réel ? La synchro repassera au tirage quotidien.", { title: "Désactiver le temps réel", confirmLabel: "Désactiver", tone: "clay" }))) return;
    setWhBusy(true);
    try {
      await trackWrite(deleteClickupWebhook(), "Désactivation webhook ClickUp");
      toast("Webhook temps réel désactivé", "ok");
    } catch (e: any) {
      const detail = String(e?.message || e?.code || "").replace(/^functions\//, "");
      toast(detail ? `Désactivation refusée — ${detail}` : "Désactivation : échec", "err");
    } finally { setWhBusy(false); }
  };
  return (
    <Card title="Intégration ClickUp" actions={<Busy label="Enregistrer" okMsg="Config ClickUp enregistrée" fn={save} />}>
      <div className="flex flex-wrap items-center gap-3 text-[13px]">
        <span className="inline-flex items-center gap-2">
          <Toggle checked={on} onChange={setEnabled} ariaLabel="Intégration ClickUp active" /> Intégration active
        </span>
        <label className="inline-flex items-center gap-2">Liste cible (Gestion de Projets)
          <Select ariaLabel="Liste ClickUp cible" className="!py-1" value={list} onChange={setListId} options={CLICKUP_LISTS.map((l) => ({ value: l.id, label: l.label }))} />
        </label>
        <label className="inline-flex items-center gap-2" title="Liste ClickUp DÉDIÉE aux tâches de certification (module Partenariats). Vide = push certifications inactif.">Liste certifications (Partenariats)
          <input className="field !py-1 w-40" value={parCertList} onChange={(e) => setParList(e.target.value)} placeholder="listId dédié (optionnel)" aria-label="Liste ClickUp des certifications" />
        </label>
      </div>
      <div className="mt-3 flex flex-col gap-2.5">
        <ClickupActionRow label="Synchroniser depuis ClickUp">
          <button type="button" className="btn-ghost !py-1.5" disabled={pullBusy} onClick={pull} title="Remonter statut projet + dates depuis ClickUp">
            {pullBusy ? "Synchro…" : "Synchroniser depuis ClickUp"}
          </button>
          <button type="button" className="btn-ghost !py-1.5" disabled={cafBusy} onClick={forceCaf} title="Repousser le CA Facturé de toutes les tâches liées">
            {cafBusy ? "Synchro CAF…" : "Forcer la synchro CAF"}
          </button>
        </ClickupActionRow>
        <ClickupActionRow label="Pousser vers ClickUp" hint="Rattacher AVANT tout push en masse (anti-doublons)">
          <button type="button" className="btn-ghost !py-1.5" disabled={recBusy} onClick={reconcile} title="Rattacher les commandes aux tâches ClickUp DÉJÀ existantes (Opp ID = FP), sans rien créer. À lancer AVANT tout push en masse.">
            {recBusy ? "Rattachement…" : "Rattacher les tâches existantes"}
          </button>
          <button type="button" className="btn-ghost !py-1.5" disabled={bulkBusy} onClick={() => bulkPush(false)} title="Créer les tâches des commandes pas encore liées (adopte automatiquement une tâche existante par Opp ID = FP)">
            {bulkBusy ? "Push…" : "Créer les commandes non liées"}
          </button>
          <button type="button" className="btn-ghost !py-1.5" disabled={bulkBusy} onClick={() => bulkPush(true)} title="Resynchroniser TOUTES les tâches liées (cœur + CAF)">
            {bulkBusy ? "Push…" : "Tout resynchroniser"}
          </button>
        </ClickupActionRow>
        <ClickupActionRow label="Diagnostic & maintenance">
          <button type="button" className="btn-ghost !py-1.5" disabled={healthBusy} onClick={refreshHealth} title="Analyser la qualité de l'intégration (couverture, tâches orphelines, écarts CAF)">
            {healthBusy ? "Diagnostic…" : "Diagnostic qualité"}
          </button>
          <button type="button" className="btn-ghost !py-1.5" disabled={enrichBusy} onClick={enrich} title="Sur chaque tâche commande liée : commentaire de synthèse (CA/RAF, qualité) + jalons de facturation en sous-tâches + BC liés en checklist + tag « à risque »">
            {enrichBusy ? "Enrichissement…" : "Enrichir les tâches"}
          </button>
          <button type="button" className="btn-ghost !py-1.5" disabled={dedupeBusy} onClick={dedupeTasks} title="Supprimer TOUTES les tâches ClickUp dupliquées (même N° FP), toutes époques, créées par des push concurrents. Aperçu (dry-run) puis confirmation ; la tâche liée / la plus ancienne est conservée pour chaque FP.">
            {dedupeBusy ? "Nettoyage…" : "Nettoyer les doublons"}
          </button>
        </ClickupActionRow>
      </div>
      <ClickupHealthPanel health={health} listId={list} onBulkPush={() => bulkPush(false)} />
      {(health?.unlinkedMatchable || 0) > 0 && <div className="text-[12px] text-gold mt-1">{health!.unlinkedMatchable} commande(s) non liée(s) ont pourtant une tâche existante → lance « Rattacher les tâches existantes ».</div>}
      <div className="mt-4 pt-3 border-t border-line">
        <div className="text-[13px] font-medium text-ink mb-2">Bons de commande fournisseurs (liste « Commandes Fournisseurs »)</div>
        <div className="flex flex-wrap items-center gap-3 text-[13px]">
          <button type="button" className="btn-ghost !py-1.5" disabled={bcRecBusy} onClick={bcReconcile} title="Rattacher les BC aux tâches ClickUp DÉJÀ existantes (par N° de Commande), sans rien créer. À lancer AVANT tout push en masse.">
            {bcRecBusy ? "Rattachement…" : "Rattacher les BC existants"}
          </button>
          <button type="button" className="btn-ghost !py-1.5" disabled={bcBulkBusy} onClick={() => bcBulkPush(false)} title="Créer les tâches des BC pas encore liés (adopte automatiquement une tâche existante par N° de Commande)">
            {bcBulkBusy ? "Push…" : "Créer les BC non liés"}
          </button>
          <button type="button" className="btn-ghost !py-1.5" disabled={bcBulkBusy} onClick={() => bcBulkPush(true)} title="Resynchroniser TOUTES les tâches BC liées">
            {bcBulkBusy ? "Push…" : "Tout resynchroniser (BC)"}
          </button>
          <button type="button" className="btn-ghost !py-1.5" disabled={bcPullBusy} onClick={bcPull} title="Remonter l'avancement achat (statut) + l'ETA des tâches BC depuis ClickUp">
            {bcPullBusy ? "Synchro…" : "Synchroniser les BC depuis ClickUp"}
          </button>
          <button type="button" className="btn-ghost !py-1.5" disabled={bcImportBusy} onClick={bcImport} title="Créer dans l'app les BC saisis directement dans ClickUp (dédup par N° BC, statut « émis », conversion XOF). L'import Logistics/PDF reste prioritaire.">
            {bcImportBusy ? "Import…" : "Importer les BC depuis ClickUp"}
          </button>
          <button type="button" className="btn-ghost !py-1.5" disabled={bcDedupeBusy} onClick={bcDedupe} title="Supprimer les tâches BC ClickUp dupliquées (regroupées par N° BC canonique). Aperçu avant suppression ; la tâche liée/la plus ancienne est conservée par N° BC.">
            {bcDedupeBusy ? "Nettoyage…" : "Dédoublonner les BC"}
          </button>
          {bcCu && <span className="text-[12px] text-muted">{bcCu.linkedCount || 0}/{bcCu.totalBc || 0} BC liés{(bcCu.overdueCount || 0) > 0 ? <> · <span className="text-clay">{bcCu.overdueCount} en retard (ETA ClickUp)</span></> : null}</span>}
        </div>
      </div>
      <div className="mt-4 pt-3 border-t border-line">
        <div className="text-[13px] font-medium text-ink mb-2">Temps réel (webhooks) {data?.webhookActive ? <Badge tone="emerald">actif</Badge> : <Badge tone="steel">inactif</Badge>}</div>
        <div className="flex flex-wrap items-center gap-3 text-[13px]">
          <input className="field !py-1.5 w-[26rem] max-w-full font-mono text-[12px]" aria-label="Endpoint du webhook clickupWebhook" value={ep} onChange={(e) => setEndpoint(e.target.value)} placeholder="https://…cloudfunctions.net/clickupWebhook" />
          <button type="button" className="btn-ghost !py-1.5" disabled={whBusy} onClick={setupWebhook} title="Enregistrer / mettre à jour le webhook ClickUp (statut, champs, suppression) pointant vers l'app">
            {whBusy ? "…" : data?.webhookActive ? "Ré-enregistrer le webhook" : "Activer le temps réel"}
          </button>
          {data?.webhookActive && <button type="button" className="btn-ghost !py-1.5" disabled={whBusy} onClick={removeWebhook} title="Supprimer le webhook (retour au tirage quotidien)">Désactiver</button>}
        </div>
        <Tip>Le webhook remonte <b>en secondes</b> les changements ClickUp (statut, dates, champs, avancement BC) sans attendre le tirage quotidien. La signature est vérifiée par <b>HMAC</b> (secret stocké côté serveur). Après un <b>redéploiement des fonctions</b>, vérifiez que l'URL ci-dessus correspond à celle de <code>clickupWebhook</code>, puis ré-enregistrez si besoin.</Tip>
      </div>
      {confirmNode}
      <Tip>Le <b>token API</b> est stocké dans Secret Manager (<code>CLICKUP_TOKEN</code>) — jamais dans l'app. Depuis la liste <b>Commandes</b>, le bouton <b>« ClickUp »</b> crée (ou met à jour) une tâche dans la liste choisie, <b>assignée au PM</b> de la commande. Le <b>CA Facturé</b> est entretenu automatiquement à chaque recalcul (bouton <b>« Forcer la synchro CAF »</b> pour tout repousser) ; le <b>Backlog</b> (RAF) est une formule ClickUp, rien à pousser. Le bouton <b>« Synchroniser depuis ClickUp »</b> (et un tirage quotidien) remonte le <b>statut projet</b>, les <b>dates</b> et le <b>PM assigné</b> dans les Commandes. <b>⚠️ Avant tout push en masse</b>, lancez <b>« Rattacher les tâches existantes »</b> : il relie les commandes aux tâches déjà présentes (Opp ID = N° FP) pour <b>ne pas créer de doublons</b>.</Tip>
    </Card>
  );
}
