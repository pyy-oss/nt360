// ATELIER DE NORMALISATION CLIENTS — un seul écran, trois blocs, zéro redondance :
//  1) INVENTAIRE : tous les noms bruts (commandes + factures + opps) groupés par CIBLE CANONIQUE
//     (règles déterministes + alias config/clientAliases), avec comptes ;
//  2) FUSIONS PROPOSÉES : détection floue (typos, mot en plus) ET analyse IA dans UNE SEULE liste
//     dédupliquée par graphie source — une proposition disparaît dès qu'un alias la couvre ;
//  3) ALIAS (direction) : la table d'alias éditable, enregistrée via setClientAliases (recompute derrière).
// Lecture gouvernée « import » ; l'édition d'alias reste réservée à la direction (setClientAliases).
import { useState, useEffect, useCallback, useMemo, type FC } from "react";
import { Card, Kpi, Tip, Badge, Table, colText, colNum, raw, Busy, cx } from "../design/components";
import { fmt } from "../design/tokens";
import { useDocData } from "../lib/hooks";
import { useCan } from "../lib/rbac";
import { grid4, type Props } from "./_shared";
import { fuzzyDuplicateClients, setClientAliases, aiSuggestClientMerges, type FuzzyPair, type ClientMergeResult } from "../lib/writes";
import { clientNames, type ClientNamesResult, type ClientNameGroup } from "../lib/clientNormWrites";

type ClientAliasConfig = { pairs?: { from: string; to: string }[] };
// Proposition de fusion UNIFIÉE (flou + IA) : une entrée par graphie SOURCE, quelle que soit sa provenance.
type MergeProposal = { from: string; to: string; confidence: number; source: "flou" | "ia"; reason?: string; corrected?: boolean };

