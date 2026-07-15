// Modules opérations : P&L Projet, Crédit Fournisseurs, Exécution BC, Clients/Domaines, FP 360°.
import { useState, useEffect, type FC } from "react";
import { where } from "firebase/firestore";
import { useDocData, useCollectionData } from "../lib/hooks";
import { useCan, useCanImport, useCanSeeMargin } from "../lib/rbac";
import { useNav } from "../lib/nav";
import { useRecordScope } from "../lib/scope";
import { T, BU_COL, BC_COL, fmt, pct } from "../design/tokens";
import { Upload } from "lucide-react";
import { Card, Kpi, Table, Badge, Tip, EmptyState, ErrorState, CardSkeleton, Busy, DangerBtn, ListView, Segmented, colText, colNum, money, det, cx, useToast } from "../design/components";
import { Select, DateField } from "../design/inputs";
import { Gauge } from "../design/charts";
import { setBcStatus, patchBcLine, upsertCreditLine, callAddBcLine, callParseBcPdf, patchProjectSheet, deleteRecord, pushBcToClickup, fpDocId } from "../lib/writes";
import { Props, grid4, cols2, SUP_LABEL, BC_STAGES, bcLabel, HBars, ImportButton, FilterNote, useObjectives, roBadge, useCommandesRows, FpLink } from "./_shared";
import { useFilters } from "../lib/filters";
import { MARGIN, QUALITY } from "../lib/thresholds";
import type { SuppliersSummary, SupplierRow, BcLine, ProjectSheet, EntitySummary, EntityRow, Invoice, Opportunity, DataQualitySummary } from "../types";

// 8 — P&L Projet

// Parités fixes légales (repli quand aucun taux n'est paramétré dans config/fxRates). DOIT rester
// aligné sur functions/lib/fx.js (peg EUR 655,957). Partagé par l'aperçu d'import ET le correcteur de
// montant BC, sinon un BC en devise sans taux affiche « 0 » à un endroit et sa contre-valeur ailleurs.
const FIXED_PEG: Record<string, number> = { EUR: 655.957, XAF: 1 };

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
  // Lignes BC indexées par N° FP → détail des coûts (type / fournisseur) masquable sous chaque affaire.
  const bcByFp = new Map<string, BcLine[]>();
  for (const b of bc) { const k = b.fp || ""; if (!k) continue; (bcByFp.get(k) || bcByFp.set(k, []).get(k)!).push(b); }
  // Panneau déplié : actions (mise à jour / suppression, si droit) puis ventilation des coûts de
  // l'affaire par type de dépense et par fournisseur (lignes BC de même N° FP).
  const affaireDetail = (r: ProjectSheet) => {
    const lines = (r.fp && bcByFp.get(r.fp)) || [];
    const total = lines.reduce((s, b) => s + (b.amountXof || 0), 0);
    return (
      <div className="flex flex-col gap-4">
        {canEditFiche && (
          <div className="rounded-lg bg-ink/[.03] border border-line/60 px-3 py-2.5 flex flex-col gap-2">
            <div className="text-xs font-semibold text-muted">Mettre à jour / supprimer</div>
            <div className="flex flex-wrap items-center gap-3">
              <FicheFixer row={r} />
              {r.id && <DangerBtn label="Supprimer la fiche" confirm={`Supprimer la fiche affaire ${r.fp || r.id} (et sa marge) ? Un futur import delta ne la recréera que si la source la contient encore.`} fn={() => deleteRecord("projectSheets", r.id!)} />}
            </div>
          </div>
        )}
        {lines.length ? (
          <div className="flex flex-col gap-3">
            <div className="text-[11px] text-faint">{lines.length} ligne{lines.length > 1 ? "s" : ""} BC · coût total {money(total)}</div>
            <div className={cols2}>
              <div>
                <div className="text-xs font-semibold text-muted mb-1.5">Coût par type</div>
                <HBars rows={sumBy(lines, (b) => b.expenseType, (b) => b.amountXof || 0)} colorFn={() => T.steel} />
              </div>
              <div>
                <div className="text-xs font-semibold text-muted mb-1.5">Coût par fournisseur (top 10)</div>
                <HBars rows={sumBy(lines, (b) => b.supplier, (b) => b.amountXof || 0).slice(0, 10)} colorFn={() => T.plum} />
              </div>
            </div>
          </div>
        ) : <div className="text-xs text-muted">Aucune ligne BC rattachée à cette affaire.</div>}
      </div>
    );
  };
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
          colsKey="pnl-projet"
          initialSearch={intent?.search}
          searchKeys={[(r) => r.fp, (r) => r.client, (r) => r.affaire]}
          rowKey={(r) => r.id || r.fp || ""}
          expand={affaireDetail}
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
          ]}
        />
      </Card>
      <Tip>Marge issue des fiches affaire. <b>Déplie une affaire</b> (chevron) pour {canEditFiche ? <><b>mettre à jour</b> (prix de vente / revient) ou <b>supprimer</b> la fiche, et </> : ""}voir la ventilation de ses coûts par type de dépense et par fournisseur (lignes BC de même N° FP).</Tip>
    </div>
  );
};

