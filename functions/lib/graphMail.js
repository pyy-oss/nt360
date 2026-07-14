// Envoi d'emails via Microsoft Graph (Office 365). Auth OAuth2 « client_credentials » (app Azure AD
// avec la permission d'application Mail.Send) : aucun mot de passe utilisateur, pérenne (contrairement à
// SMTP basique déprécié par Microsoft). Le secret client vit dans Secret Manager (GRAPH_CLIENT_SECRET).
//
// `fetchImpl` est injectable pour les tests (par défaut le fetch global de Node 18+). Le jeton est mis en
// cache EN MÉMOIRE par processus (durée ~1 h) : on ne redemande un jeton qu'à l'expiration.
const GRAPH = "https://graph.microsoft.com/v1.0";
const LOGIN = "https://login.microsoftonline.com";

let _tokenCache = null; // { token, expMs, key } — clé = tenant|clientId pour invalider si la conf change.

async function getToken({ tenant, clientId, clientSecret, fetchImpl, nowMs }) {
  const now = typeof nowMs === "number" ? nowMs : Date.now();
  const key = `${tenant}|${clientId}`;
  if (_tokenCache && _tokenCache.key === key && _tokenCache.expMs - 60_000 > now) return _tokenCache.token;
  const f = fetchImpl || fetch;
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    scope: "https://graph.microsoft.com/.default",
    grant_type: "client_credentials",
  });
  const res = await f(`${LOGIN}/${encodeURIComponent(tenant)}/oauth2/v2.0/token`, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: body.toString(),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) throw new Error(`Graph token HTTP ${res.status} — ${data.error_description || data.error || "jeton refusé"}`);
  _tokenCache = { token: data.access_token, expMs: now + (Number(data.expires_in) || 3600) * 1000, key };
  return data.access_token;
}

// Réinitialise le cache de jeton (tests / rotation de secret).
function _resetTokenCache() { _tokenCache = null; }

/**
 * Envoie un email HTML. `to` : string ou liste d'adresses. Lève sur échec (l'appelant journalise).
 * @param {{tenant,clientId,clientSecret,sender,to,subject,html,cc?,fetchImpl?,nowMs?}} o
 *   `sender` : UPN/adresse de la boîte émettrice (l'app doit avoir Mail.Send sur cette boîte).
 */
async function sendMail(o) {
  const { tenant, clientId, clientSecret, sender, to, subject, html, cc, fetchImpl, nowMs } = o;
  const recips = (Array.isArray(to) ? to : [to]).map((x) => String(x || "").trim()).filter(Boolean);
  if (!recips.length) return { ok: false, skipped: "no-recipient" };
  const token = await getToken({ tenant, clientId, clientSecret, fetchImpl, nowMs });
  const f = fetchImpl || fetch;
  const message = {
    subject: String(subject || "").slice(0, 255),
    body: { contentType: "HTML", content: String(html || "") },
    toRecipients: recips.map((a) => ({ emailAddress: { address: a } })),
  };
  const ccList = (Array.isArray(cc) ? cc : cc ? [cc] : []).map((x) => String(x || "").trim()).filter(Boolean);
  if (ccList.length) message.ccRecipients = ccList.map((a) => ({ emailAddress: { address: a } }));
  const res = await f(`${GRAPH}/users/${encodeURIComponent(sender)}/sendMail`, {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ message, saveToSentItems: false }),
  });
  if (res.status !== 202) {
    const t = await res.text().catch(() => "");
    throw new Error(`Graph sendMail HTTP ${res.status} — ${t.slice(0, 300)}`);
  }
  return { ok: true, sent: recips.length };
}

module.exports = { getToken, sendMail, _resetTokenCache };
