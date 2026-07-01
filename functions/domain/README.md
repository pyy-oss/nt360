# domain/ — calculs métier purs (BUILD_KIT §7)

Fonctions **pures** (aucune dépendance Firebase) partagées entre ingestion et agrégation,
et cibles des **tests de non-régression chiffrés** (§18).

| Fichier | Rôle | Phase |
|---------|------|-------|
| `chaine.js` | Opportunités→Certitudes→Commandes(CAS)→Facturé→Backlog(RAF), taux facturation | F3 |
| `backlog.js` | Backlog ancré FY (`config/fiscal.currentFy`), ventilations indépendantes de la période | F3 |
| `pipeline.js` | Funnel pondéré Σ(montant×proba), conversion, phasage par mois de closing | F3 |
| `fournisseurs.js` | Exposition, achat commandes ouvertes, encours (Σ BC non soldés), couverture, reco | F3 |
| `projet.js` | P&L projet : coût/vente/marge/%MB, contrôle vs `orders.cas` | F3 |
| `atterrissage.js` | Réalisé CAS(FY) + backlog + pipeline pondéré → vs objectifs, écart | F7 |

> Créés en F3/F7. Les valeurs de contrôle du §18 deviennent des assertions Vitest dans `functions/test/`.
