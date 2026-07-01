# KIT FINAL — Pilote Revenu NT CI · 100% Firebase
## Spécification d'industrialisation autoportante (serverless Firebase)
### Neurones Technologies CI — ESN/intégrateur (UEMOA/CEMAC)

> Document **unique et faisant autorité** pour construire l'application de A à Z sur Firebase. Il intègre la logique métier, le modèle de données, le RBAC opposable, l'ingestion, les fichiers de démarrage et l'annexe métier rétro-conçue. **Aucune dépendance à un autre document.**
>
> **Point de départ** : un prototype React mono-fichier (`Pilote_Revenu_NT_CI.jsx`, 13 modules, données embarquées + dépôts + droits côté client) existe et fait foi pour la parité fonctionnelle.
>
> **Cap : on ne retire rien. On bonifie à l'extrême.** Chaque module, calcul et règle est conservé puis renforcé (sécurité réelle, temps réel, traçabilité, performance).

---

## 0. Comment utiliser ce kit avec Claude Code
1. Crée un projet Firebase (console) + un dépôt Git ; place ce fichier en `docs/BUILD_KIT.md`.
2. Mets à disposition (environnement sécurisé) les sources réelles : `PIPELINE_NT_CI_Inventory.xlsx` (feuilles **P&L**, **Facturation DF**, **LIVE**), un export Odoo `account.move`, une **fiche affaire** type.
3. Démarre Claude Code, colle le **Prompt d'amorçage** (§17).
4. Déroule la **Roadmap F0→F8** (§15) une phase à la fois ; valide chaque phase par ses **critères d'acceptation** avant la suivante.
5. L'**Annexe métier** (§18) contient les faits du système réel (cellules de la fiche, étapes pipeline, valeurs de contrôle) : à respecter **à la lettre** et à transformer en **tests de non-régression chiffrés**.

---

## 1. Mission & principes

**Mission.** Un cockpit unique reliant **commercial (pipeline) → commandes (CAS) → facturation → backlog → rentabilité projet → exposition & lignes de crédit fournisseurs**, indexé par une clé d'or : le **N° FP**.

**Principes non négociables :**
- **Parité 1:1** avec le prototype, puis extensions.
- **Clé unique `N° FP`** (`FP/AAAA/NNNNN`) relie commandes, factures, fiches, BC, opportunités.
- **Sources de vérité** : `P&L` + `Facturation DF` (réalisé), `LIVE` (pipeline), `fiche affaire` (P&L projet + BC).
- **Backlog ancré** sur l'année fiscale en cours (dérivée des données), indépendant du filtre de période.
- **Droits opposables** : appliqués par les **Security Rules** Firestore + **custom claims** (le front ne fait jamais autorité).
- **Ingestion idempotente** : IDs déterministes ⇒ ré-import = upsert, jamais de doublon.
- **Traçabilité** : tout import / écriture / changement de droits audité.
- **Lectures économiques** : tableaux de bord servis par des **documents d'agrégat** (`summaries/*`), pas par des milliers de docs.
- **Local-first** : conserver l'export/sauvegarde JSON pour continuité et portabilité.

---

## 2. Périmètre — 13 modules (tous conservés) + bonifications

| # | Module | Rôle |
|---|--------|------|
| 1 | Vue d'ensemble | Chaîne Certitudes→Commandes→Facturé→Backlog, ratios, R/O, marge |
| 2 | Pipeline | Funnel pondéré, par commercial/BU, passerelles Prévision & Sourcing |
| 3 | Objectifs / R-O | Cibles paramétrables/an (CAS/Facturé/Marge) + R/O |
| 4 | Facturation | Tendance mensuelle, mix BU, top clients, détail semaine |
| 5 | Suivi Backlog | Ancré FY, par domaine/millésime/client + top commandes |
| 6 | Prévision | Trajectoire réalisé→projeté, écoulement backlog, rythme paramétrable |
| 7 | Rentabilité (P&L) | Marge, %MB, CAS vs MB par domaine, top clients |
| 8 | P&L Projet | Fiche affaire : coût/vente/marge, coût par type/fournisseur, contrôle vs CAS |
| 9 | Crédit Fournisseurs | Exposition, lignes paramétrables, saturation, aide négociation DF |
| 10 | Exécution BC | Cycle À émettre→…→Soldé, taux d'exécution, encours |
| 11 | Clients | CAS/Facturé/Backlog/Marge/%MB, concentration |
| 12 | Domaines | Mêmes indicateurs par BU |
| 13 | Habilitations | Matrice droits profil×module, MFA admin, audit |

**Bonifications (ajouts, sans rien retirer) :** atterrissage annuel · centre d'alertes (backlog dormant, marge négative, ligne saturée, concentration client, BC en retard) · vue par commercial transverse + N vs N-1 · drill-down FP 360° · exports PDF/XLSX (one-pager CODIR) · délais BC (si dates ajoutées au template) · notifications & journal d'activité.

---

## 3. Architecture Firebase

