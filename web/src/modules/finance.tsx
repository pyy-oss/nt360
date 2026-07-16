// Modules finance : Objectifs / R-O, Facturation, liste Factures, Rentabilité.
import { useState, useEffect, type FC } from "react";
import { useDocData, useCollectionData } from "../lib/hooks";
import { useCan, useCanImport } from "../lib/rbac";
import { useNav } from "../lib/nav";
import { T, fmt, pct } from "../design/tokens";
import { Card, Kpi, Table, Badge, Tip, EmptyState, ErrorState, CardSkeleton, Busy, DangerBtn, ListView, Segmented, colText, colNum, money, det, cx, useToast, type BulkAction } from "../design/components";
import { Select, DateField } from "../design/inputs";
import { AreaTrend, DonutBU, GroupedBars } from "../design/charts";
import { upsertObjective, deleteObjective, objectiveId, setInvoiceFp, patchInvoice, deleteRecord, setCancellation } from "../lib/writes";
import { Props, grid4, cols2, monthsAsc, topArr, toDonut, HBars, buBadge, ImportButton, FilterNote, FpLink, useBusinessUnits } from "./_shared";
import { useFilters } from "../lib/filters";
import { useClientKey } from "../lib/clientName";
import { frDate } from "../lib/format";
import { marginWaterfall } from "../lib/waterfall";
import { MARGIN } from "../lib/thresholds";
import type { FacturationSummary, RentabiliteSummary, Objective, Invoice, CancellationsDoc } from "../types";

// 3 — Objectifs / R-O
const SCOPES = [
  { v: "global", label: "Global" },
  { v: "bu", label: "Par BU" },
  { v: "commercial", label: "Par commercial (AM)" },
  { v: "client", label: "Par client" },
];
const EMPTY_OBJ = { fiscalYear: "", scope: "global", scopeValue: "all", label: "", targetCas: "", targetInvoiced: "", targetMargin: "", targetMarginPct: "" };

