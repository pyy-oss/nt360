// Registre des modules (BUILD_KIT §2). Chaque module vit dans son propre fichier ;
// ici uniquement : id de navigation + clé RBAC + libellé + icône + composant.
//
// Les composants sont chargés en LAZY (React.lazy + import dynamique) : le shell et l'écran de
// connexion s'affichent sans embarquer le code des modules ni leurs dépendances lourdes (recharts).
// Chaque fichier de modules devient un chunk chargé À LA DEMANDE, au premier affichage d'un de ses
// onglets. App enveloppe le module actif dans un <Suspense> (squelette de chargement).
import { lazy, type ComponentType, type FC } from "react";
import {
  LayoutDashboard, GitBranch, Target, Receipt, Layers, TrendingUp, Percent, FileText,
  Truck, ClipboardList, Users, Boxes, Search, Shield, ListChecks, ShoppingCart, FileSpreadsheet, SlidersHorizontal, UserRound, Newspaper, Eraser, BellRing, BookOpen, Radar, Gauge, Kanban, Contact, ListTodo, Stamp, Sparkles, UsersRound, FileCheck2, Wrench, type LucideIcon,
} from "lucide-react";
import type { Props } from "./_shared";

type Mod = ComponentType<Props>;
// Charge un export nommé d'un fichier de modules en lazy (le chunk est partagé entre les exports
// d'un même fichier — Vite dédoublonne l'import dynamique).
const from = (loader: () => Promise<Record<string, unknown>>, name: string): Mod =>
  lazy(() => loader().then((m) => ({ default: m[name] as Mod }))) as unknown as Mod;

const Overview = from(() => import("./overview"), "Overview");
const Actualite = from(() => import("./news"), "Actualite");
const Pipeline = from(() => import("./pipeline"), "Pipeline");
const OppList = from(() => import("./pipeline"), "OppList");
const Am360 = from(() => import("./pipeline"), "Am360");
const CommercialCockpit = from(() => import("./pipeline"), "CommercialCockpit");
const PipelineBoard = from(() => import("./pipeline"), "PipelineBoard");
const Objectifs = from(() => import("./finance"), "Objectifs");
const Facturation = from(() => import("./finance"), "Facturation");
const InvoiceList = from(() => import("./finance"), "InvoiceList");
const Rentabilite = from(() => import("./finance"), "Rentabilite");
const Backlog = from(() => import("./backlog"), "Backlog");
const Prevision = from(() => import("./backlog"), "Prevision");
const OrderList = from(() => import("./backlog"), "OrderList");
const Simulateur = from(() => import("./backlog"), "Simulateur");
const PnlProjet = from(() => import("./operations"), "PnlProjet");
const Fournisseurs = from(() => import("./operations"), "Fournisseurs");
const BC = from(() => import("./operations"), "BC");
const EntityView = from(() => import("./operations"), "EntityView") as ComponentType<Props & { kind: "clients" | "domaines" }>;
const Fp360 = from(() => import("./operations"), "Fp360");
const Client360 = from(() => import("./accounts"), "Client360");
const Activites = from(() => import("./activities"), "Activites");
const Approvals = from(() => import("./approvals"), "Approvals");
const SalesForecast = from(() => import("./salesforecast"), "SalesForecast");
const Scoring = from(() => import("./scoring"), "Scoring");
const Staffing = from(() => import("./staffing"), "Staffing");
const Reports = from(() => import("./reports"), "Reports");
const Habilitations = from(() => import("./admin"), "Habilitations");
const Cleanup = from(() => import("./cleanup"), "Cleanup");
const Fiches = from(() => import("./fiches"), "Fiches");
const Codir = from(() => import("./codir"), "Codir");
const Relances = from(() => import("./relances"), "Relances");
const Guide = from(() => import("./guide"), "Guide");
const ClickupCockpit = from(() => import("./clickupcockpit"), "ClickupCockpit");
const ClientNorm = from(() => import("./clientnorm"), "ClientNorm");
const FournisseursRef = from(() => import("./fournisseursref"), "FournisseursRef");
// Module Contrats de maintenance (mnt_) — chargé en lazy comme les autres ; masqué tant que le
// drapeau config/mntFeature est éteint (voir champ `flag` ci-dessous et App.tsx).
const Maintenance = from(() => import("./maintenance"), "Maintenance");
const Astreintes = from(() => import("./astreintes"), "Astreintes");
// Module Partenariats & Certifications (par_) — lazy, masqué tant que le drapeau parFeature est éteint.
const Partenariats = from(() => import("./partenariats"), "Partenariats");