```
┌──────────────────────────────────────────────────────────────┐
│  Firebase Hosting — SPA React/Vite/TS (design Forest & Gold)   │
│  SDK Firebase · Firestore temps réel + offline · App Check     │
└───────────────▲───────────────────────────┬───────────────────┘
                │ ID token (claim: role)      │ lectures/écritures
        ┌───────┴────────┐          ┌─────────▼─────────────────┐
        │ Firebase Auth  │          │        Firestore          │
        │ email/MFA/SSO  │          │ collections + summaries/* │
        │ custom claims  │          │ Security Rules = RBAC     │
        └────────────────┘          └─────────▲─────────────────┘
                                               │ writes (Admin SDK)
   ┌───────────────────────────────────┐ ┌─────┴────────────────────┐
   │   Cloud Functions (2nd gen)       │ │ Cloud Storage            │
   │  setUserRole · ingest · aggregate │ │ (imports bruts + exports)│
   │  syncSalesData · export           │ └──────────────────────────┘
   └───────────────▲───────────────────┘ ┌──────────────────────────┐
                   │ Cloud Scheduler      │ BigQuery (optionnel,     │
                   └ cron quotidien       │ analytique ad hoc)       │
                                          └──────────────────────────┘
```

---

## 4. Stack & services

| Couche | Choix |
|--------|-------|
| Frontend | React 18 + Vite + TypeScript, TanStack Query, Recharts, React Router |
| Hébergement | **Firebase Hosting** (+ canaux preview) |
| Auth | **Firebase Auth** (email/mot de passe, Google, **MFA**) + **custom claims** (rôle) |
| Base | **Firestore** (collections sources + documents d'agrégat) ; **BigQuery** optionnel |
| Autorisation | **Security Rules** (niveau none/read/write par module) + App Check |
| Backend | **Cloud Functions 2nd gen — Node.js 20** (un seul codebase) — ingestion **SheetJS** (`xlsx`), callable Node |
| Stockage | **Cloud Storage** (imports bruts, exports) |
| Planification | **Cloud Scheduler** (+ Pub/Sub) → sync Sales_DATA |
| Export | Cloud Function `export` (Node) → PDF (**pdfkit**/Puppeteer) / XLSX (**ExcelJS**) → URL signée |
| Tests | Vitest (front + parseurs SheetJS), `@firebase/rules-unit-testing` (règles), Playwright (e2e) |
| Dev local | **Firebase Emulator Suite** (auth, firestore, functions, storage) |
| CI/CD | GitHub Actions → `firebase deploy` |
| Observabilité | Cloud Logging/Monitoring + Sentry |

---

## 5. Structure du projet

```
pilote-revenu/
├─ docs/BUILD_KIT.md
├─ firebase.json  .firebaserc
├─ firestore.rules  firestore.indexes.json  storage.rules
├─ functions/                 # Cloud Functions 2nd gen — Node.js 20 (un seul codebase)
│  ├─ index.js                # ingest, aggregate, syncSalesData, export, setUserRole
│  ├─ parsers/                # SheetJS : pnl, facturationDf, ficheAffaire, salesData
│  ├─ domain/                 # chaine, backlog, pipeline, fournisseurs, projet
│  └─ package.json
├─ web/                       # SPA React/Vite/TS
│  ├─ src/ app/ design/ modules/ (13) lib/ (firebase, rbac, hooks) types/
│  └─ package.json
├─ seed/ (permissions, roles, premier admin)
└─ .github/workflows/ci.yml
```

---

## 6. Modèle Firestore

> **IDs déterministes ⇒ idempotence** (`set(..., {merge:true})` ne duplique jamais).

```
clients/{clientId}          { name }
salesReps/{repId}           { name, email }
suppliers/{supplierId}      { name, totalExposure, openOrdersAchat }   // agrégats maintenus par function

orders/{fp}                 { fp, client, bu, yearPo, cas, raf, mb, am, source, updatedAt,
                              suppliers:[{name,amount}] }              // ventilation Frns (≤10)
invoices/{numero}           { numero, fp, client, bu, date, amountHt, paymentStatus, source }
opportunities/{oppId}       { oppId, fp, client, am, bu, amount, stage, probability,
                              closingDate, source, createdBy, updatedAt }   // oppId = extId | hash
projectSheets/{fp}          { fp, client, affaire, commercial, sheetDate,
                              costTotal, saleTotal, margin, marginPct, sourceFile }
bcLines/{fp}_{lineIndex}    { fp, lineIndex, bcNumber, description, supplier, expenseType,
                              currency, amountCurrency, amountXof, status,
                              bcDate?, deliveryDue?, deliveryReal? }
objectives/{fy}_{scope}_{val} { fiscalYear, scope, scopeValue, targetCas, targetInvoiced, targetMargin }
creditLines/{supplierId}    { authorized, outstanding, updatedBy, updatedAt }

users/{uid}                 { email, name, active }            // rôle = custom claim
config/permissions          { matrix: { roleId: { module: "none|read|write" } } }   // éditable admin
config/fiscal               { currentFy }                      // dérivé à l'ingestion
auditLog/{autoId}           { uid, action, module, entity, entityId, detail, ts }
imports/{autoId}            { uid, kind, filename, objectKey, rowsIn, rowsOk, rowsSkipped, report, ts }

// AGRÉGATS (lecture rapide, recalculés par Functions, écriture interdite au client)
summaries/overview_{period}     { certitudes, commandes, facture, backlog, mb, ratios, week }
summaries/backlog_fy            { total, byBu, byClient, byVintage, top, fy }   // ancré FY
summaries/pipeline              { byStage, byAM, byBU, byMonth, tot, susp, conv, topOpps }
summaries/suppliers             { totalExpo, openTotal, bySupplier:[...] }
summaries/facturation_{period}  { monthly, byBu, topClients }
summaries/rentabilite_{period}  { mb, pmb, byBu, topClients }
summaries/clients_{period}      summaries/domaines_{period}
summaries/atterrissage_{fy}     { realiseCas, backlog, pipelinePondere, projete, objectif, ecart }
```

**Règle de modélisation** : écritures sur collections sources (idempotentes) ; `summaries/*` **dérivés** par Functions (sur écriture ou planifiés) ; le front lit surtout `summaries/*` (temps réel, peu coûteux) et le détail à la demande (drill-down, listes paginées).

---

## 7. Logique métier unifiée

- **Chaîne** (grandeurs **NON additives** : `CAS ≠ Facturé + Backlog`) : `Opportunités(pondérées) → Certitudes → Commandes(CAS) → Facturé(CAF) → Backlog(RAF)`, jointes par `fp`. Périmètres distincts : **CAS** = prise de commande figée sur l'année de PO (peut venir d'années antérieures) ; **CAF** = facturation, **seule** grandeur figée sur l'exercice (Σ factures datées) ; **Backlog** (RAF) et **Certitudes** (pondéré ≥90 %) sont **glissants** (cumulés jusqu'à l'année en cours, indépendants de la période). Avancement de facturation d'une cohorte = (CAS−RAF de la période)/CAS.
- **Backlog ancré FY (glissant)** : `config/fiscal.currentFy` = max(yearPo). Total + ventilations sur **toutes** les commandes ouvertes (RAF>0), **indépendant de la période sélectionnée**.
- **Pipeline pondéré** : étapes 1..9 ; actif=1-5, veille=8, conversion=6 vs 7. Pondéré = Σ(montant×proba) ; proba = `IdC` sinon défaut `{1:.10,2:.25,3:.40,4:.60,5:.80,8:.05}`. Taux conversion = won/(won+lost). Phasage par mois de `closingDate`.
- **Fournisseurs** : exposition = Σ `orders.suppliers.amount` ; achat commandes ouvertes = Σ sur RAF>0 ; encours = saisi (DF) **sinon calculé** = Σ `bcLines.amountXof` non soldés ; couverture = (autorisé−encours)−achat_ouvert (négatif=Saturation ; util≥90%=Tension) ; reco = encours + achat_ouvert×1,10.
- **P&L projet** : coût/vente/marge/%MB par `fp` ; coût par type & fournisseur (bcLines) ; contrôle vente vs `orders.cas`.
- **Exécution BC** : cycle `a_emettre→emis→livre→facture→solde` ; taux exécution = part soldée ; délai/retard si dates présentes.
- **Sourcing (signature DRO)** : charge d'achat anticipée = pondéré étapes 4-5 × ~0,90 ; à rapprocher de `creditLines` (anticiper extensions **avant** signature).
- **Atterrissage** : projeté **CAS** = Réalisé CAS(FY) + pipeline pondéré(closing FY) → vs `objectives`, avec écart et probabilité d'atteinte. Le backlog n'entre **pas** dans le projeté CAS (déjà couvert par le CAS réalisé). Projeté **CAF** (facturation) = Facturé réalisé(FY) + backlog écoulable (RAF, reste à facturer) + pipeline pondéré : le backlog **y entre** (part des commandes signées restant à facturer), sans double compte.

