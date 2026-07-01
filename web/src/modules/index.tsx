// Les 13 modules (parité prototype, BUILD_KIT §2). Lecture temps réel des summaries/*
// et du détail à la demande. Écritures gardées ajoutées en F5.
import type { ReactNode } from "react";
import { useDocData, useCollectionData } from "../lib/hooks";
import { colors, fmt, pct, buColors } from "../design/tokens";
import { Card, Kpi, HBars, Stage, Tip, Empty, Eyebrow } from "../design/components";

type Props = { period: string };

const grid = (min = 150): React.CSSProperties => ({ display: "grid", gridTemplateColumns: `repeat(auto-fill, minmax(${min}px,1fr))`, gap: 12 });
const cols2: React.CSSProperties = { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 };

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

// 1 — Vue d'ensemble
function Overview({ period }: Props) {
  const { data } = useDocData<any>(`summaries/overview_${period}`);
  if (!data) return <Empty />;
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
      <Tip>Chaîne Certitudes → Commandes → Facturé → Backlog, jointe par N° FP. Backlog ancré FY (indépendant de la période).</Tip>
    </div>
  );
}

// 2 — Pipeline
function Pipeline() {
  const { data } = useDocData<any>("summaries/pipeline");
  if (!data) return <Empty />;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
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
    </div>
  );
}

// 3 — Objectifs / R-O
function Objectifs({ period }: Props) {
  const { rows } = useCollectionData<any>("objectives");
  const { data: ov } = useDocData<any>(`summaries/overview_${period}`);
  const realise = { cas: ov?.commandes || 0, facture: ov?.facture || 0, mb: ov?.mb || 0 };
  return (
    <Card title="Objectifs annuels & Réalisé/Objectif">
      <Table
        head={["Périmètre", "Cible CAS", "Cible Facturé", "Cible Marge", "R/O CAS"]}
        rows={rows.map((o) => [
          `${o.fiscalYear} ${o.scope || ""} ${o.scopeValue || ""}`.trim(),
          fmt(o.targetCas), fmt(o.targetInvoiced), fmt(o.targetMargin),
          o.targetCas > 0 ? pct(realise.cas / o.targetCas) : "—",
        ])}
      />
      <Tip>Réalisé CAS période : {fmt(realise.cas)} · Facturé : {fmt(realise.facture)} · Marge : {fmt(realise.mb)}.</Tip>
    </Card>
  );
}

// 4 — Facturation
function Facturation({ period }: Props) {
  const { data } = useDocData<any>(`summaries/facturation_${period}`);
  if (!data) return <Empty />;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={grid()}>
        <Kpi label="Facturé (période)" value={fmt(data.total)} tone={colors.emerald} sub={`${data.count} factures`} />
      </div>
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
      <div style={grid()}>
        <Kpi label={`Backlog FY ${data.fy || ""}`} value={fmt(data.total)} tone={colors.steel} sub={`${data.count} commandes`} />
      </div>
      <div style={cols2}>
        <Card title="Par domaine"><HBars data={data.byBu || {}} /></Card>
        <Card title="Par millésime"><HBars data={data.byVintage || {}} /></Card>
      </div>
      <Card title="Top commandes">
        <Table head={["FP", "Client", "BU", "RAF"]} rows={(data.top || []).map((t: any) => [t.fp, t.client, t.bu, fmt(t.raf)])} />
      </Card>
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
  const realise = ov?.facture || 0;
  const backlog = bl?.total || 0;
  const pond = pl?.tot?.weighted || 0;
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

// 7 — Rentabilité (P&L)
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
      <Table
        head={["FP", "Client", "Affaire", "Revient", "Vente", "Marge", "%MB"]}
        rows={rows.map((r) => [r.fp, r.client, r.affaire, fmt(r.costTotal), fmt(r.saleTotal), fmt(r.margin), pct(r.marginPct)])}
      />
      <Tip>Contrôle vente vs CAS de la commande ; coût par type/fournisseur via les lignes BC.</Tip>
    </Card>
  );
}

// 9 — Crédit Fournisseurs
function Fournisseurs() {
  const { data } = useDocData<any>("summaries/suppliers");
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
          head={["Fournisseur", "Expo.", "Ouvert", "Encours", "Couverture", "État"]}
          rows={(data.bySupplier || []).map((s: any) => [s.name, fmt(s.expo), fmt(s.open), fmt(s.encours), fmt(s.coverage), <span style={{ color: stateTone[s.state] }}>{s.state}</span>])}
        />
      </Card>
    </div>
  );
}

// 10 — Exécution BC
const BC_STAGES = ["a_emettre", "emis", "livre", "facture", "solde"];
function BC() {
  const { rows } = useCollectionData<any>("bcLines");
  const byStatus: Record<string, number> = {};
  for (const r of rows) byStatus[r.status || "a_emettre"] = (byStatus[r.status || "a_emettre"] || 0) + 1;
  const solde = byStatus["solde"] || 0;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={grid(120)}>
        {BC_STAGES.map((s) => <Stage key={s} label={s} value={String(byStatus[s] || 0)} />)}
      </div>
      <Kpi label="Taux d'exécution (soldé)" value={pct(rows.length ? solde / rows.length : 0)} />
      <Card title="Lignes BC">
        <Table head={["FP", "Fournisseur", "Type", "XOF", "Statut"]} rows={rows.slice(0, 100).map((r) => [r.fp, r.supplier, r.expenseType, fmt(r.amountXof), r.status])} />
      </Card>
    </div>
  );
}

// 11 — Clients / 12 — Domaines (même structure)
function EntityView({ period, kind }: Props & { kind: "clients" | "domaines" }) {
  const { data } = useDocData<any>(`summaries/${kind}_${period}`);
  if (!data) return <Empty />;
  return (
    <Card title={kind === "clients" ? "Clients" : "Domaines (BU)"}>
      <Table
        head={[kind === "clients" ? "Client" : "BU", "CAS", "Facturé", "Backlog", "Marge", "%MB"]}
        rows={(data.rows || []).map((r: any) => [r.key, fmt(r.cas), fmt(r.facture), fmt(r.backlog), fmt(r.mb), pct(r.pmb)])}
      />
    </Card>
  );
}

// 13 — Habilitations
function Habilitations() {
  const { data } = useDocData<any>("config/permissions");
  const { rows: users } = useCollectionData<any>("users");
  const matrix = data?.matrix || {};
  const roles = Object.keys(matrix);
  const modules = roles.length ? Object.keys(matrix[roles[0]]) : [];
  const glyph: any = { write: "W", read: "R", none: "–" };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <Card title="Matrice droits (profil × module)">
        <div style={{ overflowX: "auto" }}>
          <Table head={["Module", ...roles]} rows={modules.map((m) => [m, ...roles.map((r) => glyph[matrix[r][m]] ?? "–")])} />
        </div>
        <Tip>Édition de la matrice et des rôles : F5 (réservée profil « habilitations »).</Tip>
      </Card>
      <Card title="Utilisateurs">
        <Table head={["Email", "Nom", "Actif"]} rows={users.map((u) => [u.email, u.name, u.active ? "oui" : "non"])} />
      </Card>
    </div>
  );
}

// Registre : clé permission (RBAC) → libellé + composant.
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

export { Eyebrow };
