// Module « Relances & anticipation » : plan d'actions DATÉ par responsable, en trois familles —
// créances échues (relance client), BC en retard (relance fournisseur/livraison), jalons échus non
// facturés (facturation à émettre). Chaque famille lit un summary CLOISONNÉ par module : la section
// n'est affichée que si le rôle a le droit correspondant (facturation / fournisseurs / backlog),
// sinon l'abonnement n'est pas ouvert (name null) et la carte est masquée. Aucune donnée de marge.
import { type FC, type ReactNode } from "react";
import { useDocData } from "../lib/hooks";
import { useCan } from "../lib/rbac";
import { useNav } from "../lib/nav";
import { Card, Kpi, Table, Badge, Tip, EmptyState, colText, colNum, money, det, cx } from "../design/components";
import { Props, grid4, bcLabel, FpLink } from "./_shared";
import type { RelanceCreances, RelanceBc, RelanceJalons, RelanceResp } from "../types";

// Ancienneté du retard → ton d'urgence (plus c'est vieux, plus c'est chaud).
const lateBadge = (d: number): ReactNode => (
  <Badge tone={d > 90 ? "clay" : d > 30 ? "gold" : "steel"}>{d} j</Badge>
);

// Bandeau « par responsable » : qui doit agir, combien d'actions, quel montant.
function RespChips({ rows }: { rows?: RelanceResp[] }) {
  if (!rows || !rows.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5 mb-2">
      {rows.slice(0, 8).map((r) => (
        <span key={r.key} className="inline-flex items-center gap-1 rounded-full border border-line px-2 py-0.5 text-[11px]">
          <span className="font-medium">{r.key}</span>
          <span className="text-faint">· {r.count} · {money(r.total)}</span>
        </span>
      ))}
    </div>
  );
}