---

## 8. RBAC opposable — custom claims + Security Rules

**6 profils** : `direction`, `commercial_dir`, `commercial`, `pmo`, `achats`, `lecture`.
**Matrice par défaut** (seed `config/permissions`) :

| Module | direction | commercial_dir | commercial | pmo | achats | lecture |
|--------|:--:|:--:|:--:|:--:|:--:|:--:|
| overview | W | R | R | R | R | R |
| pipeline | W | **W** | **W** | – | – | R |
| objectifs | W | R | – | – | – | R |
| facturation | W | R | – | – | – | R |
| backlog | W | R | – | R | R | R |
| prevision | W | R | – | – | – | R |
| rentabilite | W | R | – | R | – | R |
| pnlprojet | W | – | – | **W** | R | R |
| fournisseurs | W | – | – | R | **W** | R |
| bc | W | – | – | **W** | **W** | R |
| clients | W | R | R | – | – | R |
| domaines | W | R | – | R | – | R |
| habilitations | **W** | – | – | – | – | – |

**Pose du rôle (Cloud Function callable, admin uniquement) :**
```js
exports.setUserRole = onCall(async (req) => {
  if (req.auth?.token?.role !== "direction") throw new HttpsError("permission-denied","admin requis");
  const { uid, role } = req.data;                          // role ∈ 6 profils
  await getAuth().setCustomUserClaims(uid, { role });
  await getFirestore().collection("auditLog").add({ uid:req.auth.uid, action:"perm_change",
    module:"habilitations", entity:"user", entityId:uid, detail:{role}, ts:FieldValue.serverTimestamp() });
  return { ok:true };
});
```

