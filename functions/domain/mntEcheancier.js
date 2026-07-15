// Domain PUR — Échéancier de facturation d'un contrat de maintenance (mnt_), Lot 3. Aucun I/O.
// Compare l'ENGAGÉ à ce jour (montantEngage = montant PAR ÉCHÉANCE × échéances dues depuis dateDebut,
// selon la périodicité) au FACTURÉ réel (Σ factures de l'affaire par N° FP — l'ERP reste la source de
// la facturation, ADR-005). Montants ENTIERS XOF (FCFA sans subdivision). Dates ISO AAAA-MM-JJ.
const PERIOD_MONTHS = { mensuel: 1, trimestriel: 3, annuel: 12 };

const parse = (iso) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || "")); return m ? { y: +m[1], mo: +m[2], d: +m[3] } : null; };
// Nombre de mois entiers écoulés de `a` à `b` (b ≥ a) — sert au décompte des échéances dues.
function monthsBetween(aIso, bIso) {
  const a = parse(aIso), b = parse(bIso);
  if (!a || !b) return 0;
  let m = (b.y - a.y) * 12 + (b.mo - a.mo);
  if (b.d < a.d) m -= 1; // mois non révolu si le jour n'est pas atteint
  return Math.max(0, m);
}

/**
 * Échéancier d'un contrat à la date `asOfIso`. `factureTotal` = Σ factures HT de l'affaire.
 * → { periodsDue, engage, facture, ecart } — tout en entier XOF. `ecart` > 0 = sous-facturation.
 */
function echeancier(contrat, factureTotal, asOfIso) {
  const c = contrat || {};
  const per = PERIOD_MONTHS[c.echeanceType] || 1;
  const montant = Math.max(0, Math.round(Number(c.montantEngage) || 0));
  let periodsDue = 0;
  if (parse(c.dateDebut)) {
    // Échéance émise en début de chaque période, la 1ʳᵉ à dateDebut → +1.
    periodsDue = Math.floor(monthsBetween(c.dateDebut, asOfIso) / per) + 1;
    // Borne par la durée du contrat si une date de fin est posée.
    if (parse(c.dateFin)) {
      const total = Math.floor(monthsBetween(c.dateDebut, c.dateFin) / per) + 1;
      periodsDue = Math.min(periodsDue, Math.max(0, total));
    }
    periodsDue = Math.max(0, periodsDue);
  }
  const engage = periodsDue * montant;
  const facture = Math.max(0, Math.round(Number(factureTotal) || 0));
  return { periodsDue, engage, facture, ecart: engage - facture };
}

module.exports = { PERIOD_MONTHS, monthsBetween, echeancier };
