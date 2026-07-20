import { describe, it, expect } from "vitest";
const { fpKey, num, cleanBu, noAcc, cleanName, plausibleYear, buildFpAliasResolver } = require("../lib/ids");

describe("plausibleYear — fenêtre glissante (rejet sentinelles)", () => {
  const cur = new Date().getFullYear();
  it("rejette les sentinelles et hors plage", () => {
    expect(plausibleYear(1900)).toBe(0);
    expect(plausibleYear(1899)).toBe(0);
    expect(plausibleYear(0)).toBe(0);
    expect(plausibleYear("abc")).toBe(0);
    expect(plausibleYear(2010)).toBe(0); // < 2015
  });
  it("accepte l'année courante et jusqu'à +3 ans (glissant, pas de 2030 codé en dur)", () => {
    expect(plausibleYear(cur)).toBe(cur);
    expect(plausibleYear(cur + 3)).toBe(cur + 3);
    expect(plausibleYear(cur + 4)).toBe(0);
    expect(plausibleYear("2015")).toBe(2015);
  });
});

// Socle F0 : garde-fous des helpers déterministes (BUILD_KIT §18.1).
describe("fpKey — normalisation clé d'or N° FP", () => {
  it("normalise majuscules et extrait la clé d'un libellé", () => {
    expect(fpKey("fp/2026/13542")).toBe("FP/2026/13542");
    expect(fpKey("  FP/2026/13542  ")).toBe("FP/2026/13542");
    expect(fpKey("Réf FP/2026/13542 — client")).toBe("FP/2026/13542");
  });
  it("renvoie null si aucun motif FP", () => {
    expect(fpKey("")).toBeNull();
    expect(fpKey("N/A")).toBeNull();
  });
  it("rejette les FP placeholder à séquence nulle (.../0000)", () => {
    expect(fpKey("FP/2024/0000")).toBeNull();
    expect(fpKey("FP/2026/00")).toBeNull();
  });
  it("normalise les zéros de tête de la séquence (« 013 » ⇒ « 13 »)", () => {
    expect(fpKey("FP/2026/013")).toBe("FP/2026/13");
    expect(fpKey("FP/2026/13")).toBe("FP/2026/13");
    // « 13 » et « 013 » convergent → une seule clé, pas de double comptage.
    expect(fpKey("FP/2026/013")).toBe(fpKey("FP/2026/13"));
  });
  it("rejette une année à 5+ chiffres (pas de troncature/collision silencieuse)", () => {
    // « FP/20244/13 » ne doit PAS devenir « FP/2024/4 » (qui collisionnerait avec une autre commande).
    expect(fpKey("FP/20244/13")).toBeNull();
    expect(fpKey("FP/20244/13")).not.toBe(fpKey("FP/2024/4"));
    expect(fpKey("FP/2024/4")).toBe("FP/2024/4"); // la vraie clé reste valide
  });
});

describe("buildFpAliasResolver — réconciliation N° FP (FP P&L prioritaire)", () => {
  it("redirige un FP source vers sa cible P&L (canonisation de la clé)", () => {
    const r = buildFpAliasResolver({ "FP/2026/13": "FP/2026/99" });
    expect(r("FP/2026/13")).toBe("FP/2026/99");
    // La recherche canonise : zéros de tête / casse / bruit ne doivent pas manquer l'alias.
    expect(r("fp/2026/013")).toBe("FP/2026/99");
    expect(r("Réf FP/2026/13 — client")).toBe("FP/2026/99");
  });
  it("laisse INCHANGÉ un FP sans alias (pas de réécriture surprise, valeur d'origine préservée)", () => {
    const r = buildFpAliasResolver({ "FP/2026/13": "FP/2026/99" });
    // Aucun alias sur celui-ci → renvoyé tel quel (y compris son padding d'origine, on ne canonise pas).
    expect(r("FP/2026/007")).toBe("FP/2026/007");
    expect(r("bla bla")).toBe("bla bla");
  });
  it("map vide ou absente → identité (tout passe à travers)", () => {
    expect(buildFpAliasResolver({})("FP/2026/13")).toBe("FP/2026/13");
    expect(buildFpAliasResolver(null)("FP/2026/13")).toBe("FP/2026/13");
    expect(buildFpAliasResolver(undefined)("x")).toBe("x");
  });
  it("préserve les entrées vides/nulles sans planter", () => {
    const r = buildFpAliasResolver({ "FP/2026/13": "FP/2026/99" });
    expect(r("")).toBe("");
    expect(r(null)).toBe(null);
    expect(r(undefined)).toBe(undefined);
  });
});

