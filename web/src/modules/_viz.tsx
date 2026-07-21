// Primitives de VISUALISATION des entêtes cockpit (Qualité & correction, Contrats, ClickUp…) —
// séparées de _shared pour rester HORS du chunk d'entrée (budget ≤ 122 Ko) : importées uniquement
// par des modules lazy, elles vivent dans un chunk partagé asynchrone. Une seule implémentation,
// même rendu partout (vocabulaire visuel unique).

// Sparkline SVG minimaliste (aucune dépendance chart). points ∈ [0,1].
export function Spark({ points }: { points: number[] }) {
  if (points.length < 2) return null;
  const w = 160, h = 32, n = points.length;
  const d = points.map((v, i) => `${(i / (n - 1)) * w},${h - Math.max(0, Math.min(1, v)) * h}`).join(" ");
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="text-gold" aria-hidden="true">
      <polyline points={d} fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

// Anneau de score compact (conic-gradient) — score de complétude, santé du parc, couverture d'intégration…
export function ScoreRing({ value, color }: { value: number; color: string }) {
  const v = Math.max(0, Math.min(1, value));
  const deg = Math.round(v * 360);
  return (
    <div className="relative shrink-0" style={{ width: 68, height: 68 }} aria-hidden>
      <div className="absolute inset-0 rounded-full" style={{ background: `conic-gradient(${color} ${deg}deg, rgb(var(--hair)) ${deg}deg)` }} />
      <div className="absolute inset-[6px] rounded-full bg-panel flex items-center justify-center">
        <span className="font-display tabnum text-lg leading-none" style={{ color }}>{Math.round(v * 100)}</span>
      </div>
    </div>
  );
}
