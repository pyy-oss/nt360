// ATELIER DE NORMALISATION CLIENTS — un seul écran pour piloter la normalisation des noms de clients :
//  1) INVENTAIRE : tous les noms bruts (commandes + factures + opps) groupés par CIBLE CANONIQUE
//     (règles déterministes + alias config/clientAliases), avec comptes → on voit les graphies qui se
//     rejoignent déjà et celles isolées ;
//  2) QUASI-DOUBLONS : suggestions floues (typos, mot en plus) à fusionner d'un clic ;
//  3) ALIAS (direction) : la table d'alias éditable, enregistrée via setClientAliases (recompute derrière).
// Lecture gouvernée « import » ; l'édition d'alias reste réservée à la direction (setClientAliases).
import { useState, useEffect, useCallback, useMemo, type FC } from "react";
import { Card, Kpi, Tip, Table, colText, colNum, raw, Busy, cx } from "../design/components";
import { fmt } from "../design/tokens";
import { useDocData } from "../lib/hooks";
import { useCan } from "../lib/rbac";
import { grid4, type Props } from "./_shared";
import { fuzzyDuplicateClients, setClientAliases, type FuzzyPair } from "../lib/writes";
import { clientNames, type ClientNamesResult, type ClientNameGroup } from "../lib/clientNormWrites";

type ClientAliasConfig = { pairs?: { from: string; to: string }[] };

export const ClientNorm: FC<Props> = () => {
  const canEdit = useCan("habilitations") === "write"; // seule la direction pose des alias (setClientAliases)
  const [inv, setInv] = useState<ClientNamesResult | null>(null);
  const [fuzzy, setFuzzy] = useState<FuzzyPair[]>([]);
  const [loading, setLoading] = useState(true);
  const { data: aliasCfg } = useDocData<ClientAliasConfig>(canEdit ? "config/clientAliases" : null);
  const [draft, setDraft] = useState<{ from: string; to: string }[] | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [i, f] = await Promise.all([clientNames(), fuzzyDuplicateClients().catch(() => null)]);
      setInv(i); setFuzzy(f?.pairs || []);
    } catch { setInv(null); } finally { setLoading(false); }
  }, []);
  useEffect(() => { load().catch(() => {}); }, [load]);

  // Comptes par nom brut (pour choisir la cible d'une fusion floue = la graphie la plus fréquente).
  const countByName = useMemo(() => {
    const m = new Map<string, number>();
    for (const g of inv?.groups || []) for (const v of g.variants) m.set(v.name, v.count);
    return m;
  }, [inv]);

  const aliases = draft ?? (aliasCfg?.pairs || []);
  const setPair = (idx: number, k: "from" | "to", v: string) => setDraft(aliases.map((r, j) => (j === idx ? { ...r, [k]: v } : r)));
  const addPair = (p: { from: string; to: string }) => setDraft([...(aliases.filter((r) => r.from.trim() !== p.from)), p]);
  const delPair = (idx: number) => setDraft(aliases.filter((_, j) => j !== idx));
  const save = async () => { await setClientAliases(aliases.filter((r) => r.from.trim() && r.to.trim())); setDraft(null); };
  // Fusion depuis une suggestion floue : la graphie la plus fréquente devient la cible.
  const mergeFuzzy = (p: FuzzyPair) => {
    const [to, from] = (countByName.get(p.a) || 0) >= (countByName.get(p.b) || 0) ? [p.a, p.b] : [p.b, p.a];
    addPair({ from, to });
  };

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

      {/* Suggestions de quasi-doublons (fusion en un clic — réservée à la direction) */}
      {fuzzy.length > 0 && (
        <Card title={`Quasi-doublons détectés · ${fmt(fuzzy.length)}`}>
          <Table colsKey="clientnorm-fuzzy" columns={[
            colText("Graphie A", (p: FuzzyPair) => p.a, (p: FuzzyPair) => p.a),
            colText("Graphie B", (p: FuzzyPair) => p.b, (p: FuzzyPair) => p.b),
            colNum("Proximité", (p: FuzzyPair) => `${Math.round(p.score * 100)}%`, (p: FuzzyPair) => p.score),
            ...(canEdit ? [colText("", (p: FuzzyPair) => (
              <button type="button" className="btn-ghost !px-2 !py-1 text-xs" onClick={() => mergeFuzzy(p)} title="Créer un alias (la graphie la plus fréquente devient la cible)">Fusionner</button>
            ))] : []),
          ]} rows={fuzzy} />
          <Tip>Rapprochements <b>flous</b> (typos, mot en plus) que la normalisation exacte n'a pas fusionnés. « Fusionner » ajoute un <b>alias</b> ci-dessous (à enregistrer) — la graphie la plus fréquente devient la cible.</Tip>
        </Card>
      )}

      {/* Table d'alias éditable (direction) */}
      {canEdit && (
        <Card title="Alias de normalisation" actions={
          <div className="flex gap-2">
            <button type="button" className="btn-ghost !px-2.5 !py-1 text-xs" onClick={() => addPair({ from: "", to: "" })}>+ Alias</button>
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
          <Tip>Chaque ligne = un client <b>canonique</b> et les graphies brutes qui s'y regroupent (déjà) — les variantes <span className="text-gold">dorées</span> sont fusionnées par un alias. Les lignes à plusieurs graphies confirment la normalisation ; utilisez les <b>quasi-doublons</b> ci-dessus pour rapprocher les clients qui devraient l'être et ne le sont pas.</Tip>
        </Card>
      )}
    </div>
  );
};
