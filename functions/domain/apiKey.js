// API REST PUBLIQUE (Lot 7 « niveau Salesforce ») — utilitaires PURS de l'API : hachage des clés,
// extraction du jeton Bearer, routage. Comble l'écart #7 de l'audit (aucune API/webhooks pour
// intégrer nt360 à un SI tiers). La clé brute (nt360_<hex>) n'est JAMAIS stockée : seul son SHA-256
// l'est (apiKeys/*.hash), comparé à l'entrée. Testable (hachage déterministe, routage pur).
const crypto = require("crypto");

// SHA-256 hex d'une clé (déterministe). Le stockage ne garde que ce hash.
function hashApiKey(raw) {
  return crypto.createHash("sha256").update(String(raw || "")).digest("hex");
}

// Extrait le jeton d'un en-tête « Authorization: Bearer <token> » (insensible à la casse). null sinon.
function parseBearer(header) {
  const m = /^Bearer\s+(.+)$/i.exec(String(header || "").trim());
  return m ? m[1].trim() : null;
}

// Ressources exposées par l'API v1.
const API_RESOURCES = ["opportunities", "accounts"];

// Route une requête (méthode + chemin) → { action, resource, id } ou null si non gérée.
//  GET /v1/{resource}            → list
//  GET /v1/{resource}/{id}       → get
//  POST /v1/opportunities        → create (opportunités uniquement en v1)
function matchRoute(method, pathname) {
  const parts = String(pathname || "").replace(/^\/+|\/+$/g, "").split("/").filter(Boolean);
  if (parts[0] !== "v1" || !API_RESOURCES.includes(parts[1])) return null;
  const resource = parts[1];
  const id = parts[2] ? decodeURIComponent(parts[2]) : null;
  if (parts.length > 3) return null;
  if (method === "GET") return { action: id ? "get" : "list", resource, id };
  if (method === "POST" && !id && resource === "opportunities") return { action: "create", resource, id: null };
  return null;
}

module.exports = { hashApiKey, parseBearer, matchRoute, API_RESOURCES };
