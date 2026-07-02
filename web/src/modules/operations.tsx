// Modules opérations : P&L Projet, Crédit Fournisseurs, Exécution BC, Clients/Domaines, FP 360°.
import { useState, type FC } from "react";
import { where } from "firebase/firestore";
import { useDocData, useCollectionData } from "../lib/hooks";
import { useCan } from "../lib/rbac";
import { T, BU_COL, BC_COL, fmt, pct } from "../design/tokens";
import { Upload } from "lucide-react";
import { Card, Kpi, Table, Badge, Tip, EmptyState, ErrorState, CardSkeleton, Busy, ListView, colText, colNum, money, cx, useToast } from "../design/components";
import { setBcStatus, upsertCreditLine, callAddBcLine, callParseBcPdf } from "../lib/writes";
import { Props, grid4, cols2, SUP_LABEL, BC_STAGES, bcLabel, HBars, ImportButton } from "./_shared";
import type { SuppliersSummary, SupplierRow, BcLine, ProjectSheet, EntitySummary, Order, Invoice, Opportunity } from "../types";

// 8 — P&L Projet
const sumBy = (arr: any[], keyFn: (x: any) => string, valFn: (x: any) => number) => {
  const m: Record<string, number> = {};
  for (const x of arr) { const k = keyFn(x) || "—"; m[k] = (m[k] || 0) + (valFn(x) || 0); }
  return Object.entries(m).map(([name, v]) => ({ name, v })).sort((a, b) => b.v - a.v);
};
export const PnlProjet: FC<Props> = () => {
  const { rows } = useCollectionData<ProjectSheet>("projectSheets");
  const { rows: bc } = useCollectionData<BcLine>("bcLines");
  if (!rows.length) return <EmptyState label="Aucune fiche affaire. Importez des fiches affaire (par FP)." />;
  const revient = rows.reduce((s, r) => s + (r.costTotal || 0), 0);
  const vente = rows.reduce((s, r) => s + (r.saleTotal || 0), 0);
  const marge = rows.reduce((s, r) => s + (r.margin || 0), 0);
  const pmb = vente > 0 ? marge / vente : 0;
  return (
    <div className="flex flex-col gap-4">
      <div className={grid4}>
        <Kpi label="Prix de revient" value={fmt(revient)} tone="steel" />
        <Kpi label="Prix de vente" value={fmt(vente)} />
        <Kpi label="Marge brute" value={fmt(marge)} tone="gold" />
        <Kpi label="%MB global" value={pct(pmb)} tone={pmb < 0.1 ? "clay" : "emerald"} />
      </div>
      <Card title={`Fiches affaire — coût / vente / marge · ${rows.length}`}>
        <ListView
          rows={rows}
          searchKeys={[(r) => r.fp, (r) => r.client, (r) => r.affaire]}
          columns={[
            colText("FP", (r) => r.fp, (r) => r.fp),
            colText("Client", (r) => r.client, (r) => r.client),
            colText("Affaire", (r) => r.affaire || "—", (r) => r.affaire || ""),
            colNum("Revient", (r) => money(r.costTotal), (r) => r.costTotal || 0),
            colNum("Vente", (r) => money(r.saleTotal), (r) => r.saleTotal || 0),
            colNum("Marge", (r) => money(r.margin), (r) => r.margin || 0),
            colNum("%MB", (r) => <Badge tone={((r.marginPct || 0) < 0.1 ? "clay" : (r.marginPct || 0) < 0.2 ? "gold" : "emerald") as any}>{pct(r.marginPct)}</Badge>, (r) => r.marginPct || 0),
          ]}
        />
      </Card>
      <div className={cols2}>
        <Card title="Coût par type (lignes BC)">{bc.length ? <HBars rows={sumBy(bc, (b) => b.expenseType, (b) => b.amountXof || 0)} colorFn={() => T.steel} /> : <EmptyState label="Pas de lignes BC." />}</Card>
        <Card title="Coût par fournisseur (top 10)">{bc.length ? <HBars rows={sumBy(bc, (b) => b.supplier, (b) => b.amountXof || 0).slice(0, 10)} colorFn={() => T.plum} /> : <EmptyState label="Pas de lignes BC." />}</Card>
      </div>
      <Tip>Marge issue des fiches affaire. Coûts ventilés par type de dépense et par fournisseur à partir des lignes BC (mêmes N° FP).</Tip>
    </div>
  );
};

