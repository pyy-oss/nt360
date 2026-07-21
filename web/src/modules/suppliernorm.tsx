// ATELIER DE NORMALISATION FOURNISSEURS — un écran pour piloter la normalisation des noms fournisseurs :
//  1) INVENTAIRE : noms bruts (commandes + BC + factures fournisseur) groupés par CLÉ CANONIQUE
//     (`cleanName` + alias config/supplierAliases), avec comptes → on voit les graphies déjà regroupées ;
//  2) FUSIONS PROPOSÉES (IA, ADR-065 — lève la variante « sans IA » de l'ADR-046) : même pipeline que les
//     clients (aiSuggestClientMerges, entity "fournisseur"), l'IA propose / l'humain enregistre ;
//  3) ALIAS MANUELS : table éditable, enregistrée via setSupplierAliases (recompute SOA derrière).
// La clé canonique reste STRICTEMENT `cleanName` (ADR-P20) — l'IA ne produit que des ALIAS, jamais une
// nouvelle sémantique de clé. Lecture ET édition gouvernées par le droit `fournisseurs`.
import { useState, useEffect, useCallback, useMemo, type FC } from "react";
import { Card, Kpi, Tip, Badge, Table, colText, colNum, raw, Busy, cx } from "../design/components";
import { fmt } from "../design/tokens";
import { useDocData } from "../lib/hooks";
import { useCan } from "../lib/rbac";
import { grid4 } from "./_shared";
import { supplierNames, setSupplierAliases, type SupplierNamesResult, type SupplierNameGroup } from "../lib/supplierNormWrites";
import { aiSuggestClientMerges, type ClientMergeResult } from "../lib/writes";

type SupplierAliasConfig = { pairs?: { from: string; to: string }[] };

