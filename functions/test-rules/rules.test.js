// Tests de non-régression RBAC — les droits sont réellement appliqués par les
// Security Rules Firestore (BUILD_KIT §8, critère F1). Nécessite l'émulateur Firestore
// (lancé par `firebase emulators:exec`, cf. script racine `pnpm test:rules`).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { beforeAll, afterAll, beforeEach, describe, it } from "vitest";
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
} from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, updateDoc, deleteDoc } from "firebase/firestore";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rules = readFileSync(resolve(__dirname, "../../firestore.rules"), "utf8");
const matrix = JSON.parse(
  readFileSync(resolve(__dirname, "../../seed/permissions.json"), "utf8")
).matrix;

let testEnv;

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: "rules-test-nt-ci",
    firestore: { rules },
  });
});

afterAll(async () => {
  if (testEnv) await testEnv.cleanup();
});

beforeEach(async () => {
  await testEnv.clearFirestore();
  // Seed matrice + données sources via contexte privilégié (contourne les rules, cf. Admin SDK).
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, "config/permissions"), { matrix });
    await setDoc(doc(db, "orders/FP_2026_1"), { fp: "FP/2026/1", source: "pnl", cas: 100 });
    await setDoc(doc(db, "invoices/INV1"), { fp: "FP/2026/1", source: "facturationDf" });
    await setDoc(doc(db, "opportunities/OPP1"), { fp: "FP/2026/1", source: "saisie", amount: 10 });
    await setDoc(doc(db, "bcLines/FP_2026_1_0"), { fp: "FP/2026/1", status: "a_emettre", supplier: "X" });
    await setDoc(doc(db, "creditLines/S1"), { authorized: 1000, outstanding: 0 });
    await setDoc(doc(db, "objectives/2026_global_all"), { fiscalYear: 2026, targetCas: 1 });
    await setDoc(doc(db, "summaries/overview_2026"), { certitudes: 1 });
    await setDoc(doc(db, "summaries/suppliers"), { totalExpo: 1 });
    await setDoc(doc(db, "summaries/facturation_2026"), { total: 1 });
    await setDoc(doc(db, "auditLog/A1"), { action: "seed" });
  });
});

// Fabrique un client Firestore authentifié avec un rôle donné (custom claim).
const as = (role, uid = role || "anon") =>
  (role ? testEnv.authenticatedContext(uid, { role }) : testEnv.unauthenticatedContext()).firestore();

describe("Lectures selon la matrice", () => {
  it("lecture (rôle) lit overview→orders", async () => {
    await assertSucceeds(getDoc(doc(as("lecture"), "orders/FP_2026_1")));
  });
  it("non authentifié : lecture refusée", async () => {
    await assertFails(getDoc(doc(as(null), "orders/FP_2026_1")));
  });
  it("commercial ne lit PAS la facturation (none)", async () => {
    await assertFails(getDoc(doc(as("commercial"), "invoices/INV1")));
  });
  it("achats lit les fournisseurs (creditLines)", async () => {
    await assertSucceeds(getDoc(doc(as("achats"), "creditLines/S1")));
  });
});

describe("Collections sources : écriture client toujours refusée", () => {
  it("direction ne peut PAS écrire orders (Admin SDK only)", async () => {
    await assertFails(setDoc(doc(as("direction"), "orders/FP_X"), { source: "pnl" }));
  });
  it("direction ne peut PAS écrire invoices", async () => {
    await assertFails(setDoc(doc(as("direction"), "invoices/INV_X"), { source: "df" }));
  });
});

describe("Opportunités : seules les saisies sont modifiables", () => {
  it("commercial crée une opp source=saisie", async () => {
    await assertSucceeds(
      setDoc(doc(as("commercial"), "opportunities/OPP_NEW"), { fp: "FP/2026/2", source: "saisie", amount: 5 })
    );
  });
  it("commercial ne peut PAS créer une opp source=salesData", async () => {
    await assertFails(
      setDoc(doc(as("commercial"), "opportunities/OPP_BAD"), { fp: "FP/2026/2", source: "salesData" })
    );
  });
  it("lecture (pipeline=read) ne peut PAS créer d'opp", async () => {
    await assertFails(
      setDoc(doc(as("lecture"), "opportunities/OPP_R"), { source: "saisie" })
    );
  });
  it("commercial peut supprimer une opp", async () => {
    await assertSucceeds(deleteDoc(doc(as("commercial"), "opportunities/OPP1")));
  });
});

describe("Lignes BC : seul le statut est modifiable", () => {
  it("achats change le statut", async () => {
    await assertSucceeds(updateDoc(doc(as("achats"), "bcLines/FP_2026_1_0"), { status: "emis" }));
  });
  it("achats ne peut PAS changer un autre champ", async () => {
    await assertFails(updateDoc(doc(as("achats"), "bcLines/FP_2026_1_0"), { supplier: "Y" }));
  });
  it("commercial (bc=none) ne peut PAS changer le statut", async () => {
    await assertFails(updateDoc(doc(as("commercial"), "bcLines/FP_2026_1_0"), { status: "emis" }));
  });
});

describe("Lignes de crédit fournisseurs", () => {
  it("achats écrit une ligne de crédit", async () => {
    await assertSucceeds(setDoc(doc(as("achats"), "creditLines/S2"), { authorized: 500, outstanding: 0 }));
  });
  it("commercial (fournisseurs=none) ne peut PAS écrire", async () => {
    await assertFails(setDoc(doc(as("commercial"), "creditLines/S3"), { authorized: 1 }));
  });
});

describe("Objectifs", () => {
  it("direction écrit un objectif", async () => {
    await assertSucceeds(setDoc(doc(as("direction"), "objectives/2026_bu_ICT"), { fiscalYear: 2026 }));
  });
  it("commercial (objectifs=none) ne peut PAS écrire", async () => {
    await assertFails(setDoc(doc(as("commercial"), "objectives/2026_bu_X"), { fiscalYear: 2026 }));
  });
});

describe("Matrice de droits (habilitations)", () => {
  it("direction édite config/permissions", async () => {
    await assertSucceeds(setDoc(doc(as("direction"), "config/permissions"), { matrix }));
  });
  it("pmo ne peut PAS éditer config/permissions", async () => {
    await assertFails(setDoc(doc(as("pmo"), "config/permissions"), { matrix }));
  });
});

describe("Agrégats & audit", () => {
  it("summaries lisibles selon le module (lecture lit overview)", async () => {
    await assertSucceeds(getDoc(doc(as("lecture"), "summaries/overview_2026")));
  });
  it("commercial (fournisseurs=none) ne lit PAS summaries/suppliers", async () => {
    await assertFails(getDoc(doc(as("commercial"), "summaries/suppliers")));
  });
  it("commercial (facturation=none) ne lit PAS summaries/facturation_2026", async () => {
    await assertFails(getDoc(doc(as("commercial"), "summaries/facturation_2026")));
  });
  it("achats (fournisseurs=write) lit summaries/suppliers", async () => {
    await assertSucceeds(getDoc(doc(as("achats"), "summaries/suppliers")));
  });
  it("personne n'écrit summaries (Functions only)", async () => {
    await assertFails(setDoc(doc(as("direction"), "summaries/overview_2026"), { certitudes: 2 }));
  });
  it("direction (habilitations) lit auditLog", async () => {
    await assertSucceeds(getDoc(doc(as("direction"), "auditLog/A1")));
  });
  it("lecture ne lit PAS auditLog", async () => {
    await assertFails(getDoc(doc(as("lecture"), "auditLog/A1")));
  });
});
