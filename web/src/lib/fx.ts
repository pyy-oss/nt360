// Parités fixes légales — SOURCE UNIQUE côté front (miroir de functions/lib/fx.js, peg EUR 655,957).
// Repli quand aucun taux n'est paramétré dans config/fxRates. Toute vue qui affiche/convertit une
// contre-valeur XOF passe par cette constante : une 3e copie locale (fiches, import BC…) finirait
// par diverger du serveur (audit rentabilité RB2 — le peg vivait en double dans operations/fiches).
export const FIXED_PEG: Record<string, number> = { EUR: 655.957, XAF: 1 };
