import { colors, fonts } from "./design/tokens";

// F0 : SPA socle (coquille vide). Les 13 modules arrivent en F4 (parité prototype).
export default function App() {
  return (
    <div
      style={{
        minHeight: "100vh",
        background: colors.bg,
        color: colors.ink,
        fontFamily: fonts.body,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 12,
        padding: 24,
        textAlign: "center",
      }}
    >
      <h1 style={{ fontFamily: fonts.display, color: colors.gold, margin: 0 }}>
        Pilote Revenu NT CI
      </h1>
      <p style={{ opacity: 0.8, maxWidth: 520 }}>
        Socle F0 — cockpit 100% Firebase serverless. Les 13 modules (parité prototype) sont
        livrés à partir de la phase F4.
      </p>
    </div>
  );
}
