// Modules opérations : P&L Projet, Crédit Fournisseurs, Exécution BC, Clients/Domaines, FP 360°.
import { useState, useEffect, type FC } from "react";
import { where } from "firebase/firestore";
import { useDocData, useCollectionData } from "../lib/hooks";
import { useCan, useCanImport, useCanSeeMargin } from "../lib/rbac";
import { useNav } from "../lib/nav";
import { T, BU_COL, BC_COL, fmt, pct } from "../design/tokens";
import { Upload } from "lucide-react";
import { Card, Kpi, Table, Badge, Tip, EmptyState, ErrorState, CardSkeleton, Busy, ListView, Segmented, colText, colNum, money, cx, useToast } from "../design/components";
import { Gauge } from "../design/charts";
import { setBcStatus, patchBcLine, upsertCreditLine, callAddBcLine, callParseBcPdf, patchProjectSheet } from "../lib/writes";
import { Props, grid4, cols2, SUP_LABEL, BC_STAGES, bcLabel, HBars, ImportButton, FilterNote, useObjectives, roBadge, useCommandesRows, FpLink } from "./_shared";
import { useFilters } from "../lib/filters";
import { MARGIN, QUALITY } from "../lib/thresholds";
import type { SuppliersSummary, SupplierRow, BcLine, ProjectSheet, EntitySummary, EntityRow, Invoice, Opportunity, DataQualitySummary } from "../types";