**`firestore.rules` (RBAC appliqué côté serveur) :**
```
rules_version = '2';
service cloud.firestore {
  match /databases/{db}/documents {
    function signedIn() { return request.auth != null; }
    function role() { return request.auth.token.role; }
    function matrix() { return get(/databases/$(db)/documents/config/permissions).data.matrix; }
    function level(m) { return role() == 'direction' ? 'write' : matrix()[role()][m]; }
    function canRead(m)  { return signedIn() && level(m) in ['read','write']; }
    function canWrite(m) { return signedIn() && level(m) == 'write'; }

    match /orders/{id}        { allow read: if canRead('overview');     allow write: if false; }
    match /invoices/{id}      { allow read: if canRead('facturation');  allow write: if false; }
    match /projectSheets/{id} { allow read: if canRead('pnlprojet');    allow write: if false; }
    match /opportunities/{id} {
      allow read: if canRead('pipeline');
      allow create, update: if canWrite('pipeline') && request.resource.data.source == 'saisie';
      allow delete: if canWrite('pipeline');
    }
    match /bcLines/{id} {
      allow read: if canRead('bc');
      allow update: if canWrite('bc')
        && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['status']);
    }
    match /creditLines/{id}   { allow read: if canRead('fournisseurs'); allow write: if canWrite('fournisseurs'); }
    match /objectives/{id}    { allow read: if canRead('objectifs');    allow write: if canWrite('objectifs'); }
    match /summaries/{id}     { allow read: if signedIn();              allow write: if false; }   // écrit par Functions
    match /config/permissions { allow read: if signedIn();              allow write: if canWrite('habilitations'); }
    match /config/{id}        { allow read: if signedIn();              allow write: if false; }
    match /auditLog/{id}      { allow read: if canWrite('habilitations'); allow write: if false; }
    match /imports/{id}       { allow read: if signedIn();              allow write: if false; }
    match /users/{uid}        { allow read: if canWrite('habilitations') || request.auth.uid == uid; allow write: if false; }
  }
}
```
- Imports & agrégats écrits par l'**Admin SDK** (Functions) ⇒ contournent les rules (couche de confiance).
- Saisies (opp, statut BC, lignes crédit, objectifs, matrice) passent par les rules ⇒ **droits réellement appliqués**.
- **MFA** pour `direction`/`achats` (remplace le « code admin » du prototype) ; **App Check** actif.

---

## 9. Ingestion — Cloud Functions Node.js + SheetJS (Storage trigger)

Upload dans `gs://<bucket>/imports/{kind}/...` → fonction `ingest` :
```js
const {onObjectFinalized} = require("firebase-functions/v2/storage");
const {getStorage} = require("firebase-admin/storage");
const {getFirestore, FieldValue} = require("firebase-admin/firestore");
const XLSX = require("xlsx");
const db = getFirestore();

exports.ingest = onObjectFinalized({ memoryMiB: 1024, timeoutSeconds: 300 }, async (event) => {
  const [buf] = await getStorage().bucket(event.data.bucket).file(event.data.name).download();
  const wb   = XLSX.read(buf, { cellDates: true });      // SheetJS tolère les dataValidation mal formées
  const kind = detectKind(wb);                            // pnl | facturationDf | fiche | salesData
  const { rows, report } = PARSERS[kind](wb);             // règles strictes §17
  let batch = db.batch(), n = 0;
  for (const r of rows) {                                 // IDs déterministes ⇒ upsert idempotent
    batch.set(docRef(kind, r), r, { merge: true });       // orders/{fp}, invoices/{numero}, bcLines/{fp}_{i}...
    if (++n % 400 === 0) { await batch.commit(); batch = db.batch(); }
  }
  await batch.commit();
  await db.collection("imports").add({ ...report, kind, ts: FieldValue.serverTimestamp() });
  if (kind === "pnl" || kind === "fiche") await updateFiscalYearFromOrders();
  await enqueueAggregation(kind);                         // recalcul des summaries impactés
});
```
- **Fiche affaire** : parsée par **lecture cellulaire** (`XLSX.utils.sheet_to_json(ws,{header:1})`) — **pas de correctif `dataValidation` nécessaire** (SheetJS tolère les `sqref` mal formés, contrairement à openpyxl). Scan par label §17.4.
- **Sales_DATA** : remplace le lot `source:"salesData"` dans `opportunities`, **préserve** `source:"saisie"`.
- **Détection** : `detectKind(wb)` par signatures de colonnes/cellules (§17). Dé-doublonnage par IDs déterministes.
- **Quarantaine** : lignes invalides (FP malformé, montant négatif) → non écrites, listées dans le rapport.

---

## 10. Agrégation — documents `summaries/*`

Fonction `aggregate` (après import / sur écriture / planifiée) recalcule : `backlog_fy` (ancré `config/fiscal.currentFy`), `pipeline`, `suppliers` (avec encours calculé depuis `bcLines` non soldés), `overview_{period}`, `facturation_{period}`, `rentabilite_{period}`, `clients_{period}`, `domaines_{period}`, `atterrissage_{fy}`. Le front s'abonne en **temps réel** (`onSnapshot`) ⇒ rafraîchissement automatique après toute saisie/import. Pour l'analytique libre : extension **Firestore→BigQuery** + Looker Studio.

---

## 11. Sync Sales_DATA quotidien
```js
exports.syncSalesData = onSchedule("every day 06:00", async () => {
  const file = await fetchSalesDataExport();   // SFTP / dossier surveillé / API CRM → Storage
  await ingestSalesData(file);                 // remplace lot 'sales_data', préserve 'saisie'
  await recomputeSummaries(["pipeline","overview","backlog_fy","atterrissage"]);
});
```
Dé-doublonnage saisie↔fichier par `extId`/`ID` si présent (Annexe §18.5) ; sinon signalement de doublon probable (client+montant+étape).

---

