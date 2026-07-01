// Les 13 modules (parité prototype, BUILD_KIT §2). Lecture temps réel des summaries/*,
// détail à la demande, et écritures gardées (F5) refusées par les rules si rôle insuffisant.
import { useState, type ReactNode, type CSSProperties } from "react";
import { useDocData, useCollectionData } from "../lib/hooks";
import { useCan } from "../lib/rbac";
import { colors, fmt, pct, buColors } from "../design/tokens";
import { Card, Kpi, HBars, Stage, Tip, Empty } from "../design/components";
import {
  addOpportunity, setBcStatus, upsertCreditLine, upsertObjective,
  updateMatrix, callSetUserRole, callRecompute,
} from "../lib/writes";

type Props = { period: string };

const grid = (min = 150): CSSProperties => ({ display: "grid", gridTemplateColumns: `repeat(auto-fill, minmax(${min}px,1fr))`, gap: 12 });
const cols2: CSSProperties = { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 };
const field: CSSProperties = { padding: "6px 8px", borderRadius: 6, border: `1px solid ${colors.bg}`, background: colors.bg, color: colors.ink, fontSize: 13 };
const btn: CSSProperties = { padding: "6px 12px", borderRadius: 6, border: "none", background: colors.gold, color: colors.bg, fontWeight: 600, cursor: "pointer", fontSize: 13 };

function Table({ head, rows }: { head: string[]; rows: ReactNode[][] }) {
  if (!rows.length) return <Empty />;
  return (
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
      <thead>
        <tr>{head.map((h, i) => <th key={i} style={{ textAlign: i === 0 ? "left" : "right", padding: "6px 8px", opacity: 0.6, fontWeight: 500, borderBottom: `1px solid ${colors.bg}` }}>{h}</th>)}</tr>
      </thead>
      <tbody>
        {rows.map((r, ri) => (
          <tr key={ri}>{r.map((c, ci) => <td key={ci} style={{ textAlign: ci === 0 ? "left" : "right", padding: "6px 8px", fontVariantNumeric: "tabular-nums", borderBottom: `1px solid ${colors.bg}` }}>{c}</td>)}</tr>
        ))}
      </tbody>
    </table>
  );
}

function Busy({ fn, label }: { fn: () => Promise<any>; label: string }) {
  const [state, setState] = useState<"" | "busy" | "ok" | "err">("");
  return (
    <button
      style={{ ...btn, opacity: state === "busy" ? 0.6 : 1 }}
      disabled={state === "busy"}
      onClick={async () => { setState("busy"); try { await fn(); setState("ok"); } catch { setState("err"); } }}
    >
      {state === "busy" ? "…" : state === "ok" ? "✓" : state === "err" ? "✗ refusé" : label}
    </button>
  );
}

// 1 — Vue d'ensemble
function Overview({ period }: Props) {
  const { data } = useDocData<any>(`summaries/overview_${period}`);
  const canWrite = useCan("overview") === "write";
  if (!data) return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <Empty />
      {canWrite && <div><Busy label="Recalculer les agrégats" fn={callRecompute} /></div>}
    </div>
  );
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={grid()}>
        <Kpi label="Certitudes" value={fmt(data.certitudes)} tone={colors.gold} />
        <Kpi label="Commandes (CAS)" value={fmt(data.commandes)} />
        <Kpi label="Facturé" value={fmt(data.facture)} tone={colors.emerald} />
        <Kpi label="Backlog (RAF)" value={fmt(data.backlog)} tone={colors.steel} />
        <Kpi label="Marge brute" value={fmt(data.mb)} sub={`%MB ${pct(data.ratios?.pmb)}`} />
        <Kpi label="Taux facturation" value={pct(data.ratios?.tauxFacturation)} />
      </div>
      {canWrite && <div><Busy label="Recalculer les agrégats" fn={callRecompute} /></div>}
      <Tip>Chaîne Certitudes → Commandes → Facturé → Backlog, jointe par N° FP. Backlog ancré FY.</Tip>
    </div>
  );
}