// 9 — Crédit Fournisseurs
export const Fournisseurs: FC<Props> = () => {
  const { data, loading, error } = useDocData<SuppliersSummary>("summaries/suppliers");
  const canWrite = useCan("fournisseurs") === "write";
  if (error) return <ErrorState error={error} />;
  if (loading && !data) return <CardSkeleton />;
  if (!data) return <EmptyState />;
  const badge: Record<string, string> = { saturation: "clay", tension: "gold", ok: "emerald", non_suivi: "neutral" };
  const cols = [
    colText("Fournisseur", (s: SupplierRow) => s.name, (s: SupplierRow) => s.name), colNum("Expo.", (s: SupplierRow) => money(s.expo), (s: SupplierRow) => s.expo),
    colNum("Ouvert", (s: SupplierRow) => money(s.open), (s: SupplierRow) => s.open), colNum("Encours", (s: SupplierRow) => money(s.encours), (s: SupplierRow) => s.encours),
    colNum("Couverture", (s: SupplierRow) => money(s.coverage), (s: SupplierRow) => s.coverage),
    colNum("Util. %", (s: SupplierRow) => (s.authorized ? pct(s.util) : "—"), (s: SupplierRow) => s.util || 0),
    colNum("Crédit reco.", (s: SupplierRow) => money(s.reco), (s: SupplierRow) => s.reco || 0),
    colNum("État", (s: SupplierRow) => <Badge tone={(badge[s.state || ""] || "neutral") as any}>{SUP_LABEL[s.state || ""] || s.state}</Badge>, (s: SupplierRow) => s.state || ""),
    ...(canWrite ? [colNum("Ligne crédit", (s: SupplierRow) => <CreditEditor name={s.name} authorized={s.authorized || 0} outstanding={s.encours || 0} />)] : []),
  ];
  return (
    <div className="flex flex-col gap-4">
      <div className={grid4}>
        <Kpi label="Exposition totale" value={fmt(data.totalExpo)} />
        <Kpi label="Achat comm. ouvertes" value={fmt(data.openTotal)} tone="steel" />
        <Kpi label="Encours" value={fmt(data.encoursTotal)} />
      </div>
      <Card title="Top exposition"><HBars rows={(data.bySupplier || []).slice(0, 8).map((s) => ({ name: s.name, v: s.expo || 0 }))} colorFn={() => T.steel} /></Card>
      <Card title="Par fournisseur"><Table columns={cols} rows={data.bySupplier || []} /></Card>
    </div>
  );
};
function CreditEditor({ name, authorized, outstanding }: { name: string; authorized: number; outstanding: number }) {
  const [a, setA] = useState(String(authorized || ""));
  const [o, setO] = useState(String(outstanding || ""));
  return (
    <span className="inline-flex gap-1.5 items-center">
      <input className="field w-24 !py-1" aria-label={`Crédit autorisé ${name}`} value={a} onChange={(e) => setA(e.target.value)} placeholder="autorisé" />
      <input className="field w-24 !py-1" aria-label={`Encours ${name}`} value={o} onChange={(e) => setO(e.target.value)} placeholder="encours" />
      <Busy label="OK" fn={() => upsertCreditLine(name, { authorized: Number(a) || 0, outstanding: Number(o) || 0 })} />
    </span>
  );
}