## 12. Frontend (SDK Firebase)
- `firebase/app|auth|firestore|functions|app-check` ; **persistance offline** activée.
- `useClaims()` → rôle ; `useCan(module)` → none/read/write (lit `config/permissions` une fois, en cache).
- Dashboards : `onSnapshot('summaries/...')` (temps réel) ; détail : `query` paginé + index.
- Écritures : `setDoc/updateDoc` (saisie opp, statut BC, ligne crédit, objectifs) — refusées par les rules si droit insuffisant (UI désactivée en amont).
- **Design Forest & Gold conservé** : tokens `bg #0E1613 · panel #151F1A · ink #EEF3EF · gold #C9A24B · emerald #46C08A · clay #D9694C · steel #6E9DC0 · plum #A98AC4` ; BU ICT=emerald, Cloud=steel, Formation=gold ; polices **Bricolage Grotesque** + **Inter** ; `fmt` (Md/M/k), `pct`, tabular-nums.
- Composants conservés : `Kpi, Card, Eyebrow, HBars, Stage, Tip, ErrorBoundary` (un par vue) ; sélecteur de période ; sauvegarde/restauration JSON.

---

## 13. Sécurité · coûts · sauvegarde · migration
- **Sécurité** : Rules (barrière opposable) + App Check + MFA profils sensibles + moindre privilège ; toute action sensible auditée.
- **Coûts** : dashboards sur `summaries/*` (1 lecture) ; jamais de doc > 1 Mo ; index composites pour les requêtes de détail.
- **Sauvegarde** : export Firestore managé planifié vers bucket GCS (rétention) ; imports bruts conservés dans Storage (rejouabilité) ; export JSON applicatif conservé.
- **Migration prototype → Firestore** : fonction `importLegacyBackup(json)` lisant une sauvegarde JSON (`uorders, uinv, objectives, lines, fiches, bcStatus, pipeOpps, pipeUser`) et écrivant les collections (IDs déterministes).

---

## 14. Fichiers de démarrage (prêts à committer)

**`firebase.json`**
```json
{
  "hosting": { "public": "web/dist", "ignore": ["firebase.json","**/.*","**/node_modules/**"],
    "rewrites": [{ "source": "**", "destination": "/index.html" }] },
  "firestore": { "rules": "firestore.rules", "indexes": "firestore.indexes.json" },
  "storage": { "rules": "storage.rules" },
  "functions": [{ "source": "functions", "codebase": "default", "runtime": "nodejs20" }],
  "emulators": { "auth": {"port":9099}, "firestore": {"port":8080},
    "functions": {"port":5001}, "storage": {"port":9199}, "hosting": {"port":5000}, "ui": {"enabled":true} }
}
```

**`storage.rules`**
```
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    match /imports/{allPaths=**} {
      allow write: if request.auth != null && request.auth.token.role in ['direction','pmo','achats','commercial_dir','commercial'];
      allow read: if false;                  // lecture réservée aux Functions (Admin SDK)
    }
    match /exports/{allPaths=**} { allow read: if request.auth != null; allow write: if false; }
  }
}
```

**`firestore.indexes.json`** (extrait — à compléter selon requêtes)
```json
{ "indexes": [
  { "collectionGroup": "invoices", "queryScope":"COLLECTION",
    "fields": [ {"fieldPath":"date","order":"DESCENDING"} ] },
  { "collectionGroup": "opportunities", "queryScope":"COLLECTION",
    "fields": [ {"fieldPath":"stage","order":"ASCENDING"}, {"fieldPath":"amount","order":"DESCENDING"} ] },
  { "collectionGroup": "orders", "queryScope":"COLLECTION",
    "fields": [ {"fieldPath":"raf","order":"DESCENDING"} ] }
], "fieldOverrides": [] }
```

**`functions/package.json`**
```json
{
  "name": "functions",
  "engines": { "node": "20" },
  "main": "index.js",
  "dependencies": {
    "firebase-admin": "^12",
    "firebase-functions": "^5",
    "xlsx": "^0.18",
    "exceljs": "^4",
    "pdfkit": "^0.15"
  },
  "devDependencies": { "vitest": "^2", "@firebase/rules-unit-testing": "^3" }
}
```

