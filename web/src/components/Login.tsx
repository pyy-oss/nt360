import { useState, type FormEvent } from "react";
import { signInWithEmailAndPassword, sendPasswordResetEmail } from "firebase/auth";
import { auth } from "../lib/firebase";

// Écran de connexion (BUILD_KIT §8/§12). MFA profils sensibles en F8.
export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await signInWithEmailAndPassword(auth, email, password);
    } catch (err: any) {
      const code = String(err?.code || "");
      setError(code.includes("too-many") ? "Trop de tentatives — réessayez plus tard." : "Identifiants invalides.");
    } finally {
      setBusy(false);
    }
  }

  // Réinitialisation par email (Firebase Auth) : pour les profils non techniques (assistantes,
  // commerciaux) qui n'ont pas d'autre issue en cas d'oubli. Message NEUTRE (ne révèle pas si le compte
  // existe) — Firebase envoie le mail si le compte existe. On exige juste un email saisi.
  async function onReset() {
    const addr = email.trim();
    if (!addr) { setError("Saisissez votre email ci-dessus, puis « Mot de passe oublié »."); return; }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await sendPasswordResetEmail(auth, addr);
      setNotice("Si un compte existe pour cet email, un lien de réinitialisation vient d'être envoyé.");
    } catch (err: any) {
      const code = String(err?.code || "");
      // On reste neutre sauf sur un email mal formé (erreur de saisie utile à corriger).
      if (code.includes("invalid-email")) setError("Email invalide.");
      else setNotice("Si un compte existe pour cet email, un lien de réinitialisation vient d'être envoyé.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen grid place-items-center p-4 sm:p-6">
      <form onSubmit={onSubmit} className="card w-full max-w-[340px] p-6 sm:p-8 flex flex-col gap-3">
        <div className="flex items-center gap-3 mb-2">
          <div className="grid place-items-center w-9 h-9 rounded-[10px] font-display font-bold text-bg text-lg" style={{ background: "linear-gradient(135deg,#C9A24B,#8E6F2A)" }}>N</div>
          <div>
            <div className="font-display font-bold text-lg leading-none">Neurones 360</div>
            <div className="text-[11px] text-muted mt-0.5">Neurones Technologies CI</div>
          </div>
        </div>
        <label className="text-xs text-muted" htmlFor="login-email">Email</label>
        <input id="login-email" className="field -mt-1" type="email" autoComplete="email" placeholder="prenom.nom@exemple.ci" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
        <label className="text-xs text-muted" htmlFor="login-pwd">Mot de passe</label>
        <input id="login-pwd" className="field -mt-1" type="password" autoComplete="current-password" placeholder="Mot de passe" value={password} onChange={(e) => setPassword(e.target.value)} required />
        {error && <div className="text-clay text-[13px]" role="alert">{error}</div>}
        {notice && <div className="text-emerald text-[13px]" role="status">{notice}</div>}
        <button type="submit" className="btn-gold mt-1" disabled={busy}>{busy ? "Connexion…" : "Se connecter"}</button>
        <button type="button" onClick={onReset} disabled={busy} className="text-[12px] text-muted hover:text-gold underline underline-offset-2 self-center mt-0.5 disabled:opacity-50">Mot de passe oublié ?</button>
      </form>
    </div>
  );
}