// Import BC fournisseurs — 2 modes : Batch (Excel « Logistics / PO List ») ou Unitaire (PDF).
const EMPTY_BC = { bcNumber: "", supplier: "", fp: "", expenseType: "Hardware", amountXof: "", status: "a_emettre", description: "", dateIn: "" };
function BcImport() {
  const [mode, setMode] = useState<"batch" | "unitaire">("batch");
  const [f, setF] = useState(EMPTY_BC);
  const [pdf, setPdf] = useState<File | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const toast = useToast();
  const seg = (id: "batch" | "unitaire", label: string) => (
    <button onClick={() => setMode(id)} className={cx("rounded-md px-2.5 py-1 text-xs font-semibold transition-colors", mode === id ? "bg-gold text-bg" : "bg-panel2 text-muted hover:text-ink")}>{label}</button>
  );
  // À la sélection du PDF : extraction serveur (pdfjs) + pré-remplissage best-effort du formulaire.
  const onPdf = async (file: File | null) => {
    setPdf(file);
    if (!file) return;
    setAnalyzing(true);
    try {
      const x = await callParseBcPdf(file);
      setF((prev) => ({
        ...prev,
        bcNumber: x.bcNumber || prev.bcNumber,
        supplier: x.supplier || prev.supplier,
        fp: x.fp || prev.fp,
        expenseType: x.expenseType || prev.expenseType,
        amountXof: x.amountXof ? String(x.amountXof) : prev.amountXof,
        description: x.description || prev.description,
        dateIn: x.dateIn || prev.dateIn,
      }));
      const conv = x.currency && x.currency !== "XOF" && x.amount
        ? ` — montant détecté ${x.amount.toLocaleString("fr-FR")} ${x.currency}, à convertir en XOF`
        : "";
      toast(`PDF analysé : champs pré-remplis${conv}`, "ok");
    } catch (e: any) {
      toast(e?.message ? `Analyse PDF : ${e.message}` : "Analyse du PDF impossible", "err");
    } finally {
      setAnalyzing(false);
    }
  };
  return (
    <Card title="Importer des BC fournisseurs" actions={<div className="flex gap-1.5">{seg("batch", "Batch (Excel)")}{seg("unitaire", "Unitaire (PDF)")}</div>}>
      {mode === "batch" ? (
        <div className="flex flex-col gap-2">
          <p className="text-[13px] text-muted">Chargez le fichier de suivi logistique (feuille « PO List »). Les BC sont détectés puis fusionnés par clé métier — ré-import sans doublon, statuts logistiques mappés sur le cycle À émettre → Émis → Livré → Facturé → Soldé.</p>
          <div><ImportButton label="Importer le suivi (Excel)" /></div>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <p className="text-[13px] text-muted">Joignez le PDF d'un bon de commande : les champs sont <b className="text-ink">extraits automatiquement</b> et pré-remplis (n° BC, fournisseur, montant, date…) — vérifiez puis enregistrez. Le PDF est conservé pour traçabilité.</p>
          <div className="flex flex-wrap gap-2 items-center">
            <input className="field" placeholder="N° BC" aria-label="Numéro de BC" value={f.bcNumber} onChange={(e) => setF({ ...f, bcNumber: e.target.value })} />
            <input className="field" placeholder="Fournisseur" aria-label="Fournisseur" value={f.supplier} onChange={(e) => setF({ ...f, supplier: e.target.value })} />
            <input className="field w-40" placeholder="N° FP (optionnel)" aria-label="Numéro FP" value={f.fp} onChange={(e) => setF({ ...f, fp: e.target.value })} />
            <select className="field" aria-label="Type de dépense" value={f.expenseType} onChange={(e) => setF({ ...f, expenseType: e.target.value })}>{["Hardware", "Licence", "Software", "Support", "Service Pro", "Mixte"].map((t) => <option key={t}>{t}</option>)}</select>
            <input className="field w-32" placeholder="Montant XOF" aria-label="Montant XOF" value={f.amountXof} onChange={(e) => setF({ ...f, amountXof: e.target.value })} />
            <select className="field" aria-label="Statut du BC" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>{BC_STAGES.map((s) => <option key={s} value={s}>{bcLabel(s)}</option>)}</select>
            <input className="field" type="date" aria-label="Date du BC" value={f.dateIn} onChange={(e) => setF({ ...f, dateIn: e.target.value })} />
            <input className="field" placeholder="Description" aria-label="Description" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
            <label className={cx("btn-ghost !px-2.5 !py-1 text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer", analyzing && "opacity-60 pointer-events-none")}>
              <Upload size={14} aria-hidden="true" />{analyzing ? "Analyse du PDF…" : pdf ? pdf.name : "Joindre le PDF (auto-remplit)"}
              <input type="file" accept="application/pdf,.pdf" className="sr-only" aria-label="Joindre le PDF du BC" disabled={analyzing} onChange={(e) => onPdf(e.target.files?.[0] || null)} />
            </label>
            <Busy label="Enregistrer le BC" okMsg="BC enregistré" errMsg="Enregistrement refusé" fn={async () => {
              await callAddBcLine({
                bcNumber: f.bcNumber, supplier: f.supplier, fp: f.fp || undefined, expenseType: f.expenseType,
                amountXof: Number(f.amountXof) || 0, amount: Number(f.amountXof) || 0, status: f.status,
                description: f.description, dateIn: f.dateIn || undefined,
              }, pdf);
              setF(EMPTY_BC); setPdf(null);
            }} />
          </div>
        </div>
      )}
    </Card>
  );
}

