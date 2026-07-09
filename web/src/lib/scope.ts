// Cadrage des requêtes d'ENREGISTREMENTS selon la sécurité par enregistrement (Lot 2 « niveau
// Salesforce » — propriétaire + hiérarchie). L'OWD (config/recordAccess) décide :
//  - « public » (défaut) OU administrateur (direction / droit « habilitations ») → aucune contrainte,
//    tout est visible (comportement historique inchangé) ;
//  - « private » pour un non-administrateur → contrainte `array-contains` sur `visibleTo` (champ
//    tableau AUTO-indexé par Firestore : aucun index composite requis). La règle Firestore exige alors
//    cette contrainte (sinon la requête est refusée) — d'où un cadrage systématique de toutes les
//    requêtes d'opportunités côté client.
import { where, type QueryConstraint } from "firebase/firestore";
import { useDocData } from "./hooks";
import { useClaims, useCan } from "./rbac";

export type RecordObj = "opportunities" | "accounts";

export function useRecordScope(obj: RecordObj): { constraints: QueryConstraint[]; scoped: boolean; ready: boolean } {
  const { data, loading } = useDocData<Partial<Record<RecordObj, string>>>("config/recordAccess");
  const { user, role } = useClaims();
  const habil = useCan("habilitations"); // appelé inconditionnellement (règles des hooks)
  const admin = role === "direction" || habil === "write";
  // `ready` = OWD connu ET utilisateur authentifié. TANT que l'OWD n'est pas résolu, on NE connaît pas
  // encore la contrainte : émettre la requête sans `visibleTo` la ferait refuser (permission-denied) sous
  // OWD « private ». Les appelants diffèrent donc l'abonnement (nom de collection null) jusqu'à `ready`.
  const ready = !loading && !!user?.uid;
  const priv = data?.[obj] === "private";
  if (priv && !admin && user?.uid) return { constraints: [where("visibleTo", "array-contains", user.uid)], scoped: true, ready };
  return { constraints: [], scoped: false, ready };
}