export const Objectifs: FC<Props> = () => {
  const { rows } = useCollectionData<Objective>("objectives");
  const canWrite = useCan("objectifs") === "write";
  const toast = useToast();
  const [f, setF] = useState({ ...EMPTY_OBJ });
  const [editingId, setEditingId] = useState<string | null>(null);
  const bus = useBusinessUnits(); // référentiel BU (Admin) pour le sélecteur de périmètre d'objectif
  const set = (k: keyof typeof f, v: string) => setF((s) => ({ ...s, [k]: v }));
  const reset = () => { setF({ ...EMPTY_OBJ }); setEditingId(null); };

  const edit = (x: Objective) => {
    setEditingId(x.id || null);
    setF({
      fiscalYear: String(x.fiscalYear || ""), scope: x.scope || "global", scopeValue: x.scopeValue || "all", label: x.label || "",
      targetCas: String(x.targetCas || ""), targetInvoiced: String(x.targetInvoiced || ""), targetMargin: String(x.targetMargin || ""), targetMarginPct: String(x.targetMarginPct || ""),
    });
  };

  const save = async () => {
    const fiscalYear = Number(f.fiscalYear) || 0;
    if (fiscalYear < 2000) { toast("Année invalide (ex. 2026).", "err"); return; }
    const scopeValue = f.scope === "global" ? "all" : (f.scopeValue.trim() || "all");
    const payload = {
      fiscalYear, scope: f.scope, scopeValue, label: f.label.trim() || undefined,
      targetCas: Number(f.targetCas) || 0, targetInvoiced: Number(f.targetInvoiced) || 0,
      targetMargin: Number(f.targetMargin) || 0, targetMarginPct: Number(f.targetMarginPct) || 0,
    };
    // ORDRE SÛR : écrire le nouveau doc AVANT de supprimer l'ancien (édition à clé changée). Si l'upsert
    // échoue, l'objectif d'origine reste intact ; l'inverse (delete-puis-upsert) détruisait l'objectif quand
    // l'upsert échouait ensuite, avec un simple « Action refusée » — perte sans avertissement.
    const staleId = editingId && editingId !== objectiveId(payload) ? editingId : null;
    await upsertObjective(payload);
    if (staleId) await deleteObjective(staleId);
    reset();
  };

  const remove = async (x: Objective) => {
    if (!x.id) return;
    await deleteObjective(x.id);
    if (editingId === x.id) reset();
  };

  const cols = [
    colText("Périmètre", (x) => x.label || `${x.fiscalYear} ${x.scope || ""} ${x.scopeValue || ""}`.trim(), (x) => `${x.fiscalYear}${x.scope}`),
    colNum("Cible CAS", (x) => money(x.targetCas), (x) => x.targetCas || 0),
    colNum("Cible Facturé", (x) => money(x.targetInvoiced), (x) => x.targetInvoiced || 0),
    colNum("Cible Marge", (x) => money(x.targetMargin), (x) => x.targetMargin || 0),
    colNum("Cible %MB", (x) => x.targetMarginPct ? pct(x.targetMarginPct) : "—", (x) => x.targetMarginPct || 0),
    ...(canWrite ? [colNum("", (x: Objective) => (
      <span className="inline-flex gap-1.5 justify-end">
        <button className="btn-ghost !px-2.5 !py-1 text-xs" onClick={() => edit(x)}>Modifier</button>
        <DangerBtn label="Suppr." okMsg="Objectif supprimé" errMsg="Suppression refusée"
          confirm={`Supprimer l'objectif « ${x.fiscalYear} ${x.scope || ""} ${x.scopeValue || ""} » ? Cette action est définitive.`}
          fn={() => remove(x)} />
      </span>
    ))] : []),
  ];

  return (
    <div className="flex flex-col gap-4">
      <Card title="Objectifs annuels par univers / dimension">
        <Table columns={cols} rows={rows} empty="Aucun objectif défini." searchKeys={[(x: Objective) => String(x.fiscalYear || ""), (x: Objective) => x.scope || "", (x: Objective) => x.scopeValue || ""]} rowKey={(x: Objective) => objectiveId({ fiscalYear: x.fiscalYear || 0, scope: x.scope, scopeValue: x.scopeValue })} bulk={[]} />
        <Tip>Cette page sert uniquement à <b>définir les objectifs</b> (global, par BU, par client, par commercial). Le <b>R/O (Réalisé / Objectif)</b> se suit désormais sur la vue de chaque périmètre : global → Vue d'ensemble · BU → Domaines · client → Clients · commercial → AM 360°.</Tip>
      </Card>
      {canWrite && (
        <Card title={editingId ? "Modifier l'objectif" : "Ajouter un objectif"}>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            <label className="flex flex-col gap-1 text-xs text-muted">Année fiscale
              <input className="field" type="number" min={2000} placeholder="2026" value={f.fiscalYear} onChange={(e) => set("fiscalYear", e.target.value)} /></label>
            <label className="flex flex-col gap-1 text-xs text-muted">Périmètre
              <Select value={f.scope} onChange={(v) => set("scope", v)} ariaLabel="Périmètre" options={SCOPES.map((s) => ({ value: s.v, label: s.label }))} /></label>
            <label className="flex flex-col gap-1 text-xs text-muted">{f.scope === "global" ? "Valeur (— global)" : f.scope === "bu" ? "BU" : f.scope === "commercial" ? "Commercial (AM)" : "Client"}
              {f.scope === "bu"
                ? <Select value={f.scopeValue} onChange={(v) => set("scopeValue", v)} ariaLabel="BU" options={bus.map((b) => ({ value: b, label: b }))} />
                : <input className="field" disabled={f.scope === "global"} placeholder={f.scope === "global" ? "all" : "nom / identifiant"} value={f.scope === "global" ? "all" : f.scopeValue} onChange={(e) => set("scopeValue", e.target.value)} />}</label>
            <label className="flex flex-col gap-1 text-xs text-muted">Libellé (optionnel)
              <input className="field" placeholder="ex. Objectif CODIR 2026" value={f.label} onChange={(e) => set("label", e.target.value)} /></label>
            <label className="flex flex-col gap-1 text-xs text-muted">Cible CAS (FCFA)
              <input className="field" type="number" placeholder="0" value={f.targetCas} onChange={(e) => set("targetCas", e.target.value)} /></label>
            <label className="flex flex-col gap-1 text-xs text-muted">Cible Facturé (FCFA)
              <input className="field" type="number" placeholder="0" value={f.targetInvoiced} onChange={(e) => set("targetInvoiced", e.target.value)} /></label>
            <label className="flex flex-col gap-1 text-xs text-muted">Cible Marge (FCFA)
              <input className="field" type="number" placeholder="0" value={f.targetMargin} onChange={(e) => set("targetMargin", e.target.value)} /></label>
            <label className="flex flex-col gap-1 text-xs text-muted">Cible %MB (0..1)
              <input className="field" type="number" step="0.01" placeholder="0.21" value={f.targetMarginPct} onChange={(e) => set("targetMarginPct", e.target.value)} /></label>
          </div>
          <div className="flex gap-2 mt-3">
            <Busy label={editingId ? "Mettre à jour" : "Enregistrer"} fn={save} okMsg={editingId ? "Objectif mis à jour" : "Objectif créé"} />
            {editingId && <button className="btn-ghost" onClick={reset}>Annuler</button>}
          </div>
        </Card>
      )}
    </div>
  );
};