const Clients: FC<Props> = (p) => <EntityView {...p} kind="clients" />;
const Domaines: FC<Props> = (p) => <EntityView {...p} kind="domaines" />;

// `flag` (optionnel) : id d'un overlay config/<flag> ; l'onglet n'est visible que si ce drapeau est
// allumé (App.tsx). Absent = comportement historique (visibilité pilotée par le seul RBAC).
export const MODULES: { id: string; key: string; label: string; icon: LucideIcon; Component: Mod; flag?: string }[] = [
  { id: "overview", key: "overview", label: "Vue d'ensemble", icon: LayoutDashboard, Component: Overview },
  { id: "news", key: "overview", label: "Actualité", icon: Newspaper, Component: Actualite },
  { id: "codir", key: "overview", label: "Bilan CODIR", icon: Gauge, Component: Codir },
  { id: "commercial", key: "pipeline", label: "Cockpit commercial", icon: Gauge, Component: CommercialCockpit },
  { id: "opplist", key: "pipeline", label: "Opportunités", icon: ListChecks, Component: OppList },
  { id: "board", key: "pipeline", label: "Board pipeline", icon: Kanban, Component: PipelineBoard },
  { id: "pipeline", key: "pipeline", label: "Pipeline (analyse)", icon: GitBranch, Component: Pipeline },
  { id: "am360", key: "pipeline", label: "AM 360°", icon: UserRound, Component: Am360 },
  { id: "activites", key: "pipeline", label: "Activités", icon: ListTodo, Component: Activites },
  { id: "approvals", key: "pipeline", label: "Approbations", icon: Stamp, Component: Approvals },
  { id: "salesforecast", key: "pipeline", label: "Prévision commerciale", icon: TrendingUp, Component: SalesForecast },
  { id: "scoring", key: "pipeline", label: "Scoring IA", icon: Sparkles, Component: Scoring },
  { id: "reports", key: "pipeline", label: "Rapports", icon: FileSpreadsheet, Component: Reports },
  { id: "objectifs", key: "objectifs", label: "Objectifs / R-O", icon: Target, Component: Objectifs },
  { id: "facturation", key: "facturation", label: "Facturation", icon: Receipt, Component: Facturation },
  { id: "invoicelist", key: "facturation", label: "Factures", icon: FileSpreadsheet, Component: InvoiceList },
  { id: "relances", key: "overview", label: "Relances", icon: BellRing, Component: Relances },
  { id: "backlog", key: "backlog", label: "Suivi Backlog", icon: Layers, Component: Backlog },
  { id: "orderlist", key: "overview", label: "Commandes", icon: ShoppingCart, Component: OrderList },
  { id: "fiches", key: "overview", label: "Fiches d'affaire", icon: FileCheck2, Component: Fiches },
  { id: "staffing", key: "overview", label: "Staffing", icon: UsersRound, Component: Staffing },
  { id: "prevision", key: "prevision", label: "Prévision", icon: TrendingUp, Component: Prevision },
  { id: "simulator", key: "prevision", label: "Simulateur", icon: SlidersHorizontal, Component: Simulateur },
  { id: "rentabilite", key: "rentabilite", label: "Rentabilité (P&L)", icon: Percent, Component: Rentabilite },
  { id: "pnlprojet", key: "pnlprojet", label: "P&L Projet", icon: FileText, Component: PnlProjet },
  { id: "fournisseurs", key: "fournisseurs", label: "Crédit Fournisseurs", icon: Truck, Component: Fournisseurs },
  { id: "bc", key: "bc", label: "Exécution BC", icon: ClipboardList, Component: BC },
  { id: "client360", key: "overview", label: "Client 360", icon: Contact, Component: Client360 },
  { id: "clients", key: "clients", label: "Clients", icon: Users, Component: Clients },
  { id: "clientnorm", key: "import", label: "Normalisation clients", icon: Users, Component: ClientNorm },
  { id: "fournisseursref", key: "fournisseurs", label: "Fournisseurs", icon: Truck, Component: FournisseursRef },
  { id: "domaines", key: "domaines", label: "Domaines", icon: Boxes, Component: Domaines },
  { id: "fp360", key: "overview", label: "FP 360°", icon: Search, Component: Fp360 },
  // Astreintes : transverse affaires + contrats (imputées en charge par N° FP), rangées en Exécution.
  // Même gouvernance que Contrats (droit `maintenance` + drapeau mntFeature) — relocalisation présentationnelle.
  { id: "astreintes", key: "maintenance", label: "Astreintes", icon: BellRing, Component: Astreintes, flag: "mntFeature" },
  { id: "cleanup", key: "import", label: "Qualité & correction", icon: Eraser, Component: Cleanup },
  { id: "habilitations", key: "habilitations", label: "Habilitations", icon: Shield, Component: Habilitations },
  { id: "guide", key: "overview", label: "Guide", icon: BookOpen, Component: Guide },
  { id: "clickupcockpit", key: "overview", label: "Cockpit ClickUp", icon: Radar, Component: ClickupCockpit },
  // Contrats de maintenance : clé RBAC dédiée `maintenance` (absente de la matrice → `none` par
  // défaut) ET drapeau `mntFeature` (éteint par défaut). Doublement masqué tant que non activé.
  { id: "maintenance", key: "maintenance", label: "Contrats de maintenance", icon: Wrench, Component: Maintenance, flag: "mntFeature" },
  // Partenariats & Certifications : clé RBAC dédiée `partenariats` ET drapeau `parFeature` (éteint par
  // défaut). Doublement masqué tant que non activé (ADR-P01). Même patron que maintenance.
  { id: "partenariats", key: "partenariats", label: "Partenariats & Certifications", icon: UsersRound, Component: Partenariats, flag: "parFeature" },
];