describe("cleanName — fusion des doublons logiques", () => {
  it("trim, espaces, majuscules", () => {
    expect(cleanName("  Orange   ci ")).toBe("ORANGE CI");
    expect(cleanName("orange ci")).toBe("ORANGE CI");
    expect(cleanName(null)).toBe("");
  });
});

describe("num — parsing tolérant", () => {
  it("gère espaces et virgule décimale", () => {
    expect(num("1 007 500")).toBe(1007500);
    expect(num("7,2")).toBe(7.2);
    expect(num("1 085 668 FCFA")).toBe(1085668);
  });
  it("renvoie 0 pour valeurs non numériques", () => {
    expect(num(null)).toBe(0);
    expect(num("abc")).toBe(0);
  });
  it("milliers avec point, décimale virgule (fr-FR)", () => {
    expect(num("1.234.567")).toBe(1234567); // point = millier
    expect(num("1.234.567,89")).toBeCloseTo(1234567.89, 2);
    expect(num("435,04")).toBeCloseTo(435.04, 2);
  });
  it("format en-US (virgule millier, point décimal)", () => {
    expect(num("1,234,567.89")).toBeCloseTo(1234567.89, 2);
    expect(num("744.96")).toBeCloseTo(744.96, 2);
  });
  it("float à DÉCIMALES LONGUES : point décimal préservé, pas pris pour un millier (corruption ×10^n)", () => {
    // Régression import Opportunités LIVE/Sales : String(7906306.3352601165) → num prenait le « . » pour un
    // séparateur de milliers (car >2 chiffres après) et le RETIRAIT → 79063063352601170 (×1e10). Un GROUPE de
    // milliers fait EXACTEMENT 3 chiffres → seul « .ddd » reste millier ; 1-2 ou 4+ chiffres = décimale.
    expect(num("7906306.3352601165")).toBeCloseTo(7906306.3352601165, 4);
    expect(num("286322054.17791206")).toBeCloseTo(286322054.17791206, 4);
    expect(num("1974289626.32299")).toBeCloseTo(1974289626.32299, 4);
    expect(num("22042880.700000003")).toBeCloseTo(22042880.7, 4);
    // exactement 3 chiffres après le point = MILLIER (comportement conservateur inchangé)
    expect(num("1.234")).toBe(1234);
    // un NOMBRE reste intact (jamais re-parsé par l'heuristique locale)
    expect(num(7906306.3352601165)).toBe(7906306.3352601165);
  });
  it("négatifs : parenthèses comptables et signe en queue", () => {
    expect(num("(1 000)")).toBe(-1000);
    expect(num("1 000-")).toBe(-1000);
    expect(num("-2 500,50")).toBeCloseTo(-2500.5, 2);
  });
  it("entiers XOF sans décimale", () => {
    expect(num("20000000")).toBe(20000000);
    expect(num("1,234")).toBe(1234); // virgule = millier (3 chiffres) → entier
  });
});

describe("cleanBu / noAcc", () => {
  it("normalise la BU", () => {
    expect(cleanBu("ict")).toBe("ICT");
    expect(cleanBu("xxx")).toBe("AUTRE");
  });
  it("retire les accents", () => {
    expect(noAcc("Négociation")).toBe("negociation");
    expect(noAcc("N° DE FP")).toBe("n° de fp");
  });
});
