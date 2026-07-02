// Registre des modules (BUILD_KIT §2). Chaque module vit dans son propre fichier ;
// ici uniquement : id de navigation + clé RBAC + libellé + icône + composant.
import { type FC } from "react";
import {
  LayoutDashboard, GitBranch, Target, Receipt, Layers, TrendingUp, Percent, FileText,
  Truck, ClipboardList, Users, Boxes, Search, Shield, ListChecks, ShoppingCart, FileSpreadsheet, SlidersHorizontal, type LucideIcon,
} from "lucide-react";
import type { Props } from "./_shared";
import { Overview } from "./overview";
import { Pipeline, OppList } from "./pipeline";
import { Objectifs, Facturation, InvoiceList, Rentabilite } from "./finance";
import { Backlog, Prevision, OrderList, Simulateur } from "./backlog";
import { PnlProjet, Fournisseurs, BC, EntityView, Fp360 } from "./operations";
import { Habilitations } from "./admin";

const Clients: FC<Props> = (p) => <EntityView {...p} kind="clients" />;
const Domaines: FC<Props> = (p) => <EntityView {...p} kind="domaines" />;

export const MODULES: { id: string; key: string; label: string; icon: LucideIcon; Component: FC<Props> }[] = [
  { id: "overview", key: "overview", label: "Vue d'ensemble", icon: LayoutDashboard, Component: Overview },
  { id: "pipeline", key: "pipeline", label: "Pipeline", icon: GitBranch, Component: Pipeline },
  { id: "opplist", key: "pipeline", label: "Opportunités", icon: ListChecks, Component: OppList },
  { id: "objectifs", key: "objectifs", label: "Objectifs / R-O", icon: Target, Component: Objectifs },
  { id: "facturation", key: "facturation", label: "Facturation", icon: Receipt, Component: Facturation },
  { id: "invoicelist", key: "facturation", label: "Factures", icon: FileSpreadsheet, Component: InvoiceList },
  { id: "backlog", key: "backlog", label: "Suivi Backlog", icon: Layers, Component: Backlog },
  { id: "orderlist", key: "overview", label: "Commandes", icon: ShoppingCart, Component: OrderList },
  { id: "prevision", key: "prevision", label: "Prévision", icon: TrendingUp, Component: Prevision },
  { id: "simulator", key: "prevision", label: "Simulateur", icon: SlidersHorizontal, Component: Simulateur },
  { id: "rentabilite", key: "rentabilite", label: "Rentabilité (P&L)", icon: Percent, Component: Rentabilite },
  { id: "pnlprojet", key: "pnlprojet", label: "P&L Projet", icon: FileText, Component: PnlProjet },
  { id: "fournisseurs", key: "fournisseurs", label: "Crédit Fournisseurs", icon: Truck, Component: Fournisseurs },
  { id: "bc", key: "bc", label: "Exécution BC", icon: ClipboardList, Component: BC },
  { id: "clients", key: "clients", label: "Clients", icon: Users, Component: Clients },
  { id: "domaines", key: "domaines", label: "Domaines", icon: Boxes, Component: Domaines },
  { id: "fp360", key: "overview", label: "FP 360°", icon: Search, Component: Fp360 },
  { id: "habilitations", key: "habilitations", label: "Habilitations", icon: Shield, Component: Habilitations },
];

// Regroupement des onglets par domaine (navigation à 2 niveaux). Ordre = ordre d'affichage.
export const GROUPS: { label: string; ids: string[] }[] = [
  { label: "Cockpit", ids: ["overview"] },
  { label: "Commercial", ids: ["pipeline", "opplist"] },
  { label: "Revenu", ids: ["facturation", "invoicelist", "objectifs"] },
  { label: "Exécution", ids: ["orderlist", "backlog", "prevision", "simulator", "fp360"] },
  { label: "Rentabilité", ids: ["rentabilite", "pnlprojet", "fournisseurs", "bc"] },
  { label: "Référentiels", ids: ["clients", "domaines"] },
  { label: "Admin", ids: ["habilitations"] },
];