// Regroupement des onglets par domaine (navigation à 2 niveaux). Ordre = ordre d'affichage.
export const GROUPS: { label: string; ids: string[] }[] = [
  { label: "Cockpit", ids: ["overview", "codir", "news", "guide"] },
  // « Commercial » = cockpit de pilotage de la performance commerciale + du pipeline : Cockpit (synthèse)
  // → Opportunités (saisie/édition en modale) → Board (Kanban par étape) → Pipeline (analyse) → AM 360°.
  { label: "Commercial", ids: ["commercial", "opplist", "board", "pipeline", "am360", "salesforecast", "scoring", "reports", "activites", "approvals"] },
  { label: "Revenu", ids: ["facturation", "invoicelist", "relances", "objectifs"] },
  { label: "Exécution", ids: ["orderlist", "fiches", "staffing", "backlog", "prevision", "simulator", "fp360", "astreintes"] },
  { label: "Rentabilité", ids: ["rentabilite", "pnlprojet", "fournisseurs", "bc"] },
  { label: "Référentiels", ids: ["client360", "clients", "clientnorm", "fournisseursref", "domaines"] },
  { label: "Contrats", ids: ["maintenance"] },
  { label: "Partenariats", ids: ["partenariats"] },
  { label: "Admin", ids: ["cleanup", "habilitations", "clickupcockpit"] },
];

// Garde-fou de navigation : tout onglet déclaré dans MODULES doit apparaître dans exactement un
// groupe, sinon il est injoignable depuis la barre latérale (seuls les liens profonds y mènent).
// En dev, on le signale bruyamment plutôt que de laisser un écran orphelin passer inaperçu.
if (import.meta.env.DEV) {
  const grouped = new Set(GROUPS.flatMap((g) => g.ids));
  const orphans = MODULES.filter((m) => !grouped.has(m.id)).map((m) => m.id);
  if (orphans.length) console.error(`[nav] onglets orphelins (absents de GROUPS) : ${orphans.join(", ")}`);
  const unknown = [...grouped].filter((id) => !MODULES.some((m) => m.id === id));
  if (unknown.length) console.error(`[nav] ids de GROUPS sans module : ${unknown.join(", ")}`);
}
