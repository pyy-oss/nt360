// MFA / 2FA (BUILD_KIT §8, F8) — remplace le « code admin » du prototype.
// Enrôlement TOTP (authenticator app). Recommandé pour les profils sensibles
// (direction, achats). Nécessite l'activation de la MFA dans la console Firebase Auth.
import {
  multiFactor,
  TotpMultiFactorGenerator,
  type MultiFactorUser,
  type TotpSecret,
} from "firebase/auth";
import { auth } from "./firebase";

/** Démarre l'enrôlement TOTP : renvoie le secret (à afficher en QR/clé). */
export async function startTotpEnrollment(): Promise<{ secret: TotpSecret; uri: string; mfa: MultiFactorUser }> {
  const user = auth.currentUser;
  if (!user) throw new Error("connexion requise");
  const mfa = multiFactor(user);
  const session = await mfa.getSession();
  const secret = await TotpMultiFactorGenerator.generateSecret(session);
  const uri = secret.generateQrCodeUrl(user.email || "user", "Pilote Revenu NT CI");
  return { secret, uri, mfa };
}

/** Finalise l'enrôlement avec le code à 6 chiffres de l'app d'authentification. */
export async function finalizeTotpEnrollment(mfa: MultiFactorUser, secret: TotpSecret, code: string, displayName = "TOTP") {
  const assertion = TotpMultiFactorGenerator.assertionForEnrollment(secret, code);
  await mfa.enroll(assertion, displayName);
}

/** Indique si l'utilisateur courant a au moins un second facteur enrôlé. */
export function hasMfa(): boolean {
  const user = auth.currentUser;
  return !!user && multiFactor(user).enrolledFactors.length > 0;
}
