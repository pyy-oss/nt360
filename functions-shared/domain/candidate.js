// VIVIER / RECRUTEMENT (Lot 16 « 20/10 DirOps ») — pipeline de candidats rattaché au GAP DE CAPACITÉ
// (Lot 14) : quand une BU est en sous-capacité, le DirOps ouvre des postes ; ce vivier suit les candidats
// et estime la CAPACITÉ FUTURE attendue (embauches pondérées par l'avancement) → ferme la boucle
// « capacité ⇄ pipeline ⇄ recrutement ». Comble le dernier maillon du cockpit d'opérations d'ESN.
//
// Fonctions PURES (aucun I/O) → testables.

const GRADES = ["junior", "confirme", "senior", "expert", "manager"];
const CANDIDATE_STATUSES = ["sourced", "interview", "offer", "hired", "rejected"];
// Probabilité d'aboutir à une embauche selon l'avancement (pondération de la capacité future attendue).
const STAGE_WEIGHT = { sourced: 0.1, interview: 0.3, offer: 0.7, hired: 1, rejected: 0 };

function ym(v) { const s = String(v || "").trim(); return /^\d{4}-\d{2}$/.test(s) ? s : (/^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 7) : null); }
function num(v) { const n = Number(v); return Number.isFinite(n) && n >= 0 ? n : null; }

function validateCandidate(d) {
  const o = d || {};
  const name = String(o.name || "").trim().slice(0, 120);
  if (!name) return { ok: false, error: "nom requis" };
  const value = {
    name,
    gradeTarget: GRADES.includes(o.gradeTarget) ? o.gradeTarget : "confirme",
    bu: String(o.bu || "").trim().toUpperCase().slice(0, 40),
    skills: Array.isArray(o.skills) ? o.skills.map((s) => String(s).trim()).filter(Boolean).slice(0, 30) : [],
    tjmTarget: num(o.tjmTarget),
    status: CANDIDATE_STATUSES.includes(o.status) ? o.status : "sourced",
    expectedStartMonth: ym(o.expectedStartMonth),
    source: String(o.source || "").trim().slice(0, 80),
    notes: String(o.notes || "").trim().slice(0, 500),
  };
  return { ok: true, value };
}

// Un candidat est « en cours » s'il n'est ni embauché ni rejeté (dans le tunnel actif).
function isActive(c) { return c && c.status !== "hired" && c.status !== "rejected"; }

// Funnel de recrutement + capacité future attendue par BU (Σ pondération d'avancement des candidats
// non rejetés) → à rapprocher du gap de capacité (Lot 14) pour savoir si le vivier couvre le besoin.
function recruitmentFunnel(candidates) {
  const counts = { sourced: 0, interview: 0, offer: 0, hired: 0, rejected: 0 };
  const buMap = {};
  for (const c of candidates || []) {
    const st = CANDIDATE_STATUSES.includes(c.status) ? c.status : "sourced";
    counts[st] += 1;
    if (st === "rejected") continue;
    const k = c.bu || "—";
    const b = buMap[k] || (buMap[k] = { bu: k, active: 0, expectedHires: 0 });
    if (st !== "hired") b.active += 1;
    b.expectedHires += STAGE_WEIGHT[st] || 0;
  }
  const byBu = Object.values(buMap).map((b) => ({ ...b, expectedHires: +b.expectedHires.toFixed(1) })).sort((a, b) => b.expectedHires - a.expectedHires);
  const inPipeline = counts.sourced + counts.interview + counts.offer;
  return { counts, byBu, inPipeline };
}

module.exports = { GRADES, CANDIDATE_STATUSES, STAGE_WEIGHT, validateCandidate, isActive, recruitmentFunnel };