// Correction inline d'une fiche affaire : prix de vente et/ou de revient (marge recalculée
// côté serveur). Comble « fiche sans prix de vente ». Donnée de marge → droit « rentabilité ».
function FicheFixer({ row }: { row: ProjectSheet }) {
  // Pré-rempli avec les valeurs courantes : l'utilisateur édite à partir du réel. On ne pousse que les
  // champs RÉELLEMENT modifiés (la marge est recalculée côté serveur).
  const asStr = (v?: number | null) => (v == null ? "" : String(Math.round(v)));
  const [sale, setSale] = useState(asStr(row.saleTotal));
  const [cost, setCost] = useState(asStr(row.costTotal));
  const num = (s: string) => Number(String(s).replace(/[^\d.-]/g, ""));
  const saleChanged = sale.trim() !== "" && num(sale) !== Math.round(row.saleTotal || 0);
  const costChanged = cost.trim() !== "" && num(cost) !== Math.round(row.costTotal || 0);
  const changed = saleChanged || costChanged;
  return (
    <span className="inline-flex gap-2 items-center flex-wrap">
      <label className="inline-flex flex-col gap-0.5 text-[10px] uppercase tracking-wider text-faint">Vente
        <input className="field w-28 !py-1 text-xs" inputMode="decimal" aria-label={`Prix de vente ${row.fp}`} placeholder="Vente" value={sale} onChange={(e) => setSale(e.target.value)} />
      </label>
      <label className="inline-flex flex-col gap-0.5 text-[10px] uppercase tracking-wider text-faint">Revient
        <input className="field w-28 !py-1 text-xs" inputMode="decimal" aria-label={`Prix de revient ${row.fp}`} placeholder="Revient" value={cost} onChange={(e) => setCost(e.target.value)} />
      </label>
      {changed && row.fp && <Busy variant="ghost" label="Mettre à jour" okMsg="Fiche mise à jour" fn={() => patchProjectSheet({ fp: row.fp!, saleTotal: saleChanged ? num(sale) : undefined, costTotal: costChanged ? num(cost) : undefined })} />}
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
    // SOA : le SOLDE (facturé) est distinct de l'ENGAGEMENT (BC non facturés + prévisionnel).
    colNum("Solde compte", (s: SupplierRow) => money(s.solde), (s: SupplierRow) => s.solde),
    colNum("Engagement", (s: SupplierRow) => money(s.engagement), (s: SupplierRow) => s.engagement),
    colNum("Disponible", (s: SupplierRow) => (s.authorized ? <span className={cx((s.disponible ?? 0) < 0 && "text-clay font-medium")}>{money(s.disponible)}</span> : "—"), (s: SupplierRow) => s.disponible ?? 0),
    det(colNum("Util. %", (s: SupplierRow) => (s.authorized ? pct(s.util) : "—"), (s: SupplierRow) => s.util || 0)),
    colNum("État", (s: SupplierRow) => <Badge tone={(badge[s.state || ""] || "neutral") as any}>{SUP_LABEL[s.state || ""] || s.state}</Badge>, (s: SupplierRow) => s.state || ""),
    ...(canWrite ? [colNum("Crédit (autorisé · ouverture)", (s: SupplierRow) => <CreditEditor name={s.name} authorized={s.authorized || 0} opening={s.opening || 0} openingDate={s.openingDate || ""} />)] : []),
  ];
  return (
    <div className="flex flex-col gap-4">
      <div className={grid4}>
        <Kpi label="Exposition totale" value={fmt(data.totalExpo)} />
        <Kpi label="Solde comptes (facturé)" value={fmt(data.soldeTotal ?? data.encoursTotal)} tone="clay" sub="SOA : ouverture + BC facturés" />
        <Kpi label="Engagement (BC + prévisionnel)" value={fmt(data.engagementTotal)} tone="steel" sub="BC en cours + achat prévisionnel des commandes ouvertes" />
        <Kpi label="Achat comm. ouvertes" value={fmt(data.openTotal)} tone="steel" />
      </div>
      <Card title="Top exposition"><HBars rows={(data.bySupplier || []).slice(0, 8).map((s) => ({ name: s.name, v: s.expo || 0 }))} colorFn={() => T.steel} /></Card>
      <Card title="Par fournisseur">
        <Table columns={cols} rows={data.bySupplier || []} colsKey="fournisseurs" />
        <Tip><b>SOA — relevé de compte</b> : le <b>solde</b> n'est mû que par les <b>factures</b> (BC au statut « facturé », non payés) plus un <b>solde d'ouverture</b> daté posé « à jour maintenant ». Les BC non facturés (émis/livrés) et le prévisionnel des commandes forment l'<b>engagement</b> — il consomme le disponible mais <b>ne débite pas le compte</b>. <b>Disponible</b> = autorisé − solde − engagement.</Tip>
      </Card>
    </div>
  );
};
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