// 4 — Facturation
export const Facturation: FC<Props> = ({ period }) => {
  const { data, loading, error } = useDocData<FacturationSummary>(`summaries/facturation_${period}`);
  if (error) return <ErrorState error={error} />;
  if (loading && !data) return <CardSkeleton />;
  if (!data) return <EmptyState />;
  return (
    <div className="flex flex-col gap-4">
      <div className={grid4}><Kpi label="Facturé (période)" value={fmt(data.total)} tone="emerald" sub={`${data.count} factures`} /></div>
      <Card title="Tendance mensuelle"><AreaTrend data={monthsAsc(data.monthly)} color={T.emerald} name="Facturé" /></Card>
      <div className={cols2}>
        <Card title="Mix BU"><DonutBU data={toDonut(data.byBu)} /></Card>
        <Card title="Top clients"><HBars rows={topArr(data.topClients).slice(0, 10)} colorFn={() => T.emerald} /></Card>
      </div>
    </div>
  );
};

// Rattachement inline d'une facture orpheline : saisie du N° FP → recompute serveur.
function FpFixer({ id }: { id: string }) {
  const [v, setV] = useState("");
  return (
    <span className="inline-flex flex-wrap gap-1 items-center">
      <input className="field w-32 !py-1 text-xs" aria-label="N° FP à rattacher" placeholder="FP/2026/…" value={v} onChange={(e) => setV(e.target.value)} />
      <Busy variant="ghost" label="Rattacher" okMsg="Facture rattachée" fn={() => setInvoiceFp(id, v)} />
    </span>
  );
}

// Correction inline d'une facture : date de facturation + date d'échéance (le montant n'est pas
// éditable — il reste piloté par la source). Comble « factures sans date / sans échéance ».
function InvoiceDateFixer({ inv }: { inv: Invoice }) {
  const [date, setDate] = useState(inv.date || "");
  const [due, setDue] = useState(inv.dueDate || "");
  const changed = date !== (inv.date || "") || due !== (inv.dueDate || "");
  return (
    <span className="inline-flex flex-wrap gap-1 items-center">
      <DateField className="w-36 !py-1 text-xs" ariaLabel="Date de facturation" value={date} onChange={setDate} placeholder="facturation" />
      <DateField className="w-36 !py-1 text-xs" ariaLabel="Date d'échéance" value={due} onChange={setDue} placeholder="échéance" />
      {changed && inv.id && <Busy variant="ghost" label="MàJ" okMsg="Facture mise à jour" fn={() => patchInvoice({ id: inv.id!, date: date || null, dueDate: due || null })} />}
    </span>
  );
}

