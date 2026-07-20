// Module RÉFÉRENTIELS — Fournisseurs. Création/édition du paramétrage fournisseur : lignes de crédit
// (plafond autorisé, solde d'ouverture SOA daté) + migration des clés canoniques (cleanName, ADR-P20).
// DÉPLACÉ depuis « Crédit Fournisseurs » (qui devient lecture seule, ADR-044) : on centralise ici la
// gestion des référentiels, comme les clients. Le SOA reste calculé au recompute — on n'édite ici que le
// paramétrage persisté (creditLines), gouverné par le MÊME droit d'écriture `fournisseurs` (callable
// upsertCreditLine/migrateCreditLineKeys inchangés). Réutilise les primitives design et les formats ERP.
import { useState, type FC } from "react";
import { useDocData } from "../lib/hooks";
import { useCan } from "../lib/rbac";
import { pct } from "../design/tokens";
import { Card, Table, Badge, Tip, EmptyState, ErrorState, CardSkeleton, Busy, colText, colNum, money, det, cx, useToast, useConfirm } from "../design/components";
import { DateField } from "../design/inputs";
import { Props, SUP_LABEL } from "./_shared";
import { upsertCreditLine, migrateCreditLineKeys } from "../lib/writes";
import { trackWrite } from "../lib/activity";
import { SupplierNorm } from "./suppliernorm";
import type { SuppliersSummary, SupplierRow } from "../types";

export const FournisseursRef: FC<Props> = () => {
  const { data, loading, error } = useDocData<SuppliersSummary>("summaries/suppliers");
  const canWrite = useCan("fournisseurs") === "write";
  const badge: Record<string, string> = { saturation: "clay", tension: "gold", ok: "emerald", non_suivi: "neutral" };
  const cols = [
    colText("Fournisseur", (s: SupplierRow) => s.name, (s: SupplierRow) => s.name),
    colNum("Plafond autorisé", (s: SupplierRow) => (s.authorized ? money(s.authorized) : "—"), (s: SupplierRow) => s.authorized || 0),
    colNum("Solde compte", (s: SupplierRow) => money(s.solde), (s: SupplierRow) => s.solde),
    colNum("Disponible", (s: SupplierRow) => (s.authorized ? <span className={cx((s.disponible ?? 0) < 0 && "text-clay font-medium")}>{money(s.disponible)}</span> : "—"), (s: SupplierRow) => s.disponible ?? 0),
    det(colNum("Expo.", (s: SupplierRow) => money(s.expo), (s: SupplierRow) => s.expo)),
    det(colNum("Util. %", (s: SupplierRow) => (s.authorized ? pct(s.util) : "—"), (s: SupplierRow) => s.util || 0)),
    colNum("État", (s: SupplierRow) => <Badge tone={(badge[s.state || ""] || "neutral") as any}>{SUP_LABEL[s.state || ""] || s.state}</Badge>, (s: SupplierRow) => s.state || ""),
    ...(canWrite ? [colNum("Crédit (autorisé · ouverture)", (s: SupplierRow) => <CreditEditor name={s.name} authorized={s.authorized || 0} opening={s.opening || 0} openingDate={s.openingDate || ""} />)] : []),
  ];
  return (
    <div className="flex flex-col gap-4">
      {error ? <ErrorState error={error} />
        : (loading && !data) ? <CardSkeleton />
        : !data ? <EmptyState label="Aucun fournisseur au référentiel (les fournisseurs apparaissent depuis les BC, les commandes et les lignes de crédit)." />
        : (
          <Card title="Fournisseurs — lignes de crédit (SOA)" actions={canWrite ? <MigrateCreditKeysBtn /> : undefined}>
            <Tip>Référentiel fournisseur : renseignez le <b>plafond de crédit autorisé</b> et le <b>solde d'ouverture</b> daté (SOA) de chaque fournisseur. Le <b>solde</b>, l'<b>engagement</b> et le <b>disponible</b> sont recalculés automatiquement (voir « Crédit Fournisseurs » en Rentabilité pour le suivi). « Migrer les clés fournisseur » ré-appareille les plafonds sur la clé canonique (espaces/casse normalisés, ADR-P20).</Tip>
            <Table columns={cols} rows={data.bySupplier || []} colsKey="fournisseursRef" searchKeys={[(s: SupplierRow) => s.name || ""]} rowKey={(s: SupplierRow) => s.name || ""} bulk={[]} />
          </Card>
        )}
      {/* Normalisation fournisseurs (ADR-046) : inventaire + alias manuels déterministes, consolidés ICI dans
          le référentiel Fournisseurs (pas un onglet séparé — évite un doublon de nav et regroupe la gestion). */}
      <SupplierNorm />
    </div>
  );
};