// Import BC fournisseurs — 2 modes : Batch (Excel « Logistics / PO List ») ou Unitaire (PDF).
const EMPTY_BC = { bcNumber: "", supplier: "", fp: "", expenseType: "Hardware", currency: "XOF", amount: "", amountXof: "", status: "a_emettre", description: "", dateIn: "" };
function BcImport() {
  const [mode, setMode] = useState<"batch" | "unitaire">("batch");
  const [f, setF] = useState(EMPTY_BC);
  const [pdf, setPdf] = useState<File | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const { data: fx } = useDocData<{ rates?: Record<string, number> }>("config/fxRates");
  const toast = useToast();
  // Aperçu de conversion : devise étrangère × taux (paramétré, sinon parité fixe légale FIXED_PEG) → XOF ;
  // une contre-valeur saisie prime.
  const cur = (f.currency || "XOF").toUpperCase();
  const rate = cur !== "XOF" ? (Number((fx?.rates || {})[cur]) || FIXED_PEG[cur] || 0) : 0;
  const previewXof = f.amountXof.trim() !== "" ? Number(f.amountXof) || 0
    : cur === "XOF" ? Number(f.amount) || 0
    : rate > 0 ? Math.round((Number(f.amount) || 0) * rate) : 0;
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
        currency: x.currency || prev.currency,
        amount: x.amount ? String(x.amount) : prev.amount,
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
            <Select className="w-40" ariaLabel="Type de dépense" value={f.expenseType} onChange={(v) => setF({ ...f, expenseType: v })} options={["Hardware", "Licence", "Software", "Support", "Service Pro", "Mixte"].map((t) => ({ value: t, label: t }))} />
            <input className="field w-20 uppercase" placeholder="Devise" aria-label="Devise" value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value })} />
            <input className="field w-32" placeholder={cur === "XOF" ? "Montant XOF" : `Montant ${cur}`} aria-label="Montant (devise)" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} />
            {cur !== "XOF" && <input className="field w-32" placeholder="XOF (option)" aria-label="Contre-valeur XOF (option)" value={f.amountXof} onChange={(e) => setF({ ...f, amountXof: e.target.value })} />}
            <Select className="w-40" ariaLabel="Statut du BC" value={f.status} onChange={(v) => setF({ ...f, status: v })} options={BC_STAGES.map((s) => ({ value: s, label: bcLabel(s) }))} />
            <DateField className="w-40" ariaLabel="Date du BC" value={f.dateIn} onChange={(v) => setF({ ...f, dateIn: v })} placeholder="date BC" />
            <input className="field" placeholder="Description" aria-label="Description" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
            <label className={cx("btn-ghost !px-2.5 !py-1 text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer", analyzing && "opacity-60 pointer-events-none")}>
              <Upload size={14} aria-hidden="true" />{analyzing ? "Analyse du PDF…" : pdf ? pdf.name : "Joindre le PDF (auto-remplit)"}
              <input type="file" accept="application/pdf,.pdf" className="sr-only" aria-label="Joindre le PDF du BC" disabled={analyzing} onChange={(e) => onPdf(e.target.files?.[0] || null)} />
            </label>
            <Busy label="Enregistrer le BC" okMsg="BC enregistré" errMsg="Enregistrement refusé" fn={async () => {
              await callAddBcLine({
                bcNumber: f.bcNumber, supplier: f.supplier, fp: f.fp || undefined, expenseType: f.expenseType,
                currency: cur, amount: Number(f.amount) || 0,
                // Contre-valeur XOF laissée au serveur (conversion via taux) sauf override saisi.
                amountXof: f.amountXof.trim() !== "" ? (Number(f.amountXof) || 0) : undefined,
                status: f.status, description: f.description, dateIn: f.dateIn || undefined,
              }, pdf);
              setF(EMPTY_BC); setPdf(null);
            }} />
          </div>
          {cur !== "XOF" && (Number(f.amount) || 0) > 0 && (
            <div className="text-[11px]">{previewXof > 0
              ? <span className="text-muted">Contre-valeur : <b className="text-ink">{previewXof.toLocaleString("fr-FR")} XOF</b>{f.amountXof.trim() === "" && rate > 0 ? ` (taux ${rate})` : f.amountXof.trim() !== "" ? " (saisie)" : ""}</span>
              : <span className="text-clay">Aucun taux {cur} paramétré — saisissez la contre-valeur XOF, ou définissez le taux (Habilitations).</span>}</div>
          )}
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
  // Intégration ClickUp BC : bouton par ligne (push/synchro du bon de commande) si l'intégration est
  // active. Le lien N°BC↔tâche (config/clickupBcLinks) révèle les BC déjà rattachés (glyphe ↗).
  const { data: cuCfg } = useDocData<{ enabled?: boolean }>("config/clickup");
  const { data: bcLinks } = useDocData<{ map?: Record<string, string> }>(canWrite ? "config/clickupBcLinks" : null);
  const cuOn = canWrite && cuCfg?.enabled !== false;
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
          colsKey="bc"
          initialSearch={intent?.search}
          searchKeys={[(r) => r.bcNumber, (r) => r.fp, (r) => r.supplier, (r) => r.expenseType]}
          columns={[
            // Essentiels EN LIGNE (N° BC, Fournisseur, XOF, Retard, Statut) ; le secondaire (FP, Type,
            // ETA contrat/réel) est replié dans le détail via det() → tableau étroit, sans scroll.
            colText("N° BC", (r) => r.bcNumber || "—", (r) => r.bcNumber || ""),
            det(colText("FP", (r) => <FpLink fp={r.fp} />, (r) => r.fp || "")),
            colText("Fournisseur", (r) => r.supplier, (r) => r.supplier),
            det(colText("Type", (r) => r.expenseType, (r) => r.expenseType)),
            colNum("XOF", (r) => <BcAmount row={r} />, (r) => r.amountXof || 0),
            det(colText("ETA contrat", (r) => r.etaContrat || "—", (r) => r.etaContrat || "")),
            det(colText("ETA réel", (r) => r.etaReel || "—", (r) => r.etaReel || "")),
            colText("Retard", (r) => (isLate(r) ? <Badge tone="clay">en retard</Badge> : "—"), (r) => (isLate(r) ? 1 : 0)),
            colText("Statut", (r) => (canWrite ? <StatusSelect id={r.id!} status={r.status || "a_emettre"} /> : <Badge>{bcLabel(r.status)}</Badge>), (r) => r.status || ""),
            // Actions groupées en UNE colonne (entête vide → toujours en ligne) : ClickUp, fiabiliser, assainir.
            ...((cuOn || canWrite) ? [colText("", (r: BcLine) => (
              <div className="flex items-center justify-end gap-1.5">
                {cuOn && <BcClickupBtn bcNumber={r.bcNumber} linked={!!(r.bcNumber && bcLinks?.map?.[fpDocId(r.bcNumber)])} />}
                {canWrite && <BcFixer id={r.id!} fp={r.fp} amountXof={r.amountXof} supplier={r.supplier} currency={r.currency} amount={r.amount} />}
                {canWrite && r.id && <DangerBtn label="Suppr." confirm={`Supprimer la ligne BC ${r.bcNumber || r.supplier || r.id} ? Un futur import delta ne la recréera que si la source la contient encore.`} fn={() => deleteRecord("bcLines", r.id!)} />}
              </div>
            ), () => 0)] : []),
          ]}
        />
        {planned > 0 && <Tip>{planned.toLocaleString("fr-FR")} ligne(s) d'achat planifiées par les fiches affaire sont suivies en P&amp;L Projet / FP 360°, pas ici. L'Exécution BC n'est alimentée que par l'import BC (Logistics / PDF).</Tip>}
      </Card>
    </div>
  );
};

