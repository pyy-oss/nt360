// TAUX DE COUVERTURE DE LA BASE CLIENT (audit DC/DG, B4) — part des clients de la BASE DE RÉFÉRENCE qui
// sont ACTIFS (au moins une commande signée, CAS > 0). La base = union PERSISTANTE des clients CANONIQUES
// connus (normalisation des agrégats aujourd'hui, `config/clientsRef` ; Odoo enverra les nouveaux clients
// ensuite). ADDITIVE : un client churné reste dans la base → dénominateur STABLE (sinon le taux ne mesurerait
// que les clients encore vus). PURE (aucun état) → testable.
//
// - actifs   : clients de la base avec ≥ 1 commande (CAS > 0) — la vraie « couverture » commerciale.
// - prospects: clients VUS (facture/opp) mais SANS commande — connus, pas encore convertis en carnet.
// - inactifs : clients de la base ABSENTS des agrégats courants — churn, ou client Odoo sans activité (Phase 2).
function clientCoverage(baseKeys, activeKeys, seenKeys) {
  const base = new Set(baseKeys || []);
  const active = new Set((activeKeys || []).filter((k) => base.has(k)));
  const seen = new Set((seenKeys || []).filter((k) => base.has(k)));
  const b = base.size;
  const actifs = active.size;
  const prospects = [...seen].filter((k) => !active.has(k)).length; // vus (facture/opp) mais sans commande
  const inactifs = b - seen.size;                                    // dans la base, absents des agrégats courants
  return { base: b, actifs, prospects, inactifs, couverture: b > 0 ? actifs / b : 0 };
}

module.exports = { clientCoverage };
