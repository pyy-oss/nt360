// CLIENT 360 — objet Compte (Account) : entité relationnelle stable qui raccroche opportunités,
// commandes, factures et CONTACTS. Comble l'écart #1 de l'audit « niveau Salesforce » (aucun objet
// Compte/Contact persisté). Métadonnées éditables + gestion des contacts (droit « pipeline »), rollup
// CAS depuis summaries/clients, et rebonds vers le dossier de rapprochement / les commandes.
import { useState, useEffect, type FC } from "react";
import { useDocData } from "../lib/hooks";
import { useCan } from "../lib/rbac";
import { useNav } from "../lib/nav";
import { Card, Tip, Badge, Busy, DangerBtn, Table, colText, money, cx } from "../design/components";
import { accountView, upsertAccount, upsertContact, deleteContact, type Account, type Contact, type AccountView } from "../lib/writes";
import { ActivityTimeline } from "./activities";
import type { Props } from "./_shared";
import type { EntitySummary } from "../types";

const CONTACT_ROLES = ["Décideur", "Signataire", "Utilisateur", "Technique", "Achat", "Finance", "Autre"];

// Éditeur d'un contact (création ou édition) — formulaire compact inline.
function ContactForm({ account, contact, canWrite, onDone }: { account: string; contact?: Contact; canWrite: boolean; onDone: () => void }) {
  const [f, setF] = useState<Contact>(contact || { name: "", role: "", email: "", phone: "", primary: false });
  const set = (k: keyof Contact, v: unknown) => setF((p) => ({ ...p, [k]: v }));
  if (!canWrite) return null;
  return (
    <div className="flex flex-wrap items-end gap-2 text-[13px]">
      <label className="flex flex-col gap-0.5"><span className="text-[11px] text-muted">Nom</span>
        <input className="field !py-1 w-40" value={f.name || ""} onChange={(e) => set("name", e.target.value)} aria-label="Nom du contact" /></label>
      <label className="flex flex-col gap-0.5"><span className="text-[11px] text-muted">Rôle</span>
        <select className="field !py-1 w-32" value={f.role || ""} onChange={(e) => set("role", e.target.value)} aria-label="Rôle">
          <option value="">—</option>{CONTACT_ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
        </select></label>
      <label className="flex flex-col gap-0.5"><span className="text-[11px] text-muted">Email</span>
        <input className="field !py-1 w-48" value={f.email || ""} onChange={(e) => set("email", e.target.value)} aria-label="Email" placeholder="nom@client.com" /></label>
      <label className="flex flex-col gap-0.5"><span className="text-[11px] text-muted">Téléphone</span>
        <input className="field !py-1 w-32" value={f.phone || ""} onChange={(e) => set("phone", e.target.value)} aria-label="Téléphone" /></label>
      <label className="flex items-center gap-1.5 pb-1.5 text-[12px]">
        <input type="checkbox" checked={!!f.primary} onChange={(e) => set("primary", e.target.checked)} aria-label="Contact principal" /> principal</label>
      <Busy variant="ghost" label={contact ? "Enregistrer" : "Ajouter"} okMsg="Contact enregistré" errMsg="Enregistrement refusé"
        fn={async () => { if (!(f.name || "").trim()) throw new Error("nom requis"); await upsertContact({ id: contact?.id, account, name: f.name!.trim(), role: f.role, email: f.email, phone: f.phone, primary: f.primary }); if (!contact) setF({ name: "", role: "", email: "", phone: "", primary: false }); onDone(); }} />
    </div>
  );
}

export const Client360: FC<Props> = ({ period }) => {
  const canWrite = useCan("pipeline") === "write";
  const { go, canGo, intent } = useNav();
  const [q, setQ] = useState("");
  const [view, setView] = useState<AccountView | null>(null);
  const [meta, setMeta] = useState<Account>({});
  const [editing, setEditing] = useState<string | null>(null); // id contact en édition, ou "new"
  const { data: clients } = useDocData<EntitySummary>(`summaries/clients_${period}`);

  const open = async (client: string) => {
    const r = await accountView(client);
    setView(r);
    setMeta(r.account || { name: r.name });
    setEditing(null);
  };
  // Ouverture directe depuis un rebond (EntityLink client) si l'intention porte un client.
  useEffect(() => { const c = (intent as { client?: string } | undefined)?.client; if (c) open(c).catch(() => {}); }, [intent]);

  const cas = view ? (clients?.rows || []).find((r) => r.key === view.name)?.cas : undefined;

  return (
    <div className="flex flex-col gap-4">
      <Card title="Client 360" actions={
        <div className="flex items-center gap-2">
          <input className="field w-56 !py-1 text-xs" aria-label="Rechercher un client" placeholder="Nom du client…" value={q} onChange={(e) => setQ(e.target.value)} />
          {q.trim() && <Busy variant="ghost" label="Ouvrir" okMsg="Compte chargé" errMsg="Chargement refusé" fn={() => open(q.trim())} />}
        </div>
      }>
        {!view ? <Tip>Recherchez un client pour ouvrir son <b>dossier 360</b> : coordonnées du compte, contacts, CAS de l'exercice, et rebond vers le rapprochement / les commandes. Le compte est l'entité stable qui raccroche opportunités, commandes et factures.</Tip> : (
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-x-8 gap-y-2">
              <div><div className="text-[11px] text-muted">Compte</div><div className="font-display text-xl leading-tight">{view.name}</div></div>
              <div><div className="text-[11px] text-muted">CAS {period}</div><div className="font-display tabnum text-xl leading-tight">{cas != null ? money(cas) : "—"}</div></div>
              <div><div className="text-[11px] text-muted">Contacts</div><div className="font-display tabnum text-xl leading-tight">{view.contacts.length}</div></div>
              {!view.account && <Badge tone="gold">fiche compte à compléter</Badge>}
              <div className="ml-auto flex gap-2">
                {canGo("cleanup") && <button type="button" className="btn-ghost !px-2 !py-1 text-xs" onClick={() => go("cleanup")}>Rapprochement</button>}
                {canGo("orderlist") && <button type="button" className="btn-ghost !px-2 !py-1 text-xs" onClick={() => go("orderlist", { search: view.name })}>Commandes</button>}
              </div>
            </div>

            {/* Métadonnées éditables du compte */}
            <div className="flex flex-col gap-2">
              <div className="text-[11px] text-muted uppercase tracking-wide">Fiche compte</div>
              {canWrite ? (
                <div className="flex flex-wrap items-end gap-2 text-[13px]">
                  <label className="flex flex-col gap-0.5"><span className="text-[11px] text-muted">Secteur</span>
                    <input className="field !py-1 w-40" value={meta.sector || ""} onChange={(e) => setMeta({ ...meta, sector: e.target.value })} aria-label="Secteur" /></label>
                  <label className="flex flex-col gap-0.5"><span className="text-[11px] text-muted">Pays</span>
                    <input className="field !py-1 w-32" value={meta.country || ""} onChange={(e) => setMeta({ ...meta, country: e.target.value })} aria-label="Pays" /></label>
                  <label className="flex flex-col gap-0.5"><span className="text-[11px] text-muted">Territoire</span>
                    <input className="field !py-1 w-40" value={meta.territory || ""} onChange={(e) => setMeta({ ...meta, territory: e.target.value })} aria-label="Territoire" placeholder="zone / segment" /></label>
                  <label className="flex flex-col gap-0.5"><span className="text-[11px] text-muted">Compte parent</span>
                    <input className="field !py-1 w-40" value={meta.parentId || ""} onChange={(e) => setMeta({ ...meta, parentId: e.target.value })} aria-label="Compte parent (client)" placeholder="nom du groupe" /></label>
                  <label className="flex flex-col gap-0.5 grow"><span className="text-[11px] text-muted">Notes</span>
                    <input className="field !py-1 w-full" value={meta.notes || ""} onChange={(e) => setMeta({ ...meta, notes: e.target.value })} aria-label="Notes" /></label>
                  <Busy variant="ghost" label="Enregistrer la fiche" okMsg="Fiche compte enregistrée" errMsg="Enregistrement refusé"
                    fn={async () => { await upsertAccount({ name: view.name, sector: meta.sector, country: meta.country, territory: meta.territory, parent: meta.parentId || null, notes: meta.notes }); await open(view.name); }} />
                </div>
              ) : (
                <div className="text-[13px] text-muted">{[meta.sector, meta.country].filter(Boolean).join(" · ") || "—"}{meta.notes ? ` — ${meta.notes}` : ""}</div>
              )}
            </div>

            {/* Contacts */}
            <div className="flex flex-col gap-2">
              <div className="text-[11px] text-muted uppercase tracking-wide">Contacts</div>
              {view.contacts.length > 0 && (
                <Table columns={[
                  colText("Nom", (c: Contact) => <span className="inline-flex items-center gap-1">{c.name}{c.primary && <Badge tone="emerald">principal</Badge>}</span>, (c: Contact) => c.name || ""),
                  colText("Rôle", (c: Contact) => c.role || "—"),
                  colText("Email", (c: Contact) => c.email || "—"),
                  colText("Téléphone", (c: Contact) => c.phone || "—"),
                  ...(canWrite ? [colText("", (c: Contact) => (
                    <span className="inline-flex gap-2">
                      <button type="button" className="text-gold hover:underline text-[11px]" onClick={() => setEditing(editing === c.id ? null : c.id!)}>{editing === c.id ? "fermer" : "éditer"}</button>
                      <DangerBtn label="Suppr." okMsg="Contact supprimé" errMsg="Suppression refusée" confirm={`Supprimer le contact « ${c.name} » ?`} fn={async () => { await deleteContact(c.id!); await open(view.name); }} />
                    </span>
                  ))] : []),
                ]} rows={view.contacts} />
              )}
              {canWrite && view.contacts.map((c) => editing === c.id && (
                <div key={`edit-${c.id}`} className="border-t border-hair pt-2"><ContactForm account={view.name} contact={c} canWrite={canWrite} onDone={() => open(view.name)} /></div>
              ))}
              {canWrite && (
                <div className={cx("border-t border-hair pt-2", view.contacts.length ? "" : "")}>
                  <div className="text-[11px] text-muted mb-1">Ajouter un contact</div>
                  <ContactForm account={view.name} canWrite={canWrite} onDone={() => open(view.name)} />
                </div>
              )}
              {!view.contacts.length && !canWrite && <div className="text-[13px] text-muted">Aucun contact.</div>}
            </div>

            {/* Timeline : activités & tâches rattachées au compte (Lot 3) */}
            <div className="border-t border-hair pt-3">
              <ActivityTimeline relatedType="account" relatedId={view.id} relatedName={view.name} />
            </div>

            <Tip>Le <b>compte</b> est clé sur le nom client canonique (jointure directe avec toutes les vues). Renseignez secteur, pays, compte parent (hiérarchie) et les <b>contacts</b> (un principal). Journalisez appels, e-mails et RDV, et créez des <b>tâches à échéance</b> dans la timeline — retrouvez vos tâches ouvertes dans le module <b>Activités</b>.</Tip>
          </div>
        )}
      </Card>
    </div>
  );
};