// 2 — Pipeline (+ saisie d'opportunité)
function Pipeline() {
  const { data } = useDocData<any>("summaries/pipeline");
  const canWrite = useCan("pipeline") === "write";
  const [f, setF] = useState({ client: "", am: "", bu: "ICT", amount: "", stage: "1", probability: "", closingDate: "" });
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {data && (
        <>
          <div style={grid()}>
            <Kpi label="Actif (brut)" value={fmt(data.tot?.brut)} sub={`${data.tot?.count ?? 0} opp.`} />
            <Kpi label="Actif (pondéré)" value={fmt(data.tot?.weighted)} tone={colors.gold} />
            <Kpi label="Suspendu" value={fmt(data.susp?.brut)} sub={`${data.susp?.count ?? 0} opp.`} tone={colors.clay} />
            <Kpi label="Conversion" value={pct(data.conv)} sub={`${data.wonCount}/${data.wonCount + data.lostCount}`} />
          </div>
          <div style={cols2}>
            <Card title="Pondéré par AM"><HBars data={data.byAM || {}} /></Card>
            <Card title="Pondéré par BU"><HBars data={data.byBU || {}} /></Card>
          </div>
          <Card title="Top opportunités (pondéré)">
            <Table head={["Client", "AM", "Montant", "Pondéré"]} rows={(data.topOpps || []).map((o: any) => [o.client, o.am, fmt(o.amount), fmt(o.weighted)])} />
          </Card>
        </>
      )}
      {!data && <Empty />}
      {canWrite && (
        <Card title="Ajouter une opportunité (saisie)">
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
            <input style={field} placeholder="Client" value={f.client} onChange={(e) => setF({ ...f, client: e.target.value })} />
            <input style={field} placeholder="AM" value={f.am} onChange={(e) => setF({ ...f, am: e.target.value })} />
            <select style={field} value={f.bu} onChange={(e) => setF({ ...f, bu: e.target.value })}>{["ICT", "CLOUD", "FORMATION", "AUTRE"].map((b) => <option key={b}>{b}</option>)}</select>
            <input style={field} placeholder="Montant" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} />
            <select style={field} value={f.stage} onChange={(e) => setF({ ...f, stage: e.target.value })}>{[1, 2, 3, 4, 5, 6, 7, 8, 9].map((s) => <option key={s} value={s}>Étape {s}</option>)}</select>
            <input style={field} placeholder="Proba (0..1)" value={f.probability} onChange={(e) => setF({ ...f, probability: e.target.value })} />
            <input style={field} type="date" value={f.closingDate} onChange={(e) => setF({ ...f, closingDate: e.target.value })} />
            <Busy label="Ajouter" fn={() => addOpportunity({
              client: f.client, am: f.am, bu: f.bu, amount: Number(f.amount) || 0, stage: Number(f.stage),
              probability: Number(f.probability) || 0, closingDate: f.closingDate || undefined,
            })} />
          </div>
        </Card>
      )}
    </div>
  );
}

// 3 — Objectifs / R-O (+ saisie)
function Objectifs({ period }: Props) {
  const { rows } = useCollectionData<any>("objectives");
  const { data: ov } = useDocData<any>(`summaries/overview_${period}`);
  const canWrite = useCan("objectifs") === "write";
  const realiseCas = ov?.commandes || 0;
  const [o, setO] = useState({ fiscalYear: "", scope: "global", scopeValue: "all", targetCas: "", targetInvoiced: "", targetMargin: "" });
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <Card title="Objectifs annuels & Réalisé/Objectif">
        <Table
          head={["Périmètre", "Cible CAS", "Cible Facturé", "Cible Marge", "R/O CAS"]}
          rows={rows.map((x) => [`${x.fiscalYear} ${x.scope || ""} ${x.scopeValue || ""}`.trim(), fmt(x.targetCas), fmt(x.targetInvoiced), fmt(x.targetMargin), x.targetCas > 0 ? pct(realiseCas / x.targetCas) : "—"])}
        />
        <Tip>Réalisé CAS période : {fmt(realiseCas)} · Facturé : {fmt(ov?.facture)} · Marge : {fmt(ov?.mb)}.</Tip>
      </Card>
      {canWrite && (
        <Card title="Ajouter / mettre à jour un objectif">
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
            <input style={field} placeholder="Année" value={o.fiscalYear} onChange={(e) => setO({ ...o, fiscalYear: e.target.value })} />
            <input style={field} placeholder="Scope (global/bu/am)" value={o.scope} onChange={(e) => setO({ ...o, scope: e.target.value })} />
            <input style={field} placeholder="Valeur scope" value={o.scopeValue} onChange={(e) => setO({ ...o, scopeValue: e.target.value })} />
            <input style={field} placeholder="Cible CAS" value={o.targetCas} onChange={(e) => setO({ ...o, targetCas: e.target.value })} />
            <input style={field} placeholder="Cible Facturé" value={o.targetInvoiced} onChange={(e) => setO({ ...o, targetInvoiced: e.target.value })} />
            <input style={field} placeholder="Cible Marge" value={o.targetMargin} onChange={(e) => setO({ ...o, targetMargin: e.target.value })} />
            <Busy label="Enregistrer" fn={() => upsertObjective({
              fiscalYear: Number(o.fiscalYear) || 0, scope: o.scope, scopeValue: o.scopeValue,
              targetCas: Number(o.targetCas) || 0, targetInvoiced: Number(o.targetInvoiced) || 0, targetMargin: Number(o.targetMargin) || 0,
            })} />
          </div>
        </Card>
      )}
    </div>
  );
}

