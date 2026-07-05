// Console d'ASSAINISSEMENT (gouvernée « import ») : point unique pour nettoyer la base.
//  - Corriger À LA LIGNE : chaque anomalie ouvre l'écran cible pré-filtré (les éditeurs + la
//    suppression par ligne y vivent déjà — cf. remédiation guidée + assainissement lot 1).
//  - Purger EN LOT : le cas clairement « déchet » — les factures orphelines (rattachables à aucune
//    commande) — en une action, plus un raccourci vers le dédoublonnage (doublons).
// NON destructif par défaut : la purge demande confirmation et n'agit que sur des enregistrements
// non rattachables. Le delta reste prioritaire (une source ré-important le record le recrée).
import { type FC } from "react";
import { useDocData, useCollectionData } from "../lib/hooks";
import { useCanImport } from "../lib/rbac";
import { useNav } from "../lib/nav";
import { Card, Tip, Badge, DangerBtn, EmptyState, cx } from "../design/components";
import { deleteRecords } from "../lib/writes";
import { Props } from "./_shared";
import type { DataQualitySummary, Invoice } from "../types";

// Anomalie → écran de correction (miroir du cockpit Qualité). Le drill-through transporte la 1re
// référence en recherche pour arriver directement sur la ligne (éditeur + suppression sur place).
const FIX = (type: string): { module: string; segment?: string } | null => {
  if (type === "factures_orphelines") return { module: "invoicelist", segment: "orphan" };
  if (type.startsWith("factures")) return { module: "invoicelist" };
  if (type.startsWith("commandes") || type === "am_invalide" || type === "surfacturation") return { module: "orderlist" };
  if (type.startsWith("opps")) return { module: "opplist" };
  if (type.startsWith("bc_")) return { module: "bc" };
  if (type.startsWith("fiches")) return { module: "pnlprojet" };
  return null;
};

export const Cleanup: FC<Props> = () => {
  const { data } = useDocData<DataQualitySummary>("summaries/dataQuality");
  const canImport = useCanImport();
  const { go, canGo } = useNav();
  // Factures orphelines chargées seulement si le rôle peut assainir (droit import).
  const { rows: invoices } = useCollectionData<Invoice>(canImport ? "invoices" : null);
  const orphanIds = invoices.filter((r) => r.linked !== true && r.id).map((r) => r.id!) as string[];
  const orphanAmt = invoices.filter((r) => r.linked !== true).reduce((s, r) => s + (r.amountHt || 0), 0);
  const issues = data?.issues || [];
  const tone: Record<string, string> = { high: "clay", medium: "gold", low: "steel" };
  return (
    <div className="flex flex-col gap-4">
      <Card title="Purge en lot">
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-3 flex-wrap text-[13px]">
            <span className="text-ink font-medium">Factures orphelines</span>
            <Badge tone={orphanIds.length ? "clay" : "emerald"}>{orphanIds.length}</Badge>
            {orphanAmt > 0 && <span className="text-muted">{(orphanAmt / 1e9).toFixed(2)} Md non rattachés</span>}
            {orphanIds.length > 0 && (
              <DangerBtn label={`Purger ${orphanIds.length} facture(s)`} okMsg="Factures orphelines purgées (recalcul lancé)"
                confirm={`Supprimer définitivement ${orphanIds.length} facture(s) non rattachée(s) à une commande ? À ne faire que si elles ne doivent pas exister. Un futur import delta les recréera si la source les contient encore.`}
                fn={() => deleteRecords("invoices", orphanIds)} />
            )}
          </div>
          <Tip>Une facture orpheline n'est reliée à aucune commande (N° FP inconnu). Si elle est <b>valide</b>, préférez la <b>rattacher</b> (Factures → Rattacher) ; si c'est un <b>déchet</b> (doublon, test, erreur), purgez-la ici. Les <b>doublons</b> se traitent via le <b>Dédoublonnage</b> (Habilitations).</Tip>
        </div>
      </Card>

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
    </div>
  );
};