// 8 — P&L Projet
const sumBy = (arr: any[], keyFn: (x: any) => string, valFn: (x: any) => number) => {
  const m: Record<string, number> = {};
  for (const x of arr) { const k = keyFn(x) || "—"; m[k] = (m[k] || 0) + (valFn(x) || 0); }
  return Object.entries(m).map(([name, v]) => ({ name, v })).sort((a, b) => b.v - a.v);
};
export const PnlProjet: FC<Props> = () => {
  const canMargin = useCanSeeMargin();
  const { rows: allRows } = useCollectionData<ProjectSheet>("projectSheets");
  // Marge des fiches isolée (accès Rentabilité) : lue seulement si le rôle a le droit, fusionnée par FP.
  const { rows: mrows } = useCollectionData<ProjectSheet>(canMargin ? "projectSheetsMargin" : null);
  const { rows: bc } = useCollectionData<BcLine>("bcLines");
  const { match } = useFilters();
  const marginBy = new Map(mrows.map((m) => [m.fp, m]));
  const base = allRows.filter((r) => match(r, ["client"])); // fiches : filtre client uniquement
  const rows = canMargin ? base.map((r) => ({ ...r, ...(marginBy.get(r.fp) || {}) })) : base;
  const canImport = useCanImport();
  const canEditFiche = useCan("rentabilite") === "write"; // saisie du prix de vente = donnée de marge
  const { intent } = useNav();
  if (!allRows.length) return <EmptyState label="Aucune fiche affaire. Importez des fiches affaire (par FP)." action={canImport ? <ImportButton label="Importer des fiches affaire" /> : undefined} />;
  const revient = rows.reduce((s, r) => s + (r.costTotal || 0), 0);
  const vente = rows.reduce((s, r) => s + (r.saleTotal || 0), 0);
  const marge = rows.reduce((s, r) => s + (r.margin || 0), 0);
  const pmb = vente > 0 ? marge / vente : 0;
  return (
    <div className="flex flex-col gap-4">
      <FilterNote dims="client" />
      {canMargin && (
        <div className={grid4}>
          <Kpi label="Prix de revient" value={fmt(revient)} tone="steel" />
          <Kpi label="Prix de vente" value={fmt(vente)} />
          <Kpi label="Marge brute" value={fmt(marge)} tone="gold" />
          <Kpi label="%MB global" value={pct(pmb)} tone={pmb < MARGIN.LOW ? "clay" : "emerald"} />
        </div>
      )}
      <Card title={`Fiches affaire${canMargin ? " — coût / vente / marge" : ""} · ${rows.length}`}>
        <ListView
          rows={rows}
          initialSearch={intent?.search}
          searchKeys={[(r) => r.fp, (r) => r.client, (r) => r.affaire]}
          columns={[
            colText("FP", (r) => <FpLink fp={r.fp} />, (r) => r.fp),
            colText("Client", (r) => r.client, (r) => r.client),
            colText("Affaire", (r) => r.affaire || "—", (r) => r.affaire || ""),
            // Coût / vente / marge masqués pour les rôles sans accès « Rentabilité » (confidentialité).
            ...(canMargin ? [
              colNum("Revient", (r: ProjectSheet) => money(r.costTotal), (r: ProjectSheet) => r.costTotal || 0),
              colNum("Vente", (r: ProjectSheet) => money(r.saleTotal), (r: ProjectSheet) => r.saleTotal || 0),
              colNum("Marge", (r: ProjectSheet) => money(r.margin), (r: ProjectSheet) => r.margin || 0),
              colNum("%MB", (r: ProjectSheet) => <Badge tone={((r.marginPct || 0) < MARGIN.LOW ? "clay" : (r.marginPct || 0) < MARGIN.OK ? "gold" : "emerald") as any}>{pct(r.marginPct)}</Badge>, (r: ProjectSheet) => r.marginPct || 0),
            ] : []),
            ...(canEditFiche ? [colText("Corriger", (r: ProjectSheet) => <FicheFixer row={r} />, () => 0)] : []),
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

// Correction inline d'une fiche affaire : prix de vente et/ou de revient (marge recalculée
// côté serveur). Comble « fiche sans prix de vente ». Donnée de marge → droit « rentabilité ».
function FicheFixer({ row }: { row: ProjectSheet }) {
  const [sale, setSale] = useState("");
  const [cost, setCost] = useState("");
  const changed = sale.trim() !== "" || cost.trim() !== "";
  const num = (s: string) => Number(String(s).replace(/[^\d.-]/g, ""));
  return (
    <span className="inline-flex gap-1 items-center flex-wrap">
      <input className="field w-24 !py-1 text-xs" inputMode="decimal" aria-label={`Prix de vente ${row.fp}`} placeholder="Vente" value={sale} onChange={(e) => setSale(e.target.value)} />
      <input className="field w-24 !py-1 text-xs" inputMode="decimal" aria-label={`Prix de revient ${row.fp}`} placeholder="Revient" value={cost} onChange={(e) => setCost(e.target.value)} />
      {changed && row.fp && <Busy variant="ghost" label="MàJ" okMsg="Fiche mise à jour" fn={() => patchProjectSheet({ fp: row.fp!, saleTotal: sale.trim() !== "" ? num(sale) : undefined, costTotal: cost.trim() !== "" ? num(cost) : undefined })} />}
    </span>
  );
}

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
    <Card title="Importer des BC fournisseurs" actions={<Segmented value={mode} onChange={setMode} ariaLabel="Mode d'import BC" options={[{ value: "batch", label: "Batch (Excel)" }, { value: "unitaire", label: "Unitaire (PDF)" }]} />}>
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
  const { rows: allRows } = useCollectionData<BcLine>("bcLines");
  // Exécution BC = BC RÉELLEMENT ÉMIS via l'IMPORT BC (Logistics / PDF). Les lignes issues des
  // fiches affaire (source « fiche ») sont des achats PLANIFIÉS au niveau projet — elles restent
  // visibles en P&L Projet / FP 360°, JAMAIS dans le suivi d'exécution (même si elles portent un
  // N° BC saisi sur la fiche). Cette vue n'est alimentée que par l'import BC.
  // Exécution BC = TOUTES les lignes issues de l'import BC (source ≠ "fiche"), y compris celles dont
  // le N° BC n'est pas encore renseigné — elles restent visibles et fiabilisables, jamais masquées
  // en silence (sinon un BC unitaire/logistics sans N° disparaîtrait sans aucun indicateur).
  const rows = allRows.filter((r) => r.source !== "fiche");
  const planned = allRows.length - rows.length; // = lignes de fiche affaire (achats planifiés)
  const canWrite = useCan("bc") === "write";
  const { intent } = useNav();
  const [flt, setFlt] = useState<"all" | "open" | "late">(intent?.segment === "late" ? "late" : intent?.segment === "open" ? "open" : "all");
  // Drill-through depuis le Centre d'alertes (« BC en retard / en attente ») → segment pré-sélectionné.
  useEffect(() => { if (intent?.segment === "late" || intent?.segment === "open") setFlt(intent.segment as "late" | "open"); }, [intent]);
  const today = new Date().toISOString().slice(0, 10);
  const isLate = (r: BcLine) => { const eta = r.etaReel || r.etaContrat; return !!eta && String(eta).slice(0, 10) < today && !BC_DELIVERED.has(r.status || "a_emettre"); };
  const byStatus: Record<string, number> = {};
  for (const r of rows) byStatus[r.status || "a_emettre"] = (byStatus[r.status || "a_emettre"] || 0) + 1;
  const solde = byStatus["solde"] || 0;
  const lateCount = rows.filter(isLate).length;
  const filtered = flt === "late" ? rows.filter(isLate) : flt === "open" ? rows.filter((r) => (r.status || "a_emettre") !== "solde") : rows;
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
      <Card title={`Lignes BC · ${rows.length.toLocaleString("fr-FR")}`} actions={<Segmented value={flt} onChange={setFlt} ariaLabel="Filtrer les lignes BC" options={[{ value: "all", label: "Toutes" }, { value: "open", label: "Non soldés" }, { value: "late", label: "En retard", count: lateCount }]} />}>
        <ListView
          rows={filtered}
          initialSearch={intent?.search}
          searchKeys={[(r) => r.bcNumber, (r) => r.fp, (r) => r.supplier, (r) => r.expenseType]}
          columns={[
            colText("N° BC", (r) => r.bcNumber || "—", (r) => r.bcNumber || ""),
            colText("FP", (r) => <FpLink fp={r.fp} />, (r) => r.fp || ""),
            colText("Fournisseur", (r) => r.supplier, (r) => r.supplier),
            colText("Type", (r) => r.expenseType, (r) => r.expenseType),
            colNum("XOF", (r) => money(r.amountXof), (r) => r.amountXof || 0),
            colText("ETA contrat", (r) => r.etaContrat || "—", (r) => r.etaContrat || ""),
            colText("ETA réel", (r) => r.etaReel || "—", (r) => r.etaReel || ""),
            colText("Retard", (r) => (isLate(r) ? <Badge tone="clay">en retard</Badge> : "—"), (r) => (isLate(r) ? 1 : 0)),
            colText("Statut", (r) => (canWrite ? <StatusSelect id={r.id!} status={r.status || "a_emettre"} /> : <Badge>{bcLabel(r.status)}</Badge>), (r) => r.status || ""),
            ...(canWrite ? [colText("Fiabiliser", (r: BcLine) => <BcFixer id={r.id!} fp={r.fp} amountXof={r.amountXof} supplier={r.supplier} />, () => 0)] : []),
          ]}
        />
        {planned > 0 && <Tip>{planned.toLocaleString("fr-FR")} ligne(s) d'achat planifiées par les fiches affaire sont suivies en P&amp;L Projet / FP 360°, pas ici. L'Exécution BC n'est alimentée que par l'import BC (Logistics / PDF).</Tip>}
      </Card>
    </div>
  );
};

// Fiabilisation inline d'une ligne BC : rattacher un N° FP et/ou saisir la contre-valeur XOF
// (ex. BC en devise étrangère → montant XOF nul). Pré-remplit les champs à corriger.
function BcFixer({ id, fp, amountXof, supplier }: { id: string; fp?: string; amountXof?: number; supplier?: string }) {
  const [nf, setNf] = useState("");
  const [amt, setAmt] = useState("");
  const [sup, setSup] = useState("");
  const noFp = !fp;
  const noAmt = !((amountXof || 0) > 0);
  const noSup = !(supplier && supplier.trim());
  if (!noFp && !noAmt && !noSup) return <span className="text-[11px] text-faint">ok</span>;
  return (
    <span className="inline-flex gap-1 items-center flex-wrap">
      {noFp && <>
        <input className="field w-28 !py-1 text-xs" aria-label="Rattacher un N° FP" placeholder="FP/2026/…" value={nf} onChange={(e) => setNf(e.target.value)} />
        <Busy variant="ghost" label="FP" okMsg="FP rattaché" fn={() => patchBcLine({ id, fp: nf })} />
      </>}
      {noSup && <>
        <input className="field w-28 !py-1 text-xs" aria-label="Fournisseur" placeholder="Fournisseur" value={sup} onChange={(e) => setSup(e.target.value)} />
        <Busy variant="ghost" label="Frns" okMsg="Fournisseur corrigé" errMsg="Fournisseur invalide"
          fn={() => { if (!sup.trim()) throw new Error("saisir un fournisseur"); return patchBcLine({ id, supplier: sup }); }} />
      </>}
      {noAmt && <>
        <input className="field w-24 !py-1 text-xs" inputMode="numeric" aria-label="Montant XOF" placeholder="XOF" value={amt} onChange={(e) => setAmt(e.target.value)} />
        {/* Parse tolérant : « 5 000 000 », « 5.000.000 » → 5000000 (XOF entier). Refuse une saisie
            vide/invalide au lieu d'écrire 0 en silence avec un faux « corrigé ». */}
        <Busy variant="ghost" label="Montant" okMsg="Montant corrigé" errMsg="Montant invalide"
          fn={() => { const v = Number(String(amt).replace(/[^\d]/g, "")); if (!(v > 0)) throw new Error("saisir un montant XOF > 0"); return patchBcLine({ id, amountXof: v }); }} />
      </>}
    </span>
  );
}
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
  const canMargin = useCanSeeMargin();
  // Marge par entité isolée dans un doc *Margin_* (lecture réservée à « Rentabilité ») — lu seulement
  // si le rôle a l'accès marge ; sinon jamais demandé (confidentialité opposable par les Rules).
  const { data: mdata } = useDocData<EntitySummary>(canMargin ? `summaries/${kind}Margin_${period}` : null);
  const marginBy = new Map((mdata?.rows || []).map((r) => [r.key, r]));
  const mbOf = (r: EntityRow) => marginBy.get(r.key)?.mb;
  const pmbOf = (r: EntityRow) => marginBy.get(r.key)?.pmb;
  // R/O par périmètre : objectifs de scope « bu » (Domaines) ou « client » (Clients) de l'exercice.
  const scope = kind === "domaines" ? "bu" : "client";
  const obj = useObjectives(period);
  const roOf = (r: EntityRow) => obj.get(scope, r.key);
  if (error) return <ErrorState error={error} />;
  if (loading && !data) return <CardSkeleton />;
  if (!data) return <EmptyState />;
  const rows = data.rows || [];
  const hasObj = rows.some((r) => roOf(r));
  return (
    <div className="flex flex-col gap-4">
      <Card title={kind === "clients" ? "CAS par client (top 10)" : "CAS par domaine"}>
        <HBars rows={rows.slice(0, 10).map((r) => ({ name: r.key, v: r.cas || 0 }))} colorFn={(r) => (kind === "domaines" ? (BU_COL[r.name] || T.faint) : T.gold)} />
      </Card>
      <Card title={kind === "clients" ? "Clients" : "Domaines (BU)"}>
        <Table columns={[
          colText(kind === "clients" ? "Client" : "BU", (r) => <EntityLink kind={kind} value={r.key} />, (r) => r.key),
          colNum("CAS", (r) => money(r.cas), (r) => r.cas), colNum("Facturé", (r) => money(r.facture), (r) => r.facture),
          colNum("Backlog", (r) => money(r.backlog), (r) => r.backlog),
          // Marges masquées pour les rôles sans accès « Rentabilité ».
          ...(canMargin ? [colNum("Marge", (r: EntityRow) => money(mbOf(r)), (r: EntityRow) => mbOf(r) || 0), colNum("%MB", (r: EntityRow) => pct(pmbOf(r)), (r: EntityRow) => pmbOf(r) || 0)] : []),
          // R/O (Réalisé / Objectif) au périmètre — affiché si un objectif existe pour l'exercice.
          ...(hasObj ? [
            colNum("R/O CAS", (r: EntityRow) => roBadge(r.cas, roOf(r)?.targetCas)),
            colNum("R/O Fact.", (r: EntityRow) => roBadge(r.facture, roOf(r)?.targetInvoiced)),
            ...(canMargin ? [colNum("R/O Marge", (r: EntityRow) => roBadge(mbOf(r), roOf(r)?.targetMargin))] : []),
          ] : []),
        ]} rows={rows} />
        {hasObj && <Tip>R/O = réalisé de la période / objectif {period} au périmètre {kind === "domaines" ? "BU" : "client"}. Les objectifs se définissent dans « Objectifs ».</Tip>}
      </Card>
    </div>
  );
}

// Cellule entité (client / BU) cliquable → ouvre la liste correspondante pré-filtrée (factures du
// client, commandes de la BU) via l'intention de filtre transverse. Repli en texte si pas d'accès.
function EntityLink({ kind, value }: { kind: "clients" | "domaines"; value: string }) {
  const { go, canGo } = useNav();
  if (!value) return <>—</>;
  const target = kind === "clients" ? "invoicelist" : "orderlist";
  const filter = kind === "clients" ? { client: value } : { bu: value };
  if (!canGo(target)) return <>{value}</>;
  return (
    <button type="button" onClick={() => go(target, { filter })}
      className="text-ink hover:text-gold underline decoration-dotted underline-offset-2"
      title={kind === "clients" ? "Voir les factures de ce client" : "Voir les commandes de cette BU"}>{value}</button>
  );
}

// FP 360°
export const Fp360: FC<Props> = () => {
  const { intent } = useNav();
  const [q, setQ] = useState(intent?.fp ?? "");
  // Ouverture depuis une cellule FP (maillage) → pré-remplit la recherche avec le N° FP cliqué.
  useEffect(() => { if (intent?.fp) setQ(intent.fp); }, [intent]);
  const canMargin = useCanSeeMargin();
  const fp = q.trim().toUpperCase();
  const cons = [where("fp", "==", fp || "__none__")];
  // Commande lue depuis commandesRows (marge fusionnée si accès Rentabilité) — plus de lecture directe
  // de orders/* côté client (qui porte la marge et est désormais réservé à « Rentabilité »).
  const { rows: cmdRows } = useCommandesRows(!!fp); // chargé seulement quand un N° FP est saisi
  // queryKey = fp ; abonnements ouverts UNIQUEMENT quand un N° FP est saisi (sinon name null).
  const { rows: invoices } = useCollectionData<Invoice>(fp ? "invoices" : null, cons, fp);
  const { rows: sheetsBase } = useCollectionData<ProjectSheet>(fp ? "projectSheets" : null, cons, fp);
  // Marge de la fiche isolée (accès Rentabilité) : fusionnée par FP quand le rôle a le droit.
  const { rows: sheetsMargin } = useCollectionData<ProjectSheet>(fp && canMargin ? "projectSheetsMargin" : null, cons, fp);
  const sheetsMBy = new Map(sheetsMargin.map((m) => [m.fp, m]));
  const sheets = sheetsBase.map((s) => ({ ...s, ...(sheetsMBy.get(s.fp) || {}) }));
  const { rows: bc } = useCollectionData<BcLine>(fp ? "bcLines" : null, cons, fp);
  const { rows: opps } = useCollectionData<Opportunity>(fp ? "opportunities" : null, cons, fp);
  const o = fp ? cmdRows.find((r) => (r.fp || "").toUpperCase() === fp) : undefined;
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
            {canMargin ? <Kpi label="MB" value={fmt(o.mb)} sub={o.bu} tone="gold" /> : <Kpi label="BU" value={o.bu || "—"} />}
          </div>
          <Card title={`Factures · ${invoices.length}`}><Table columns={[colText("Numéro", (i) => i.numero), colText("Date", (i) => i.date), colNum("Montant HT", (i) => money(i.amountHt))]} rows={invoices} /></Card>
          {canMargin && <Card title="Fiche projet"><Table columns={[colText("Affaire", (s) => s.affaire), colNum("Revient", (s) => money(s.costTotal)), colNum("Vente", (s) => money(s.saleTotal)), colNum("Marge", (s) => money(s.margin)), colNum("%MB", (s) => pct(s.marginPct))]} rows={sheets} /></Card>}
          <Card title={`Lignes BC · ${bc.length}`}><Table columns={[colText("Fournisseur", (b) => b.supplier), colText("Type", (b) => b.expenseType), colNum("XOF", (b) => money(b.amountXof)), colText("Statut", (b) => bcLabel(b.status))]} rows={bc} /></Card>
          <Card title={`Opportunités · ${opps.length}`}><Table columns={[colText("Client", (x) => x.client), colText("AM", (x) => x.am), colNum("Montant", (x) => money(x.amount)), colText("Étape", (x) => x.stageLabel || x.stage)]} rows={opps} /></Card>
        </>
      ) : <EmptyState label={`Aucune commande pour ${fp}.`} />)}
    </div>
  );
};