// Liste Factures (drill-down)
export const InvoiceList: FC<Props> = () => {
  const { rows: allRows, loading } = useCollectionData<Invoice>("invoices");
  // Overlay des factures ANNULÉES (statut persistant, hors agrégats). La facture reste lisible ici
  // (collection brute) mais est exclue côté serveur de la facturation/cash/créances/qualité.
  const { data: cxl } = useDocData<CancellationsDoc>("config/cancelInvoices");
  const cancelled = new Set((cxl?.items || []).map((e) => e.id));
  const { match } = useFilters();
  const clientKey = useClientKey(); // canonicalise le client (miroir serveur) pour matcher l'option canonique
  const rows = allRows.filter((r) => match({ ...r, client: clientKey(r.client) }, ["bu", "client"])); // les factures ne portent pas d'AM
  const canImport = useCanImport();
  const { intent } = useNav();
  const [f, setF] = useState<"all" | "linked" | "orphan">(intent?.segment === "orphan" ? "orphan" : "all");
  // Drill-through depuis le Centre d'alertes (« factures non rattachées ») → segment pré-sélectionné.
  useEffect(() => { if (intent?.segment === "orphan") setF("orphan"); }, [intent]);
  if (loading && !allRows.length) return <CardSkeleton />;
  // Une facture annulée n'est pas une orpheline à traiter (elle est déjà écartée des agrégats).
  const orphan = rows.filter((r) => r.linked !== true && !cancelled.has(r.id!));
  const orphanAmt = orphan.reduce((s, r) => s + (r.amountHt || 0), 0);
  const filtered = f === "all" ? rows : f === "orphan" ? orphan : rows.filter((r) => r.linked === true);
  // Actions en masse (réservées à qui peut importer, comme les actions par ligne) : annulation / rétablissement
  // en LOT, réutilisant l'overlay `setCancellation` (statut persistant, rétablissable, survit au ré-import).
  // NB : `setCancellation` sérialise déjà le read-modify-write de l'overlay (transaction serveur). On enchaîne
  // les appels SÉQUENTIELLEMENT (pas Promise.all) pour ne pas mettre en contention le même doc d'annulations
  // (N transactions concurrentes sur un doc unique → tempête de retries / timeouts sur grande sélection).
  const invoiceBulk: BulkAction[] = canImport ? [
    { label: "Annuler", tone: "danger", confirm: "Annuler les factures sélectionnées ? Elles sortent de la facturation, du cash et des créances (conservées, rétablissables). L'annulation survit à un ré-import.",
      okMsg: (rs) => { const n = rs.filter((x) => x.id).length; return `${n} facture${n > 1 ? "s" : ""} annulée${n > 1 ? "s" : ""}`; }, errMsg: "Annulation refusée",
      run: async (rs) => { for (const r of rs.filter((x) => x.id)) await setCancellation("invoices", r.id!, true, { label: r.numero || r.id!, client: r.client }); } },
    { label: "Rétablir", confirm: "Rétablir les factures sélectionnées ? Elles réintègrent la facturation et le cash.",
      okMsg: (rs) => { const n = rs.filter((x) => x.id).length; return `${n} facture${n > 1 ? "s" : ""} rétablie${n > 1 ? "s" : ""}`; }, errMsg: "Rétablissement refusé",
      run: async (rs) => { for (const r of rs.filter((x) => x.id)) await setCancellation("invoices", r.id!, false); } },
  ] : [];
  return (
    <div className="flex flex-col gap-3">
      <FilterNote dims="BU / client" />
      {orphan.length > 0 && (
        <div className={grid4}>
          <Kpi label="Factures non rattachées" value={orphan.length.toLocaleString("fr-FR")} tone="clay" sub={`${fmt(orphanAmt)} FCFA`} />
        </div>
      )}
      <Card title={`Factures · ${rows.length.toLocaleString("fr-FR")}`} actions={<div className="flex gap-1.5 items-center flex-wrap"><Segmented value={f} onChange={setF} ariaLabel="Filtrer les factures" options={[{ value: "all", label: "Toutes" }, { value: "linked", label: "Rattachées" }, { value: "orphan", label: "Non rattachées", count: orphan.length }]} />{canImport && <ImportButton label="Importer un delta" />}</div>}>
        <ListView
          rows={filtered}
          colsKey="factures"
          initialSearch={intent?.search}
          searchKeys={[(r) => r.numero, (r) => r.fp, (r) => r.client]}
          rowKey={(r) => r.id || r.numero || ""}
          bulk={invoiceBulk}
          columns={[
            // Essentiels EN LIGNE (Numéro, Client, Échéance, Montant, Statut) ; le secondaire (FP, BU,
            // Rattachement, Date d'émission) est replié dans le détail via det() → tableau étroit, lisible.
            colText("Numéro", (r) => r.numero, (r) => r.numero),
            det(colText("FP", (r) => <FpLink fp={r.fp} />, (r) => r.fp || "")),
            colText("Client", (r) => r.client, (r) => r.client),
            det(colText("BU", (r) => buBadge(r.bu), (r) => r.bu)),
            det(colText("Rattach.", (r) => (r.linked !== true ? <Badge tone="clay">non</Badge> : <Badge tone="emerald">oui</Badge>), (r) => (r.linked !== true ? 0 : 1))),
            det(colText("Date", (r) => frDate(r.date), (r) => r.date || "")),
            colText("Échéance", (r) => frDate(r.dueDate), (r) => r.dueDate || ""),
            colNum("Montant HT", (r) => money(r.amountHt), (r) => r.amountHt),
            colText("Statut", (r) => (cancelled.has(r.id!) ? <Badge tone="clay">Annulée</Badge> : (r.paymentStatus || "—")), (r) => (cancelled.has(r.id!) ? "zzz" : r.paymentStatus || "")),
            // Actions groupées en UNE colonne (entête vide → jamais repliée) : rattacher, dates, assainir,
            // annuler/rétablir. Reste toujours visible en ligne (cf. socle design : colonnes d'action).
            ...(canImport ? [colText("", (r: Invoice) => (r.id ? (
              <div className="flex flex-wrap items-center justify-end gap-1.5">
                {r.linked !== true && !cancelled.has(r.id) && <FpFixer id={r.id} />}
                {!cancelled.has(r.id) && <InvoiceDateFixer inv={r} />}
                <DangerBtn label="Suppr." confirm={`Supprimer la facture ${r.numero || r.id} ? Un futur import delta ne la recréera que si la source la contient encore.`} fn={() => deleteRecord("invoices", r.id!)} />
                {/* Annulation (statut « Annulée » persistant) : la facture sort de la facturation/cash/créances
                    mais reste conservée (rétablissable). Survit à un ré-import delta (overlay). */}
                {cancelled.has(r.id)
                  ? <DangerBtn label="Rétablir" tone="steel" okMsg="Facture rétablie" errMsg="Rétablissement refusé" confirm={`Rétablir la facture ${r.numero || r.id} ? Elle réintègre la facturation et le cash.`} fn={() => setCancellation("invoices", r.id!, false)} />
                  : <DangerBtn label="Annuler" tone="gold" okMsg="Facture annulée" errMsg="Annulation refusée" confirm={`Annuler la facture ${r.numero || r.id} ? Elle sort de la facturation, du cash et des créances (conservée, rétablissable). L'annulation survit à un ré-import.`} fn={() => setCancellation("invoices", r.id!, true, { label: r.numero || r.id!, client: r.client })} />}
              </div>
            ) : null), () => 0)] : []),
          ]}
        />
      </Card>
    </div>
  );
};