// 4 — Facturation
function Facturation({ period }: Props) {
  const { data } = useDocData<any>(`summaries/facturation_${period}`);
  if (!data) return <Empty />;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={grid()}><Kpi label="Facturé (période)" value={fmt(data.total)} tone={colors.emerald} sub={`${data.count} factures`} /></div>
      <Card title="Tendance mensuelle"><HBars data={data.monthly || {}} /></Card>
      <div style={cols2}>
        <Card title="Mix BU"><HBars data={data.byBu || {}} /></Card>
        <Card title="Top clients"><HBars data={data.topClients || []} /></Card>
      </div>
    </div>
  );
}

// 5 — Suivi Backlog
function Backlog() {
  const { data } = useDocData<any>("summaries/backlog_fy");
  if (!data) return <Empty />;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={grid()}><Kpi label={`Backlog FY ${data.fy || ""}`} value={fmt(data.total)} tone={colors.steel} sub={`${data.count} commandes`} /></div>
      <div style={cols2}>
        <Card title="Par domaine"><HBars data={data.byBu || {}} /></Card>
        <Card title="Par millésime"><HBars data={data.byVintage || {}} /></Card>
      </div>
      <Card title="Top commandes"><Table head={["FP", "Client", "BU", "RAF"]} rows={(data.top || []).map((t: any) => [t.fp, t.client, t.bu, fmt(t.raf)])} /></Card>
      <Tip>Ancré sur l'année fiscale — inchangé quand on change la période.</Tip>
    </div>
  );
}

// 6 — Prévision
function Prevision({ period }: Props) {
  const { data: ov } = useDocData<any>(`summaries/overview_${period}`);
  const { data: bl } = useDocData<any>("summaries/backlog_fy");
  const { data: pl } = useDocData<any>("summaries/pipeline");
  if (!ov && !bl && !pl) return <Empty />;
  const realise = ov?.facture || 0, backlog = bl?.total || 0, pond = pl?.tot?.weighted || 0;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={grid()}>
        <Kpi label="Réalisé (facturé)" value={fmt(realise)} tone={colors.emerald} />
        <Kpi label="Backlog écoulable" value={fmt(backlog)} tone={colors.steel} />
        <Kpi label="Pipeline pondéré" value={fmt(pond)} tone={colors.gold} />
        <Kpi label="Projeté" value={fmt(realise + backlog + pond)} />
      </div>
      <Tip>Trajectoire réalisé → projeté (réalisé + écoulement backlog + pipeline pondéré).</Tip>
    </div>
  );
}

// 7 — Rentabilité
function Rentabilite({ period }: Props) {
  const { data } = useDocData<any>(`summaries/rentabilite_${period}`);
  if (!data) return <Empty />;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={grid()}>
        <Kpi label="Marge brute" value={fmt(data.mb)} tone={colors.gold} />
        <Kpi label="CAS" value={fmt(data.cas)} />
        <Kpi label="%MB" value={pct(data.pmb)} />
      </div>
      <Card title="CAS vs MB par domaine">
        <Table head={["BU", "CAS", "MB", "%MB"]} rows={(data.byBu || []).map((b: any) => [<span style={{ color: (buColors as any)[b.bu] || colors.ink }}>{b.bu}</span>, fmt(b.cas), fmt(b.mb), pct(b.pmb)])} />
      </Card>
      <Card title="Top clients (marge)"><HBars data={data.topClients || []} /></Card>
    </div>
  );
}

// 8 — P&L Projet
function PnlProjet() {
  const { rows } = useCollectionData<any>("projectSheets");
  return (
    <Card title="Fiches affaire — coût / vente / marge">
      <Table head={["FP", "Client", "Affaire", "Revient", "Vente", "Marge", "%MB"]} rows={rows.map((r) => [r.fp, r.client, r.affaire, fmt(r.costTotal), fmt(r.saleTotal), fmt(r.margin), pct(r.marginPct)])} />
      <Tip>Contrôle vente vs CAS de la commande ; coût par type/fournisseur via les lignes BC.</Tip>
    </Card>
  );
}

