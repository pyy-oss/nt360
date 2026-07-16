// FICHE D'AFFAIRE dématérialisée — greffe sur les commandes : chemin ALTERNATIF à l'import du
// fichier P&L. Numérise la « fiche d'affaire » Excel (calcul prix de revient / marge) et la fait
// circuler dans un circuit de validation à 6 étapes (AC1→DC→DRO→AC2→DGA→CDGDF) avec journal
// d'audit. Le cœur métier (calcul, transitions, verrous, masquage) est SERVEUR (domain/ficheAffaire
// + callables) ; ce module n'est que la vue. Les champs confidentiels (provisions, prix de revient,
// marge) sont OMIS de la réponse pour le PM / tout rôle sans droit « rentabilité » (masquage serveur).
import { useState, useEffect, useCallback, type FC, type ReactNode } from "react";
import { useClaims } from "../lib/rbac";
import { Card, Badge, Busy, Table, Modal, money, cx, useToast, EmptyState, colText, colNum } from "../design/components";
import { Select, DateField } from "../design/inputs";
import { Combo } from "../design/combo";
import { useAmOptions, useClientOptions } from "./_shared";
import { fmt } from "../design/tokens";
import { relTime } from "../lib/format";
import {
  listFiches, getFiche, createFiche, updateFiche, ficheAdvance, ficheReject,
  type Fiche, type FicheLine, type FicheEvent,
} from "../lib/writes";
import type { Props } from "./_shared";

// Circuit 6 étapes — reflet du domaine serveur (source de vérité). role = rôle nt360 qui agit.
const STEPS = [
  { etape: 0, code: "AC1", label: "Édition (AC)", role: "assistante", act: "Soumettre au DC" },
  { etape: 1, code: "DC", label: "Directeur Commercial", role: "commercial_dir", act: "Valider" },
  { etape: 2, code: "DRO", label: "DRO (définit le N° DC)", role: "pmo", act: "Valider" },
  { etape: 3, code: "AC2", label: "Saisie N° BC (AC)", role: "assistante", act: "Transmettre au DGA" },
  { etape: 4, code: "DGA", label: "Directeur Général Adjoint", role: "direction", act: "Valider" },
  { etape: 5, code: "CDGDF", label: "Contrôle Gestion / DF", role: "direction", act: "Valider (finale)" },
];
const CAN_REJECT = new Set([1, 2, 4, 5]);
const STATUT_LABEL: Record<string, string> = {
  brouillon: "Brouillon", validation_dc: "Attente DC", validation_dro: "Attente DRO",
  retour_ac_bc: "Saisie BC (AC)", validation_dga: "Attente DGA", validation_cdgdf: "Attente CDG/DF", validee: "Validée",
};
const STATUT_TONE: Record<string, string> = {
  brouillon: "steel", validation_dc: "gold", validation_dro: "gold", retour_ac_bc: "gold",
  validation_dga: "gold", validation_cdgdf: "gold", validee: "emerald",
};
const TYPES_CHARGE = ["Materiel", "Licences", "Support", "Logiciel", "Frais_approche", "Prestation", "Marge_arriere"];
const DEVISES = ["XOF", "USD", "EUR"];
const roleActs = (role: string, etape: number) => STEPS[etape]?.role === role;

const EMPTY_LINE = (): FicheLine => ({ description: "", fournisseur: "", type_charge: "Prestation", devise: "XOF", montant: 0, numero_bc: null });
const EMPTY_FICHE = (): Partial<Fiche> => ({
  numero_fp: "", client: "", affaire: "", commercial: "", date_fiche: null, editeur_ac: "",
  taux_usd: 590, taux_eur: 655.957, seuil_marge_pct: 15, provisions_xof: 0, autres_frais_financiers_xof: 0,
  prix_vente_ht_xof: 0, memo: "", lignes: [EMPTY_LINE()],
});