**`functions/index.js` (squelette SheetJS — ingest + parseurs + callable admin)**
```js
const {onObjectFinalized} = require("firebase-functions/v2/storage");
const {onSchedule} = require("firebase-functions/v2/scheduler");
const {onCall, HttpsError} = require("firebase-functions/v2/https");
const {initializeApp} = require("firebase-admin/app");
const {getFirestore, FieldValue} = require("firebase-admin/firestore");
const {getStorage} = require("firebase-admin/storage");
const {getAuth} = require("firebase-admin/auth");
const XLSX = require("xlsx");
initializeApp(); const db = getFirestore();

const fpKey = v => { const m = String(v||"").match(/FP\/?\s*\d{4}\/?\s*\d+/i);
  return m ? m[0].replace(/\s/g,"").toUpperCase() : null; };
const num = v => { const n = parseFloat(String(v??"").replace(/\s/g,"").replace(",",".").replace(/[^\d.\-]/g,""));
  return isNaN(n) ? 0 : n; };
const cleanBu = x => { const s = String(x||"").trim().toUpperCase();
  return ["ICT","CLOUD","FORMATION"].includes(s) ? s : "AUTRE"; };
const NOISE = new Set(["COM","MISC","DIVERS","TBD","ALL","PS","0","NAN","NONE",""]);

function parsePnl(wb){                                   // → orders/{fp} + suppliers (§17.2)
  const rows = XLSX.utils.sheet_to_json(wb.Sheets["P&L"], {defval:null});
  const out = [];
  for (const r of rows){
    const fp = fpKey(r["Opp ID"]); const cas = num(r["CAS"]);
    if (!fp || cas <= 0) continue;
    const suppliers = [];
    for (let i=1;i<=10;i++){ const amt = num(r[`Frns${i}`]); const nm = String(r[`Frns${i} N`]||"").trim().toUpperCase();
      if (amt>0 && !NOISE.has(nm)) suppliers.push({name:nm, amount:amt}); }
    out.push({ _id:fp, fp, client:String(r["Customer"]||""), bu:cleanBu(r["BU"]),
      yearPo:parseInt(r["Year PO"])||0, cas, raf:Math.max(num(r["RAF TOTAL"]),0),
      mb:num(r["MB TOTAL"]), am:String(r["AM"]||""), suppliers, source:"pnl" });
  }
  return { rows:out, report:{rowsIn:rows.length, rowsOk:out.length} };
}

// Fiche affaire : lecture cellulaire (aucun correctif dataValidation requis avec SheetJS)
function parseFiche(wb){                                 // → projectSheets/{fp} + bcLines/{fp}_{i} (§17.4)
  const aoa = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], {header:1, raw:true, defval:null});
  const noAcc = s => String(s||"").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"");
  const cells = []; aoa.forEach((row,ri)=>row&&row.forEach((v,ci)=>{ if(v!=null&&v!=="") cells.push({ri,ci,v}); }));
  const find = lbl => { const L=noAcc(lbl); return cells.find(x=>typeof x.v==="string"&&noAcc(x.v).includes(L)); };
  const rightOf = lbl => { const c=find(lbl); if(!c) return null; const row=aoa[c.ri]||[];
    for(let k=c.ci+1;k<row.length;k++) if(row[k]!=null&&row[k]!=="") return row[k]; return null; };
  const lastOf  = lbl => { const c=find(lbl); if(!c) return null; const row=aoa[c.ri]||[]; let last=null;
    for(let k=c.ci+1;k<row.length;k++) if(row[k]!=null&&row[k]!=="") last=row[k]; return last; };
  const fp = fpKey(rightOf("N° DE FP"));
  const sheet = { _id:fp, fp, client:String(rightOf("CLIENT")||"").trim(),
    affaire:String(rightOf("AFFAIRE")||"").trim(), commercial:String(rightOf("COMMERCIAL")||"").trim(),
    costTotal:num(lastOf("PRIX DE REVIENT")), saleTotal:num(lastOf("PRIX DE VENTE NEURONES")),
    margin:num(lastOf("MARGE BRUTE NEURONES")), marginPct:(v=>v>1.5?v/100:v)(num(lastOf("% DE MARGE BRUTE"))), source:"fiche" };
  // table BC : en-tête = ligne contenant "fournisseur" ; colonnes C..I ; données 16→ jusqu'à "TOTAL"
  const bc = [];
  let hr=-1, col={}; aoa.forEach((row,ri)=>{ if(row&&row.some(v=>typeof v==="string"&&noAcc(v).trim()==="fournisseur")){
    hr=ri; row.forEach((v,ci)=>{ if(typeof v==="string") col[noAcc(v).trim()]=ci; }); }});
  const pick=(...k)=>{ for(const key in col) if(k.some(s=>key.includes(s))) return col[key]; return -1; };
  const cF=pick("fournisseur"),cX=pick("charges en xof"),cT=pick("type"),cB=pick("bc"),cD=pick("description");
  if(hr>=0) for(let ri=hr+1; ri<aoa.length; ri++){ const row=aoa[ri]||[]; const b=row[1];
    if(typeof b==="string"&&noAcc(b).includes("total")) break;
    const frn=cF>=0?String(row[cF]||"").trim():""; const xof=cX>=0?num(row[cX]):0;
    if((frn&&frn!=="0")||xof>0) bc.push({ _id:`${fp}_${bc.length}`, fp, lineIndex:bc.length,
      bcNumber:cB>=0?String(row[cB]||"").trim():"", description:cD>=0?String(row[cD]||"").trim():"",
      supplier:frn.toUpperCase(), expenseType:cT>=0?String(row[cT]||"").trim():"", currency:"XOF",
      amountXof:xof, status:"a_emettre" }); }
  return { sheet, bcLines:bc };
}

// parseFacturationDf (§17.3), parseSalesData (§17.5) — mêmes conventions ...
const PARSERS = { pnl: parsePnl /*, facturationDf, fiche, salesData */ };
function detectKind(wb){ /* signatures de colonnes/cellules → 'pnl'|'facturationDf'|'fiche'|'salesData' */ }
function docRef(kind, r){ return ({ pnl:()=>db.doc(`orders/${r._id}`),
  facturationDf:()=>db.doc(`invoices/${r._id}`), fiche:()=>db.doc(`projectSheets/${r._id}`),
  salesData:()=>db.doc(`opportunities/${r._id}`) }[kind])(); }

exports.setUserRole = onCall(async (req) => {
  if (req.auth?.token?.role !== "direction") throw new HttpsError("permission-denied","admin requis");
  await getAuth().setCustomUserClaims(req.data.uid, { role: req.data.role });
  await db.collection("auditLog").add({ uid:req.auth.uid, action:"perm_change", module:"habilitations",
    entity:"user", entityId:req.data.uid, detail:{role:req.data.role}, ts:FieldValue.serverTimestamp() });
  return { ok:true };
});
// exports.ingest (voir §9), exports.aggregate, exports.syncSalesData, exports.export, exports.importLegacyBackup
```

**`.github/workflows/ci.yml`** : `pnpm i && pnpm test` (web), `npm --prefix functions test` (Vitest parseurs SheetJS), `firebase emulators:exec "npm run test:rules"`, build, `firebase hosting:channel:deploy preview` puis `firebase deploy` sur `main`.