// 9 — Crédit Fournisseurs (+ édition ligne de crédit)
function Fournisseurs() {
  const { data } = useDocData<any>("summaries/suppliers");
  const canWrite = useCan("fournisseurs") === "write";
  if (!data) return <Empty />;
  const stateTone: any = { saturation: colors.clay, tension: colors.gold, ok: colors.emerald };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={grid()}>
        <Kpi label="Exposition totale" value={fmt(data.totalExpo)} />
        <Kpi label="Achat comm. ouvertes" value={fmt(data.openTotal)} tone={colors.steel} />
        <Kpi label="Encours" value={fmt(data.encoursTotal)} />
      </div>
      <Card title="Par fournisseur">
        <Table
          head={["Fournisseur", "Expo.", "Ouvert", "Encours", "Couverture", "État", ...(canWrite ? ["Ligne crédit"] : [])]}
          rows={(data.bySupplier || []).map((s: any) => {
            const base = [s.name, fmt(s.expo), fmt(s.open), fmt(s.encours), fmt(s.coverage), <span style={{ color: stateTone[s.state] }}>{s.state}</span>];
            return canWrite ? [...base, <CreditEditor name={s.name} authorized={s.authorized} outstanding={s.encours} />] : base;
          })}
        />
      </Card>
    </div>
  );
}
function CreditEditor({ name, authorized, outstanding }: { name: string; authorized: number; outstanding: number }) {
  const [a, setA] = useState(String(authorized || ""));
  const [o, setO] = useState(String(outstanding || ""));
  return (
    <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
      <input style={{ ...field, width: 90 }} value={a} onChange={(e) => setA(e.target.value)} placeholder="autorisé" />
      <input style={{ ...field, width: 90 }} value={o} onChange={(e) => setO(e.target.value)} placeholder="encours" />
      <Busy label="OK" fn={() => upsertCreditLine(name, { authorized: Number(a) || 0, outstanding: Number(o) || 0 })} />
    </span>
  );
}

// 10 — Exécution BC (+ changement de statut)
const BC_STAGES = ["a_emettre", "emis", "livre", "facture", "solde"];
function BC() {
  const { rows } = useCollectionData<any>("bcLines");
  const canWrite = useCan("bc") === "write";
  const byStatus: Record<string, number> = {};
  for (const r of rows) byStatus[r.status || "a_emettre"] = (byStatus[r.status || "a_emettre"] || 0) + 1;
  const solde = byStatus["solde"] || 0;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={grid(120)}>{BC_STAGES.map((s) => <Stage key={s} label={s} value={String(byStatus[s] || 0)} />)}</div>
      <Kpi label="Taux d'exécution (soldé)" value={pct(rows.length ? solde / rows.length : 0)} />
      <Card title="Lignes BC">
        <Table
          head={["FP", "Fournisseur", "Type", "XOF", "Statut"]}
          rows={rows.slice(0, 100).map((r) => [
            r.fp, r.supplier, r.expenseType, fmt(r.amountXof),
            canWrite ? <StatusSelect id={r.id} status={r.status || "a_emettre"} /> : (r.status || "a_emettre"),
          ])}
        />
      </Card>
    </div>
  );
}
function StatusSelect({ id, status }: { id: string; status: string }) {
  const [s, setS] = useState(status);
  return (
    <select style={field} value={s} onChange={async (e) => { const v = e.target.value; setS(v); try { await setBcStatus(id, v); } catch { setS(status); } }}>
      {BC_STAGES.map((x) => <option key={x} value={x}>{x}</option>)}
    </select>
  );
}

// 11/12 — Clients / Domaines
function EntityView({ period, kind }: Props & { kind: "clients" | "domaines" }) {
  const { data } = useDocData<any>(`summaries/${kind}_${period}`);
  if (!data) return <Empty />;
  return (
    <Card title={kind === "clients" ? "Clients" : "Domaines (BU)"}>
      <Table head={[kind === "clients" ? "Client" : "BU", "CAS", "Facturé", "Backlog", "Marge", "%MB"]} rows={(data.rows || []).map((r: any) => [r.key, fmt(r.cas), fmt(r.facture), fmt(r.backlog), fmt(r.mb), pct(r.pmb)])} />
    </Card>
  );
}

