// Guide d'utilisation IN-APP — onboarding léger, adapté au rôle. 100 % client (aucune écriture,
// aucun agrégat) : lit le rôle et la matrice d'accès pour n'afficher QUE les parcours réalisables,
// avec des boutons « Ouvrir » qui amènent directement sur l'écran (drill-through). Sert de point
// d'entrée pour un nouvel utilisateur : que faire, dans quel ordre, et le vocabulaire de l'outil.
import { type FC, type ReactNode } from "react";
import { BookOpen, Compass, ArrowRight } from "lucide-react";
import { useClaims, useCanFn, type Level } from "../lib/rbac";
import { useNav } from "../lib/nav";
import { Card, Badge, Tip, cx } from "../design/components";
import { Props } from "./_shared";

type Step = { text: ReactNode; go?: string };
type Parcours = {
  title: string;
  who: string;                       // à qui s'adresse ce parcours (libellé)
  need: (can: (m: string) => Level) => boolean; // condition d'affichage (droits requis)
  steps: Step[];
};

const has = (can: (m: string) => Level, m: string) => can(m) !== "none";
const canWrite = (can: (m: string) => Level, m: string) => can(m) === "write";

// Libellés de rôle (custom claims) → présentation humaine.
const ROLE_LABEL: Record<string, string> = {
  direction: "Direction", commercial_dir: "Directeur commercial", commercial: "Commercial",
  pmo: "PMO", achats: "Achats", lecture: "Lecture seule",
  assistante: "Assistante", finance: "Finance (DF)", directeur_contrats: "Directeur contrats", data_steward: "Data-steward",
};

