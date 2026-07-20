// ATELIER DE NORMALISATION FOURNISSEURS — variante MINIMALE (ADR-046) : un écran pour piloter la
// normalisation des noms fournisseurs sans IA :
//  1) INVENTAIRE : noms bruts (commandes + BC + factures fournisseur) groupés par CLÉ CANONIQUE
//     (`cleanName` + alias config/supplierAliases), avec comptes → on voit les graphies déjà regroupées ;
//  2) ALIAS MANUELS : table éditable, enregistrée via setSupplierAliases (recompute SOA derrière).
// Contrairement aux clients, PAS de règles juridiques/pays ni d'IA : la clé reste `cleanName` (ADR-P20).
// Lecture ET édition gouvernées par le droit `fournisseurs` (même droit que le référentiel fournisseur).
import { useState, useEffect, useCallback, type FC } from "react";
import { Card, Kpi, Tip, Table, colText, colNum, raw, Busy, cx } from "../design/components";
import { fmt } from "../design/tokens";
import { useDocData } from "../lib/hooks";
import { useCan } from "../lib/rbac";
import { grid4 } from "./_shared";
import { supplierNames, setSupplierAliases, type SupplierNamesResult, type SupplierNameGroup } from "../lib/supplierNormWrites";

type SupplierAliasConfig = { pairs?: { from: string; to: string }[] };

// Rendu comme SECTION du référentiel Fournisseurs (fournisseursref) — pas un onglet séparé (ADR-046).
export const SupplierNorm: FC = () => {
  const canEdit = useCan("fournisseurs") === "write"; // même droit que le référentiel fournisseur (pas direction-only)
  const [inv, setInv] = useState<SupplierNamesResult | null>(null);
  const [loading, setLoading] = useState(true);
  const { data: aliasCfg } = useDocData<SupplierAliasConfig>(canEdit ? "config/supplierAliases" : null);
  const [draft, setDraft] = useState<{ from: string; to: string }[] | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try { setInv(await supplierNames()); } catch { setInv(null); } finally { setLoading(false); }
  }, []);
  useEffect(() => { load().catch(() => {}); }, [load]);

  const aliases = draft ?? (aliasCfg?.pairs || []);
  const setPair = (idx: number, k: "from" | "to", v: string) => setDraft(aliases.map((r, j) => (j === idx ? { ...r, [k]: v } : r)));
  const addPair = () => setDraft([...aliases, { from: "", to: "" }]);
  const delPair = (idx: number) => setDraft(aliases.filter((_, j) => j !== idx));
  const save = async () => { await setSupplierAliases(aliases.filter((r) => r.from.trim() && r.to.trim())); setDraft(null); };

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
