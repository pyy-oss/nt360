// OBJET COMPTE (Account) — socle relationnel « niveau Salesforce ». Le compte est l'entité stable qui
// raccroche opportunités / commandes / factures / contacts. Il est CLÉ sur le nom client CANONIQUE
// (même chaîne que le champ `client` normalisé partout par buildClientResolver) → jointure directe,
// sans migration des enregistrements existants. Module PUR (testable).
const { canonicalKey } = require("./clientName");

// ID de compte déterministe : nom canonique → slug Firestore-safe (espaces → « _ », pas de « / »).
// On slugifie plutôt que supprimer les espaces pour éviter les collisions (« AB C » ≠ « ABC »).
function accountId(clientName) {
  const k = canonicalKey(clientName);
  return k ? k.replace(/\s+/g, "_") : "";
}

// Rôles de contact proposés (référentiel léger, non bloquant — champ libre côté saisie).
const CONTACT_ROLES = ["Décideur", "Signataire", "Utilisateur", "Technique", "Achat", "Finance", "Autre"];

module.exports = { accountId, CONTACT_ROLES };
