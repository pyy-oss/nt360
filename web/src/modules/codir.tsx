// BILAN HEBDOMADAIRE CODIR — « Projection CAF » : one-pager de pilotage hebdo (comité de direction).
// Réassemble des AGRÉGATS EXISTANTS (atterrissage, clients, backlog, tendance de facturation) dans la
// mise en page du tableau de bord Excel « Projection CA ». AUCUN calcul confidentiel (CAF, backlog,
// prise de commande — pas de marge) → visible au niveau « overview ». Export XLSX = one-pager CODIR
// existant (exportReport).
import { useState, useEffect, type FC } from "react";
import { Card, Kpi, Badge, Table, Modal, Busy, money, useToast, EmptyState, colText, colNum } from "../design/components";
import { Gauge } from "../design/charts";
import { FreshnessGuard, type Props } from "./_shared";
import { T, fmt } from "../design/tokens";
import { relTime } from "../lib/format";
import { useDocData } from "../lib/hooks";
import { useCanExport, useClaims } from "../lib/rbac";
import { callExportReport, upsertOpsBulletin, type OpsBulletin, type BulletinSection } from "../lib/writes";
import type { AtterrissageSummary, EntitySummary, BacklogSummary, BillingTrendSummary, PeriodsConfig } from "../types";

// N° de semaine ISO (le titre « S 27 » du bilan) — calculé côté client, sans dépendance.
function isoWeek(d: Date) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const ys = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return Math.ceil((((t.getTime() - ys.getTime()) / 86400000) + 1) / 7);
}
const MONTH_FR = ["janv", "févr", "mars", "avr", "mai", "juin", "juil", "août", "sept", "oct", "nov", "déc"];
const monthLabel = (ym: string) => { const [, m] = (ym || "").split("-"); return MONTH_FR[Number(m) - 1] || ym; };
// Montant compact : « 1.39 Md » au-delà du milliard, sinon « 693 M » (aligné sur l'affichage Excel CODIR).
const mM = (v: number) => (Math.abs(v) >= 1e9 ? `${(v / 1e9).toFixed(2)} Md` : `${Math.round(v / 1e6)} M`);