// 10 — Exécution BC
const BC_DELIVERED = new Set(["livre", "facture", "solde"]);
export const BC: FC<Props> = () => {
  const { rows } = useCollectionData<BcLine>("bcLines");
  const canWrite = useCan("bc") === "write";
  const [flt, setFlt] = useState<"all" | "open" | "late">("all");
  const today = new Date().toISOString().slice(0, 10);
  const isLate = (r: BcLine) => { const eta = r.etaReel || r.etaContrat; return !!eta && String(eta).slice(0, 10) < today && !BC_DELIVERED.has(r.status || "a_emettre"); };
  const byStatus: Record<string, number> = {};
  for (const r of rows) byStatus[r.status || "a_emettre"] = (byStatus[r.status || "a_emettre"] || 0) + 1;
  const solde = byStatus["solde"] || 0;
  const lateCount = rows.filter(isLate).length;
  const filtered = flt === "late" ? rows.filter(isLate) : flt === "open" ? rows.filter((r) => (r.status || "a_emettre") !== "solde") : rows;
  const seg = (id: typeof flt, label: string, n?: number) => (
    <button onClick={() => setFlt(id)} className={cx("rounded-md px-2.5 py-1 text-xs font-semibold transition-colors", flt === id ? "bg-gold text-bg" : "bg-panel2 text-muted hover:text-ink")}>
      {label}{n != null && <span className="ml-1 opacity-70">{n.toLocaleString("fr-FR")}</span>}
    </button>
  );
  return (
    <div className="flex flex-col gap-4">
      {canWrite && <BcImport />}
      <div className="grid gap-3 grid-cols-2 md:grid-cols-5">
        {BC_STAGES.map((s) => (
          <div key={s} className="card p-4">
            <div className="text-xs text-muted">{bcLabel(s)}</div>
            <div className="font-display text-2xl tabnum mt-1" style={{ color: BC_COL[s] }}>{byStatus[s] || 0}</div>
          </div>
        ))}
      </div>
      <div className={grid4}>
        <Kpi label="Taux d'exécution (soldé)" value={pct(rows.length ? solde / rows.length : 0)} tone="emerald" />
        <Kpi label="BC en retard" value={lateCount.toLocaleString("fr-FR")} tone={lateCount ? "clay" : "steel"} sub="ETA dépassée, non livré" />
      </div>
      <Card title={`Lignes BC · ${rows.length.toLocaleString("fr-FR")}`} actions={<div className="flex gap-1.5">{seg("all", "Toutes")}{seg("open", "Non soldés")}{seg("late", "En retard", lateCount)}</div>}>
        <ListView
          rows={filtered}
          searchKeys={[(r) => r.bcNumber, (r) => r.fp, (r) => r.supplier, (r) => r.expenseType]}
          columns={[
            colText("N° BC", (r) => r.bcNumber || "—", (r) => r.bcNumber || ""),
            colText("FP", (r) => r.fp || "—", (r) => r.fp || ""),
            colText("Fournisseur", (r) => r.supplier, (r) => r.supplier),
            colText("Type", (r) => r.expenseType, (r) => r.expenseType),
            colNum("XOF", (r) => money(r.amountXof), (r) => r.amountXof || 0),
            colText("ETA contrat", (r) => r.etaContrat || "—", (r) => r.etaContrat || ""),
            colText("ETA réel", (r) => r.etaReel || "—", (r) => r.etaReel || ""),
            colText("Retard", (r) => (isLate(r) ? <Badge tone="clay">en retard</Badge> : "—"), (r) => (isLate(r) ? 1 : 0)),
            colText("Statut", (r) => (canWrite ? <StatusSelect id={r.id!} status={r.status || "a_emettre"} /> : <Badge>{bcLabel(r.status)}</Badge>), (r) => r.status || ""),
          ]}
        />
      </Card>
    </div>
  );
};
function StatusSelect({ id, status }: { id: string; status: string }) {
  const [s, setS] = useState(status);
  const toast = useToast();
  return (
    <select aria-label="Statut de la ligne BC" className="field !py-1" value={s}
      onChange={async (e) => { const v = e.target.value; const prev = s; setS(v); try { await setBcStatus(id, v); toast("Statut mis à jour", "ok"); } catch { setS(prev); toast("Échec de la mise à jour du statut", "err"); } }}>
      {BC_STAGES.map((x) => <option key={x} value={x}>{bcLabel(x)}</option>)}
    </select>
  );
}

