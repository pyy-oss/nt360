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
  // Contrat NON ENCORE DÉMARRÉ (asOf < dateDebut) → 0 échéance due : monthsBetween est bornée à 0, donc
  // sans cette garde un contrat actif à date de début future compterait déjà 1 échéance (fausse sous-
  // facturation — audit Lot 5). Comparaison lexicographique sûre sur des ISO AAAA-MM-JJ.
  if (parse(c.dateDebut) && String(asOfIso) >= String(c.dateDebut)) {
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

// Ajoute `n` mois à une date ISO (jour ramené au dernier du mois si dépassement). PUR. Sert à dater
// chaque échéance de l'échéancier détaillé (dateDebut + i × périodicité).
function addMonthsIso(iso, n) {
  const p = parse(iso);
  if (!p) return null;
  let y = p.y, mo = (p.mo - 1) + n, d = p.d;
  y += Math.floor(mo / 12); mo = ((mo % 12) + 12) % 12;
  const last = new Date(Date.UTC(y, mo + 1, 0)).getUTCDate(); // dernier jour du mois cible
  if (d > last) d = last;
  return `${y}-${String(mo + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

const MAX_PERIODS = 240; // borne d'affichage (20 ans en mensuel) — anti-liste démesurée

/**
 * Échéancier DÉTAILLÉ : la liste datée des échéances de facturation d'un contrat, chacune marquée
 * `facture` (couverte par le facturé cumulé de l'affaire), `du` (échéance passée non couverte) ou
 * `a_venir`. Modèle de couverture CUMULATIF (sans allocation facture↔période inventée) : la 1ʳᵉ échéance
 * dont l'engagé cumulé dépasse le facturé total est la 1ʳᵉ non couverte. Agrégats identiques à `echeancier`.
 * Sans date de fin : on ne liste QUE les échéances dues (aucune projection spéculative).
 * @returns {{periods:{index,dateEcheance,montant,cumulEngage,statut}[], periodsDue, engage, facture, ecart}}
 */
function echeancierPlan(contrat, factureTotal, asOfIso) {
  const c = contrat || {};
  const per = PERIOD_MONTHS[c.echeanceType] || 1;
  const montant = Math.max(0, Math.round(Number(c.montantEngage) || 0));
  const agg = echeancier(c, factureTotal, asOfIso); // réutilise le décompte/agrégats (parité stricte)
  let total = agg.periodsDue;
  if (parse(c.dateDebut) && parse(c.dateFin)) {
    total = Math.max(0, Math.floor(monthsBetween(c.dateDebut, c.dateFin) / per) + 1);
  }
  total = Math.min(Math.max(0, total), MAX_PERIODS);
  const periods = [];
  for (let i = 0; i < total; i++) {
    const dateEcheance = addMonthsIso(c.dateDebut, i * per);
    const cumulEngage = (i + 1) * montant;
    let statut;
    if (cumulEngage <= agg.facture) statut = "facture";        // couverte par le facturé cumulé
    else if (dateEcheance && String(dateEcheance) <= String(asOfIso)) statut = "du"; // passée, non couverte
    else statut = "a_venir";
    periods.push({ index: i + 1, dateEcheance, montant, cumulEngage, statut });
  }
  return { periods, periodsDue: agg.periodsDue, engage: agg.engage, facture: agg.facture, ecart: agg.ecart };
}

module.exports = { PERIOD_MONTHS, monthsBetween, echeancier, addMonthsIso, echeancierPlan };