export const ClientNorm: FC<Props> = () => {
  const canEdit = useCan("habilitations") === "write"; // seule la direction pose des alias (setClientAliases)
  const [inv, setInv] = useState<ClientNamesResult | null>(null);
  const [fuzzy, setFuzzy] = useState<FuzzyPair[]>([]);
  const [loading, setLoading] = useState(true);
  const { data: aliasCfg } = useDocData<ClientAliasConfig>(canEdit ? "config/clientAliases" : null);
  const [draft, setDraft] = useState<{ from: string; to: string }[] | null>(null);
  const [aiSug, setAiSug] = useState<ClientMergeResult | null>(null);
  const [sel, setSel] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [i, f] = await Promise.all([clientNames(), fuzzyDuplicateClients().catch(() => null)]);
      setInv(i); setFuzzy(f?.pairs || []);
    } catch { setInv(null); } finally { setLoading(false); }
  }, []);
  useEffect(() => { load().catch(() => {}); }, [load]);

  // Comptes par nom brut (cible d'une fusion floue = la graphie la plus fréquente).
  const countByName = useMemo(() => {
    const m = new Map<string, number>();
    for (const g of inv?.groups || []) for (const v of g.variants) m.set(v.name, v.count);
    return m;
  }, [inv]);

  // Mémoïsé : `aliases` nourrit le useMemo des propositions (dédup) — une référence stable évite de
  // recalculer la liste à chaque rendu quand ni le brouillon ni la config n'ont bougé.
  const aliases = useMemo(() => draft ?? (aliasCfg?.pairs || []), [draft, aliasCfg]);
  const setPair = (idx: number, k: "from" | "to", v: string) => setDraft(aliases.map((r, j) => (j === idx ? { ...r, [k]: v } : r)));
  const delPair = (idx: number) => setDraft(aliases.filter((_, j) => j !== idx));
  const save = async () => { await setClientAliases(aliases.filter((r) => r.from.trim() && r.to.trim())); setDraft(null); };

  // --- FUSIONS PROPOSÉES : flou + IA fusionnés en UNE liste, dédupliquée par graphie source. ---
  // Une graphie DÉJÀ couverte par un alias (posé ou en brouillon) est MASQUÉE : plus de proposition
  // qui traîne après avoir été traitée. À sources égales, l'IA prime (elle porte une justification).
  const proposals = useMemo(() => {
    const covered = new Set(aliases.map((r) => r.from.trim()).filter(Boolean));
    const m = new Map<string, MergeProposal>();
    for (const p of fuzzy) {
      const [to, from] = (countByName.get(p.a) || 0) >= (countByName.get(p.b) || 0) ? [p.a, p.b] : [p.b, p.a];
      if (!from || from === to || covered.has(from)) continue;
      m.set(from, { from, to, confidence: p.score, source: "flou" });
    }
    for (const s of aiSug?.suggestions || []) {
      if (!s.from || s.from === s.to || covered.has(s.from)) continue;
      m.set(s.from, { from: s.from, to: s.to, confidence: s.confidence, source: "ia", reason: s.reason, corrected: !s.existingTarget });
    }
    return [...m.values()].sort((a, b) => b.confidence - a.confidence);
  }, [fuzzy, aiSug, aliases, countByName]);

  // Inventaire des graphies distinctes (avec fréquence) envoyé à l'IA, borné au plafond serveur —
  // la troncature est SIGNALÉE (jamais silencieuse).
  const aiNames = useMemo(() => [...countByName.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count).slice(0, 400), [countByName]);
  const aiCapped = countByName.size > aiNames.length;
  const runAi = async () => {
    const r = await aiSuggestClientMerges(aiNames);
    // Auto-sélection des fusions IA ≥ 90 % (« automatique à 90 % ») ; le reste demande un arbitrage.
    setSel((p) => new Set([...p, ...r.suggestions.filter((s) => s.confidence >= 0.9).map((s) => s.from)]));
    setAiSug(r);
  };
  const toggle = (from: string) => setSel((p) => { const n = new Set(p); n.has(from) ? n.delete(from) : n.add(from); return n; });
  // Pose les fusions cochées comme alias (brouillon) — l'humain enregistre ensuite (setClientAliases).
  // Les propositions couvertes disparaissent de la liste par construction (dédup vs `aliases`).
  const picked = proposals.filter((p) => sel.has(p.from));
  const applySelected = () => {
    if (!picked.length) return;
    setDraft([...aliases.filter((r) => !picked.some((p) => p.from === r.from.trim())), ...picked.map((p) => ({ from: p.from, to: p.to }))]);
    setSel(new Set());
  };
  const confTone = (c: number): "emerald" | "gold" | "clay" => (c >= 0.9 ? "emerald" : c >= 0.7 ? "gold" : "clay");

  return (
    <div className="flex flex-col gap-4">
      <Card title="Normalisation clients — atelier"
        actions={<Busy variant="ghost" label="Rafraîchir" okMsg="Inventaire à jour" fn={load} />}>
        {loading && !inv ? <div className="text-[13px] text-muted py-2">Analyse des noms de clients…</div> : !inv ? (
          <Tip>Inventaire indisponible.</Tip>
        ) : (
          <>
            <div className={grid4}>
              <Kpi label="Noms distincts" value={fmt(inv.distinctNames)} sub="graphies brutes (cmd + fact + opp)" tone="steel" />
              <Kpi label="Clients canoniques" value={fmt(inv.distinctCanon)} sub="après règles + alias" tone="steel" />
              <Kpi label="Graphies regroupées" value={fmt(inv.toReview)} sub="clients à ≥ 2 orthographes" tone={inv.toReview ? "gold" : "emerald"} />
              <Kpi label="Alias posés" value={fmt(inv.aliasCount)} sub="fusions manuelles actives" tone="steel" />
            </div>
            {inv.capped && <Tip><b>Analyse partielle</b> : volume trop important pour un scan intégral — certains noms peu fréquents peuvent manquer.</Tip>}
          </>
        )}
      </Card>

      {/* FUSIONS PROPOSÉES — détection floue + IA dans une seule liste (une entrée par graphie source). */}
      {(proposals.length > 0 || (canEdit && aiNames.length > 0)) && (
        <Card title={proposals.length ? `Fusions proposées · ${fmt(proposals.length)}` : "Fusions proposées"}
          actions={
            <div className="flex flex-wrap items-center gap-2">
              {canEdit && picked.length > 0 && <button type="button" className="btn-ghost !px-2.5 !py-1 text-xs" onClick={applySelected}>Ajouter {picked.length} à la liste</button>}
              {canEdit && aiNames.length > 0 && <Busy variant="gold" label={aiSug ? "Réanalyser (IA)" : "Doper à l'IA"} okMsg="Analyse IA prête" errMsg="Analyse IA indisponible" fn={runAi} />}
            </div>}>
          {proposals.length === 0 ? (
            <Tip>Aucune fusion en attente{aiSug ? " — la détection floue et l'IA n'ont rien trouvé de plus" : ""}. « <b>Doper à l'IA</b> » juge quelles graphies désignent la <b>même entité</b> (abréviations, mots manquants, formes juridiques) au-delà des quasi-doublons flous, en évitant les faux rapprochements (« ORANGE » ≠ « ORANGE BANK »).</Tip>
          ) : (
            <>
              <Table colsKey="clientnorm-merge" columns={[
                ...(canEdit ? [raw(colText("", (p: MergeProposal) => (
                  <input type="checkbox" className="accent-gold" checked={sel.has(p.from)} onChange={() => toggle(p.from)} aria-label={`Sélectionner ${p.from}`} />
                )))] : []),
                colText("Graphie", (p: MergeProposal) => p.from, (p: MergeProposal) => p.from),
                colText("→ Cible canonique", (p: MergeProposal) => (
                  <span>{p.to} {p.corrected && <span className="text-[10px] text-gold" title="Graphie corrigée par l'IA (absente de l'inventaire)">· corrigée</span>}</span>
                ), (p: MergeProposal) => p.to),
                colNum("Confiance", (p: MergeProposal) => <Badge tone={confTone(p.confidence)}>{Math.round(p.confidence * 100)} %</Badge>, (p: MergeProposal) => p.confidence),
                colText("Source", (p: MergeProposal) => <Badge tone={p.source === "ia" ? "gold" : "steel"}>{p.source === "ia" ? "IA" : "flou"}</Badge>, (p: MergeProposal) => p.source),
                colText("Analyse", (p: MergeProposal) => <span className="text-[12px] text-muted">{p.reason || "—"}</span>),
              ]} rows={proposals} />
              <Tip><b>flou</b> = quasi-doublon détecté par proximité (typos, mot en plus) — la graphie la plus fréquente devient la cible ; <b>IA</b> = même entité jugée au-delà du flou (abréviations, formes juridiques), fusions ≥ 90 % pré-cochées. Cochez puis « <b>Ajouter à la liste</b> » : les fusions deviennent des alias ci-dessous, à <b>enregistrer</b> pour lancer le recalcul — rien n'est appliqué automatiquement. Une proposition disparaît dès qu'un alias la couvre.{aiCapped ? ` Analyse IA bornée aux ${aiNames.length} graphies les plus fréquentes (sur ${fmt(countByName.size)}).` : ""}</Tip>
            </>
          )}
        </Card>
      )}

      {/* Table d'alias éditable (direction) */}
      {canEdit && (
        <Card title="Alias de normalisation" actions={
          <div className="flex gap-2">
            <button type="button" className="btn-ghost !px-2.5 !py-1 text-xs" onClick={() => setDraft([...aliases, { from: "", to: "" }])}>+ Alias</button>
            <Busy label="Enregistrer" okMsg="Alias enregistrés (recalcul lancé)" fn={save} />
          </div>}>
          <div className="flex flex-col gap-1.5">
            {aliases.length ? aliases.map((r, i) => (
              <div key={i} className="flex items-center gap-2">
                <input className="field !py-1 flex-1" placeholder="Variante (ex. SGBCI)" value={r.from} onChange={(e) => setPair(i, "from", e.target.value)} aria-label={`Variante ${i + 1}`} />
                <span className="text-muted" aria-hidden="true">→</span>
                <input className="field !py-1 flex-1" placeholder="Nom canonique (ex. Société Générale)" value={r.to} onChange={(e) => setPair(i, "to", e.target.value)} aria-label={`Nom canonique ${i + 1}`} />
                <button type="button" className="btn-ghost !px-2 !py-1" onClick={() => delPair(i)} aria-label={`Supprimer l'alias ${i + 1}`}>×</button>
              </div>
            )) : <div className="text-[13px] text-muted">Aucun alias — les noms sont normalisés par règles automatiques.</div>}
          </div>
          <Tip>Règles automatiques d'abord (MAJUSCULES, accents, ponctuation, formes juridiques SA/SARL…, suffixe « Côte d'Ivoire »/« CI »). Un <b>alias</b> fusionne deux graphies que les règles ne rapprochent pas (ex. « SGBCI » → « Société Générale »). L'enregistrement relance un recalcul complet ; les <b>documents sources ne sont pas modifiés</b>.</Tip>
        </Card>
      )}

      {/* Inventaire complet groupé par cible canonique */}
      {inv && inv.groups.length > 0 && (
        <Card title="Inventaire des clients (par nom canonique)">
          <Table colsKey="clientnorm-inv" columns={[
            colText("Nom canonique", (g: ClientNameGroup) => g.canon, (g: ClientNameGroup) => g.canon),
            colNum("Docs", (g: ClientNameGroup) => fmt(g.total), (g: ClientNameGroup) => g.total),
            colNum("Graphies", (g: ClientNameGroup) => String(g.distinct), (g: ClientNameGroup) => g.distinct),
            raw(colText("Variantes", (g: ClientNameGroup) => (
              <span className="inline-flex flex-wrap gap-1">
                {g.variants.slice(0, 6).map((v, i) => (
                  <span key={i} className={cx("rounded px-1.5 py-0.5 text-[10px] whitespace-nowrap", v.aliased ? "bg-gold/15 text-gold" : "bg-panel2 text-muted")} title={v.aliased ? "graphie aliasée" : undefined}>{v.name} · {v.count}</span>
                ))}
                {g.variants.length > 6 && <span className="text-[10px] text-faint">+{g.variants.length - 6}</span>}
              </span>
            ))),
          ]} rows={inv.groups} />
          <Tip>Chaque ligne = un client <b>canonique</b> et les graphies brutes qui s'y regroupent (déjà) — les variantes <span className="text-gold">dorées</span> sont fusionnées par un alias. Les lignes à plusieurs graphies confirment la normalisation ; utilisez les <b>fusions proposées</b> ci-dessus pour rapprocher les clients qui devraient l'être et ne le sont pas.</Tip>
        </Card>
      )}
    </div>
  );
};