// Push / synchro d'un bon de commande (agrégé par N° BC) vers ClickUp. Toutes les lignes de même N°
// BC forment UNE tâche côté serveur ; un ré-appui met à jour la tâche existante (idempotent).
function BcClickupBtn({ bcNumber, linked }: { bcNumber?: string; linked: boolean }) {
  const num = (bcNumber || "").trim();
  if (!num) return <span className="text-faint text-[11px]" title="N° BC requis pour synchroniser">—</span>;
  return (
    <Busy variant="ghost" label={linked ? "ClickUp ↗" : "ClickUp"} okMsg="BC synchronisé avec ClickUp" errMsg="ClickUp : échec"
      fn={async () => { const r = await pushBcToClickup(num); if (r.url) window.open(r.url, "_blank", "noopener"); }} />
  );
}

// Fiabilisation inline d'une ligne BC : rattacher un N° FP et/ou saisir la contre-valeur XOF
// (ex. BC en devise étrangère → montant XOF nul). Pré-remplit les champs à corriger.
function BcFixer({ id, fp, amountXof, supplier, currency, amount }: { id: string; fp?: string; amountXof?: number; supplier?: string; currency?: string; amount?: number }) {
  const [nf, setNf] = useState("");
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
      {noAmt && <BcAmountFixer id={id} currency={currency} amount={amount} />}
    </span>
  );
}

