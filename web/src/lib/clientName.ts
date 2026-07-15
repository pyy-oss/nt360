// MIROIR CLIENT de la normalisation des noms de clients (functions/domain/clientName.js). Le serveur
// canonicalise les noms clients au recompute (aggregate.js) : les options du filtre transverse et les
// summaries/clients_all portent donc des clés CANONIQUES. Sans ce miroir, filtrer une vue qui lit des
// collections BRUTES (Opportunités, Factures, Vue d'ensemble live) compare une valeur canonique
// (« SOCIETE GENERALE ») à un client brut (« Société Générale CI ») → la vue tombe à zéro / sous-compte
// alors que le serveur, lui, a tout regroupé. On réplique EXACTEMENT `canonicalKey` + le résolveur d'alias.
// Doit rester le miroir strict de functions/domain/clientName.js (cf. le même contrat que ids.ts↔ids.js).
import { useMemo } from "react";
import { useDocData } from "./hooks";

// Formes juridiques (tokens isolés) retirées de la clé — conservateur (on NE retire PAS SOCIETE/STE).
const LEGAL = new Set([
  "SA", "SARL", "SAS", "SASU", "SARLU", "SUARL", "EURL", "SNC", "SCI", "GIE",
  "LTD", "LLC", "INC", "PLC", "CO", "CORP", "GROUP", "GROUPE", "HOLDING", "CIE",
]);
// Suffixes pays (Côte d'Ivoire) après déburrage.
const COUNTRY = new Set(["CI", "COTE", "IVOIRE", "DIVOIRE"]);
// Particules de liaison issues de la ponctuation (d'/l'/de/la…).
const STOP = new Set(["DE", "DU", "DES", "D", "LA", "LE", "LES", "L", "ET", "AND", "OF", "THE"]);
// Bruit (miroir de lib/ids.js NOISE).
const NOISE = new Set(["COM", "MISC", "DIVERS", "TBD", "ALL", "PS", "0", "NAN", "NONE", ""]);

const COMBINING = /[̀-ͯ]/g;
const noAcc = (s?: string | null) => String(s || "").toLowerCase().normalize("NFD").replace(COMBINING, "");
const cleanName = (s?: string | null) => String(s || "").replace(/\s+/g, " ").trim().toUpperCase();

/** Clé canonique d'un nom brut : MAJUSCULES déburrées, ponctuation → espace, tokens juridiques /
 *  pays / particules / bruit retirés, espaces normalisés. Ne réduit jamais à vide (repli sur le brut). */
export function canonicalKey(name?: string | null): string {
  const base = noAcc(name).toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim();
  if (!base) return "";
  const toks = base.split(/\s+/).filter((t) => t && !LEGAL.has(t) && !COUNTRY.has(t) && !STOP.has(t) && !NOISE.has(t));
  const key = toks.join(" ").trim();
  return key || base; // si tout a été filtré (nom = uniquement forme juridique/pays), on garde le brut
}

/** Construit un résolveur `client brut → nom canonique` à partir de paires d'alias {from, to} (brutes).
 *  Résolution à UN niveau (pas de chaînage) — miroir de buildClientResolver (functions/domain/clientName.js). */
export function buildClientResolver(pairs?: { from: string; to: string }[] | null): (raw?: string | null) => string {
  const map: Record<string, string> = {};
  for (const p of pairs || []) {
    const f = canonicalKey(p && p.from);
    const t = canonicalKey(p && p.to);
    if (f && t && f !== t) map[f] = t;
  }
  return (raw) => {
    const k = canonicalKey(raw);
    if (!k) return cleanName(raw); // nom non normalisable → nettoyage minimal
    return map[k] || k;
  };
}

// Hook d'abonnement à config/clientAliases → résolveur `client brut → nom canonique`, EN MIROIR du serveur.
// Vit ici (module chargé en LAZY par les seules vues qui filtrent des collections brutes) plutôt que dans
// FilterProvider (chunk d'entrée) : évite d'alourdir le démarrage. Repli sur les règles seules avant
// chargement des alias / sans droit de lecture.
export function useClientKey(): (raw?: string | null) => string {
  const { data } = useDocData<{ pairs?: { from: string; to: string }[] }>("config/clientAliases");
  return useMemo(() => buildClientResolver(data?.pairs || []), [data]);
}
