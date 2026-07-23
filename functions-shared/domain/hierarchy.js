// HIÉRARCHIE DE RÔLES (sécurité par enregistrement, Lot 2 — modèle « Propriétaire + hiérarchie »,
// standard Salesforce). Un enregistrement est visible par son PROPRIÉTAIRE et par toute sa LIGNE
// HIÉRARCHIQUE ascendante (manager, manager du manager, …). On matérialise cette liste sur chaque
// enregistrement (`visibleTo`) pour que les Security Rules et les requêtes client soient O(1)
// (`array-contains uid`) — sans traversée récursive impossible en rules.
//
// Fonctions PURES (aucun accès I/O) → testables unitairement. La map d'entrée associe un uid à sa
// fiche { managerUid } (extraite de users/*).

// Chaîne ascendante d'un propriétaire : [ownerUid, manager, manager du manager, …].
// - déduplication (un même uid n'apparaît qu'une fois) ;
// - garde-fou anti-cycle (A→B→A) : on arrête dès qu'un uid est revu ;
// - plafond de profondeur (défense en profondeur contre une hiérarchie corrompue très profonde).
// ownerUid absent/vide → [] (enregistrement SANS propriétaire : sous OWD « privé », visible des seuls
// administrateurs — cf. rules ; sous OWD « public », visible de tout rôle habilité au module).
function ownerChain(usersMap, ownerUid, cap = 12) {
  const owner = ownerUid ? String(ownerUid) : "";
  if (!owner) return [];
  const map = usersMap || {};
  const chain = [];
  const seen = new Set();
  let cur = owner;
  while (cur && !seen.has(cur) && chain.length < cap) {
    seen.add(cur);
    chain.push(cur);
    const mgr = map[cur] && map[cur].managerUid ? String(map[cur].managerUid) : "";
    cur = mgr && mgr !== cur ? mgr : "";
  }
  return chain;
}

// Descendants d'un uid (lui-même + tous ceux dont il est, directement ou transitivement, le manager).
// Sert au ré-indexage : quand la hiérarchie change (setManager) ou qu'un propriétaire est réaffecté,
// c'est l'ensemble des enregistrements dont la `visibleTo` doit être recalculée. Anti-cycle par `seen`.
function descendants(usersMap, rootUid) {
  const root = rootUid ? String(rootUid) : "";
  if (!root) return [];
  const map = usersMap || {};
  // Index inverse manager → [subordonnés].
  const children = {};
  for (const uid of Object.keys(map)) {
    const mgr = map[uid] && map[uid].managerUid ? String(map[uid].managerUid) : "";
    if (mgr) (children[mgr] = children[mgr] || []).push(uid);
  }
  const out = [];
  const seen = new Set();
  const stack = [root];
  while (stack.length) {
    const u = stack.pop();
    if (seen.has(u)) continue;
    seen.add(u);
    out.push(u);
    for (const c of children[u] || []) if (!seen.has(c)) stack.push(c);
  }
  return out;
}

module.exports = { ownerChain, descendants };