// 13 — Habilitations (+ édition matrice & rôles)
function Habilitations() {
  const { data } = useDocData<any>("config/permissions");
  const { rows: users } = useCollectionData<any>("users");
  const canWrite = useCan("habilitations") === "write";
  const [draft, setDraft] = useState<Record<string, Record<string, string>> | null>(null);
  const matrix = draft || data?.matrix || {};
  const roles = Object.keys(matrix);
  const modules = roles.length ? Object.keys(matrix[roles[0]]) : [];
  const cycle: any = { none: "read", read: "write", write: "none" };
  const glyph: any = { write: "W", read: "R", none: "–" };
  const tone: any = { write: colors.emerald, read: colors.steel, none: colors.bg };

  const setCell = (r: string, m: string) => {
    const base = JSON.parse(JSON.stringify(matrix));
    base[r][m] = cycle[base[r][m]] || "read";
    setDraft(base);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <Card title="Matrice droits (profil × module)">
        <div style={{ overflowX: "auto" }}>
          <table style={{ borderCollapse: "collapse", fontSize: 12 }}>
            <thead><tr><th style={{ padding: 6, textAlign: "left", opacity: 0.6 }}>Module</th>{roles.map((r) => <th key={r} style={{ padding: 6, opacity: 0.6 }}>{r}</th>)}</tr></thead>
            <tbody>
              {modules.map((m) => (
                <tr key={m}>
                  <td style={{ padding: 6 }}>{m}</td>
                  {roles.map((r) => (
                    <td key={r} style={{ padding: 4, textAlign: "center" }}>
                      <button
                        disabled={!canWrite}
                        onClick={() => canWrite && setCell(r, m)}
                        style={{ width: 28, height: 24, borderRadius: 4, border: "none", cursor: canWrite ? "pointer" : "default", background: tone[matrix[r][m]] || colors.bg, color: matrix[r][m] === "none" ? colors.ink : colors.bg, fontWeight: 600 }}
                      >{glyph[matrix[r][m]] ?? "–"}</button>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {canWrite && draft && <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
          <Busy label="Enregistrer la matrice" fn={async () => { await updateMatrix(draft); setDraft(null); }} />
          <button style={{ ...btn, background: colors.panel, color: colors.ink }} onClick={() => setDraft(null)}>Annuler</button>
        </div>}
      </Card>
      <Card title="Utilisateurs & rôles">
        <Table
          head={["Email", "Nom", "Actif", ...(canWrite ? ["Rôle"] : [])]}
          rows={users.map((u) => {
            const base = [u.email, u.name, u.active ? "oui" : "non"];
            return canWrite ? [...base, <RoleSetter uid={u.id} />] : base;
          })}
        />
        <Tip>Le rôle est un custom claim posé via la Cloud Function setUserRole (auditée).</Tip>
      </Card>
    </div>
  );
}
function RoleSetter({ uid }: { uid: string }) {
  const [role, setRole] = useState("lecture");
  return (
    <span style={{ display: "inline-flex", gap: 6 }}>
      <select style={field} value={role} onChange={(e) => setRole(e.target.value)}>
        {["direction", "commercial_dir", "commercial", "pmo", "achats", "lecture"].map((r) => <option key={r}>{r}</option>)}
      </select>
      <Busy label="Poser" fn={() => callSetUserRole(uid, role)} />
    </span>
  );
}

export const MODULES: { key: string; label: string; Component: (p: Props) => ReactNode }[] = [
  { key: "overview", label: "Vue d'ensemble", Component: Overview },
  { key: "pipeline", label: "Pipeline", Component: () => <Pipeline /> },
  { key: "objectifs", label: "Objectifs / R-O", Component: Objectifs },
  { key: "facturation", label: "Facturation", Component: Facturation },
  { key: "backlog", label: "Suivi Backlog", Component: () => <Backlog /> },
  { key: "prevision", label: "Prévision", Component: Prevision },
  { key: "rentabilite", label: "Rentabilité (P&L)", Component: Rentabilite },
  { key: "pnlprojet", label: "P&L Projet", Component: () => <PnlProjet /> },
  { key: "fournisseurs", label: "Crédit Fournisseurs", Component: () => <Fournisseurs /> },
  { key: "bc", label: "Exécution BC", Component: () => <BC /> },
  { key: "clients", label: "Clients", Component: (p) => <EntityView {...p} kind="clients" /> },
  { key: "domaines", label: "Domaines", Component: (p) => <EntityView {...p} kind="domaines" /> },
  { key: "habilitations", label: "Habilitations", Component: () => <Habilitations /> },
];