const PARCOURS: Parcours[] = [
  {
    title: "Piloter le revenu au quotidien",
    who: "Direction / Directeur commercial",
    need: (c) => has(c, "overview"),
    steps: [
      { text: <>Ouvrir la <b>Vue d'ensemble</b> : certitudes, pipeline projeté, facturé, backlog.</>, go: "overview" },
      { text: <>Lire l'<b>Actualité</b> : les événements clés et recommandations du moment.</>, go: "news" },
      { text: <>Vérifier l'atterrissage et les scénarios dans <b>Prévision</b> (CAS/CAF, tension cash).</>, go: "prevision" },
      { text: <>Suivre l'atteinte des cibles dans <b>Objectifs / R-O</b>.</>, go: "objectifs" },
    ],
  },
  {
    title: "Gérer le pipeline commercial",
    who: "Commercial",
    need: (c) => has(c, "pipeline"),
    steps: [
      { text: <>Analyser le <b>Pipeline</b> (par stade, par AM, taux de conversion).</>, go: "pipeline" },
      { text: <>Parcourir et saisir des <b>Opportunités</b> ; requalifier les dormantes.</>, go: "opplist" },
      { text: <>Suivre chaque AM dans <b>AM 360°</b>.</>, go: "am360" },
      { text: <>Une opportunité <b>gagnée</b> se réconcilie en commande depuis <b>Commandes</b> (réconciliation), sans double saisie.</>, go: "orderlist" },
    ],
  },
  {
    title: "Facturer et suivre l'encaissement",
    who: "Facturation",
    need: (c) => has(c, "facturation"),
    steps: [
      { text: <>Suivre la <b>Facturation</b> (mensuel, par BU, top clients).</>, go: "facturation" },
      { text: <>Sur <b>Factures</b> : rattacher les orphelines à leur FP, corriger date/échéance.</>, go: "invoicelist" },
      { text: <>Traiter les <b>Relances</b> : créances échues à recouvrer, par responsable.</>, go: "relances" },
      { text: <>Anticiper la trésorerie (scénarios & tension) dans <b>Prévision</b>.</>, go: "prevision" },
    ],
  },
  {
    title: "Exécuter les achats & piloter le crédit fournisseur",
    who: "Achats",
    need: (c) => has(c, "bc") || has(c, "fournisseurs"),
    steps: [
      { text: <>Faire évoluer le <b>statut</b> des BC dans <b>Exécution BC</b> (émis → livré → facturé → soldé).</>, go: "bc" },
      { text: <>Poser les <b>soldes d'ouverture</b> des comptes dans <b>Crédit Fournisseurs</b> (SOA « à jour maintenant »).</>, go: "fournisseurs" },
      { text: <>Rappel SOA : <b>seule une facture</b> (BC « facturé ») bouge le solde ; les BC non facturés sont un <b>engagement</b>.</> },
      { text: <>Surveiller les relances <b>BC en retard</b> dans <b>Relances</b>.</>, go: "relances" },
    ],
  },
  {
    title: "Piloter le backlog & la facturation à venir",
    who: "PMO / Backlog",
    need: (c) => has(c, "backlog"),
    steps: [
      { text: <>Suivre le <b>Suivi Backlog</b> (RAF par millésime, BU, fiabilité).</>, go: "backlog" },
      { text: <>Renseigner les <b>jalons de facturation</b> par projet (échéancier prévisionnel).</>, go: "backlog" },
      { text: <>Traiter les <b>jalons échus non facturés</b> dans <b>Relances</b>.</>, go: "relances" },
    ],
  },
  {
    title: "Assainir la base de données",
    who: "Import / Direction",
    need: (c) => canWrite(c, "import"),
    steps: [
      { text: <>Repérer les anomalies dans <b>Qualité &amp; correction</b> (champs manquants, rattachements).</>, go: "cleanup" },
      { text: <>Corriger, supprimer, <b>annuler</b> ou dédoublonner dans <b>Assainissement</b>.</>, go: "cleanup" },
      { text: <>Principe : les imports sont des <b>deltas</b> (mise à jour / nouvel enregistrement), jamais une purge.</> },
      { text: <>Après correction, lancer un <b>Recalcul</b> (Vue d'ensemble) pour matérialiser.</>, go: "overview" },
    ],
  },
  {
    title: "Administrer les accès",
    who: "Direction",
    need: (c) => canWrite(c, "habilitations"),
    steps: [
      { text: <>Créer des utilisateurs et affecter les rôles dans <b>Habilitations</b>.</>, go: "habilitations" },
      { text: <>Ajuster la <b>matrice de droits</b> (opposable, appliquée côté serveur).</>, go: "habilitations" },
    ],
  },
  {
    title: "Synchroniser avec ClickUp (projets & achats)",
    who: "Direction",
    need: (c) => canWrite(c, "habilitations"),
    steps: [
      { text: <>Dans <b>Habilitations → Intégration ClickUp</b> : garder l'intégration <b>active</b> et choisir la liste cible.</>, go: "habilitations" },
      { text: <><b>Rattacher les tâches existantes</b> (Opp ID = N° FP) AVANT tout push en masse, pour éviter les doublons.</>, go: "habilitations" },
      { text: <>Depuis <b>Commandes</b>, le bouton <b>« ClickUp »</b> crée/met à jour une tâche assignée au PM ; le CA facturé est entretenu automatiquement.</>, go: "orderlist" },
      { text: <>Côté BC : <b>Rattacher</b> → <b>Créer les BC non liés</b> → au besoin <b>Importer les BC saisis dans ClickUp</b> (statut « émis », sans impact solde).</>, go: "habilitations" },
      { text: <>Activer le <b>temps réel</b> (webhooks) pour refléter ClickUp en secondes, puis <b>« Enrichir les tâches »</b> (synthèse + jalons en sous-tâches + BC en checklist).</>, go: "habilitations" },
      { text: <>Suivre l'ensemble (couverture, retards, échéancier) dans le <b>Cockpit ClickUp</b>.</>, go: "clickupcockpit" },
    ],
  },
];

const GLOSSARY: { term: string; def: string }[] = [
  { term: "CAS", def: "Chiffre d'affaires Signé — prise de commande (carnet)." },
  { term: "CAF", def: "Chiffre d'affaires Facturé — revenu réellement facturé." },
  { term: "RAF / Backlog", def: "Reste À Facturer sur les commandes en cours." },
  { term: "MB / %MB", def: "Marge Brute et son taux (assiette CAS ou facturé). Réservé au droit Rentabilité." },
  { term: "Pipeline projeté", def: "CA d'opportunités pondéré : 100 % des IdC ≥ 90 %, 20 % des IdC ≥ 70 %, D Prev dans l'exercice." },
  { term: "IdC", def: "Indice de Confiance d'une opportunité (probabilité de gain)." },
  { term: "D Prev", def: "Date de clôture prévue d'une opportunité." },
  { term: "FP", def: "Numéro de Fiche Projet — identifiant pivot d'une affaire (commande, facture, BC, opp)." },
  { term: "SOA", def: "Statement Of Account — relevé/solde du compte fournisseur." },
  { term: "Solde vs Engagement", def: "Solde = facturé (impacte le compte) ; Engagement = BC non facturés (n'impacte pas le compte)." },
  { term: "Delta", def: "Un import met à jour ou ajoute des enregistrements ; il ne purge jamais la base." },
  { term: "Atterrissage", def: "Projection de fin d'exercice (CAS et CAF) vs objectif." },
];

function StepRow({ s, canGo, go, i }: { s: Step; canGo: (id: string) => boolean; go: (id: string) => void; i: number }) {
  return (
    <div className="flex items-start gap-2.5 py-1.5">
      <span className="mt-0.5 shrink-0 w-5 h-5 rounded-full bg-panel2 text-[11px] font-semibold flex items-center justify-center tabnum">{i + 1}</span>
      <div className="flex-1 text-[13px] leading-relaxed">{s.text}</div>
      {s.go && canGo(s.go) && (
        <button className="btn-ghost !py-1 !px-2 text-[12px] shrink-0 inline-flex items-center gap-1" onClick={() => go(s.go!)}>
          Ouvrir <ArrowRight size={13} />
        </button>
      )}
    </div>
  );
}

export const Guide: FC<Props> = () => {
  const { role } = useClaims();
  const can = useCanFn();
  const { go, canGo } = useNav();
  const parcours = PARCOURS.filter((p) => p.need(can));

  return (
    <div className="flex flex-col gap-4">
      <Card title="Guide d'utilisation">
        <div className="flex items-center gap-2 flex-wrap">
          <BookOpen size={16} className="text-gold" />
          <span className="text-[13px]">Bienvenue. Votre rôle :</span>
          <Badge tone="gold">{ROLE_LABEL[role || ""] || role || "sans rôle"}</Badge>
        </div>
        <Tip>Ce guide n'affiche que les <b>parcours réalisables avec vos droits</b>. Les boutons « Ouvrir » vous amènent directement sur l'écran concerné. Les indicateurs se mettent à jour après chaque <b>import delta</b> et <b>recalcul</b>.</Tip>
      </Card>

      {parcours.map((p) => (
        <Card key={p.title} title={p.title}>
          <div className="flex items-center gap-2 mb-1 text-[11px] text-muted">
            <Compass size={13} /> <span>{p.who}</span>
          </div>
          <div className="divide-y divide-line/50">
            {p.steps.map((s, i) => <StepRow key={i} s={s} i={i} go={go} canGo={canGo} />)}
          </div>
        </Card>
      ))}

      <Card title="Glossaire">
        <div className="grid gap-2 sm:grid-cols-2">
          {GLOSSARY.map((g) => (
            <div key={g.term} className={cx("rounded-lg border border-line/60 p-2.5")}>
              <div className="text-[12px] font-semibold text-gold">{g.term}</div>
              <div className="text-[12px] text-muted leading-relaxed mt-0.5">{g.def}</div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
};