// Cockpit QUALITÉ DES DONNÉES : hygiène d'ingestion (champs manquants, rattachements, incohérences).
// Anomalie → module de remédiation (le drill-through remplace le cul-de-sac « export CSV » par un
// accès direct au widget de correction déjà existant : rattacher facture, corriger commande, etc.).
const ISSUE_FIX = (type: string): { module: string; segment?: string } | null => {
  if (type === "factures_orphelines") return { module: "invoicelist", segment: "orphan" };
  if (type.startsWith("factures")) return { module: "invoicelist" };
  if (type.startsWith("commandes") || type === "am_invalide" || type === "surfacturation") return { module: "orderlist" };
  if (type.startsWith("opps")) return { module: "opplist" };
  if (type.startsWith("bc_")) return { module: "bc" };
  if (type.startsWith("fiches")) return { module: "pnlprojet" };
  return null;
};

// Cockpit QUALITÉ DES DONNÉES : hygiène d'ingestion (champs manquants, rattachements, incohérences).
export const DataQuality: FC<Props> = () => {
  const { data } = useDocData<DataQualitySummary>("summaries/dataQuality");
  const { go, canGo } = useNav();
  if (!data) return <EmptyState />;
  const issues = data.issues || [];
  const c = data.counts || {};
  const score = data.score ?? 1;
  const tone: Record<string, string> = { high: "clay", medium: "gold", low: "steel" };
  // Export CSV des anomalies (à corriger à la source puis ré-importer).
  const exportCsv = () => {
    const esc = (s: string) => `"${String(s).replace(/"/g, '""')}"`;
    const rows = [["type", "severite", "compte", "libelle", "references"].join(",")]
      .concat(issues.map((i) => [i.type, i.severity, String(i.count), esc(i.label), esc((i.refs || []).join(" | "))].join(",")));
    const blob = new Blob(["﻿" + rows.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "anomalies_donnees.csv"; a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <div className="flex flex-col gap-4">
      <div className={cols2}>
        <Card title="Score de complétude des données">
          <Gauge value={score} color={score >= QUALITY.GOOD ? T.emerald : score >= QUALITY.FAIR ? T.gold : T.clay} />
          <div className="text-[11px] text-faint text-center mt-1">enregistrements / (enregistrements + anomalies pondérées)</div>
        </Card>
        <Card title="Volumes ingérés">
          <div className="grid grid-cols-2 gap-2">
            <Kpi label="Commandes" value={(c.orders || 0).toLocaleString("fr-FR")} />
            <Kpi label="Factures" value={(c.invoices || 0).toLocaleString("fr-FR")} />
            <Kpi label="Opportunités" value={(c.opportunities || 0).toLocaleString("fr-FR")} />
            <Kpi label="Lignes BC" value={(c.bcLines || 0).toLocaleString("fr-FR")} />
          </div>
        </Card>
      </div>
      <Card title={`Anomalies de données · ${issues.length}`} actions={issues.length ? <button onClick={exportCsv} className="btn-ghost !px-2.5 !py-1 text-xs">Exporter (CSV)</button> : undefined}>
        {issues.length ? (
          <div className="flex flex-col gap-2">
            {issues.map((it, i) => {
              const fix = ISSUE_FIX(it.type);
              const actionable = !!fix && canGo(fix.module);
              return (
              <div key={i} className="flex items-start gap-2 text-[13px]">
                <Badge tone={(tone[it.severity] || "neutral") as any}>{it.count}</Badge>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  {actionable
                    ? <button onClick={() => go(fix!.module, { ...(fix!.segment ? { segment: fix!.segment } : {}), search: it.refs?.[0] })} className="text-ink hover:text-gold underline decoration-dotted underline-offset-2 text-left" title="Ouvrir la vue pré-filtrée sur la 1re ligne à corriger">{it.label}</button>
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
        ) : <EmptyState label="Aucune anomalie détectée — données propres." />}
      </Card>
      <Tip>Ce cockpit cible l'<b>hygiène d'ingestion</b> (champs manquants, rattachements rompus, incohérences) pour fiabiliser les données — distinct du Centre d'alertes (alertes métier). <b>Clique une anomalie</b> pour ouvrir l'écran où la corriger directement dans l'app (rattacher, corriger l'opp/la commande/le BC/la facture, saisir le prix de vente…) ; les anomalies se recalculent automatiquement. Un ré-import reste possible pour les corrections de masse.</Tip>
    </div>
  );
};