// Édition d'une ligne de crédit fournisseur — plafond autorisé, solde d'ouverture SOA daté. Le callable
// upsertCreditLine clé le doc sur cleanName (autorité canonique, ADR-P20) et déclenche le recompute SOA.
function CreditEditor({ name, authorized, opening, openingDate }: { name: string; authorized: number; opening: number; openingDate: string }) {
  const [a, setA] = useState(String(authorized || ""));
  const [o, setO] = useState(String(opening || ""));
  const [d, setD] = useState(openingDate || "");
  return (
    <span className="inline-flex gap-1.5 items-center flex-wrap justify-end">
      <input className="field w-24 !py-1" aria-label={`Crédit autorisé ${name}`} value={a} onChange={(e) => setA(e.target.value)} placeholder="autorisé" />
      <input className="field w-24 !py-1" aria-label={`Solde d'ouverture ${name}`} value={o} onChange={(e) => setO(e.target.value)} placeholder="ouverture" />
      <DateField className="w-36 !py-1" ariaLabel={`Date d'ouverture ${name}`} value={d} onChange={setD} placeholder="date SOA" />
      <Busy label="OK" fn={() => upsertCreditLine(name, { authorized: Number(a) || 0, openingBalance: Number(o) || 0, openingDate: d || null })} />
    </span>
  );
}

// MES ADR-P20 — action ponctuelle de réconciliation : ré-appareille les lignes de crédit sur la clé
// fournisseur CANONIQUE (cleanName). À lancer une fois après le déploiement de l'unification, pour que
// les plafonds saisis « à un espace/casse près » (selon la source du BC) retrouvent leur fournisseur du
// SOA. Idempotent (relançable sans effet). Même patron qu'un backfill admin (confirmation + compteurs).
function MigrateCreditKeysBtn() {
  const [ask, confirmNode] = useConfirm();
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const run = async () => {
    if (!(await ask(
      <>Ré-appareiller les lignes de crédit fournisseur sur leur clé canonique (espaces internes et casse normalisés) ?
        <p className="mt-2 text-faint">Réconcilie les plafonds saisis « à un espace/casse près » selon la source. <b>Additif et sans perte</b> : le plafond est conservé sur la clé canonique, puis le SOA est recalculé. Opération unique, relançable sans effet.</p></>,
      { title: "Migrer les clés fournisseur (ADR-P20)", confirmLabel: "Migrer", tone: "steel" }))) return;
    setBusy(true);
    try {
      const r = await trackWrite(migrateCreditLineKeys(), "Migration des clés fournisseur");
      toast(`${r.moved} clé(s) migrée(s)${r.merged ? `, ${r.merged} fusionnée(s)` : ""}${r.skipped ? `, ${r.skipped} déjà canonique(s)` : ""}`, "ok");
    } catch (e: any) {
      const detail = String(e?.message || e?.code || "").replace(/^functions\//, "");
      toast(detail ? `Migration refusée — ${detail}` : "Migration refusée", "err");
    } finally { setBusy(false); }
  };
  return (
    <>
      <button className="btn-ghost hover:opacity-80 text-steel" disabled={busy} onClick={run}>{busy ? "…" : "Migrer les clés fournisseur"}</button>
      {confirmNode}
    </>
  );
}