// Barre horizontale client — soit simple (CAS), soit EMPILÉE Certitudes (CAS) + Forecast (pipeline
// pondéré ouvert), pour que la part de forecast soit VISIBLE même petite. Aligné à droite : valeur + delta.
function ClientBars({ rows, stacked }: { rows: { name: string; cas: number; forecast: number }[]; stacked?: boolean }) {
  if (!rows.length) return <EmptyState />;
  const mx = Math.max(1, ...rows.map((r) => r.cas + (stacked ? r.forecast : 0)));
  return (
    <div className="flex flex-col gap-2.5 mt-1">
      {rows.map((r) => {
        const total = r.cas + (stacked ? r.forecast : 0);
        return (
          <div key={r.name}>
            <div className="flex justify-between text-[12.5px] mb-1">
              <span className="truncate max-w-[180px] text-ink">{r.name}</span>
              <span className="text-muted tabnum">
                {mM(total)}
                {stacked && r.forecast > 0 && <span className="text-gold"> · +{mM(r.forecast)} forecast</span>}
              </span>
            </div>
            <div className="flex h-[8px] w-full overflow-hidden rounded bg-panel2">
              <div className="h-full" style={{ width: `${Math.max((r.cas / mx) * 100, 1)}%`, background: T.steel }} title={`Commandes (CAS) ${fmt(r.cas)}`} />
              {stacked && r.forecast > 0 && (
                <div className="h-full" style={{ width: `${(r.forecast / mx) * 100}%`, background: T.gold }} title={`Forecast pondéré ${fmt(r.forecast)}`} />
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// Projection facturation mensuelle — barres verticales empilées (réalisé + planifié), valeur en M au
// sommet, ligne de base, largeur constante. Plus lisible que la version brute.
function MonthBars({ rows }: { rows: { name: string; realise: number; planifie: number }[] }) {
  if (!rows.length) return <EmptyState label="Projection de facturation indisponible (dates ClickUp à synchroniser)." />;
  const mx = Math.max(1, ...rows.map((r) => r.realise + r.planifie));
  const H = 150;
  return (
    <div className="relative pt-5">
      <div className="flex items-end justify-between gap-1.5 border-b border-line" style={{ height: H + 4 }}>
        {rows.map((r) => {
          const total = r.realise + r.planifie;
          const hR = (r.realise / mx) * H, hP = (r.planifie / mx) * H;
          return (
            <div key={r.name} className="group relative flex flex-1 flex-col items-center justify-end min-w-0" style={{ height: H }}>
              <span className="mb-1 text-[10px] text-muted tabnum whitespace-nowrap">{mM(total)}</span>
              {hP > 0 && <div className="w-full max-w-[30px] rounded-t-sm" style={{ height: hP, background: T.gold, opacity: 0.45 }} title={`Planifié ${fmt(r.planifie)}`} />}
              {hR > 0 && <div className={`w-full max-w-[30px] ${hP > 0 ? "" : "rounded-t-sm"}`} style={{ height: hR, background: T.emerald }} title={`Réalisé ${fmt(r.realise)}`} />}
            </div>
          );
        })}
      </div>
      <div className="flex justify-between gap-1.5">
        {rows.map((r) => <span key={r.name} className="flex-1 text-center text-[11px] text-faint">{r.name}</span>)}
      </div>
    </div>
  );
}

function Legend({ items }: { items: { color: string; label: string; faded?: boolean }[] }) {
  return (
    <span className="ml-2 inline-flex items-center gap-2 text-[10px] font-normal text-faint">
      {items.map((it) => (
        <span key={it.label} className="inline-flex items-center gap-1">
          <span className="inline-block h-2 w-2.5 rounded-sm" style={{ background: it.color, opacity: it.faded ? 0.45 : 1 }} />{it.label}
        </span>
      ))}
    </span>
  );
}

// Carte JAUGE CIRCULAIRE réutilisable (atteinte d'un objectif CAF) — même rendu pour le prévisionnel
// (projeté) et le réel (facturé YTD), pour une paire cohérente.
function GaugeCard({ title, value, num, objectif, sub }: { title: string; value: number; num: number; objectif: number; sub?: string }) {
  return (
    <div className="flex flex-col rounded-lg border border-line bg-panel2/40 p-3">
      <div className="text-[12px] text-muted mb-1">{title}</div>
      <div className="flex-1 flex flex-col justify-center">
        <Gauge value={value} color={value >= 0.9 ? T.emerald : value >= 0.6 ? T.gold : T.clay} />
        <div className="text-center text-[12px] text-muted -mt-1">
          <b className="text-ink tabnum">{fmt(num)}</b> / objectif <b className="tabnum">{fmt(objectif)}</b>
          {sub && <span className="text-faint"> · {sub}</span>}
        </div>
      </div>
    </div>
  );
}

function ExportBtn() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const onClick = async () => {
    if (busy) return; setBusy(true);
    toast("Génération du one-pager CODIR…", "info");
    try {
      const r = await callExportReport("all");
      if (r.url) { window.open(r.url, "_blank"); toast("Export CODIR prêt.", "ok"); }
      else toast("Export généré (URL signée indisponible en émulateur).", "info");
    } catch (e: any) {
      toast("Export refusé : " + String(e?.message || e?.code || "").replace(/^functions\//, ""), "err");
    } finally { setBusy(false); }
  };
  return <button type="button" onClick={onClick} disabled={busy} className="btn-ghost !px-2.5 !py-1 text-xs font-semibold">{busy ? "Export…" : "Exporter (XLSX)"}</button>;
}

// Export PowerPoint du deck CODIR — pptxgenjs chargé À LA DEMANDE (import dynamique).
function PptxBtn({ build }: { build: () => Promise<void> }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const onClick = async () => {
    if (busy) return; setBusy(true);
    toast("Génération du PowerPoint CODIR…", "info");
    try { await build(); toast("PowerPoint généré.", "ok"); }
    catch (e: any) { toast("Export PPTX échoué : " + String(e?.message || e), "err"); }
    finally { setBusy(false); }
  };
  return <button type="button" onClick={onClick} disabled={busy} className="btn-primary !px-2.5 !py-1 text-xs font-semibold">{busy ? "Génération…" : "Exporter (PowerPoint)"}</button>;
}

// ── BULLETIN HEBDO « Hot Topics Opérations » — commentaires / points clés (Phase 1, saisie manuelle) ──
const DEFAULT_SECTIONS = (): BulletinSection[] => [
  { title: "Engagements fournisseurs", items: [{ text: "", sub: [] }] },
  { title: "Projets", items: [{ text: "", sub: [] }] },
];

// Rendu lecture — fidèle à la capture (sections en gras, puces, sous-puces indentées).
function BulletinView({ sections }: { sections: BulletinSection[] }) {
  if (!sections.length) return <EmptyState label="Aucun point clé saisi pour cette semaine." />;
  return (
    <div className="flex flex-col gap-3 text-[13px]">
      {sections.map((s, i) => (
        <div key={i}>
          {s.title && <div className="font-semibold text-ink mb-1">{s.title}</div>}
          <ul className="flex flex-col gap-1">
            {s.items.map((it, j) => (
              <li key={j} className="ml-1">
                {it.text && <div className="flex gap-2"><span className="text-gold shrink-0">•</span><span className="text-muted">{it.text}</span></div>}
                {(it.sub || []).length > 0 && (
                  <ul className="ml-6 mt-0.5 flex flex-col gap-0.5">
                    {(it.sub || []).map((x, k) => <li key={k} className="flex gap-2"><span className="text-faint shrink-0">◦</span><span className="text-faint">{x}</span></li>)}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

// Éditeur — sections (titre) → puces (texte) → sous-puces. Ajout/suppression à chaque niveau.
function BulletinEditor({ fy, week, initial, onClose, onSaved }: { fy: number; week: number; initial: BulletinSection[]; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [secs, setSecs] = useState<BulletinSection[]>(initial.length ? JSON.parse(JSON.stringify(initial)) : DEFAULT_SECTIONS());
  const upd = (fn: (d: BulletinSection[]) => void) => setSecs((p) => { const c = JSON.parse(JSON.stringify(p)); fn(c); return c; });
  const save = async () => { await upsertOpsBulletin({ fy, week, sections: secs }); toast("Bulletin enregistré", "ok"); onSaved(); };
  return (
    <Modal open title={`Hot Topics Opérations — S${week} / FY ${fy}`} onClose={onClose} size="md" actions={<Busy label="Enregistrer" fn={save} okMsg="Enregistré" errMsg="Enregistrement refusé" />}>
      <div className="flex flex-col gap-4 text-[13px]">
        {secs.map((s, i) => (
          <div key={i} className="rounded-lg border border-line p-3">
            <div className="flex items-center gap-2 mb-2">
              <input className="field !py-1 flex-1 font-semibold" placeholder="Titre de section (ex. Engagements fournisseurs)" value={s.title} onChange={(e) => upd((d) => { d[i].title = e.target.value; })} aria-label={`Titre section ${i + 1}`} />
              <button type="button" className="text-clay hover:underline text-[11px]" onClick={() => upd((d) => { d.splice(i, 1); })}>Suppr. section</button>
            </div>
            <div className="flex flex-col gap-2">
              {s.items.map((it, j) => (
                <div key={j} className="ml-2 border-l border-line pl-2">
                  <div className="flex items-start gap-2">
                    <span className="text-gold mt-1.5">•</span>
                    <textarea className="field !py-1 flex-1" rows={1} placeholder="Point clé (ex. WESTCON : BP BF 111K$ -> On Hold)" value={it.text} onChange={(e) => upd((d) => { d[i].items[j].text = e.target.value; })} aria-label={`Puce ${j + 1} section ${i + 1}`} />
                    <button type="button" className="text-clay hover:underline text-[11px] mt-1.5" onClick={() => upd((d) => { d[i].items.splice(j, 1); })}>✕</button>
                  </div>
                  {(it.sub || []).map((x, k) => (
                    <div key={k} className="ml-6 mt-1 flex items-center gap-2">
                      <span className="text-faint">◦</span>
                      <input className="field !py-1 flex-1" placeholder="Sous-point" value={x} onChange={(e) => upd((d) => { d[i].items[j].sub![k] = e.target.value; })} aria-label={`Sous-puce ${k + 1}`} />
                      <button type="button" className="text-clay hover:underline text-[11px]" onClick={() => upd((d) => { d[i].items[j].sub!.splice(k, 1); })}>✕</button>
                    </div>
                  ))}
                  <button type="button" className="ml-6 mt-1 text-[11px] text-faint hover:text-ink" onClick={() => upd((d) => { (d[i].items[j].sub = d[i].items[j].sub || []).push(""); })}>+ sous-point</button>
                </div>
              ))}
              <button type="button" className="btn-ghost !px-2.5 !py-1 text-xs w-fit" onClick={() => upd((d) => { d[i].items.push({ text: "", sub: [] }); })}>+ Ajouter un point</button>
            </div>
          </div>
        ))}
        <button type="button" className="btn-ghost !px-2.5 !py-1 text-xs w-fit" onClick={() => upd((d) => { d.push({ title: "", items: [{ text: "", sub: [] }] }); })}>+ Ajouter une section</button>
        <p className="text-[11px] text-faint">Phase 2 (à venir) : pré-remplissage depuis les commandes / commentaires projets ClickUp.</p>
      </div>
    </Modal>
  );
}

function HotTopics({ fy, week }: { fy: number; week: number }) {
  const { role } = useClaims();
  const canEdit = role === "direction" || role === "pmo";
  const id = `${fy}_W${String(week).padStart(2, "0")}`;
  const { data } = useDocData<OpsBulletin>(`opsBulletins/${id}`);
  const [editing, setEditing] = useState(false);
  const [nonce, setNonce] = useState(0); // force le rechargement après enregistrement
  useEffect(() => { setNonce((n) => n + 1); }, [data]);
  const sections = data?.sections || [];
  return (
    <Card
      title={<span className="flex items-center gap-3">Hot Topics Opérations <Badge tone="gold">S{week}</Badge></span>}
      actions={canEdit ? <button className="btn-ghost !px-2.5 !py-1 text-xs font-semibold" onClick={() => setEditing(true)}>{sections.length ? "Éditer" : "Renseigner"}</button> : undefined}
    >
      <div className="text-[12px] text-muted mb-2">Commentaires / points clés — semaine {week}</div>
      <BulletinView sections={sections} />
      {data?.updatedByName && <div className="mt-3 text-[11px] text-faint">Dernière mise à jour : {data.updatedByName}{data.updatedAt ? ` · ${relTime(data.updatedAt)}` : ""}</div>}
      {editing && <BulletinEditor key={nonce} fy={fy} week={week} initial={sections} onClose={() => setEditing(false)} onSaved={() => setEditing(false)} />}
    </Card>
  );
}

// ── BULLETIN HEBDO « Hot Topics Opérations » — commentaires / points clés (Phase 1, saisie manuelle) ──
const DEFAULT_SECTIONS = (): BulletinSection[] => [
  { title: "Engagements fournisseurs", items: [{ text: "", sub: [] }] },
  { title: "Projets", items: [{ text: "", sub: [] }] },
];

// Rendu lecture — fidèle à la capture (sections en gras, puces, sous-puces indentées).
function BulletinView({ sections }: { sections: BulletinSection[] }) {
  if (!sections.length) return <EmptyState label="Aucun point clé saisi pour cette semaine." />;
  return (
    <div className="flex flex-col gap-3 text-[13px]">
      {sections.map((s, i) => (
        <div key={i}>
          {s.title && <div className="font-semibold text-ink mb-1">{s.title}</div>}
          <ul className="flex flex-col gap-1">
            {s.items.map((it, j) => (
              <li key={j} className="ml-1">
                {it.text && <div className="flex gap-2"><span className="text-gold shrink-0">•</span><span className="text-muted">{it.text}</span></div>}
                {(it.sub || []).length > 0 && (
                  <ul className="ml-6 mt-0.5 flex flex-col gap-0.5">
                    {(it.sub || []).map((x, k) => <li key={k} className="flex gap-2"><span className="text-faint shrink-0">◦</span><span className="text-faint">{x}</span></li>)}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

// Éditeur — sections (titre) → puces (texte) → sous-puces. Ajout/suppression à chaque niveau.
function BulletinEditor({ fy, week, initial, onClose, onSaved }: { fy: number; week: number; initial: BulletinSection[]; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [secs, setSecs] = useState<BulletinSection[]>(initial.length ? JSON.parse(JSON.stringify(initial)) : DEFAULT_SECTIONS());
  const upd = (fn: (d: BulletinSection[]) => void) => setSecs((p) => { const c = JSON.parse(JSON.stringify(p)); fn(c); return c; });
  const save = async () => { await upsertOpsBulletin({ fy, week, sections: secs }); toast("Bulletin enregistré", "ok"); onSaved(); };
  return (
    <Modal open title={`Hot Topics Opérations — S${week} / FY ${fy}`} onClose={onClose} size="md" actions={<Busy label="Enregistrer" fn={save} okMsg="Enregistré" errMsg="Enregistrement refusé" />}>
      <div className="flex flex-col gap-4 text-[13px]">
        {secs.map((s, i) => (
          <div key={i} className="rounded-lg border border-line p-3">
            <div className="flex items-center gap-2 mb-2">
              <input className="field !py-1 flex-1 font-semibold" placeholder="Titre de section (ex. Engagements fournisseurs)" value={s.title} onChange={(e) => upd((d) => { d[i].title = e.target.value; })} aria-label={`Titre section ${i + 1}`} />
              <button type="button" className="text-clay hover:underline text-[11px]" onClick={() => upd((d) => { d.splice(i, 1); })}>Suppr. section</button>
            </div>
            <div className="flex flex-col gap-2">
              {s.items.map((it, j) => (
                <div key={j} className="ml-2 border-l border-line pl-2">
                  <div className="flex items-start gap-2">
                    <span className="text-gold mt-1.5">•</span>
                    <textarea className="field !py-1 flex-1" rows={1} placeholder="Point clé (ex. WESTCON : BP BF 111K$ -> On Hold)" value={it.text} onChange={(e) => upd((d) => { d[i].items[j].text = e.target.value; })} aria-label={`Puce ${j + 1} section ${i + 1}`} />
                    <button type="button" className="text-clay hover:underline text-[11px] mt-1.5" onClick={() => upd((d) => { d[i].items.splice(j, 1); })}>✕</button>
                  </div>
                  {(it.sub || []).map((x, k) => (
                    <div key={k} className="ml-6 mt-1 flex items-center gap-2">
                      <span className="text-faint">◦</span>
                      <input className="field !py-1 flex-1" placeholder="Sous-point" value={x} onChange={(e) => upd((d) => { d[i].items[j].sub![k] = e.target.value; })} aria-label={`Sous-puce ${k + 1}`} />
                      <button type="button" className="text-clay hover:underline text-[11px]" onClick={() => upd((d) => { d[i].items[j].sub!.splice(k, 1); })}>✕</button>
                    </div>
                  ))}
                  <button type="button" className="ml-6 mt-1 text-[11px] text-faint hover:text-ink" onClick={() => upd((d) => { (d[i].items[j].sub = d[i].items[j].sub || []).push(""); })}>+ sous-point</button>
                </div>
              ))}
              <button type="button" className="btn-ghost !px-2.5 !py-1 text-xs w-fit" onClick={() => upd((d) => { d[i].items.push({ text: "", sub: [] }); })}>+ Ajouter un point</button>
            </div>
          </div>
        ))}
        <button type="button" className="btn-ghost !px-2.5 !py-1 text-xs w-fit" onClick={() => upd((d) => { d.push({ title: "", items: [{ text: "", sub: [] }] }); })}>+ Ajouter une section</button>
        <p className="text-[11px] text-faint">Phase 2 (à venir) : pré-remplissage depuis les commandes / commentaires projets ClickUp.</p>
      </div>
    </Modal>
  );
}

function HotTopics({ fy, week }: { fy: number; week: number }) {
  const { role } = useClaims();
  const canEdit = role === "direction" || role === "pmo";
  const id = `${fy}_W${String(week).padStart(2, "0")}`;
  const { data } = useDocData<OpsBulletin>(`opsBulletins/${id}`);
  const [editing, setEditing] = useState(false);
  const [nonce, setNonce] = useState(0); // force le rechargement après enregistrement
  useEffect(() => { setNonce((n) => n + 1); }, [data]);
  const sections = data?.sections || [];
  return (
    <Card
      title={<span className="flex items-center gap-3">Hot Topics Opérations <Badge tone="gold">S{week}</Badge></span>}
      actions={canEdit ? <button className="btn-ghost !px-2.5 !py-1 text-xs font-semibold" onClick={() => setEditing(true)}>{sections.length ? "Éditer" : "Renseigner"}</button> : undefined}
    >
      <div className="text-[12px] text-muted mb-2">Commentaires / points clés — semaine {week}</div>
      <BulletinView sections={sections} />
      {data?.updatedByName && <div className="mt-3 text-[11px] text-faint">Dernière mise à jour : {data.updatedByName}{data.updatedAt ? ` · ${relTime(data.updatedAt)}` : ""}</div>}
      {editing && <BulletinEditor key={nonce} fy={fy} week={week} initial={sections} onClose={() => setEditing(false)} onSaved={() => setEditing(false)} />}
    </Card>
  );
}

export const Codir: FC<Props> = () => {
  const { data: cfg } = useDocData<PeriodsConfig>("config/periods");
  const fy = cfg?.currentFy;
  const { data: att } = useDocData<AtterrissageSummary>(fy ? `summaries/atterrissage_${fy}` : null);
  // Top clients ALIGNÉS sur l'exercice courant (comme les KPI atterrissage) : commandes ET forecast
  // de l'exercice `fy`, et non tous exercices confondus (clients_all).
  const { data: clients } = useDocData<EntitySummary>(fy ? `summaries/clients_${fy}` : null);
  const { data: backlog } = useDocData<BacklogSummary>("summaries/backlog_fy");
  const { data: trend } = useDocData<BillingTrendSummary>(fy ? `summaries/billingTrend_${fy}` : null);
  const week = isoWeek(new Date());
  const { data: bulletin } = useDocData<OpsBulletin>(fy ? `opsBulletins/${fy}_W${String(week).padStart(2, "0")}` : null);
  const canExport = useCanExport();

  // KPI (atterrissage CAF) : facturé YTD, backlog, CAF projeté (certitudes) et yc forecast (pipeline pondéré).
  const cafYtd = att?.factureN || 0;
  const backlogYtd = att?.backlog || 0;
  const forecast = att?.pipelinePondere || 0;
  const cafEstYcForecast = att?.cafProjete || 0;
  const cafEst = Math.max(cafEstYcForecast - forecast, 0); // hors forecast = certitudes seules
  const objectifCaf = att?.objectifCaf || 0;
  const atteinte = objectifCaf > 0 ? Math.min(cafEstYcForecast / objectifCaf, 1) : 0;

  const rows = (clients?.rows || []).filter((r) => !r.isOther);
  // Le champ `forecast`/`projete` est produit par le recompute. S'il est absent (agrégat antérieur à
  // l'ajout du champ), on le signale plutôt que d'afficher deux graphes identiques (CAS = projeté).
  const hasForecast = rows.some((r) => r.forecast != null);
  const barRows = (getVal: (r: typeof rows[number]) => number) =>
    [...rows].sort((a, b) => getVal(b) - getVal(a)).slice(0, 8)
      .map((r) => ({ name: r.key, cas: r.cas || 0, forecast: r.forecast || 0 }));
  const topCmd = barRows((r) => r.cas || 0);
  const topProj = barRows((r) => r.projete || r.cas || 0);

  const top10 = (backlog?.top || []).slice(0, 10);
  const monthRows = (trend?.months || []).map((m) => ({ name: monthLabel(m.month), realise: m.realise || 0, planifie: m.planifie || 0 }))
    .filter((m) => m.realise + m.planifie > 0);

  // Export PowerPoint (deck 3 slides : Projection CAF · Backlog & Facturation · Hot Topics). pptxgenjs
  // chargé à la demande. Réutilise les données déjà calculées ci-dessus + le bulletin de la semaine.
  const doPptx = async () => {
    const { exportCodirPptx } = await import("../lib/codirPptx");
    await exportCodirPptx({
      fy: fy || 0, week, cafYtd, backlogYtd, cafEst, cafEstYcForecast, forecast, objectifCaf,
      topClients: topProj, backlog: top10, months: monthRows, bulletin: bulletin?.sections || [],
    });
  };

  const backlogCols = [
    colText("Client", (r: NonNullable<BacklogSummary["top"]>[number]) => r.client || "—", (r: any) => r.client || ""),
    colText("Description du projet", (r: any) => <span className="truncate max-w-[380px] inline-block align-bottom">{r.affaire || "—"}</span>),
    colNum("RAF total", (r: any) => money(r.raf), (r: any) => r.raf || 0),
  ];

  return (
    <div className="flex flex-col gap-4">
      <FreshnessGuard />
      <Card
        title={<span className="flex items-center gap-3">Bilan hebdomadaire — Projection CAF <Badge tone="gold">S{week}</Badge>{fy && <Badge tone="neutral">FY {fy}</Badge>}</span>}
        actions={canExport ? <div className="flex items-center gap-2"><ExportBtn /><PptxBtn build={doPptx} /></div> : undefined}
      >
        {!att ? <div className="py-8 text-center text-faint">Agrégats indisponibles — lance un recalcul (Vue d'ensemble).</div> : (
          <div className="flex flex-col gap-5">
            {/* KPI row */}
            <div className="grid gap-2 sm:gap-3 grid-cols-2 lg:grid-cols-4">
              <Kpi label="CAF YTD" value={fmt(cafYtd)} tone="emerald" sub="facturé — exercice" />
              <Kpi label="Backlog YTD" value={fmt(backlogYtd)} tone="clay" sub="RAF glissant" />
              <Kpi label="CAF Estimé" value={fmt(cafEst)} tone="steel" sub="certitudes (hors forecast)" />
              <Kpi label="CAF Estimé yc Forecast" value={fmt(cafEstYcForecast)} tone="gold" sub={`+ ${fmt(forecast)} pipeline pondéré`} />
            </div>

            {/* Deux jauges circulaires cohérentes : CA RÉEL (facturé YTD) et CAF PRÉVISIONNEL (projeté), vs objectif */}
            <div className="grid gap-3 md:grid-cols-2 items-stretch">
              <GaugeCard title={`CA réel vs objectif ${fy || ""}`} value={objectifCaf > 0 ? Math.min(cafYtd / objectifCaf, 1) : 0} num={cafYtd} objectif={objectifCaf} sub="facturé YTD" />
              <GaugeCard title={`CAF prévisionnel vs objectif ${fy || ""}`} value={atteinte} num={cafEstYcForecast} objectif={objectifCaf} sub="projeté yc forecast" />
            </div>

            {/* Top clients */}
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <div className="text-[12px] font-semibold text-muted mb-2">Top clients — Commandes <Legend items={[{ color: T.steel, label: "PO value (CAS)" }]} /></div>
                <ClientBars rows={topCmd} />
              </div>
              <div>
                <div className="text-[12px] font-semibold text-muted mb-2">Top clients — Commandes &amp; Certitudes &amp; Forecast
                  <Legend items={[{ color: T.steel, label: "certitudes" }, { color: T.gold, label: "forecast" }]} /></div>
                {hasForecast
                  ? <ClientBars rows={topProj} stacked />
                  : <div className="rounded-lg border border-gold/40 bg-gold/10 px-3 py-2 text-[12px] text-ink">Le <b>forecast par client</b> sera disponible au prochain recalcul (nouvel indicateur). Lance « Recalculer » (Vue d'ensemble) pour distinguer certitudes et forecast.</div>}
              </div>
            </div>

            {/* Top 10 backlog + projection facturation */}
            <div className="grid gap-4 lg:grid-cols-2">
              <div>
                <div className="text-[12px] font-semibold text-muted mb-2">Top 10 Backlog</div>
                <Table columns={backlogCols} rows={top10} colsKey="codir-backlog" empty="Aucun backlog." pageSize={10} />
              </div>
              <div>
                <div className="text-[12px] font-semibold text-muted mb-2">Projection facturation
                  <Legend items={[{ color: T.emerald, label: "réalisé" }, { color: T.gold, label: "planifié", faded: true }]} /></div>
                <MonthBars rows={monthRows} />
              </div>
            </div>
          </div>
        )}
      </Card>

      {/* Page 2 du bilan hebdo : Hot Topics Opérations (commentaires / points clés, saisie manuelle) */}
      {fy && <HotTopics fy={fy} week={week} />}
    </div>
  );
};