// Fiabilisation du MONTANT d'une ligne BC. Pour une devise étrangère (le montant d'origine est connu,
// ex. 35 765,18 USD) : conversion GUIDÉE — taux pré-rempli depuis config/fxRates, aperçu XOF en direct,
// un clic « Convertir » (fige le taux, traçable). Plus de calcul manuel « brutal » de la contre-valeur.
// Pour une ligne en XOF sans montant (rare) : saisie directe. Raccourci vers le réglage des taux.
function BcAmountFixer({ id, currency, amount }: { id: string; currency?: string; amount?: number }) {
  const { data: fx } = useDocData<{ rates?: Record<string, number> }>("config/fxRates");
  const { go, canGo } = useNav();
  const [rate, setRate] = useState("");
  const [xof, setXof] = useState("");
  const cur = (currency || "XOF").toUpperCase();
  const foreign = cur !== "XOF" && (amount || 0) > 0;
  if (foreign) {
    const cfgRate = Number(fx?.rates?.[cur] || 0) || FIXED_PEG[cur] || 0; // repli parité légale (comme l'aperçu d'import)
    const r = rate.trim() !== "" ? (Number(rate.replace(",", ".")) || 0) : cfgRate;
    const preview = r > 0 ? Math.round((amount || 0) * r) : 0;
    return (
      <span className="inline-flex gap-1 items-center flex-wrap text-xs">
        <span className="text-faint">{(amount || 0).toLocaleString("fr-FR")} {cur} ×</span>
        <input className="field w-16 !py-1 text-xs text-right" inputMode="decimal" aria-label={`Taux ${cur} → XOF`} placeholder={cfgRate ? String(cfgRate) : "taux"} value={rate} onChange={(e) => setRate(e.target.value)} />
        {preview > 0 && <span className="text-ink">= {preview.toLocaleString("fr-FR")} XOF</span>}
        <Busy variant="ghost" label="Convertir" okMsg="Montant converti au taux (recalcul lancé)" errMsg="Conversion refusée"
          fn={() => { if (!(r > 0)) throw new Error("saisir un taux > 0"); return patchBcLine({ id, amountXof: Math.round((amount || 0) * r), fxRate: r }); }} />
        {!cfgRate && canGo("habilitations") && (
          <button type="button" onClick={() => go("habilitations")} className="text-gold hover:underline text-[11px]" title="Définir le taux de cette devise pour tous les BC">définir le taux</button>
        )}
      </span>
    );
  }
  // Ligne en XOF sans montant : saisie directe (parse tolérant « 5 000 000 » → 5000000).
  return (
    <span className="inline-flex gap-1 items-center">
      <input className="field w-24 !py-1 text-xs" inputMode="numeric" aria-label="Montant XOF" placeholder="XOF" value={xof} onChange={(e) => setXof(e.target.value)} />
      <Busy variant="ghost" label="Montant" okMsg="Montant corrigé" errMsg="Montant invalide"
        fn={() => { const v = Number(String(xof).replace(/[^\d]/g, "")); if (!(v > 0)) throw new Error("saisir un montant XOF > 0"); return patchBcLine({ id, amountXof: v }); }} />
    </span>
  );
}
// Montant d'une ligne BC : contre-valeur XOF, avec le montant d'ORIGINE en devise (et le taux figé)
// pour les BC en devise étrangère. « à saisir » si devise sans conversion (jamais assimilé à du XOF).
function BcAmount({ row }: { row: BcLine }) {
  const foreign = !!row.currency && row.currency !== "XOF";
  // « à saisir » dès qu'un BC RÉEL (avec N° BC) est à contre-valeur XOF nulle, quelle que soit la devise —
  // MÊME prédicat que le signal qualité bc_montant_zero (dataQuality.js) et le flag `unvalued` (SOA).
  // Sinon un BC en XOF à montant 0 s'affichait « 0 » ici alors qu'il est signalé « montant nul » ailleurs.
  const toConvert = !((row.amountXof || 0) > 0) && (foreign || !!row.bcNumber);
  return (
    <span className="inline-flex flex-col items-end leading-tight">
      {toConvert ? <span className="text-clay text-[12px]">à saisir</span> : money(row.amountXof)}
      {foreign && (row.amount || 0) > 0 && (
        <span className="text-[10.5px] text-faint">{(row.amount || 0).toLocaleString("fr-FR")} {row.currency}{row.fxRate ? ` @ ${row.fxRate}` : ""}</span>
      )}
    </span>
  );
}
function StatusSelect({ id, status }: { id: string; status: string }) {
  const [s, setS] = useState(status);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  // Resync sur MAJ de snapshot : la Table clé les lignes par index → le prop `status` peut changer
  // sous le même composant sans remontage, sinon le menu affiche un statut périmé (cf. audit intégral F6).
  useEffect(() => { setS(status); }, [status]);
  return (
    <Select ariaLabel="Statut de la ligne BC" className="!py-1" value={s} disabled={busy}
      onChange={async (v) => {
        // Verrou in-flight : désactive le menu pendant l'écriture → pas de double déclenchement (F6).
        const prev = s; setS(v); setBusy(true);
        try { await setBcStatus(id, v); toast("Statut mis à jour", "ok"); }
        catch { setS(prev); toast("Échec de la mise à jour du statut", "err"); }
        finally { setBusy(false); }
      }}
      options={BC_STAGES.map((x) => ({ value: x, label: bcLabel(x) }))} />
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
          // « Autres (N) » (longue traîne agrégée, cf. audit intégral A2) : non cliquable (pas une entité réelle).
          colText(kind === "clients" ? "Client" : "BU", (r) => (r.isOther ? <span className="text-faint italic">{r.key}</span> : <EntityLink kind={kind} value={r.key} />), (r) => r.key),
          colNum("CAS", (r) => money(r.cas), (r) => r.cas), colNum("Facturé", (r) => money(r.facture), (r) => r.facture),
          colNum("Backlog", (r) => money(r.backlog), (r) => r.backlog),
          // Marges masquées pour les rôles sans accès « Rentabilité ».
          ...(canMargin ? [colNum("Marge", (r: EntityRow) => money(mbOf(r)), (r: EntityRow) => mbOf(r) || 0), colNum("%MB", (r: EntityRow) => pct(pmbOf(r)), (r: EntityRow) => pmbOf(r) || 0)] : []),
          // R/O (Réalisé / Objectif) au périmètre — affiché si un objectif existe pour l'exercice.
          // R/O (Réalisé / Objectif) : comparaison secondaire → repliée dans le détail (det).
          ...(hasObj ? [
            det(colNum("R/O CAS", (r: EntityRow) => roBadge(r.cas, roOf(r)?.targetCas))),
            det(colNum("R/O Fact.", (r: EntityRow) => roBadge(r.facture, roOf(r)?.targetInvoiced))),
            ...(canMargin ? [det(colNum("R/O Marge", (r: EntityRow) => roBadge(mbOf(r), roOf(r)?.targetMargin)))] : []),
          ] : []),
        ]} rows={rows} colsKey={`entity-${kind}`} />
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
  // Sécurité par enregistrement : sous OWD « private », les opps sont filtrées par visibleTo (array-contains,
  // seule contrainte serveur possible sans index composite) puis re-filtrées par N° FP côté client.
  const oppScope = useRecordScope("opportunities");
  const { rows: oppsRaw } = useCollectionData<Opportunity>(fp && oppScope.ready ? "opportunities" : null, oppScope.scoped ? oppScope.constraints : cons, fp + (oppScope.scoped ? "|s" : ""));
  const opps = oppScope.scoped ? oppsRaw.filter((x) => (x.fp || "").toUpperCase() === fp) : oppsRaw;
  const o = fp ? cmdRows.find((r) => (r.fp || "").toUpperCase() === fp) : undefined;
  return (
    <div className="flex flex-col gap-4">
      <Card title="Recherche par N° FP">
        <input className="field w-full md:w-96" aria-label="Rechercher un N° FP" placeholder="FP/2026/13542" value={q} onChange={(e) => setQ(e.target.value)} />
      </Card>
      {fp && ((o || invoices.length || opps.length || bc.length || sheets.length) ? (
        <>
          {/* Un N° FP peut exister HORS carnet (opp gagnée sans P&L, facture/BC orphelins) : on ne masque
              plus les maillons rattachés faute de commande — on affiche tout ce qui porte ce FP. */}
          {o ? (
            <div className={grid4}>
              <Kpi label="Client" value={o.client || "—"} />
              <Kpi label="CAS" value={fmt(o.cas)} />
              <Kpi label="RAF" value={fmt(o.raf)} tone="steel" />
              {canMargin ? <Kpi label="MB" value={fmt(o.mb)} sub={o.bu} tone="gold" /> : <Kpi label="BU" value={o.bu || "—"} />}
            </div>
          ) : (
            <Tip><b>Aucune commande</b> (carnet P&L) pour {fp} — ce N° FP existe <b>hors carnet</b> : opportunité gagnée non adossée, facture ou BC orphelin. Les maillons rattachés sont listés ci-dessous ; corrigez le rattachement dans <b>Qualité &amp; correction</b>.</Tip>
          )}
          <Card title={`Factures · ${invoices.length}`}><Table columns={[colText("Numéro", (i) => i.numero), colText("Date", (i) => i.date), colNum("Montant HT", (i) => money(i.amountHt))]} rows={invoices} /></Card>
          {canMargin && <Card title="Fiche projet"><Table columns={[colText("Affaire", (s) => s.affaire), colNum("Revient", (s) => money(s.costTotal)), colNum("Vente", (s) => money(s.saleTotal)), colNum("Marge", (s) => money(s.margin)), colNum("%MB", (s) => pct(s.marginPct))]} rows={sheets} /></Card>}
          <Card title={`Lignes BC · ${bc.length}`}><Table columns={[colText("Fournisseur", (b) => b.supplier), colText("Type", (b) => b.expenseType), colNum("XOF", (b) => money(b.amountXof)), colText("Statut", (b) => bcLabel(b.status))]} rows={bc} /></Card>
          <Card title={`Opportunités · ${opps.length}`}><Table columns={[colText("Client", (x) => x.client), colText("Affaire", (x) => x.designation || "—"), colText("Commercial", (x) => x.am), colNum("Montant", (x) => money(x.amount)), colText("Étape", (x) => x.stageLabel || x.stage)]} rows={opps} /></Card>
        </>
      ) : <EmptyState label={`Aucun élément rattaché à ${fp}.`} />)}
    </div>
  );
};