**`seed/permissions.json`** : matrice §8. À écrire dans `config/permissions` au bootstrap + créer le 1er `direction` (claim via `setUserRole`).

---

## 15. Roadmap F0→F8 + critères d'acceptation

- **F0 Socle** : projet Firebase, Emulator Suite, Hosting (SPA vide), seed `config/permissions`. *✓ `firebase emulators:start` lève tout ; seed présent.*
- **F1 Auth & RBAC** : Auth + claims + `setUserRole` + `firestore.rules` + tests de règles par profil. *✓ une écriture non habilitée est refusée **par les rules** ; login audité.*
- **F2 Ingestion** : `ingest` (P&L, DF, fiche, Sales_DATA) + Storage + `imports` + idempotence + correctif fiche. *✓ ré-import sans doublon ; fiche mal formée lue ; rapport intégrés/ignorés.*
- **F3 Agrégation** : `summaries/*` (backlog FY, pipeline, fournisseurs, overview…). *✓ backlog inchangé quand on change la période ; pondéré = Σ(montant×proba) ; encours = Σ BC non soldés.*
- **F4 Frontend parité** : 13 modules lisant `summaries/*` + détail à la demande. *✓ chiffres = prototype sur mêmes données (valeurs §18).*
- **F5 Écritures gardées** : saisie opp, statut BC, lignes crédit, objectifs, matrice droits. *✓ refus UI + refus rules en profil insuffisant.*
- **F6 Sync quotidien** : `syncSalesData` (Scheduler). *✓ remplace pipeline source sans écraser les saisies.*
- **F7 Bonifications** : atterrissage, alertes, drill-down FP, exports PDF/XLSX, N vs N-1. *✓ atterrissage = réalisé+backlog+pondéré ; export CODIR généré.*
- **F8 Durcissement** : App Check, MFA, export Firestore planifié, BigQuery+Looker (option), tests ≥80%. *✓ sauvegarde/restauration vérifiées.*

---

## 16. Prompt d'amorçage Claude Code

```
Lis docs/BUILD_KIT.md intégralement : c'est LA spécification (métier + Firebase),
faisant autorité et autoportante. Objectif : industrialiser le cockpit
"Pilote Revenu NT CI" en application 100% Firebase serverless, SANS RIEN RETIRER
des 13 modules, en bonifiant (sécurité réelle, temps réel, traçabilité, performance).

Stack imposée : Firebase Hosting (React/Vite/TS) + Firebase Auth (custom claims + MFA)
+ Firestore (collections sources + documents d'agrégat summaries/*) + Cloud Functions Node.js
(ingestion SheetJS, agrégation, setUserRole, syncSalesData, export)
+ Cloud Storage + Cloud Scheduler. RBAC OPPOSABLE via custom claims + Security Rules.

Règles d'or :
- Clé unique N° FP ; sources de vérité P&L / Facturation DF / LIVE / fiche affaire.
- Backlog ancré sur config/fiscal.currentFy (dérivé des données), indépendant de la période.
- Droits appliqués par les Security Rules (le front ne fait jamais autorité).
- Ingestion idempotente par IDs déterministes (orders/{fp}, invoices/{numero},
  bcLines/{fp}_{i}, opportunities/{extId|hash}). Parseurs en Node/SheetJS.
  Respecte l'Annexe §18 à la lettre
  (cellules de la fiche, correctif dataValidation, étapes pipeline, valeurs de contrôle)
  et transforme les valeurs de contrôle en tests de non-régression.
- Dashboards lisent summaries/* (coût/perf) ; détail à la demande ; temps réel + offline.
- Design "Forest & Gold" et composants du prototype conservés.

Méthode : 1) propose firebase.json + arborescence + firestore.rules, attends ma validation ;
2) exécute la Roadmap F0→F8 phase par phase avec tests (rules-unit-testing, pytest parseurs,
Vitest) et critères d'acceptation ; pause et résumé à chaque fin de phase.
Ingestion et Functions en Node.js/SheetJS (pas de Python). Commence par F0,
ne passe pas à la phase suivante sans mon feu vert.
```

---

## 17. Annexe métier — faits rétro-conçus (à respecter à la lettre)

> Issus de l'analyse du classeur réel `PIPELINE_NT_CI_Inventory.xlsx`, d'un export Odoo `account.move`, et d'une fiche affaire. **Base des parseurs et des tests de non-régression chiffrés.**

### 18.1 Clé d'or
`FP/AAAA/NNNNN` (ex. `FP/2026/13542`). Normaliser : majuscules, sans espaces, motif `FP\/?\s*\d{4}\/?\s*\d+`. 1 FP = 1 commande ; N factures par FP.

### 18.2 Feuille P&L → `orders` + `orders.suppliers`
- Clé : `Opp ID` = N° FP. Colonnes : `Customer, CAS, CAF Total, RAF TOTAL, MB TOTAL` (utiliser **MB TOTAL**, pas MB Réel), `BU`, `Year PO`, `AM`.
- Ventilation : `Frns1..10` (montants) + `Frns1 N..10 N` (noms). Noms bruités à ignorer : `COM, MISC, DIVERS, TBD, ALL, PS, 0` + combinés.
- **Contrôle** : ~1581 lignes ; **CAS≈31,7 Md · CAF≈28,4 Md · RAF≈3,66 Md · MB≈6,76 Md (~21%)**. Périmètre embarqué (year≥2024 OU RAF>0) = **798**.

