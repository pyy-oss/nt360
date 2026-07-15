// Module « Contrats de maintenance » (mnt_) — Lot 0 : SOCLE ÉTEINT.
// Cette coquille n'existe que pour ancrer le module dans la navigation (registre MODULES) derrière
// le drapeau config/mntFeature. À drapeau éteint (défaut), l'onglet est masqué par App et ce
// composant n'est jamais monté : l'ERP est STRICTEMENT celui d'avant. Le contenu réel arrive aux
// lots suivants (contrat & SLA, tickets, échéancier, risque). Aucune donnée, aucun appel ici.
import { type FC } from "react";
import { Card, Tip } from "../design/components";
import type { Props } from "./_shared";

export const Maintenance: FC<Props> = () => (
  <div className="flex flex-col gap-4">
    <Card title="Contrats de maintenance">
      <Tip>Module en cours de déploiement. Les contrats, engagements SLA et échéanciers arriveront
        dans les prochains lots. Aucune donnée n'est encore gérée ici.</Tip>
    </Card>
  </div>
);
