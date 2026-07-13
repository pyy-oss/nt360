// PRÉ-FACTURATION DEPUIS LE CRA (Lot 21 « 20/10 DirOps ») — génère une PROPOSITION de facturation
// mensuelle à partir des jours réellement FACTURÉS au CRA (Lot 15) et du TJM : montant HT = jours
// facturés × TJM. Le TJM retenu est celui de l'AFFECTATION couvrant le mois (tjmBilled, taux réellement
// contractualisé) quand il est connu et NON AMBIGU, sinon le TJM cible de l'annuaire (tjmTarget).
// VUE LECTURE SEULE : ne crée AUCUNE facture (les factures restent ingérées depuis la compta) — c'est
// un OUTIL DE CADRAGE que le Directeur des Opérations exporte et transmet à la facturation, pour ne pas
// oublier de facturer des jours consommés. Agrégé par consultant / BU / mois. Distinct du P&L (Lot 17)
// qui, lui, expose le coût/la marge (confidentiel) : ici, aucune donnée de coût.
//
// Fonctions PURES (aucun I/O) → testables.

function num(v) { const n = Number(v); return Number.isFinite(n) ? n : null; }

// TJM de l'affectation couvrant le mois pour ce consultant, quand il est exploitable. En cas d'AMBIGUÏTÉ
// (plusieurs affectations couvrantes à TJM DIFFÉRENTS), on ne devine pas : tjm=null + ambiguous=true, ce
// qui fait retomber l'appelant sur le TJM cible de l'annuaire. Retourne aussi une réf de mission (FP/label).
function coveringRate(assignments, consultantId, month) {
  const cov = (assignments || []).filter((a) =>
    a && a.consultantId === consultantId && a.startMonth <= month && a.endMonth >= month &&
    num(a.tjmBilled) != null && num(a.tjmBilled) > 0);
  if (!cov.length) return { tjm: null, ref: null, ambiguous: false };
  const rates = new Set(cov.map((a) => num(a.tjmBilled)));
  const a0 = cov[0];
  return { tjm: rates.size === 1 ? num(a0.tjmBilled) : null, ref: a0.projectFp || a0.label || null, ambiguous: rates.size > 1 };
}

// Une ligne de pré-facturation par (consultant, mois) où des jours ont été FACTURÉS au CRA.
// consultants: annuaire (id, name, bu, tjmTarget) ; timesheets: CRA mensuels ; assignments: plan de charge.
function computePreBilling(consultants, timesheets, assignments, months) {
  const monthSet = new Set(months || []);
  const byId = {};
  for (const c of consultants || []) byId[c.id] = c;
  const lines = [];
  for (const t of timesheets || []) {
    if (!t || !monthSet.has(t.month)) continue;
    const billed = num(t.billedDays) || 0;
    if (billed <= 0) continue; // rien de facturé ce mois → pas de ligne de pré-facturation
    const c = byId[t.consultantId] || {};
    const cover = coveringRate(assignments, t.consultantId, t.month);
    const tjmTarget = num(c.tjmTarget);
    // Priorité au taux CONTRACTUALISÉ (affectation) ; repli sur le TJM cible de l'annuaire.
    const tjm = cover.tjm != null ? cover.tjm : (tjmTarget != null && tjmTarget > 0 ? tjmTarget : null);
    const tjmSource = cover.tjm != null ? "assignment" : (tjm != null ? "target" : "none");
    const amountHt = tjm != null ? Math.round(billed * tjm) : 0;
    lines.push({
      consultantId: t.consultantId, name: c.name || t.consultantId, bu: c.bu || null,
      month: t.month, billedDays: billed, tjm, tjmSource, projectFp: cover.ref || null,
      amountHt, missingTjm: tjmSource === "none", ambiguousRate: cover.ambiguous,
    });
  }
  // Tri : mois le plus récent d'abord, puis montant décroissant.
  lines.sort((a, b) => (a.month < b.month ? 1 : a.month > b.month ? -1 : b.amountHt - a.amountHt));

  const agg = (keyFn) => {
    const m = {};
    for (const l of lines) {
      const k = keyFn(l) || "—";
      const g = m[k] || (m[k] = { key: k, billedDays: 0, amountHt: 0, lines: 0, missingTjm: 0 });
      g.billedDays += l.billedDays; g.amountHt += l.amountHt; g.lines += 1; if (l.missingTjm) g.missingTjm += 1;
    }
    return Object.values(m).sort((a, b) => b.amountHt - a.amountHt);
  };
  const global = {
    lines: lines.length,
    billedDays: lines.reduce((s, l) => s + l.billedDays, 0),
    amountHt: lines.reduce((s, l) => s + l.amountHt, 0),
    missingTjm: lines.filter((l) => l.missingTjm).length,
  };
  // byMonth trié chronologiquement (lisibilité de la proposition mois par mois).
  const byMonth = agg((l) => l.month).sort((a, b) => (a.key < b.key ? -1 : 1));
  return { global, lines, byConsultant: agg((l) => l.name), byBu: agg((l) => l.bu), byMonth };
}

module.exports = { computePreBilling, coveringRate };
