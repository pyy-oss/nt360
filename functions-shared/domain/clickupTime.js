// AUTO-CRA DEPUIS CLICKUP (Lot 20 « 20/10 DirOps ») — agrège les entrées de temps ClickUp (time entries)
// par CONSULTANT et par MOIS en jours facturés, pour pré-remplir le CRA (Lot 15) sans double saisie.
// Correspondance consultant ↔ utilisateur ClickUp via `clickupUserId` (Lot 20). Conversion ms → jours
// via une durée de journée paramétrable (défaut 8 h). Fonction PURE (aucun I/O) → testable.

const HOURS_PER_DAY = 8;

// entry ClickUp : { user: { id }, duration (ms, string|number), start (ms epoch, string|number) }.
// userToConsultant : { [clickupUserId]: consultantId }. monthsSet : Set des mois AAAA-MM à retenir.
function aggregateTime(entries, userToConsultant, monthsSet, hoursPerDay = HOURS_PER_DAY) {
  const map = {};           // clé `${consultantId}|${month}` → ms cumulés
  const msPerDay = hoursPerDay * 3600 * 1000;
  for (const e of entries || []) {
    const uid = e && e.user && e.user.id != null ? String(e.user.id) : null;
    const cid = uid && userToConsultant ? userToConsultant[uid] : null;
    if (!cid) continue;
    const startMs = Number(e.start);
    const dur = Number(e.duration);
    if (!Number.isFinite(startMs) || !Number.isFinite(dur) || dur <= 0) continue;
    const d = new Date(startMs);
    const month = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    if (monthsSet && !monthsSet.has(month)) continue;
    map[`${cid}|${month}`] = (map[`${cid}|${month}`] || 0) + dur;
  }
  return Object.entries(map).map(([k, ms]) => {
    const [consultantId, month] = k.split("|");
    // Arrondi au 1/2 jour (granularité CRA usuelle), borné à 31.
    const billedDays = Math.min(31, Math.round(ms / msPerDay * 2) / 2);
    return { consultantId, month, billedDays };
  }).sort((a, b) => a.consultantId.localeCompare(b.consultantId) || a.month.localeCompare(b.month));
}

module.exports = { HOURS_PER_DAY, aggregateTime };
