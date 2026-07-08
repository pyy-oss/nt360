// ACTIVITÉS & TÂCHES (Lot 3 « niveau Salesforce ») — journal d'actions commerciales (appel, e-mail,
// RDV, note) + TÂCHES à échéance, rattachées à un compte ou une opportunité. Comble l'écart #3 de
// l'audit (aucun objet Activité/Tâche : ni timeline, ni relances d'actions). La visibilité par
// enregistrement (Lot 2) est appliquée côté serveur (listActivities). Deux surfaces :
//  - <ActivityTimeline> : timeline + composeur d'un enregistrement (embarqué dans Client 360) ;
//  - <Activites> : module « Activités » (mes tâches ouvertes + flux récent), avec achèvement/rebonds.
import { useState, useEffect, useCallback, type FC } from "react";
import { useCan } from "../lib/rbac";
import { useNav } from "../lib/nav";
import { Card, Tip, Badge, Busy, DangerBtn, cx } from "../design/components";
import { Select, DateField } from "../design/inputs";
import { listActivities, upsertActivity, deleteActivity, type Activity, type ActivityType } from "../lib/writes";
import type { Props } from "./_shared";

const TYPE_META: Record<ActivityType, { label: string; icon: string }> = {
  call: { label: "Appel", icon: "📞" },
  email: { label: "E-mail", icon: "✉️" },
  meeting: { label: "RDV", icon: "🗓️" },
  note: { label: "Note", icon: "📝" },
  task: { label: "Tâche", icon: "✅" },
};

// Composeur : journalise une action ou crée une tâche rattachée à l'enregistrement fourni.
function ActivityComposer({ relatedType, relatedId, relatedName, onDone }: { relatedType: "account" | "opportunity"; relatedId: string; relatedName?: string; onDone: () => void }) {
  const [type, setType] = useState<ActivityType>("note");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [dueDate, setDueDate] = useState("");
  const reset = () => { setSubject(""); setBody(""); setDueDate(""); };
  return (
    <div className="flex flex-wrap items-end gap-2 text-[13px]">
      <label className="flex flex-col gap-0.5"><span className="text-[11px] text-muted">Type</span>
        <Select ariaLabel="Type d'activité" className="!py-1 w-28" value={type} onChange={(v) => setType(v as ActivityType)}
          options={(Object.keys(TYPE_META) as ActivityType[]).map((t) => ({ value: t, label: `${TYPE_META[t].icon} ${TYPE_META[t].label}` }))} /></label>
      <label className="flex flex-col gap-0.5 grow"><span className="text-[11px] text-muted">Sujet</span>
        <input className="field !py-1 w-full" value={subject} onChange={(e) => setSubject(e.target.value)} aria-label="Sujet" placeholder={type === "task" ? "À faire…" : "Compte rendu…"} /></label>
      {type === "task" && (
        <label className="flex flex-col gap-0.5"><span className="text-[11px] text-muted">Échéance</span>
          <DateField ariaLabel="Échéance" className="!py-1 w-36" value={dueDate} onChange={setDueDate} /></label>
      )}
      <label className="flex flex-col gap-0.5 w-full"><span className="text-[11px] text-muted">Détail (optionnel)</span>
        <input className="field !py-1 w-full" value={body} onChange={(e) => setBody(e.target.value)} aria-label="Détail" /></label>
      <Busy variant="ghost" label={type === "task" ? "Créer la tâche" : "Journaliser"} okMsg="Activité enregistrée" errMsg="Enregistrement refusé"
        fn={async () => { if (!subject.trim()) throw new Error("sujet requis"); await upsertActivity({ type, subject: subject.trim(), body: body.trim(), relatedType, relatedId, relatedName, dueDate: type === "task" && dueDate ? dueDate : null }); reset(); onDone(); }} />
    </div>
  );
}

