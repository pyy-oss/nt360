// Module RÉFÉRENTIELS — Paramètres transverses (Devises, Project Managers, Business Units, Territoires,
// Équipes). DÉPLACÉ depuis Habilitations (ADR-045) : on regroupe les référentiels sous « Référentiels »,
// comme les clients et les fournisseurs. RIEN d'autre ne change — MÊME garde direction-only (isDirection),
// MÊMES callables (setFxRates/setRefList inchangés). Le déplacement est présentationnel : il n'élargit PAS
// qui peut éditer ces référentiels sensibles (le taux de change surtout). Réutilise les primitives design.
import { useState, type FC } from "react";
import { useDocData } from "../lib/hooks";
import { useClaims } from "../lib/rbac";
import { Card, Tip, Busy, EmptyState, useToast, cx } from "../design/components";
import { setFxRates, setRefList, listClickupMembers } from "../lib/writes";
import { Props } from "./_shared";

export const ReferentielsAdmin: FC<Props> = () => {
  // Garde direction-only STRICTE, identique à l'ancien emplacement (Habilitations) : ces référentiels
  // (taux de change, PM, BU, territoires, équipes) ne s'éditent que par la Direction. Aucun élargissement.
  const isDirection = useClaims().role === "direction";
  if (!isDirection) return <EmptyState label="Réservé à la Direction — les référentiels (devises, Project Managers, Business Units, territoires, équipes) se paramètrent depuis un compte Direction." />;
  return (
    <div className="flex flex-col gap-4">
      <FxRatesCard />
      <RefListCard kind="projectManagers" title="Référentiel — Project Managers" placeholder="Nom du PM" clickupImport tip="Liste des Project Managers proposée à l'affectation des commandes (écran Commandes). Pour une assignation ClickUp fiable, utilisez « Importer depuis ClickUp » (noms exacts) puis retirez les non-PM. L'auto-complétion combine ce référentiel et les PM déjà affectés." />
      <RefListCard kind="businessUnits" title="Référentiel — Business Units (BU)" placeholder="ICT" upper tip="Liste des BU proposée dans les sélecteurs (filtre transverse, saisie d'opportunité/commande, objectifs). Les valeurs sont normalisées en MAJUSCULES. Sans référentiel, les BU par défaut (ICT, CLOUD, FORMATION, AUTRE) s'appliquent." />
      <RefListCard kind="territories" title="Référentiel — Territoires" placeholder="Abidjan Nord" tip="Liste des territoires (zones/segments commerciaux) proposée à l'affectation d'un compte (Client 360). Un territoire regroupe des comptes pour l'organisation commerciale." />
      <RefListCard kind="teams" title="Référentiel — Équipes" placeholder="Équipe ICT" tip="Liste des équipes proposée à l'affectation des utilisateurs (Utilisateurs & rôles). Une équipe regroupe des commerciaux ; complète la hiérarchie manager de la sécurité par enregistrement." />
    </div>
  );
};