// 11/12 — Clients / Domaines
export function EntityView({ period, kind }: Props & { kind: "clients" | "domaines" }) {
  const { data, loading, error } = useDocData<EntitySummary>(`summaries/${kind}_${period}`);
  if (error) return <ErrorState error={error} />;
  if (loading && !data) return <CardSkeleton />;
  if (!data) return <EmptyState />;
  const rows = data.rows || [];
  return (
    <div className="flex flex-col gap-4">
      <Card title={kind === "clients" ? "CAS par client (top 10)" : "CAS par domaine"}>
        <HBars rows={rows.slice(0, 10).map((r) => ({ name: r.key, v: r.cas || 0 }))} colorFn={(r) => (kind === "domaines" ? (BU_COL[r.name] || T.faint) : T.gold)} />
      </Card>
      <Card title={kind === "clients" ? "Clients" : "Domaines (BU)"}>
        <Table columns={[
          colText(kind === "clients" ? "Client" : "BU", (r) => r.key, (r) => r.key),
          colNum("CAS", (r) => money(r.cas), (r) => r.cas), colNum("Facturé", (r) => money(r.facture), (r) => r.facture),
          colNum("Backlog", (r) => money(r.backlog), (r) => r.backlog), colNum("Marge", (r) => money(r.mb), (r) => r.mb), colNum("%MB", (r) => pct(r.pmb), (r) => r.pmb),
        ]} rows={rows} />
      </Card>
    </div>
  );
}

// FP 360°
export const Fp360: FC<Props> = () => {
  const [q, setQ] = useState("");
  const fp = q.trim().toUpperCase();
  const cons = [where("fp", "==", fp || "__none__")];
  // queryKey = fp : sans lui le hook ne se ré-abonne pas quand la recherche change.
  const { rows: orders } = useCollectionData<Order>("orders", cons, fp);
  const { rows: invoices } = useCollectionData<Invoice>("invoices", cons, fp);
  const { rows: sheets } = useCollectionData<ProjectSheet>("projectSheets", cons, fp);
  const { rows: bc } = useCollectionData<BcLine>("bcLines", cons, fp);
  const { rows: opps } = useCollectionData<Opportunity>("opportunities", cons, fp);
  const o = orders[0];
  return (
    <div className="flex flex-col gap-4">
      <Card title="Recherche par N° FP">
        <input className="field w-full md:w-96" aria-label="Rechercher un N° FP" placeholder="FP/2026/13542" value={q} onChange={(e) => setQ(e.target.value)} />
      </Card>
      {fp && (o ? (
        <>
          <div className={grid4}>
            <Kpi label="Client" value={o.client || "—"} />
            <Kpi label="CAS" value={fmt(o.cas)} />
            <Kpi label="RAF" value={fmt(o.raf)} tone="steel" />
            <Kpi label="MB" value={fmt(o.mb)} sub={o.bu} tone="gold" />
          </div>
          <Card title={`Factures · ${invoices.length}`}><Table columns={[colText("Numéro", (i) => i.numero), colText("Date", (i) => i.date), colNum("Montant HT", (i) => money(i.amountHt))]} rows={invoices} /></Card>
          <Card title="Fiche projet"><Table columns={[colText("Affaire", (s) => s.affaire), colNum("Revient", (s) => money(s.costTotal)), colNum("Vente", (s) => money(s.saleTotal)), colNum("Marge", (s) => money(s.margin)), colNum("%MB", (s) => pct(s.marginPct))]} rows={sheets} /></Card>
          <Card title={`Lignes BC · ${bc.length}`}><Table columns={[colText("Fournisseur", (b) => b.supplier), colText("Type", (b) => b.expenseType), colNum("XOF", (b) => money(b.amountXof)), colText("Statut", (b) => bcLabel(b.status))]} rows={bc} /></Card>
          <Card title={`Opportunités · ${opps.length}`}><Table columns={[colText("Client", (x) => x.client), colText("AM", (x) => x.am), colNum("Montant", (x) => money(x.amount)), colText("Étape", (x) => x.stageLabel || x.stage)]} rows={opps} /></Card>
        </>
      ) : <EmptyState label={`Aucune commande pour ${fp}.`} />)}
    </div>
  );
};
