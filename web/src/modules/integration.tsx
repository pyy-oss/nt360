// Onglet ADMIN — Intégration : regroupe tous les branchements externes de l'ERP (webhook entrant Odoo,
// webhook sortant, API REST publique + clés, champs custom, automatisations, notifications Slack/Teams,
// e-mail Office 365). DÉPLACÉ depuis Habilitations (ADR-048) pour désengorger la page et donner un point
// d'entrée dédié aux intégrations. MÊMES cartes, MÊMES callables, MÊME garde direction-only : le déplacement
// est présentationnel et n'élargit PAS qui configure les intégrations (URLs/secrets sensibles).
import { type FC, type ReactNode } from "react";
import { useClaims } from "../lib/rbac";
import { Eyebrow, EmptyState } from "../design/components";
import { Props } from "./_shared";
import { OdooWebhookCard, OutboundWebhookCard, ApiKeysCard, CustomFieldsCard, AutomationCard, NotificationCard, EmailNotifyCard } from "./admin";

const Section: FC<{ children: ReactNode }> = ({ children }) => (
  <div className="border-t border-line/50 pt-3 mt-1 first:border-t-0 first:pt-0 first:mt-0"><Eyebrow as="h2">{children}</Eyebrow></div>
);

export const Integration: FC<Props> = () => {
  // Garde direction-only stricte, identique à l'ancien emplacement (Habilitations) : les intégrations
  // portent des URLs/secrets sensibles et ne se configurent que par la direction. Aucun élargissement.
  const isDirection = useClaims().role === "direction";
  if (!isDirection) return <EmptyState label="Réservé à la Direction — les intégrations (webhooks Odoo/sortant, API publique, champs custom, automatisations, notifications) se configurent depuis un compte Direction." />;
  return (
    <div className="flex flex-col gap-4">
      <Section>Webhooks & API</Section>
      <OdooWebhookCard />
      <OutboundWebhookCard />
      <ApiKeysCard />
      <Section>Champs & automatisations</Section>
      <CustomFieldsCard />
      <AutomationCard />
      <Section>Notifications</Section>
      <NotificationCard />
      <EmailNotifyCard />
    </div>
  );
};
