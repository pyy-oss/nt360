import { useState, type FormEvent } from "react";
import { signInWithEmailAndPassword } from "firebase/auth";
import { auth } from "../lib/firebase";

// Écran de connexion (BUILD_KIT §8/§12). MFA profils sensibles en F8.
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
    } catch (err: any) {
      const code = String(err?.code || "");
      setError(code.includes("too-many") ? "Trop de tentatives — réessaie plus tard." : "Identifiants invalides.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen grid place-items-center p-6">
      <form onSubmit={onSubmit} className="card w-[340px] p-8 flex flex-col gap-3">
        <div className="flex items-center gap-3 mb-2">
          <div className="grid place-items-center w-9 h-9 rounded-[10px] font-display font-bold text-bg text-lg" style={{ background: "linear-gradient(135deg,#C9A24B,#8E6F2A)" }}>N</div>
          <div>
            <div className="font-display font-bold text-lg leading-none">Pilote Revenu</div>
            <div className="text-[11px] text-muted mt-0.5">Neurones Technologies CI</div>
          </div>
        </div>
        <input className="field" type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
        <input className="field" type="password" placeholder="Mot de passe" value={password} onChange={(e) => setPassword(e.target.value)} required />
        {error && <div className="text-clay text-[13px]">{error}</div>}
        <button type="submit" className="btn-gold mt-1" disabled={busy}>{busy ? "Connexion…" : "Se connecter"}</button>
      </form>
    </div>
  );
}