// Champ numérique compact (séparateurs FR à l'affichage géré par le serveur ; ici saisie brute).
function NumField({ value, onChange, w = "w-32", aria, disabled }: { value: number | undefined; onChange: (n: number) => void; w?: string; aria: string; disabled?: boolean }) {
  return <input type="number" inputMode="decimal" disabled={disabled} aria-label={aria}
    className={cx("field !py-1", w, disabled && "opacity-60")} value={value ?? 0}
    onChange={(e) => onChange(Number(e.target.value))} />;
}
function TxtField({ value, onChange, w = "w-44", aria, disabled, placeholder }: { value: string; onChange: (v: string) => void; w?: string; aria: string; disabled?: boolean; placeholder?: string }) {
  return <input disabled={disabled} aria-label={aria} placeholder={placeholder}
    className={cx("field !py-1", w, disabled && "opacity-60")} value={value} onChange={(e) => onChange(e.target.value)} />;
}

// Stepper horizontal : étape courante + validée. Compact, lisible d'un coup d'œil.
function Stepper({ etape, terminee }: { etape: number; terminee?: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
      {STEPS.map((s) => {
        const done = terminee || s.etape < etape;
        const cur = !terminee && s.etape === etape;
        return (
          <span key={s.code} className={cx("inline-flex items-center gap-1 rounded px-1.5 py-0.5 border",
            cur ? "border-gold/60 bg-gold/15 text-gold font-semibold" : done ? "border-emerald/40 bg-emerald/10 text-emerald" : "border-line text-faint")}>
            {done ? "✓" : s.etape + 1} {s.code}
          </span>
        );
      })}
    </div>
  );
}

// Résumé financier — rendu UNIQUEMENT si le serveur a renvoyé fin (rôle habilité « rentabilité »).
function Financials({ fin }: { fin: NonNullable<Fiche["financials"]> }) {
  const rows: [string, ReactNode][] = [
    ["Prix de revient HT", money(fin.prix_de_revient_ht)],
    ["Prix de vente HT", money(fin.prix_vente_ht)],
    ["Marge brute", <span className={cx("tabnum", fin.marge_brute < 0 && "text-clay")}>{fmt(fin.marge_brute)}</span>],
    ["% marge brute", <span className={cx("tabnum", fin.below_threshold && "text-clay")}>{fin.pct_marge.toFixed(1)} %</span>],
  ];
  return (
    <div className="rounded-lg border border-line bg-panel2/40 p-3">
      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[13px]">
        {rows.map(([k, v]) => (<div key={k} className="flex justify-between"><span className="text-muted">{k}</span>{v}</div>))}
      </div>
      {fin.below_threshold && (
        <div className="mt-2 text-[12px] text-clay">⚠ Marge sous le seuil de vigilance ({fin.seuil_marge_pct} %) — non bloquant.</div>
      )}
    </div>
  );
}

// Journal d'audit (append-only) — récent → ancien.
function Journal({ history }: { history: FicheEvent[] }) {
  if (!history.length) return <EmptyState label="Aucun mouvement de circuit pour l'instant." />;
  const ACTION: Record<string, { label: string; tone: string }> = {
    soumission: { label: "Soumission", tone: "steel" }, validation: { label: "Validation", tone: "emerald" }, rejet: { label: "Rejet", tone: "clay" },
  };
  return (
    <div className="flex flex-col gap-1.5 text-[12.5px]">
      {history.map((h, i) => {
        const a = ACTION[h.type_action] || { label: h.type_action, tone: "neutral" };
        return (
          <div key={i} className="flex flex-wrap items-center gap-2 border-b border-line/60 pb-1.5">
            <Badge tone={a.tone as any}>{a.label}</Badge>
            <span className="text-faint">{h.etape_code}</span>
            <span className="text-ink">{h.acteur_nom || "—"}</span>
            <span className="text-faint">{h.horodatage_ms ? relTime(new Date(h.horodatage_ms)) : ""}</span>
            {h.duree_etape_s != null && <span className="text-faint">· {Math.round(h.duree_etape_s / 60)} min</span>}
            {h.commentaire && <span className="text-clay">« {h.commentaire} »</span>}
          </div>
        );
      })}
    </div>
  );
}

