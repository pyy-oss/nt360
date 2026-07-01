import { useState, type FormEvent } from "react";
import { signInWithEmailAndPassword } from "firebase/auth";
import { auth } from "../lib/firebase";
import { colors, fonts } from "../design/tokens";

// Écran de connexion (BUILD_KIT §8/§12). MFA profils sensibles ajouté en F8.
export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await signInWithEmailAndPassword(auth, email, password);
    } catch {
      setError("Identifiants invalides.");
    } finally {
      setBusy(false);
    }
  }

  const field: React.CSSProperties = {
    padding: "10px 12px",
    borderRadius: 8,
    border: `1px solid ${colors.panel}`,
    background: colors.panel,
    color: colors.ink,
    fontSize: 14,
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        background: colors.bg,
        color: colors.ink,
        fontFamily: fonts.body,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <form
        onSubmit={onSubmit}
        style={{
          background: colors.panel,
          padding: 32,
          borderRadius: 16,
          display: "flex",
          flexDirection: "column",
          gap: 12,
          width: 320,
          boxShadow: "0 8px 40px rgba(0,0,0,.4)",
        }}
      >
        <h1 style={{ fontFamily: fonts.display, color: colors.gold, margin: "0 0 8px", fontSize: 22 }}>
          Pilote Revenu NT CI
        </h1>
        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          style={field}
        />
        <input
          type="password"
          placeholder="Mot de passe"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          style={field}
        />
        {error && <div style={{ color: colors.clay, fontSize: 13 }}>{error}</div>}
        <button
          type="submit"
          disabled={busy}
          style={{
            padding: "10px 12px",
            borderRadius: 8,
            border: "none",
            background: colors.gold,
            color: colors.bg,
            fontWeight: 600,
            cursor: busy ? "default" : "pointer",
            opacity: busy ? 0.7 : 1,
          }}
        >
          {busy ? "Connexion…" : "Se connecter"}
        </button>
      </form>
    </div>
  );
}