### 18.3 Facturation DF / Odoo `account.move` → `invoices`
- Clé dé-doublonnage : `Numéro` (ex. `JV/2024/01/0002`). Colonnes : `Client, Date, N° FP, Montant HT, BU`, statut paiement.
- Mapping Odoo : `Nom d'affichage du partenaire`→Client, `Date de facturation`→Date, `Numéro`→Numéro, `Référence`→FP, `Total signé en devises`/`Montant HT`→montant.
- **Contrôle** : 2221 factures depuis 2020 ; périmètre 2024+ = **858** ; **rythme mensuel moyen (6 derniers mois) = 447 975 335 FCFA**. Σ factures d'un FP = son `CAF Total`.

### 18.4 Fiche affaire (formulaire fixe) → `projectSheets` + `bcLines`
**Lecture** : parser via **SheetJS** (`sheet_to_json(ws,{header:1})`) — **aucun correctif requis**, SheetJS tolère les `dataValidation sqref` mal formés (ex. `I39;G16:G27`). *(Note : seul openpyxl/Python nécessitait de remplacer `;` par un espace dans `xl/worksheets/sheet*.xml` — non applicable ici.)*

| Donnée | Cellule | Label repère |
|--------|---------|--------------|
| N° FP | **G4** | `F4="N° DE FP :"` |
| Client | **G5** | `F5="CLIENT :"` |
| Affaire | G6 | `F6="AFFAIRE :"` |
| Commercial | G7 | `F7="COMMERCIAL :"` |
| Date fiche | **I9** (série Excel) | `H9="DATE FICHE AFFAIRE :"` |

Table dépenses/BC : en-tête = ligne contenant `FOURNISSEUR` (ligne 15). Colonnes `C=N°BC FRNS, D=DESCRIPTION, E=FOURNISSEUR, F=TYPE, G=DEVISE, H=CHARGES EN DEVISE, I=CHARGES EN XOF`. Données 16→27 (`B="Commande Frns 1..12"`), arrêt à `B="TOTAL Commandes Frns"` (B28). Types : `Matériel, Licences, Support, Logiciel, Frais d'approche, Prestation, Marge arrière`. Devises : `XOF, USD, EUR`.
Récap (valeur = cellule la plus à droite de la ligne, colonne I) : **I37** revient · **I38** vente · **I41** marge · **I42** %MB (si >1,5 → /100).
**Contrôle (PAM-BF)** : `FP/2026/13542`, client `PAM - BF`, `AITEK` 1 007 500 ; revient **1 007 500**, vente **1 085 668**, marge **78 168**, %MB **7,2%**, date **2026-06-30**.
Le template n'a **ni statut BC ni dates** ⇒ statut piloté dans l'app (`a_emettre→…→solde`) ; ajouter `Statut, Date BC, Livraison prévue/réelle` au template pour activer les délais.

### 18.5 Feuille LIVE → `opportunities`
- Colonnes : `N° FP` (souvent vide en amont), `Sales`/`NEW AM`, `Client`, `Domaine`/`BU`, `Montant (HT)`, `Statut` (étape), `IdC` (**probabilité 0..1**), `D Prev` (closing), `MB%`.
- Étapes : `1-Qualification, 2-Montage, 3-Transmise, 4-Négociation, 5-Contractualisation, 6-Gagné, 7-Perdu, 8-Suspendu, 9-Annulé` (normaliser variantes/accents/casse).
- Proba défaut si `IdC` absent : `{1:.10, 2:.25, 3:.40, 4:.60, 5:.80, 8:.05}`. Actif=1-5, veille=8, conversion=6 vs 7.
- **Contrôle** : actif **42,98 Md brut / 13,78 Md pondéré** ; suspendu **24,7 Md** (761) ; **conversion 62%** (1588/966). Top AM (pondéré) : DATCHA≈11,2 ; KOUADIO≈10,8 ; CAUPHY≈7,8.

### 18.6 Exposition fournisseurs (depuis P&L Frns) — contrôle
Exposition totale **≈12,1 Md** ; achat commandes ouvertes **≈6,02 Md**. Top : HIPERDIST (1,96/0,94), WESTCON (1,57/0,94), EXCLUSIVE (1,36/0,75), HDF (1,23/0,60), EXN (0,90/0,59), AITEK (0,79/0,44). Encours calculé = Σ `bcLines.amountXof` non soldés.

### 18.7 Continuité prototype (clés de sauvegarde JSON pour migration)
`uorders, uinv, objectives, lines, fiches, bcStatus, pipeOpps, pipeUser` → collections Firestore correspondantes (IDs déterministes). Conserver : ErrorBoundary par vue, garde-fous de dépôt (format/taille, rapport par fichier), sauvegarde/restauration JSON, mémorisation période+profil, formatage FCFA, garde anti-NaN/zéro.

---

## 18. Définition de « terminé »
Livré quand : 13 modules à parité chiffrée (tests §17) · droits opposables par les Security Rules · ingestion des 4 sources idempotente et auditée · `summaries/*` temps réel · sync Sales_DATA quotidien · bonifications (atterrissage, alertes, drill-down, exports) en place · couverture tests domaine/ingestion ≥80% · déploiement via `firebase deploy` + export Firestore planifié.

> **Cap inchangé : on ne retire rien. Firebase accélère et sécurise l'exploitation ; le périmètre des 13 modules et la logique métier sont intégralement préservés et renforcés.**

*— Fin du kit final Firebase —*