// 7 — Rentabilité : deux perspectives de marge — Commande (assiette CAS) ou Facturé (assiette CAF).
// Waterfall de marge (Lot 9b) : cascade des contributions de marge par domaine (BU) jusqu'au total.
// Chaque barre « flotte » entre son cumul de départ et d'arrivée ; vert = contribution positive, rouge =
// négative, or = total. Rend visible la formation de la marge (quel domaine porte / pèse sur le résultat).
function MarginWaterfall({ byBu }: { byBu: { bu?: string; mb?: number }[] }) {
  const { steps } = marginWaterfall(byBu);
  if (steps.length <= 1) return null;
  // Domaine COMPLET [lo, hi] incluant les valeurs NÉGATIVES (une marge cumulée qui passe sous zéro) : sinon
  // une contribution négative donnait un `left` négatif écrêté (barre indiscernable d'une grosse positive).
  const lo = Math.min(0, ...steps.map((s) => s.start));
  const hi = Math.max(...steps.map((s) => s.end));
  const span = Math.max(1, hi - lo);
  const x = (v: number) => ((v - lo) / span) * 100;
  const color = (k: string) => (k === "total" ? T.gold : k === "neg" ? T.clay : T.emerald);
  return (
    <Card title="Waterfall de marge — contribution par domaine">
      <div className="flex flex-col gap-1.5">
        {steps.map((s) => (
          <div key={s.label} className="flex items-center gap-2 text-[12px]">
            <div className="w-28 truncate text-right text-muted" title={s.label}>{s.label}</div>
            <div className="relative grow h-4 rounded bg-panel2 overflow-hidden">
              <div className="absolute top-0 bottom-0 rounded" style={{ left: `${x(s.start)}%`, width: `${Math.max(0.5, x(s.end) - x(s.start))}%`, backgroundColor: color(s.kind) }} />
            </div>
            <div className={cx("w-28 text-right tabnum", s.value < 0 && "text-clay", s.kind === "total" && "font-semibold")}>{money(s.value)}</div>
          </div>
        ))}
      </div>
      <Tip>Cascade de formation de la <b>marge totale</b> : chaque domaine (BU) ajoute (vert) ou retranche (rouge) sa contribution, du plus fort au plus faible, jusqu'au <b>total</b> (or). Un domaine à marge négative tire le résultat vers le bas.</Tip>
    </Card>
  );
}

