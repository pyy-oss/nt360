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

export function useRecordScope(obj: RecordObj): { constraints: QueryConstraint[]; scoped: boolean } {
  const { data } = useDocData<Partial<Record<RecordObj, string>>>("config/recordAccess");
  const { user, role } = useClaims();
  const habil = useCan("habilitations"); // appelé inconditionnellement (règles des hooks)
  const admin = role === "direction" || habil === "write";
  const priv = data?.[obj] === "private";
  if (priv && !admin && user?.uid) return { constraints: [where("visibleTo", "array-contains", user.uid)], scoped: true };
  return { constraints: [], scoped: false };
}
