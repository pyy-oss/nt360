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
    await setDoc(doc(db, "summaries/qualityHistory"), { days: [] });
    await setDoc(doc(db, "config/cancelOrders"), { items: [] });
    await setDoc(doc(db, "config/cancelInvoices"), { items: [] });
    await setDoc(doc(db, "summaries/cashScenario"), { horizon: 0 });
    await setDoc(doc(db, "summaries/relancesCreances"), { count: 0 });
    await setDoc(doc(db, "summaries/relancesBc"), { count: 0 });
    await setDoc(doc(db, "summaries/relancesJalons"), { count: 0 });
    await setDoc(doc(db, "auditLog/A1"), { action: "seed" });
  });
});

// Fabrique un client Firestore authentifié avec un rôle donné (custom claim NAMESPACÉ nt360Role).
const as = (role, uid = role || "anon") =>
  (role ? testEnv.authenticatedContext(uid, { nt360Role: role }) : testEnv.unauthenticatedContext()).firestore();

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

describe("Opportunités : écriture client interdite (callable-only)", () => {
  // Durcissement sécurité : toute écriture passe par les callables (Admin SDK), qui valident,
  // auditent et journalisent les transitions. Une écriture SDK directe est refusée par les rules —
  // même pour un rédacteur pipeline — pour empêcher la corruption non tracée du carnet (opp gagnée).
  it("un rédacteur pipeline (commercial) ne peut PAS créer d'opp en SDK direct", async () => {
    await assertFails(
      setDoc(doc(as("commercial"), "opportunities/OPP_NEW"), { fp: "FP/2026/2", source: "saisie", amount: 5 })
    );
  });
  it("un rédacteur pipeline ne peut PAS modifier une opp en SDK direct", async () => {
    await assertFails(
      setDoc(doc(as("commercial"), "opportunities/OPP1"), { fp: "FP/2026/1", source: "saisie", amount: 99 })
    );
  });
  it("un rédacteur pipeline ne peut PAS supprimer une opp en SDK direct", async () => {
    await assertFails(deleteDoc(doc(as("commercial"), "opportunities/OPP1")));
  });
  it("la LECTURE reste autorisée à qui a pipeline:read", async () => {
    await assertSucceeds(getDoc(doc(as("commercial"), "opportunities/OPP1")));
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
  it("écriture SDK DIRECTE interdite (même pour achats) → passe par le callable upsertCreditLine audité", async () => {
    await assertFails(setDoc(doc(as("achats"), "creditLines/S2"), { authorized: 500, outstanding: 0 }));
  });
  it("commercial (fournisseurs=none) ne peut PAS écrire", async () => {
    await assertFails(setDoc(doc(as("commercial"), "creditLines/S3"), { authorized: 1 }));
  });
  it("achats LIT toujours les lignes de crédit", async () => {
    await assertSucceeds(getDoc(doc(as("achats"), "creditLines/S1")));
  });
});

describe("Objectifs", () => {
  // objectives n'est plus éditable EN DIRECT (write:false) : l'édition passe par les callables
  // upsertObjective/deleteObjective (cibles validées + auditLog). Même direction ne peut pas écrire
  // le doc directement — cohérent avec creditLines / billingMilestones / config/permissions.
  it("objectives n'est PAS éditable en direct — même par direction (callable-only)", async () => {
    await assertFails(setDoc(doc(as("direction"), "objectives/2026_bu_ICT"), { fiscalYear: 2026 }));
  });
  it("commercial (objectifs=none) ne peut PAS écrire", async () => {
    await assertFails(setDoc(doc(as("commercial"), "objectives/2026_bu_X"), { fiscalYear: 2026 }));
  });
  it("direction LIT les objectifs", async () => {
    await assertSucceeds(getDoc(doc(as("direction"), "objectives/2026_bu_ICT")));
  });
});

describe("Historique des transitions d'étape (oppHistory · funnel)", () => {
  // oppHistory est écrit uniquement par les Cloud Functions (recordOppTransition, Admin SDK) : lisible
  // par qui voit le pipeline, jamais éditable côté client (funnel non falsifiable).
  it("commercial (pipeline:write) LIT oppHistory", async () => {
    await assertSucceeds(getDoc(doc(as("commercial"), "oppHistory/h1")));
  });
  it("oppHistory n'est PAS éditable en direct — même par direction (callable-only)", async () => {
    await assertFails(setDoc(doc(as("direction"), "oppHistory/h1"), { from: 1, to: 2 }));
  });
  it("summaries/oppFunnel lisible au niveau pipeline (commercial OK)", async () => {
    await assertSucceeds(getDoc(doc(as("commercial"), "summaries/oppFunnel")));
  });
});

describe("Matrice de droits (habilitations)", () => {
  // config/permissions n'est plus éditable EN DIRECT (write:false) : l'édition passe par le callable
  // setPermissions (schéma validé + audité). Même direction ne peut pas écrire le doc directement.
  it("config/permissions n'est PAS éditable en direct — même par direction (callable-only)", async () => {
    await assertFails(setDoc(doc(as("direction"), "config/permissions"), { matrix }));
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
  it("summaries/trends (mappé overview) lisible par lecture", async () => {
    await assertSucceeds(getDoc(doc(as("lecture"), "summaries/trends")));
  });
  it("agrégat NON classé → refusé par défaut (fail-closed) pour un rôle non-direction", async () => {
    await assertFails(getDoc(doc(as("lecture"), "summaries/nouvelleMarge_2026")));
  });
  it("direction lit tout agrégat, même non classé (superviseur)", async () => {
    await assertSucceeds(getDoc(doc(as("direction"), "summaries/nouvelleMarge_2026")));
  });
  it("summaries/alertsMargin (marge) : commercial (rentabilite=none) refusé, lecture (rentabilite=read) OK", async () => {
    await assertFails(getDoc(doc(as("commercial"), "summaries/alertsMargin")));
    await assertSucceeds(getDoc(doc(as("lecture"), "summaries/alertsMargin")));
  });
  it("alertes CLOISONNÉES par module : commercial (overview+pipeline) ne lit pas les alertes facturation/fournisseurs/backlog/BC", async () => {
    await assertSucceeds(getDoc(doc(as("commercial"), "summaries/alerts")));            // overview:read → OK
    await assertSucceeds(getDoc(doc(as("commercial"), "summaries/alertsPipeline")));    // pipeline:write → OK
    await assertFails(getDoc(doc(as("commercial"), "summaries/alertsFacturation")));    // facturation=none
    await assertFails(getDoc(doc(as("commercial"), "summaries/alertsFournisseurs")));   // fournisseurs=none → plus de fuite noms fournisseurs
    await assertFails(getDoc(doc(as("commercial"), "summaries/alertsBacklog")));        // backlog=none
    await assertFails(getDoc(doc(as("commercial"), "summaries/alertsBc")));             // bc=none
  });
  it("alertes cloisonnées : chaque module habilité lit son summary d'alerte", async () => {
    await assertSucceeds(getDoc(doc(as("achats"), "summaries/alertsFournisseurs")));    // fournisseurs=write
    await assertSucceeds(getDoc(doc(as("achats"), "summaries/alertsBc")));              // bc (achats)
    await assertSucceeds(getDoc(doc(as("pmo"), "summaries/alertsBacklog")));            // backlog=write
    await assertSucceeds(getDoc(doc(as("lecture"), "summaries/alertsFacturation")));    // facturation=read
  });
  it("Actualité CLOISONNÉE par module : commercial (overview+pipeline) refusé sur newsFacturation/Fournisseurs/Backlog/Bc", async () => {
    await assertSucceeds(getDoc(doc(as("commercial"), "summaries/news")));            // overview → OK
    await assertSucceeds(getDoc(doc(as("commercial"), "summaries/newsPipeline")));    // pipeline:write → OK
    await assertFails(getDoc(doc(as("commercial"), "summaries/newsFacturation")));    // facturation=none → plus de fuite créances/DSO
    await assertFails(getDoc(doc(as("commercial"), "summaries/newsFournisseurs")));   // fournisseurs=none
    await assertFails(getDoc(doc(as("commercial"), "summaries/newsBacklog")));        // backlog=none
    await assertFails(getDoc(doc(as("commercial"), "summaries/newsBc")));             // bc=none
  });
  it("Actualité : chaque module habilité lit son volet", async () => {
    await assertSucceeds(getDoc(doc(as("lecture"), "summaries/newsFacturation")));    // facturation:read
    await assertSucceeds(getDoc(doc(as("achats"), "summaries/newsFournisseurs")));    // fournisseurs:write
    await assertSucceeds(getDoc(doc(as("pmo"), "summaries/newsBacklog")));            // backlog:write
  });
  it("config/* : allowlist fail-closed (config/alerts lisible, config non listé refusé même pour direction)", async () => {
    await assertSucceeds(getDoc(doc(as("commercial"), "config/alerts")));
    await assertFails(getDoc(doc(as("direction"), "config/secretFutur")));
  });
  it("summaries/qualityHistory (mappé overview) lisible par lecture", async () => {
    await assertSucceeds(getDoc(doc(as("lecture"), "summaries/qualityHistory")));
  });
  it("summaries/cashScenario (prévision cash) cloisonné facturation comme cashflow", async () => {
    await assertFails(getDoc(doc(as("commercial"), "summaries/cashScenario")));   // facturation=none
    await assertSucceeds(getDoc(doc(as("lecture"), "summaries/cashScenario")));    // facturation=read
  });
  it("plan de relance : cloisonné par module (créances→facturation, bc→fournisseurs, jalons→backlog)", async () => {
    await assertFails(getDoc(doc(as("commercial"), "summaries/relancesCreances")));   // facturation=none
    await assertSucceeds(getDoc(doc(as("lecture"), "summaries/relancesCreances")));    // facturation=read
    await assertFails(getDoc(doc(as("commercial"), "summaries/relancesBc")));          // fournisseurs=none
    await assertSucceeds(getDoc(doc(as("achats"), "summaries/relancesBc")));           // fournisseurs=write
    await assertFails(getDoc(doc(as("commercial"), "summaries/relancesJalons")));      // backlog=none
    await assertSucceeds(getDoc(doc(as("pmo"), "summaries/relancesJalons")));          // backlog=write
  });
  it("overlays d'annulation : cancelOrders au niveau overview, cancelInvoices cloisonné facturation", async () => {
    await assertSucceeds(getDoc(doc(as("commercial"), "config/cancelOrders")));   // overview=read
    await assertFails(getDoc(doc(as("commercial"), "config/cancelInvoices")));    // facturation=none
    await assertSucceeds(getDoc(doc(as("lecture"), "config/cancelInvoices")));    // facturation=read
    await assertFails(setDoc(doc(as("direction"), "config/cancelOrders"), { items: [] })); // écriture = callable only
  });
  it("config/clickupBcLinks : cloisonné module bc (n° BC procurement), plus dans l'allowlist world-readable (R1)", async () => {
    await assertFails(getDoc(doc(as("commercial"), "config/clickupBcLinks")));    // bc=none → refusé
    await assertSucceeds(getDoc(doc(as("achats"), "config/clickupBcLinks")));     // bc (achats) → autorisé
    await assertFails(setDoc(doc(as("direction"), "config/clickupBcLinks"), { map: {} })); // écriture = callable only
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
