// Formatage PUR sans dépendance (testable).

// Millisecondes d'un Timestamp Firestore ({toMillis} ou {seconds}) — 0 si inconnu.
export function tsMillis(ts: any): number {
  return ts?.toMillis ? ts.toMillis() : ts?.seconds ? ts.seconds * 1000 : 0;
}

// Âge en jours (entier) depuis un Timestamp, relatif à `nowMs`. -1 si le timestamp est inconnu
// (distingue « pas de données » de « 0 jour »). PUR (nowMs injecté) → testable.
export function ageDays(ts: any, nowMs: number): number {
  const ms = tsMillis(ts);
  if (!ms) return -1;
  return Math.floor((nowMs - ms) / 86_400_000);
}

// Temps relatif à partir d'un Timestamp Firestore ({toMillis} ou {seconds}) → « il y a … ».
export function relTime(ts: any): string {
  const ms = tsMillis(ts);
  if (!ms) return "";
  const d = Date.now() - ms;
  const m = Math.floor(d / 60000);
  if (m < 1) return "à l'instant";
  if (m < 60) return `il y a ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `il y a ${h} h`;
  return `il y a ${Math.floor(h / 24)} j`;
}