// Petit bloc champ étiqueté (éditeur de lignes) : label + contenu, largeur fluide qui se replie.
function LineField({ label, className, right, children }: { label: string; className?: string; right?: boolean; children: ReactNode }) {
  return (
    <div className={cx("flex flex-col gap-0.5 min-w-0", className)}>
      <span className={cx("text-[10px] uppercase tracking-wider text-faint", right && "text-right")}>{label}</span>
      <div className={cx("text-[12.5px] text-ink", right && "text-right")}>{children}</div>
    </div>
  );
}

// Éditeur de lignes fournisseur. mode: "edit" (étape 0, tout éditable sauf BC) · "bc" (étape 3, BC
// uniquement) · "ro" (lecture seule). En "bc" le montant/type peuvent être masqués si non habilité.
// Rendu en CARTES à champs fluides (flex-wrap) : plus de <table> à largeurs fixes → zéro scroll
// horizontal, y compris dans une modale étroite. Les champs se replient sur plusieurs lignes.
function LinesEditor({ lignes, mode, onChange, showMontant }: { lignes: FicheLine[]; mode: "edit" | "bc" | "ro"; onChange?: (l: FicheLine[]) => void; showMontant: boolean }) {
  const set = (i: number, patch: Partial<FicheLine>) => onChange?.(lignes.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const editable = mode === "edit";
  const bcEdit = mode === "bc";
  return (
    <div className="flex flex-col gap-2">
      {lignes.map((l, i) => (
        <div key={i} className="rounded-lg border border-line/60 bg-ink/[.02] p-2.5">
          <div className="flex flex-wrap items-end gap-x-3 gap-y-2">
            <LineField label="Description" className="flex-[2] basis-40">
              {editable ? <TxtField value={l.description} onChange={(v) => set(i, { description: v })} aria={`Description ligne ${i + 1}`} w="w-full" /> : <span className="break-words">{l.description || "—"}</span>}
            </LineField>
            <LineField label="Fournisseur" className="flex-1 basis-32">
              {editable ? <TxtField value={l.fournisseur} onChange={(v) => set(i, { fournisseur: v })} aria={`Fournisseur ligne ${i + 1}`} w="w-full" /> : <span className="break-words">{l.fournisseur || "—"}</span>}
            </LineField>
            <LineField label="Type" className="basis-32 grow">
              {editable ? <Select className="!py-1 w-full" ariaLabel={`Type ligne ${i + 1}`} value={l.type_charge} onChange={(v) => set(i, { type_charge: v })} options={TYPES_CHARGE.map((t) => ({ value: t, label: t.replace("_", " ") }))} /> : (l.type_charge?.replace("_", " ") || "—")}
            </LineField>
            <LineField label="Devise" className="basis-20">
              {editable ? <Select className="!py-1 w-full" ariaLabel={`Devise ligne ${i + 1}`} value={l.devise} onChange={(v) => set(i, { devise: v as FicheLine["devise"] })} options={DEVISES.map((d) => ({ value: d, label: d }))} /> : l.devise}
            </LineField>
            {showMontant && (
              <LineField label="Montant" className="basis-28 grow" right>
                {editable ? <NumField value={l.montant} onChange={(n) => set(i, { montant: n })} aria={`Montant ligne ${i + 1}`} w="w-full" /> : <span className="tabnum">{fmt(l.montant)}</span>}
              </LineField>
            )}
            <LineField label="N° BC" className="basis-28 grow">
              {bcEdit ? <TxtField value={l.numero_bc || ""} onChange={(v) => set(i, { numero_bc: v })} aria={`N° BC ligne ${i + 1}`} w="w-full" placeholder="N° BC" /> : (l.numero_bc || <span className="text-faint">—</span>)}
            </LineField>
            {editable && (
              <button type="button" className="text-clay hover:underline text-[11px] shrink-0 self-end pb-1.5" onClick={() => onChange?.(lignes.filter((_, j) => j !== i))} disabled={lignes.length <= 1}>Suppr.</button>
            )}
          </div>
        </div>
      ))}
      {editable && <button type="button" className="btn-ghost !px-2.5 !py-1 text-xs mt-1 self-start" onClick={() => onChange?.([...lignes, EMPTY_LINE()])}>+ Ajouter une ligne</button>}
    </div>
  );
}

// Modale de détail + circuit d'une fiche.
function FicheDetail({ id, role, onClose, onChanged }: { id: string; role: string | null; onClose: () => void; onChanged: () => void }) {
  const amOpts = useAmOptions(), clientOpts = useClientOptions();
  const toast = useToast();
  const [fiche, setFiche] = useState<Fiche | null>(null);
  const [history, setHistory] = useState<FicheEvent[]>([]);
  const [draft, setDraft] = useState<Fiche | null>(null); // édition locale (étape 0 / BC)
  const [dc, setDc] = useState("");
  const [motif, setMotif] = useState("");
  const load = useCallback(async () => {
    const r = await getFiche(id);
    setFiche(r.fiche); setHistory(r.history || []); setDraft(r.fiche); setDc(r.fiche.numero_dc || "");
  }, [id]);
  useEffect(() => { load().catch(() => toast("Fiche introuvable", "err")); }, [load, toast]);

  if (!fiche || !draft) return <Modal open title="Fiche d'affaire" onClose={onClose}><div className="py-8 text-center text-faint">Chargement…</div></Modal>;

  const etape = fiche.etape_courante || 0;
  const terminee = !!fiche.terminee;
  const canAct = !terminee && role != null && roleActs(role, etape);
  const showMontant = !fiche.pmMasked; // le PM voit les lignes ; le montant reste visible (périmètre kit)
  const mode: "edit" | "bc" | "ro" = terminee ? "ro" : etape === 0 && canAct ? "edit" : etape === 3 && canAct ? "bc" : "ro";

  const saveDraft = async () => {
    if (etape === 0) await updateFiche(id, { ...draft, lignes: draft.lignes });
    else if (etape === 3) await updateFiche(id, { lignes: draft.lignes.map((l, i) => ({ ordre: l.ordre ?? i, numero_bc: l.numero_bc })) });
    await load(); onChanged();
  };
  const doAdvance = async () => {
    if (etape === 0 || etape === 3) await saveDraft(); // persiste la saisie avant de soumettre
    const r = await ficheAdvance(id, etape === 2 ? { numero_dc: dc } : {});
    setMotif(""); await load(); onChanged();
    if (r.recomputed) toast("Fiche validée — P&L de la commande alimenté.", "ok");
  };
  const doReject = async () => {
    if (!motif.trim()) { toast("Motif de rejet obligatoire", "err"); return; }
    await ficheReject(id, motif.trim()); setMotif(""); await load(); onChanged();
  };

  const stepInfo = STEPS[etape];
  return (
    <Modal open title={<span className="flex items-center gap-2">Fiche {fiche.numero_fp} <Badge tone={(STATUT_TONE[fiche.statut] || "neutral") as any}>{STATUT_LABEL[fiche.statut] || fiche.statut}</Badge></span>} onClose={onClose} size="md">
      <div className="flex flex-col gap-3 text-[13px]">
        <Stepper etape={etape} terminee={terminee} />
        {fiche.pmMasked && <div className="text-[12px] text-steel">Vue Chef de projet — données financières confidentielles masquées.</div>}

        {/* Entête */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5">
          <Info k="Client" v={editVal(mode === "edit", <Combo value={draft.client} onChange={(v) => setDraft({ ...draft, client: v })} ariaLabel="Client" placeholder="Client" allowCreate className="w-full" options={clientOpts.map((c) => ({ value: c, label: c }))} />, fiche.client)} />
          <Info k="Affaire" v={editVal(mode === "edit", <TxtField value={draft.affaire} onChange={(v) => setDraft({ ...draft, affaire: v })} aria="Affaire" w="w-full" />, fiche.affaire)} />
          <Info k="Commercial" v={editVal(mode === "edit", <Combo value={draft.commercial} onChange={(v) => setDraft({ ...draft, commercial: v })} ariaLabel="Commercial" placeholder="Commercial" allowCreate className="w-full" options={amOpts.map((a) => ({ value: a, label: a }))} />, fiche.commercial)} />
          <Info k="N° DC" v={etape === 2 && canAct ? <TxtField value={dc} onChange={setDc} aria="N° de DC" w="w-full" placeholder="N° de DC" /> : (fiche.numero_dc || <span className="text-faint">— (défini par le DRO)</span>)} />
          <Info k="Date fiche" v={editVal(mode === "edit", <DateField value={draft.date_fiche || ""} onChange={(v) => setDraft({ ...draft, date_fiche: v })} ariaLabel="Date fiche" />, fiche.date_fiche || "—")} />
          <Info k="Éditée par" v={editVal(mode === "edit", <TxtField value={draft.editeur_ac || ""} onChange={(v) => setDraft({ ...draft, editeur_ac: v })} aria="Éditée par" />, fiche.editeur_ac || "—")} />
        </div>

        {/* Paramètres de calcul + confidentiels (édition étape 0 uniquement, masqués si pmMasked) */}
        {mode === "edit" && (
          <div className="flex flex-wrap items-end gap-3">
            <Lbl t="Taux USD"><NumField value={draft.taux_usd} onChange={(n) => setDraft({ ...draft, taux_usd: n })} aria="Taux USD" w="w-24" /></Lbl>
            <Lbl t="Taux EUR"><NumField value={draft.taux_eur} onChange={(n) => setDraft({ ...draft, taux_eur: n })} aria="Taux EUR" w="w-24" /></Lbl>
            <Lbl t="Seuil marge %"><NumField value={draft.seuil_marge_pct} onChange={(n) => setDraft({ ...draft, seuil_marge_pct: n })} aria="Seuil marge" w="w-20" /></Lbl>
            <Lbl t="Prix vente HT"><NumField value={draft.prix_vente_ht_xof} onChange={(n) => setDraft({ ...draft, prix_vente_ht_xof: n })} aria="Prix de vente HT" /></Lbl>
            <Lbl t="Provisions"><NumField value={draft.provisions_xof} onChange={(n) => setDraft({ ...draft, provisions_xof: n })} aria="Provisions" /></Lbl>
            <Lbl t="Autres frais fin."><NumField value={draft.autres_frais_financiers_xof} onChange={(n) => setDraft({ ...draft, autres_frais_financiers_xof: n })} aria="Autres frais financiers" /></Lbl>
          </div>
        )}

        {/* Lignes fournisseur */}
        <div>
          <div className="text-[12px] text-muted mb-1">Lignes de commande fournisseur</div>
          <LinesEditor lignes={draft.lignes || []} mode={mode} showMontant={showMontant} onChange={mode === "edit" || mode === "bc" ? (l) => setDraft({ ...draft, lignes: l }) : undefined} />
        </div>

        {/* Résumé financier (si habilité) */}
        {fiche.financials && <Financials fin={fiche.financials} />}

        {/* Mémo */}
        {(mode === "edit" ? true : fiche.memo) && (
          <Lbl t="Mémo">{mode === "edit"
            ? <textarea className="field !py-1 w-full" rows={2} aria-label="Mémo" value={draft.memo || ""} onChange={(e) => setDraft({ ...draft, memo: e.target.value })} />
            : <span className="text-ink">{fiche.memo}</span>}</Lbl>
        )}

        {/* Actions de circuit */}
        {canAct && (
          <div className="flex flex-col gap-2 border-t border-line pt-3">
            <div className="flex flex-wrap items-center gap-2">
              {(mode === "edit" || mode === "bc") && <Busy label="Enregistrer" variant="ghost" fn={saveDraft} okMsg="Enregistré" />}
              <Busy label={stepInfo.act} fn={doAdvance} okMsg="Transmis" />
            </div>
            {CAN_REJECT.has(etape) && (
              <div className="flex flex-wrap items-center gap-2">
                <TxtField value={motif} onChange={setMotif} aria="Motif de rejet" w="w-72" placeholder="Motif de rejet (obligatoire)" />
                <Busy label="Rejeter" variant="ghost" fn={doReject} okMsg="Rejeté" errMsg="Rejet refusé" />
              </div>
            )}
          </div>
        )}
        {!canAct && !terminee && <div className="text-[12px] text-faint border-t border-line pt-2">En attente de l'action « {stepInfo?.label} » — vous n'êtes pas l'acteur de cette étape.</div>}
        {terminee && <div className="text-[12px] text-emerald border-t border-line pt-2">Fiche validée — verrouillée. Le P&L de la commande {fiche.numero_fp} est alimenté.</div>}

        {/* Journal */}
        <details className="mt-1">
          <summary className="cursor-pointer select-none text-faint hover:text-ink text-[12px]">Journal d'audit ({history.length})</summary>
          <div className="mt-2"><Journal history={history} /></div>
        </details>
      </div>
    </Modal>
  );
}
const Info = ({ k, v }: { k: string; v: ReactNode }) => (<div className="flex justify-between gap-2"><span className="text-muted shrink-0">{k}</span><span className="text-ink text-right">{v}</span></div>);
const Lbl = ({ t, children }: { t: string; children: ReactNode }) => (<label className="flex flex-col gap-0.5"><span className="text-[11px] text-muted">{t}</span>{children}</label>);
const editVal = (on: boolean, node: ReactNode, ro: ReactNode) => (on ? node : <span>{ro}</span>);

// Modale de création (assistance commerciale / direction).
function CreateFiche({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const amOpts = useAmOptions(), clientOpts = useClientOptions();
  const toast = useToast();
  const [f, setF] = useState<Partial<Fiche>>(EMPTY_FICHE());
  const set = (patch: Partial<Fiche>) => setF((p) => ({ ...p, ...patch }));
  const submit = async () => {
    const r = await createFiche(f);
    toast("Fiche créée (brouillon)", "ok"); onCreated(r.id);
  };
  return (
    <Modal open title="Nouvelle fiche d'affaire" onClose={onClose} size="md" actions={<Busy label="Créer le brouillon" fn={submit} okMsg="Créée" errMsg="Création refusée" />}>
      <div className="flex flex-col gap-3 text-[13px]">
        <div className="flex flex-wrap items-end gap-3">
          <Lbl t="N° de FP (FP/AAAA/N)"><TxtField value={f.numero_fp || ""} onChange={(v) => set({ numero_fp: v })} aria="N° de FP" w="w-40" placeholder="FP/2026/1" /></Lbl>
          <Lbl t="Client"><Combo value={f.client || ""} onChange={(v) => set({ client: v })} ariaLabel="Client" placeholder="Client" allowCreate className="w-44" options={clientOpts.map((c) => ({ value: c, label: c }))} /></Lbl>
          <Lbl t="Affaire"><TxtField value={f.affaire || ""} onChange={(v) => set({ affaire: v })} aria="Affaire" w="w-56" /></Lbl>
          <Lbl t="Commercial"><Combo value={f.commercial || ""} onChange={(v) => set({ commercial: v })} ariaLabel="Commercial" placeholder="Commercial" allowCreate className="w-44" options={amOpts.map((a) => ({ value: a, label: a }))} /></Lbl>
          <Lbl t="Date fiche"><DateField value={f.date_fiche || ""} onChange={(v) => set({ date_fiche: v })} ariaLabel="Date fiche" /></Lbl>
          <Lbl t="Éditée par"><TxtField value={f.editeur_ac || ""} onChange={(v) => set({ editeur_ac: v })} aria="Éditée par" /></Lbl>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <Lbl t="Taux USD"><NumField value={f.taux_usd} onChange={(n) => set({ taux_usd: n })} aria="Taux USD" w="w-24" /></Lbl>
          <Lbl t="Taux EUR"><NumField value={f.taux_eur} onChange={(n) => set({ taux_eur: n })} aria="Taux EUR" w="w-24" /></Lbl>
          <Lbl t="Prix vente HT"><NumField value={f.prix_vente_ht_xof} onChange={(n) => set({ prix_vente_ht_xof: n })} aria="Prix de vente HT" /></Lbl>
          <Lbl t="Provisions"><NumField value={f.provisions_xof} onChange={(n) => set({ provisions_xof: n })} aria="Provisions" /></Lbl>
          <Lbl t="Autres frais fin."><NumField value={f.autres_frais_financiers_xof} onChange={(n) => set({ autres_frais_financiers_xof: n })} aria="Autres frais" /></Lbl>
        </div>
        <div>
          <div className="text-[12px] text-muted mb-1">Lignes de commande fournisseur</div>
          <LinesEditor lignes={f.lignes || []} mode="edit" showMontant onChange={(l) => set({ lignes: l })} />
        </div>
        <p className="text-[11px] text-faint">Le N° de DC (rattachement des BC) sera défini par le DRO à l'étape 3 ; les N° de BC seront saisis après validation DRO.</p>
      </div>
    </Modal>
  );
}

export const Fiches: FC<Props> = () => {
  const { role } = useClaims();
  const canCreate = role === "assistante" || role === "direction";
  const [rows, setRows] = useState<Fiche[]>([]);
  const [loading, setLoading] = useState(true);
  const [statut, setStatut] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try { const r = await listFiches(statut ? { statut } : {}); setRows(r.fiches || []); }
    finally { setLoading(false); }
  }, [statut]);
  useEffect(() => { load().catch(() => setLoading(false)); }, [load]);

  const cols = [
    colText("N° FP", (r: Fiche) => <button className="text-ink hover:text-gold underline decoration-dotted" onClick={() => setOpenId(r._id!)}>{r.numero_fp}</button>, (r: Fiche) => r.numero_fp),
    colText("Client", (r: Fiche) => r.client, (r: Fiche) => r.client),
    colText("Affaire", (r: Fiche) => <span className="truncate max-w-[220px] inline-block align-bottom">{r.affaire}</span>),
    colText("Commercial", (r: Fiche) => r.commercial, (r: Fiche) => r.commercial),
    colText("Étape", (r: Fiche) => <Stepper etape={r.etape_courante || 0} terminee={r.terminee} />, (r: Fiche) => r.etape_courante || 0),
    colText("Statut", (r: Fiche) => <Badge tone={(STATUT_TONE[r.statut] || "neutral") as any}>{STATUT_LABEL[r.statut] || r.statut}</Badge>, (r: Fiche) => r.statut),
    colNum("Vente HT", (r: Fiche) => (r.financials ? money(r.financials.prix_vente_ht) : <span className="tabnum">{fmt(r.prix_vente_ht_xof || 0)}</span>), (r: Fiche) => r.financials?.prix_vente_ht ?? r.prix_vente_ht_xof ?? 0),
    colNum("% MB", (r: Fiche) => (r.financials ? <span className={cx("tabnum", r.financials.below_threshold && "text-clay")}>{r.financials.pct_marge.toFixed(1)} %</span> : <span className="text-faint">—</span>), (r: Fiche) => r.financials?.pct_marge ?? -999),
  ];

  return (
    <div className="flex flex-col gap-4">
      <Card title="Fiches d'affaire — circuit de validation"
        actions={<div className="flex items-center gap-2">
          <Select className="!py-1 text-xs" ariaLabel="Filtrer par statut" value={statut} onChange={setStatut}
            options={[{ value: "", label: "Statut · tous" }, ...Object.entries(STATUT_LABEL).map(([v, l]) => ({ value: v, label: l }))]} />
          {canCreate && <button className="btn-ghost !px-3 !py-1 text-xs" onClick={() => setCreating(true)}>+ Nouvelle fiche</button>}
        </div>}>
        <p className="text-[12px] text-muted mb-3">
          Alternative à l'import du fichier P&L : la fiche calcule le prix de revient / marge et alimente le P&L de la commande à sa validation finale.
          Circuit à 6 étapes (AC → DC → DRO → AC → DGA → CDG/DF). Champs financiers masqués pour les rôles non habilités.
        </p>
        {loading ? <div className="py-8 text-center text-faint">Chargement…</div>
          : <Table columns={cols} rows={rows} colsKey="fiches" empty="Aucune fiche d'affaire — créez-en une pour numériser une affaire." searchKeys={[(r: Fiche) => r.numero_fp, (r: Fiche) => r.client, (r: Fiche) => r.affaire, (r: Fiche) => r.commercial]} rowKey={(r: Fiche) => r._id || r.numero_fp || ""} bulk={[]} />}
      </Card>

      {openId && <FicheDetail id={openId} role={role} onClose={() => setOpenId(null)} onChanged={load} />}
      {creating && <CreateFiche onClose={() => setCreating(false)} onCreated={(id) => { setCreating(false); load(); setOpenId(id); }} />}
    </div>
  );
};