// Rendu comme SECTION du référentiel Fournisseurs (fournisseursref) — pas un onglet séparé (ADR-046).
export const SupplierNorm: FC = () => {
  const canEdit = useCan("fournisseurs") === "write"; // même droit que le référentiel fournisseur (pas direction-only)
  const [inv, setInv] = useState<SupplierNamesResult | null>(null);
  const [loading, setLoading] = useState(true);
  const { data: aliasCfg } = useDocData<SupplierAliasConfig>(canEdit ? "config/supplierAliases" : null);
  const [draft, setDraft] = useState<{ from: string; to: string }[] | null>(null);
  const [aiSug, setAiSug] = useState<ClientMergeResult | null>(null);
  const [sel, setSel] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    try { setInv(await supplierNames()); } catch { setInv(null); } finally { setLoading(false); }
  }, []);
  useEffect(() => { load().catch(() => {}); }, [load]);

  // Mémoïsé : nourrit la dédup des propositions IA (référence stable, cf. clientnorm).
  const aliases = useMemo(() => draft ?? (aliasCfg?.pairs || []), [draft, aliasCfg]);
  const setPair = (idx: number, k: "from" | "to", v: string) => setDraft(aliases.map((r, j) => (j === idx ? { ...r, [k]: v } : r)));
  const addPair = () => setDraft([...aliases, { from: "", to: "" }]);
  const delPair = (idx: number) => setDraft(aliases.filter((_, j) => j !== idx));
  const save = async () => { await setSupplierAliases(aliases.filter((r) => r.from.trim() && r.to.trim())); setDraft(null); };

  // --- FUSIONS PROPOSÉES (IA) — même gouvernance que les clients : l'IA propose, l'humain enregistre.
  // Inventaire (graphie + fréquence) borné au plafond serveur ; troncature SIGNALÉE, jamais silencieuse.
  const aiNames = useMemo(() => {
    const m = new Map<string, number>();
    for (const g of inv?.groups || []) for (const v of g.variants) m.set(v.name, v.count);
    return [...m.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count).slice(0, 400);
  }, [inv]);
  const runAi = async () => {
    const r = await aiSuggestClientMerges(aiNames, "fournisseur");
    // Auto-sélection des fusions IA ≥ 90 % (même seuil que les clients) ; le reste demande un arbitrage.
    setSel((p) => new Set([...p, ...r.suggestions.filter((s) => s.confidence >= 0.9).map((s) => s.from)]));
    setAiSug(r);
  };
  // Une proposition DISPARAÎT dès qu'un alias (posé ou brouillon) couvre sa graphie source.
  const proposals = useMemo(() => {
    const covered = new Set(aliases.map((r) => r.from.trim()).filter(Boolean));
    return (aiSug?.suggestions || []).filter((s) => s.from && s.from !== s.to && !covered.has(s.from));
  }, [aiSug, aliases]);
  const toggle = (from: string) => setSel((p) => { const n = new Set(p); n.has(from) ? n.delete(from) : n.add(from); return n; });
  const picked = proposals.filter((s) => sel.has(s.from));
  const applySelected = () => {
    if (!picked.length) return;
    setDraft([...aliases.filter((r) => !picked.some((p) => p.from === r.from.trim())), ...picked.map((p) => ({ from: p.from, to: p.to }))]);
    setSel(new Set());
  };
  const confTone = (c: number): "emerald" | "gold" | "clay" => (c >= 0.9 ? "emerald" : c >= 0.7 ? "gold" : "clay");

  return (
    <div className="flex flex-col gap-4">
      <Card title="Normalisation fournisseurs — atelier"
        actions={<Busy variant="ghost" label="Rafraîchir" okMsg="Inventaire à jour" fn={load} />}>
        {loading && !inv ? <div className="text-[13px] text-muted py-2">Analyse des noms de fournisseurs…</div> : !inv ? (
          <Tip>Inventaire indisponible.</Tip>
        ) : (
          <>
            <div className={grid4}>
              <Kpi label="Noms distincts" value={fmt(inv.distinctNames)} sub="graphies brutes (cmd + BC + fact.)" tone="steel" />
              <Kpi label="Fournisseurs canoniques" value={fmt(inv.distinctCanon)} sub="après cleanName + alias" tone="steel" />
              <Kpi label="Graphies regroupées" value={fmt(inv.toReview)} sub="fournisseurs à ≥ 2 orthographes" tone={inv.toReview ? "gold" : "emerald"} />
              <Kpi label="Alias posés" value={fmt(inv.aliasCount)} sub="fusions manuelles actives" tone="steel" />
            </div>
            {inv.capped && <Tip><b>Analyse partielle</b> : volume trop important pour un scan intégral — certains noms peu fréquents peuvent manquer.</Tip>}
          </>
        )}
      </Card>

      {/* FUSIONS PROPOSÉES (IA) — même pipeline que la normalisation clients, entité « fournisseur ». */}
      {canEdit && aiNames.length > 0 && (
        <Card title={proposals.length ? `Fusions proposées (IA) · ${fmt(proposals.length)}` : "Fusions proposées (IA)"}
          actions={
            <div className="flex flex-wrap items-center gap-2">
              {picked.length > 0 && <button type="button" className="btn-ghost !px-2.5 !py-1 text-xs" onClick={applySelected}>Ajouter {picked.length} à la liste</button>}
              <Busy variant="gold" label={aiSug ? "Réanalyser (IA)" : "Doper à l'IA"} okMsg="Analyse IA prête" errMsg="Analyse IA indisponible" fn={runAi} />
            </div>}>
          {!aiSug ? (
            <Tip>L'<b>IA</b> juge quelles graphies désignent le <b>même fournisseur</b> — abréviations (« EXN » = « EXCLUSIVE NETWORKS »), mots manquants, formes juridiques — en évitant les faux rapprochements (deux lignes d'achat distinctes ne fusionnent pas). Les fusions <b>≥ 90 %</b> sont pré-cochées ; « Ajouter à la liste » les pose comme alias (à <b>enregistrer</b> ensuite). Rien n'est appliqué automatiquement.{aiNames.length >= 400 ? ` Analyse bornée aux ${aiNames.length} graphies les plus fréquentes.` : ""}</Tip>
          ) : proposals.length === 0 ? (
            <Tip>Aucune fusion en attente — l'IA n'a rien trouvé de plus sur cet inventaire.{aiSug.truncated ? ` (Analyse bornée aux ${aiSug.analyzed} graphies les plus fréquentes.)` : ""}</Tip>
          ) : (
            <>
              <Table colsKey="suppliernorm-ai" columns={[
                raw(colText("", (s: (typeof proposals)[number]) => (
                  <input type="checkbox" className="accent-gold" checked={sel.has(s.from)} onChange={() => toggle(s.from)} aria-label={`Sélectionner ${s.from}`} />
                ))),
                colText("Graphie", (s: (typeof proposals)[number]) => s.from, (s: (typeof proposals)[number]) => s.from),
                colText("→ Cible canonique", (s: (typeof proposals)[number]) => (
                  <span>{s.to} {!s.existingTarget && <span className="text-[10px] text-gold" title="Graphie corrigée par l'IA (absente de l'inventaire)">· corrigée</span>}</span>
                ), (s: (typeof proposals)[number]) => s.to),
                colNum("Confiance", (s: (typeof proposals)[number]) => <Badge tone={confTone(s.confidence)}>{Math.round(s.confidence * 100)} %</Badge>, (s: (typeof proposals)[number]) => s.confidence),
                colText("Analyse", (s: (typeof proposals)[number]) => <span className="text-[12px] text-muted">{s.reason || "—"}</span>),
              ]} rows={proposals} />
              <Tip>Cochez puis « <b>Ajouter à la liste</b> » : les fusions deviennent des alias ci-dessous, à <b>enregistrer</b> pour lancer le recalcul (SOA) — rien n'est appliqué automatiquement. Une proposition disparaît dès qu'un alias la couvre.{aiSug.truncated ? ` Analyse bornée aux ${aiSug.analyzed} graphies les plus fréquentes.` : ""}</Tip>
            </>
          )}
        </Card>
      )}

      {/* Table d'alias manuels éditable (droit fournisseurs) */}
      {canEdit && (
        <Card title="Alias de normalisation" actions={
          <div className="flex gap-2">
            <button type="button" className="btn-ghost !px-2.5 !py-1 text-xs" onClick={addPair}>+ Alias</button>
            <Busy label="Enregistrer" okMsg="Alias enregistrés (recalcul lancé)" fn={save} />
          </div>}>
          <div className="flex flex-col gap-1.5">
            {aliases.length ? aliases.map((r, i) => (
              <div key={i} className="flex items-center gap-2">
                <input className="field !py-1 flex-1" placeholder="Variante (ex. SAMSUNG ELECTRONICS)" value={r.from} onChange={(e) => setPair(i, "from", e.target.value)} aria-label={`Variante ${i + 1}`} />
                <span className="text-muted" aria-hidden="true">→</span>
                <input className="field !py-1 flex-1" placeholder="Nom canonique (ex. SAMSUNG)" value={r.to} onChange={(e) => setPair(i, "to", e.target.value)} aria-label={`Nom canonique ${i + 1}`} />
                <button type="button" className="btn-ghost !px-2 !py-1" onClick={() => delPair(i)} aria-label={`Supprimer l'alias ${i + 1}`}>×</button>
              </div>
            )) : <div className="text-[13px] text-muted">Aucun alias — les noms sont normalisés par la clé canonique (espaces, casse).</div>}
          </div>
          <Tip>La clé canonique (<b>cleanName</b> : espaces compactés, casse, ADR-P20) regroupe déjà les graphies « à un espace/casse près ». Un <b>alias manuel</b> fusionne EN PLUS deux graphies que cleanName ne rapproche pas (ex. « SAMSUNG ELECTRONICS » → « SAMSUNG »). L'enregistrement relance un recalcul complet ; les <b>documents sources ne sont pas modifiés</b> (overlay).</Tip>
        </Card>
      )}

      {/* Inventaire complet groupé par clé canonique */}
      {inv && inv.groups.length > 0 && (
        <Card title="Inventaire des fournisseurs (par nom canonique)">
          <Table colsKey="suppliernorm-inv" columns={[
            colText("Nom canonique", (g: SupplierNameGroup) => g.canon, (g: SupplierNameGroup) => g.canon),
            colNum("Occurrences", (g: SupplierNameGroup) => fmt(g.total), (g: SupplierNameGroup) => g.total),
            colNum("Graphies", (g: SupplierNameGroup) => String(g.distinct), (g: SupplierNameGroup) => g.distinct),
            raw(colText("Variantes", (g: SupplierNameGroup) => (
              <span className="inline-flex flex-wrap gap-1">
                {g.variants.slice(0, 6).map((v, i) => (
                  <span key={i} className={cx("rounded px-1.5 py-0.5 text-[10px] whitespace-nowrap", v.aliased ? "bg-gold/15 text-gold" : "bg-panel2 text-muted")} title={v.aliased ? "graphie aliasée" : undefined}>{v.name} · {v.count}</span>
                ))}
                {g.variants.length > 6 && <span className="text-[10px] text-faint">+{g.variants.length - 6}</span>}
              </span>
            ))),
          ]} rows={inv.groups} />
          <Tip>Chaque ligne = un fournisseur <b>canonique</b> et les graphies brutes qui s'y regroupent — les variantes <span className="text-gold">dorées</span> sont fusionnées par un alias manuel. Les lignes à plusieurs graphies confirment le regroupement ; posez un <b>alias</b> ci-dessus pour rapprocher les fournisseurs qui devraient l'être et ne le sont pas.</Tip>
        </Card>
      )}
    </div>
  );
};