// Cockpit QUALITÉ DES DONNÉES : synthèse d'hygiène d'ingestion (score de complétude + volumes). Le
// DÉTAIL des anomalies et leur correction (éditeur inline + IA + export) sont consolidés dans le Centre
// de correction (Assainissement) — point unique ; ici on ne garde que la vue de santé + un renvoi.
export const DataQuality: FC<Props> = () => {
  const { data, loading } = useDocData<DataQualitySummary>("summaries/dataQuality");
  if (loading && !data) return <CardSkeleton />; // évite le flash « Aucune donnée » avant le 1er snapshot (F4)
  if (!data) return <EmptyState />;
  const c = data.counts || {};
  const score = data.score ?? 1;
  const totalAnomalies = (data.issues || []).reduce((s, i) => s + i.count, 0);
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
      <Tip>Ce cockpit cible l'<b>hygiène d'ingestion</b> — distinct du Centre d'alertes (alertes métier). Le <b>détail des {totalAnomalies.toLocaleString("fr-FR")} anomalies</b> et leur correction guidée (éditeur inline, assistant <b>🧠 IA</b>, export CSV) sont désormais réunis en un point unique : <b>Assainissement → Centre de correction</b>. Un ré-import reste possible pour les corrections de masse.</Tip>
    </div>
  );
};