// Ligne d'activité : icône, sujet, rattachement, date ; pour une tâche : échéance + retard + achèvement.
function ActivityRow({ a, canWrite, onChange, onOpen }: { a: Activity; canWrite: boolean; onChange: () => void; onOpen?: (a: Activity) => void }) {
  const meta = TYPE_META[a.type] || TYPE_META.note;
  const openTask = a.type === "task" && a.done !== true;
  return (
    <div className={cx("flex items-start gap-2 border-t border-hair py-2 text-[13px]", a.done && "opacity-60")}>
      <span className="text-base leading-5" aria-hidden>{meta.icon}</span>
      <div className="min-w-0 grow">
        <div className="flex flex-wrap items-center gap-2">
          <span className={cx("font-medium", a.done && "line-through")}>{a.subject}</span>
          {a.overdue && <Badge tone="clay">en retard</Badge>}
          {a.type === "task" && a.done && <Badge tone="emerald">faite</Badge>}
          {onOpen && a.relatedName && <button type="button" className="text-gold hover:underline text-[11px]" onClick={() => onOpen(a)}>{a.relatedName}</button>}
          {!onOpen && a.relatedName && <span className="text-[11px] text-muted">{a.relatedName}</span>}
        </div>
        {a.body && <div className="text-[12px] text-muted mt-0.5 break-words">{a.body}</div>}
        <div className="text-[11px] text-faint mt-0.5">{meta.label}{a.dueDate ? ` · échéance ${a.dueDate}` : a.at ? ` · ${a.at}` : ""}</div>
      </div>
      {canWrite && (
        <span className="inline-flex shrink-0 items-center gap-2">
          {openTask && <Busy variant="ghost" label="Terminer" okMsg="Tâche terminée" errMsg="Refusé" fn={async () => { await upsertActivity({ id: a.id, type: a.type, subject: a.subject, body: a.body, relatedType: a.relatedType, relatedId: a.relatedId, relatedName: a.relatedName, dueDate: a.dueDate, done: true }); onChange(); }} />}
          <DangerBtn label="Suppr." okMsg="Activité supprimée" errMsg="Suppression refusée" confirm={`Supprimer « ${a.subject} » ?`} fn={async () => { await deleteActivity(a.id!); onChange(); }} />
        </span>
      )}
    </div>
  );
}

// Timeline d'un enregistrement (compte / opportunité) : composeur + flux. Embarquée dans Client 360.
export function ActivityTimeline({ relatedType, relatedId, relatedName }: { relatedType: "account" | "opportunity"; relatedId: string; relatedName?: string }) {
  const canWrite = useCan("pipeline") === "write";
  const [rows, setRows] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setLoading(true);
    try { const r = await listActivities({ relatedId }); setRows(r.activities); } catch { setRows([]); } finally { setLoading(false); }
  }, [relatedId]);
  useEffect(() => { load().catch(() => {}); }, [load]);
  return (
    <div className="flex flex-col gap-2">
      <div className="text-[11px] text-muted uppercase tracking-wide">Activités & tâches</div>
      {canWrite && <ActivityComposer relatedType={relatedType} relatedId={relatedId} relatedName={relatedName} onDone={load} />}
      {loading ? <div className="text-[13px] text-muted py-2">Chargement…</div>
        : rows.length ? <div>{rows.map((a) => <ActivityRow key={a.id} a={a} canWrite={canWrite} onChange={load} />)}</div>
        : <div className="text-[13px] text-muted py-2">Aucune activité — journalisez un appel, un e-mail ou créez une tâche.</div>}
    </div>
  );
}

// Module « Activités » : mes tâches ouvertes (échéances, retards) + flux récent d'activités de mon
// périmètre. Rebond vers le Client 360 de l'enregistrement rattaché.
export const Activites: FC<Props> = () => {
  const canWrite = useCan("pipeline") === "write";
  const { go, canGo } = useNav();
  const [tasks, setTasks] = useState<Activity[]>([]);
  const [feed, setFeed] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [t, f] = await Promise.all([listActivities({ mine: true, openTasksOnly: true }), listActivities({ limit: 80 })]);
      setTasks(t.activities); setFeed(f.activities);
    } catch { setTasks([]); setFeed([]); } finally { setLoading(false); }
  }, []);
  useEffect(() => { load().catch(() => {}); }, [load]);
  const openRelated = (a: Activity) => { if (a.relatedType === "account" && a.relatedName && canGo("client360")) go("client360", { client: a.relatedName }); };
  const overdue = tasks.filter((t) => t.overdue).length;
  return (
    <div className="flex flex-col gap-4">
      <Card title={`Mes tâches ouvertes${tasks.length ? ` · ${tasks.length}` : ""}`} actions={overdue ? <Badge tone="clay">{overdue} en retard</Badge> : undefined}>
        {loading ? <div className="text-[13px] text-muted py-2">Chargement…</div>
          : tasks.length ? <div>{tasks.map((a) => <ActivityRow key={a.id} a={a} canWrite={canWrite} onChange={load} onOpen={openRelated} />)}</div>
          : <Tip>Aucune tâche ouverte. Créez des tâches depuis le <b>Client 360</b> d'un compte (onglet Activités).</Tip>}
      </Card>
      <Card title="Flux d'activités récentes">
        {loading ? <div className="text-[13px] text-muted py-2">Chargement…</div>
          : feed.length ? <div>{feed.map((a) => <ActivityRow key={a.id} a={a} canWrite={canWrite} onChange={load} onOpen={openRelated} />)}</div>
          : <div className="text-[13px] text-muted py-2">Aucune activité dans votre périmètre.</div>}
      </Card>
    </div>
  );
};