export const Rentabilite: FC<Props> = ({ period }) => {
  const { data, loading, error } = useDocData<RentabiliteSummary>(`summaries/rentabilite_${period}`);
  const { active } = useFilters();
  const [view, setView] = useState<"commande" | "facture">("commande");
  if (error) return <ErrorState error={error} />;
  if (loading && !data) return <CardSkeleton />;
  if (!data) return <EmptyState />;

  // Perspective générique (assiette = `base`). Repli sur les champs racine (perspective Commande)
  // pour un ancien agrégat non encore recalculé.
  const hasFac = !!data.perspectives;
  const fallback = {
    base: data.cas || 0, mb: data.mb || 0, pmb: data.pmb || 0,
    byBu: (data.byBu || []).map((b: any) => ({ bu: b.bu, base: b.cas, mb: b.mb, pmb: b.pmb ?? (b.cas > 0 ? b.mb / b.cas : 0) })),
    byAm: (data.byAm || []).map((a) => ({ am: a.am, base: a.cas, mb: a.mb, pmb: a.pmb })),
    bottomAffaires: (data.bottomAffaires || []).map((o) => ({ fp: o.fp, client: o.client, am: o.am, base: o.cas, mb: o.mb, pmb: o.pmb })),
    topClients: data.topClients || [],
  };
  const p = data.perspectives ? data.perspectives[view] : fallback;
  const filterActive = active; // la Rentabilité lit un agrégat pré-calculé GLOBAL : le filtre transverse ne s'y applique pas
  const baseLbl = view === "commande" ? "CAS" : "Facturé";
  const baseSub = view === "commande" ? "Marge P&L sur la prise de commande" : "Marge reconnue au prorata du facturé (CAF)";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <span className="text-[11px] uppercase tracking-wide text-faint">Perspective</span>
        <Segmented value={view} onChange={setView} ariaLabel="Perspective de marge"
          options={[{ value: "commande", label: "Commande" }, { value: "facture", label: "Facturé", disabled: !hasFac, title: !hasFac ? "Recalculer les agrégats pour activer cette perspective" : undefined }]} />
      </div>
      {filterActive && <div className="text-[11px] text-gold">Vue globale — le filtre transverse (BU / AM / client) ne s'applique pas ici (agrégat pré-calculé). La marge filtrée est lisible dans la Vue d'ensemble.</div>}
      <div className={grid4}>
        <Kpi label={view === "commande" ? "Marge brute (commande)" : "Marge brute (facturé)"} value={fmt(p.mb)} tone="gold" sub={baseSub} />
        <Kpi label={baseLbl} value={fmt(p.base)} />
        <Kpi label="%MB" value={pct(p.pmb)} />
      </div>
      <div className={cols2}>
        <Card title={`${baseLbl} vs MB par domaine`}>
          <GroupedBars data={(p.byBu || []).map((b) => ({ name: b.bu, [baseLbl]: b.base, MB: b.mb }))} series={[{ key: baseLbl, color: T.steel, name: baseLbl }, { key: "MB", color: T.plum, name: "MB" }]} />
        </Card>
        <Card title={`${baseLbl} vs MB par commercial (AM)`}>
          {(p.byAm || []).length
            ? <GroupedBars data={(p.byAm || []).slice(0, 10).map((a) => ({ name: a.am, [baseLbl]: a.base, MB: a.mb }))} series={[{ key: baseLbl, color: T.steel, name: baseLbl }, { key: "MB", color: T.gold, name: "MB" }]} />
            : <EmptyState label="Aucun commercial renseigné." />}
        </Card>
      </div>
      <MarginWaterfall byBu={p.byBu || []} />
      <Card title="Affaires à faible marge (à surveiller)">
        <Table columns={[
          colText("FP", (a) => <FpLink fp={a.fp} />, (a) => a.fp || ""),
          colText("Client", (a) => a.client || "—", (a) => a.client || ""),
          colText("Commercial", (a) => a.am || "—", (a) => a.am || ""),
          colNum(baseLbl, (a) => money(a.base), (a) => a.base),
          colNum("MB", (a) => money(a.mb), (a) => a.mb),
          colNum("%MB", (a) => <Badge tone={(a.pmb < MARGIN.LOW ? "clay" : a.pmb < MARGIN.OK ? "gold" : "emerald") as any}>{pct(a.pmb)}</Badge>, (a) => a.pmb),
        ]} rows={p.bottomAffaires || []} empty={`Aucune affaire à ${baseLbl} positif.`} />
      </Card>
      <Card title="Top clients (marge)"><HBars rows={topArr(p.topClients).slice(0, 10)} colorFn={() => T.gold} /></Card>
      <Tip><b>Commande</b> : marge P&amp;L sur la prise de commande (CAS, cohorte par année de PO). <b>Facturé</b> : assiette = factures <b>datées</b> dans la période (identique à la vue Facturation), marge = taux de marge de la commande rattachée × montant facturé. L'attribution par date de facture évite les inversions entre exercices.</Tip>
    </div>
  );
};