export const Relances: FC<Props> = () => {
  const canFact = useCan("facturation") !== "none";
  const canFour = useCan("fournisseurs") !== "none";
  const canBack = useCan("backlog") !== "none";
  const { go } = useNav();
  // Abonnements gatés par le droit : pas d'accès → name null → aucune lecture (fail-closed côté rules aussi).
  const { data: cre } = useDocData<RelanceCreances>(canFact ? "summaries/relancesCreances" : null);
  const { data: bc } = useDocData<RelanceBc>(canFour ? "summaries/relancesBc" : null);
  const { data: jal } = useDocData<RelanceJalons>(canBack ? "summaries/relancesJalons" : null);

  if (!canFact && !canFour && !canBack) {
    return <EmptyState label="Aucune famille de relance accessible avec votre rôle." />;
  }
  const asOf = cre?.asOf || bc?.asOf || jal?.asOf;

  return (
    <div className="flex flex-col gap-4">
      <div className={grid4}>
        {canFact && <Kpi label="Créances échues" value={(cre?.count || 0).toLocaleString("fr-FR")} tone={cre?.count ? "clay" : "ink"} sub={`${money(cre?.total || 0)} à recouvrer`} />}
        {canFour && <Kpi label="BC en retard" value={(bc?.count || 0).toLocaleString("fr-FR")} tone={bc?.count ? "gold" : "ink"} sub={`${money(bc?.total || 0)} exposés`} />}
        {canBack && <Kpi label="Jalons échus non facturés" value={(jal?.count || 0).toLocaleString("fr-FR")} tone={jal?.count ? "gold" : "ink"} sub={`${money(jal?.total || 0)} à émettre`} />}
        <Kpi label="À date" value={asOf ? asOf.slice(8, 10) + "/" + asOf.slice(5, 7) : "—"} sub="dernier recalcul" />
      </div>

      {canFact && (
        <Card title={`Créances échues · relance client${cre?.count ? ` · ${cre.count}` : ""}`}>
          <RespChips rows={cre?.byResp} />
          {cre?.items?.length ? (
            <Table columns={[
              colText("Échéance", (r: any) => <span className="tabnum">{r.dueDate}</span>, (r: any) => r.dueDate),
              colText("Retard", (r: any) => lateBadge(r.daysLate), (r: any) => r.daysLate),
              colText("Client", (r: any) => r.client, (r: any) => r.client),
              colText("Commercial", (r: any) => <Badge tone="steel">{r.am}</Badge>, (r: any) => r.am),
              colText("N° facture", (r: any) => (r.fp ? <FpLink fp={r.fp} /> : <span className="text-faint">{r.numero}</span>), (r: any) => r.numero),
              colNum("Montant", (r: any) => money(r.amount), (r: any) => r.amount),
            ]} rows={cre.items} colsKey="relances-creances" />
          ) : <EmptyState label="Aucune créance échue — rien à relancer." />}
          <Tip>Factures ouvertes dont l'échéance est dépassée, triées par ancienneté. <button className="text-gold underline underline-offset-2 hover:opacity-80" onClick={() => go("invoicelist", { segment: "orphan" })}>Ouvrir les factures</button> pour agir (rattachement, dates).</Tip>
        </Card>
      )}

      {canFour && (
        <Card title={`BC en retard · relance fournisseur${bc?.count ? ` · ${bc.count}` : ""}`}>
          <RespChips rows={bc?.byResp} />
          {bc?.items?.length ? (
            <Table columns={[
              colText("ETA", (r: any) => <span className="tabnum">{r.eta}</span>, (r: any) => r.eta),
              colText("Retard", (r: any) => lateBadge(r.daysLate), (r: any) => r.daysLate),
              colText("Fournisseur", (r: any) => r.supplier, (r: any) => r.supplier),
              colText("Client", (r: any) => r.customer, (r: any) => r.customer),
              colText("FP", (r: any) => <FpLink fp={r.fp} />, (r: any) => r.fp || ""),
              colText("Statut", (r: any) => <Badge tone="neutral">{bcLabel(r.status)}</Badge>, (r: any) => r.status),
              colNum("Montant", (r: any) => money(r.amount), (r: any) => r.amount),
            ]} rows={bc.items} colsKey="relances-bc" />
          ) : <EmptyState label="Aucun BC en retard — livraisons à jour." />}
          <Tip>BC dont l'ETA (réelle sinon contractuelle) est dépassée et non livrés. <button className="text-gold underline underline-offset-2 hover:opacity-80" onClick={() => go("bc", { segment: "late" })}>Ouvrir l'exécution BC</button> pour mettre à jour le statut.</Tip>
        </Card>
      )}

      {canBack && (
        <Card title={`Jalons échus non facturés · facturation à émettre${jal?.count ? ` · ${jal.count}` : ""}`}>
          <RespChips rows={jal?.byResp} />
          {jal?.items?.length ? (
            <Table columns={[
              colText("Échéance", (r: any) => <span className="tabnum">{r.dueDate}</span>, (r: any) => r.dueDate),
              colText("Retard", (r: any) => lateBadge(r.daysLate), (r: any) => r.daysLate),
              det(colText("FP", (r: any) => <FpLink fp={r.fp} />, (r: any) => r.fp)),
              colText("Client", (r: any) => r.client, (r: any) => r.client),
              colText("Commercial", (r: any) => <Badge tone="steel">{r.am}</Badge>, (r: any) => r.am),
              colNum("Attendu", (r: any) => money(r.expected), (r: any) => r.expected),
              colNum("Facturé", (r: any) => money(r.invoiced), (r: any) => r.invoiced),
              colNum("À émettre", (r: any) => <span className={cx("font-medium", r.gap > 0 && "text-clay")}>{money(r.gap)}</span>, (r: any) => r.gap),
            ]} rows={jal.items} colsKey="relances-jalons" />
          ) : <EmptyState label="Aucun jalon échu non facturé — facturation à jour." />}
          <Tip>Projets dont la somme des jalons échus dépasse le facturé à date (retard de facturation). L'écart est le montant à facturer pour rattraper la trajectoire.</Tip>
        </Card>
      )}
    </div>
  );
};