// Taux de change (XOF par unité de devise) pour la conversion automatique des BC en devise étrangère.
function FxRatesCard() {
  const { data } = useDocData<{ rates?: Record<string, number> }>("config/fxRates");
  const [draft, setDraft] = useState<{ cur: string; rate: string }[] | null>(null);
  const list = draft ?? Object.entries(data?.rates || {}).map(([cur, rate]) => ({ cur, rate: String(rate) }));
  const set = (i: number, k: "cur" | "rate", v: string) => setDraft(list.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  const add = () => setDraft([...list, { cur: "", rate: "" }]);
  const del = (i: number) => setDraft(list.filter((_, j) => j !== i));
  const save = async () => {
    const rates: Record<string, number> = {};
    for (const r of list) { const c = r.cur.trim().toUpperCase(); const n = Number(r.rate); if (c && c !== "XOF" && Number.isFinite(n) && n > 0) rates[c] = n; }
    await setFxRates(rates); setDraft(null);
  };
  return (
    <Card title="Taux de change — devises (XOF par unité)" actions={
      <div className="flex gap-2">
        <button className="btn-ghost !px-2.5 !py-1 text-xs" onClick={add}>+ Devise</button>
        <Busy label="Enregistrer" okMsg="Taux enregistrés" fn={save} />
      </div>}>
      <div className="flex flex-col gap-1.5">
        {list.length ? list.map((r, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2">
            <input className="field !py-1 w-28 uppercase" placeholder="EUR" value={r.cur} onChange={(e) => set(i, "cur", e.target.value)} aria-label={`Devise ${i + 1}`} />
            <span className="text-muted text-xs" aria-hidden="true">= 1 unité →</span>
            <input className="field !py-1 w-36" inputMode="decimal" placeholder="655.957" value={r.rate} onChange={(e) => set(i, "rate", e.target.value)} aria-label={`Taux XOF pour ${r.cur || `devise ${i + 1}`}`} />
            <span className="text-muted text-xs">XOF</span>
            <button className="btn-ghost !px-2 !py-1" onClick={() => del(i)} aria-label={`Supprimer la devise ${i + 1}`}>×</button>
          </div>
        )) : <div className="text-[13px] text-muted">Aucun taux — les BC en devise étrangère restent « à saisir » (contre-valeur XOF manuelle).</div>}
      </div>
      <Tip>Un BC importé/saisi en devise étrangère est <b>converti automatiquement en XOF</b> à sa création via ces taux (le taux appliqué est figé sur la ligne pour traçabilité). Une contre-valeur XOF <b>saisie manuellement</b> reste prioritaire. Sans taux pour la devise, le BC est marqué <b>« à saisir »</b> (jamais assimilé à du XOF). Ne modifie pas les BC déjà enregistrés.</Tip>
    </Card>
  );
}

// Référentiel éditable (liste simple) — Project Managers / Business Units. Remplace la liste en base.
function RefListCard({ kind, title, placeholder, tip, upper, clickupImport }: { kind: "projectManagers" | "businessUnits" | "territories" | "teams"; title: string; placeholder: string; tip: string; upper?: boolean; clickupImport?: boolean }) {
  const { data } = useDocData<{ list?: string[] }>(`config/${kind}`);
  const [draft, setDraft] = useState<string[] | null>(null);
  const toast = useToast();
  const list = draft ?? (data?.list || []);
  const set = (i: number, v: string) => setDraft(list.map((r, j) => (j === i ? v : r)));
  const add = () => setDraft([...list, ""]);
  const del = (i: number) => setDraft(list.filter((_, j) => j !== i));
  const save = async () => { await setRefList(kind, list.map((s) => (upper ? s.trim().toUpperCase() : s.trim())).filter(Boolean)); setDraft(null); };
  // Import ClickUp : fusionne les noms des membres ClickUp dans le brouillon (noms EXACTS → assignation
  // fiable). L'utilisateur retire les non-PM puis Enregistre. Ne remplace rien tant qu'on n'a pas cliqué Enregistrer.
  const importClickup = async () => {
    const r = await listClickupMembers();
    const names = (r.members || []).map((m) => m.name).filter(Boolean);
    const merged = [...new Set([...list, ...names])].sort((a, b) => a.localeCompare(b));
    setDraft(merged);
    toast(`${names.length} membre(s) ClickUp importé(s) — retirez les non-PM puis « Enregistrer ».`, "ok");
  };
  return (
    <Card title={title} actions={
      <div className="flex flex-wrap gap-2 justify-end">
        {clickupImport && <Busy variant="ghost" label="Importer depuis ClickUp" errMsg="Import ClickUp refusé" fn={importClickup} />}
        <button className="btn-ghost !px-2.5 !py-1 text-xs" onClick={add}>+ Ajouter</button>
        <Busy label="Enregistrer" okMsg="Référentiel enregistré" fn={save} />
      </div>}>
      <div className="flex flex-wrap gap-1.5">
        {list.length ? list.map((r, i) => (
          <div key={i} className="flex items-center gap-1">
            <input className={cx("field !py-1 w-44", upper && "uppercase")} placeholder={placeholder} value={r} onChange={(e) => set(i, e.target.value)} aria-label={`${title} — entrée ${i + 1}`} />
            <button className="btn-ghost !px-2 !py-1" onClick={() => del(i)} aria-label={`Supprimer l'entrée ${i + 1}`}>×</button>
          </div>
        )) : <div className="text-[13px] text-muted">Aucune entrée.</div>}
      </div>
      <Tip>{tip}</Tip>
    </Card>
  );
}
