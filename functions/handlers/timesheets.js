// HANDLER — CRA / temps constaté + activité ESN (Lots 15/17/19/20/21/22 « 20/10 DirOps ») : extraction
// hors du monolithe index.js (patron R3). Compte rendu d'activité mensuel (jours facturés/congés/internes)
// → TACE et occupation RÉELS, tendance, auto-CRA ClickUp, P&L par ressource et pré-facturation. timesheets/*
// callable-only ; id déterministe consultant_mois (upsert sans doublon) ; source « manual » PRIME sur
// l'auto-CRA ClickUp. Écriture « pipeline » ; lecture « overview » (KPI) ou « rentabilite » (coût/TJM).
// Fabrique `createTimesheets(deps)` à injection ; helpers PURS requis directement. Exports déclarés dans
// index.js (garde-fou de déploiement par nom). Comportement identique à l'inline d'origine.
const { MAX_SCAN, sliceCapped } = require("../domain/scan");
const { isMntEnabled } = require("../domain/mntFeature");
const { excludeMaintenance } = require("../domain/timesheet");

function createTimesheets({ onCallG, HttpsError, db, FieldValue, requireWrite, requireRead, assertPlainId, CLICKUP_TOKEN, CLICKUP_TEAM }) {
  // Drapeau du module maintenance : lu à la demande. ÉTEINT ⇒ la contribution CRA « mnt » (ADR-013)
  // est écartée des KPI d'activité (TACE/occupation) pour restaurer strictement l'ERP d'avant (1A).
  async function mntEnabled() {
    try { return isMntEnabled((await db.doc("config/mntFeature").get()).data()); } catch (e) { return false; }
  }
  const upsertTimesheet = onCallG("upsertTimesheet", { memoryMiB: 256, timeoutSeconds: 60 }, async (req) => {
    await requireWrite(req, "pipeline");
    const { validateTimesheet } = require("../domain/timesheet");
    const v = validateTimesheet(req.data);
    if (!v.ok) throw new HttpsError("invalid-argument", v.error);
    const id = assertPlainId(`${v.value.consultantId}_${v.value.month}`, "id CRA"); // 1 CRA par consultant×mois
    // source « manual » : une saisie manuelle PRIME sur l'auto-CRA ClickUp (qui ne l'écrase plus) — cf. audit F1.
    await db.doc(`timesheets/${id}`).set({ ...v.value, source: "manual", updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    await db.collection("auditLog").add({ uid: req.auth.uid, action: "upsert_timesheet", module: "pipeline", entity: "timesheet", entityId: id, detail: { consultantId: v.value.consultantId, month: v.value.month, billedDays: v.value.billedDays }, ts: FieldValue.serverTimestamp() });
    return { ok: true, id };
  });

  const deleteTimesheet = onCallG("deleteTimesheet", { memoryMiB: 256, timeoutSeconds: 60 }, async (req) => {
    await requireWrite(req, "pipeline");
    const id = assertPlainId(req.data?.id, "id CRA");
    await db.doc(`timesheets/${id}`).delete();
    await db.collection("auditLog").add({ uid: req.auth.uid, action: "delete_timesheet", module: "pipeline", entity: "timesheet", entityId: id, ts: FieldValue.serverTimestamp() });
    return { ok: true };
  });

  // KPI constatés (TACE/occupation réels) + occupation PRÉVISIONNELLE sur la même plage → écart constaté vs prévu.
  const timesheetKpis = onCallG("timesheetKpis", { memoryMiB: 256, timeoutSeconds: 60 }, async (req) => {
    await requireRead(req, "overview");
    const { monthsRange, buildLoad } = require("../domain/assignment");
    const { computeConstat } = require("../domain/timesheet");
    const now = new Date();
    // Par défaut : les 6 DERNIERS mois (le constaté regarde le passé, contrairement au prévisionnel).
    let [cy, cm] = [now.getFullYear(), now.getMonth() + 1];
    const span = Math.min(18, Math.max(1, Number(req.data?.months) || 6));
    let sm = cm - span + 1, sy = cy; while (sm < 1) { sm += 12; sy -= 1; }
    const fromYm = req.data?.fromMonth && /^\d{4}-\d{2}$/.test(req.data.fromMonth) ? req.data.fromMonth : `${sy}-${String(sm).padStart(2, "0")}`;
    const months = monthsRange(fromYm, `${cy}-${String(cm).padStart(2, "0")}`);
    const [tSnap, cSnap, aSnap] = await Promise.all([
      db.collection("timesheets").limit(MAX_SCAN + 1).get(),
      db.collection("consultants").select("name", "status").limit(MAX_SCAN + 1).get(),
      db.collection("assignments").select("consultantId", "startMonth", "endMonth", "allocationPct").limit(MAX_SCAN + 1).get(),
    ]);
    let timesheets = sliceCapped(tSnap.docs).docs.map((d) => ({ id: d.id, ...d.data() }));
    // Drapeau maintenance éteint ⇒ la contribution « mnt » disparaît de TACE/occupation (ERP d'avant, 1A).
    if (!(await mntEnabled())) timesheets = excludeMaintenance(timesheets);
    const consultants = sliceCapped(cSnap.docs).docs.map((d) => ({ id: d.id, ...d.data() }));
    const assignments = sliceCapped(aSnap.docs).docs.map((d) => ({ id: d.id, ...d.data() }));
    const nameById = Object.fromEntries(consultants.map((c) => [c.id, c.name || null]));
    const constat = computeConstat(timesheets, months);
    constat.rows = constat.rows.map((r) => ({ ...r, name: nameById[r.consultantId] || r.consultantId }));
    // Occupation prévisionnelle moyenne (plan de charge) sur la même plage, pour l'écart constaté vs prévu.
    const activeIds = consultants.filter((c) => (c.status || "active") === "active").map((c) => c.id);
    const { byConsultant } = buildLoad(assignments, months, activeIds);
    let sum = 0, n = 0;
    for (const id of activeIds) for (const m of months) { sum += Math.min(100, (byConsultant[id] && byConsultant[id][m]) || 0); n += 1; }
    const plannedOccupancyPct = n ? Math.round(sum / n) : 0;
    return { ok: true, months, plannedOccupancyPct, ...constat };
  });

  // HISTORISATION TACE + TENDANCE (Lot 22) — série MENSUELLE du TACE constaté (congés exclus) + occupation,
  // dérivée des CRA (source de vérité) : montre la TENDANCE plutôt qu'un seul chiffre agrégé. DÉRIVÉ À LA
  // DEMANDE (pas de snapshot périmé). Gouverné « overview » comme timesheetKpis (KPI, pas de coût).
  const taceHistory = onCallG("taceHistory", { memoryMiB: 256, timeoutSeconds: 60 }, async (req) => {
    await requireRead(req, "overview");
    const { monthsRange } = require("../domain/assignment");
    const { computeTaceTrend } = require("../domain/taceTrend");
    const now = new Date();
    let [cy, cm] = [now.getFullYear(), now.getMonth() + 1];
    // Par défaut : 12 derniers mois (une tendance a besoin de recul ; bornée à 24 pour rester lisible).
    const span = Math.min(24, Math.max(3, Number(req.data?.months) || 12));
    let sm = cm - span + 1, sy = cy; while (sm < 1) { sm += 12; sy -= 1; }
    const fromYm = req.data?.fromMonth && /^\d{4}-\d{2}$/.test(req.data.fromMonth) ? req.data.fromMonth : `${sy}-${String(sm).padStart(2, "0")}`;
    const months = monthsRange(fromYm, `${cy}-${String(cm).padStart(2, "0")}`, 24);
    const [tSnap, cSnap] = await Promise.all([
      db.collection("timesheets").limit(MAX_SCAN + 1).get(),
      db.collection("consultants").select("bu").limit(MAX_SCAN + 1).get(),
    ]);
    let timesheets = sliceCapped(tSnap.docs).docs.map((d) => ({ id: d.id, ...d.data() }));
    if (!(await mntEnabled())) timesheets = excludeMaintenance(timesheets); // ERP d'avant drapeau éteint (1A)
    const consultants = sliceCapped(cSnap.docs).docs.map((d) => ({ id: d.id, ...d.data() }));
    const trend = computeTaceTrend(timesheets, consultants, months);
    return { ok: true, months, ...trend };
  });

  // IMPORT CRA EN MASSE (Lot 19) — colle un tableau (Nom / mois / facturés / congés / internes) pour
  // renseigner plusieurs CRA d'un coup. Résout le nom contre l'annuaire, valide chaque ligne, upsert par
  // batch (id déterministe consultant_mois). Écriture « pipeline ». Audité.
  const importTimesheets = onCallG("importTimesheets", { memoryMiB: 256, timeoutSeconds: 120 }, async (req) => {
    await requireWrite(req, "pipeline");
    const { parseTimesheetPaste } = require("../domain/timesheetImport");
    const { validateTimesheet } = require("../domain/timesheet");
    const text = String(req.data?.text || "");
    if (!text.trim()) throw new HttpsError("invalid-argument", "texte requis (lignes à coller)");
    const cSnap = await db.collection("consultants").select("name").limit(MAX_SCAN + 1).get();
    const nameToId = {};
    for (const d of sliceCapped(cSnap.docs).docs) { const n = (d.data().name || "").toLowerCase().trim(); if (n) nameToId[n] = d.id; }
    const { rows, errors } = parseTimesheetPaste(text, nameToId);
    if (rows.length > 500) throw new HttpsError("invalid-argument", "trop de lignes (max 500)");
    let batch = db.batch(), n = 0, imported = 0;
    for (const r of rows) {
      const v = validateTimesheet(r);
      if (!v.ok) { errors.push({ line: 0, reason: v.error }); continue; }
      const id = `${v.value.consultantId}_${v.value.month}`;
      // `source:"manual"` INDISPENSABLE (parité avec l'upsert unitaire) : sans lui, `syncClickupTimesheets`
      // (qui ne préserve que `source==="manual"`) ÉCRASE les CRA importés en masse par le temps ClickUp.
      batch.set(db.doc(`timesheets/${id}`), { ...v.value, source: "manual", updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      imported++; if (++n % 400 === 0) { await batch.commit(); batch = db.batch(); n = 0; }
    }
    if (n) await batch.commit();
    await db.collection("auditLog").add({ uid: req.auth.uid, action: "import_timesheets", module: "pipeline", entity: "timesheet", entityId: "*", detail: { imported, errors: errors.length }, ts: FieldValue.serverTimestamp() });
    return { ok: true, imported, errorCount: errors.length, errors: errors.slice(0, 20) };
  });

  // AUTO-CRA DEPUIS CLICKUP (Lot 20) — pré-remplit les jours FACTURÉS du CRA à partir du temps saisi dans
  // ClickUp (time entries), via la correspondance consultant.clickupUserId. Merge → préserve congés/internes
  // déjà saisis. Best-effort : messages clairs si l'intégration est désactivée / non mappée.
  const syncClickupTimesheets = onCallG("syncClickupTimesheets", { secrets: [CLICKUP_TOKEN], memoryMiB: 256, timeoutSeconds: 300 }, async (req) => {
    await requireWrite(req, "pipeline");
    const clickup = require("../lib/clickup");
    const { aggregateTime } = require("../domain/clickupTime");
    const { monthsRange } = require("../domain/assignment");
    const cfg = (await db.doc("config/clickup").get()).data() || {};
    if (cfg.enabled === false) throw new HttpsError("failed-precondition", "intégration ClickUp désactivée (Habilitations)");
    const token = CLICKUP_TOKEN.value();
    if (!token) throw new HttpsError("failed-precondition", "token ClickUp absent (secret CLICKUP_TOKEN)");
    const teamId = cfg.teamId || CLICKUP_TEAM;
    const now = new Date();
    const cy = now.getFullYear(), cm = now.getMonth() + 1;
    const span = Math.min(12, Math.max(1, Number(req.data?.months) || 3)); // derniers N mois (défaut 3)
    let sm = cm - span + 1, sy = cy; while (sm < 1) { sm += 12; sy -= 1; }
    const months = monthsRange(`${sy}-${String(sm).padStart(2, "0")}`, `${cy}-${String(cm).padStart(2, "0")}`);
    const monthsSet = new Set(months);
    const startMs = Date.UTC(sy, sm - 1, 1);
    const endMs = Date.UTC(cy, cm, 0, 23, 59, 59); // dernier jour du mois courant
    const cSnap = await db.collection("consultants").select("name", "clickupUserId").limit(MAX_SCAN + 1).get();
    const u2c = {};
    for (const d of sliceCapped(cSnap.docs).docs) { const cu = d.data().clickupUserId; if (cu) u2c[String(cu)] = d.id; }
    if (!Object.keys(u2c).length) throw new HttpsError("failed-precondition", "aucun consultant n'a d'identifiant ClickUp (champ clickupUserId à renseigner)");
    let entries;
    try { entries = await clickup.listTimeEntries(token, teamId, startMs, endMs); }
    catch (e) { throw new HttpsError("unavailable", "ClickUp : temps non récupéré — " + ((e && e.message) || e)); }
    const rows = aggregateTime(entries, u2c, monthsSet);
    // État existant des CRA sur la fenêtre synchronisée : pour (F1) NE PAS écraser un CRA manuel, et
    // (F2) REMETTRE À 0 un facturé auto dont toutes les saisies ClickUp ont été supprimées (sinon le
    // facturé restait figé à l'ancienne valeur → TACE sur-estimé). `in` borné (months ≤ 12).
    const existing = new Map();
    (await db.collection("timesheets").where("month", "in", months).get()).forEach((d) => existing.set(d.id, d.data() || {}));
    const mappedIds = new Set(Object.values(u2c));
    const aggIds = new Set();

    let batch = db.batch(), n = 0, upserts = 0, skippedManual = 0, reset = 0;
    for (const r of rows) {
      const id = `${r.consultantId}_${r.month}`;
      aggIds.add(id);
      const ex = existing.get(id);
      if (ex && ex.source === "manual") { skippedManual++; continue; } // F1 : le CRA MANUEL prime sur l'auto-CRA
      batch.set(db.doc(`timesheets/${id}`), { consultantId: r.consultantId, month: r.month, billedDays: r.billedDays, source: "clickup", updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      upserts++; if (++n % 400 === 0) { await batch.commit(); batch = db.batch(); n = 0; }
    }
    // F2 : un CRA auto (source clickup) d'un consultant MAPPÉ, dans la fenêtre, ABSENT du nouvel agrégat
    // = toutes ses saisies ClickUp ont été supprimées → on remet le facturé à 0 (merge, congés préservés).
    for (const [id, ex] of existing) {
      if (aggIds.has(id) || ex.source !== "clickup") continue;
      if (!monthsSet.has(ex.month) || !mappedIds.has(ex.consultantId) || (ex.billedDays || 0) === 0) continue;
      batch.set(db.doc(`timesheets/${id}`), { billedDays: 0, source: "clickup", updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      reset++; if (++n % 400 === 0) { await batch.commit(); batch = db.batch(); n = 0; }
    }
    if (n) await batch.commit();
    await db.collection("auditLog").add({ uid: req.auth.uid, action: "sync_clickup_timesheets", module: "pipeline", entity: "timesheet", entityId: "*", detail: { entries: entries.length, upserts, reset, skippedManual, mapped: Object.keys(u2c).length }, ts: FieldValue.serverTimestamp() });
    return { ok: true, entries: entries.length, upserts, reset, skippedManual, mapped: Object.keys(u2c).length, months };
  });

  // RENTABILITÉ PAR RESSOURCE (Lot 17) — P&L par consultant (CA réel = jours facturés × TJM ; coût = jours
  // ouvrés × CJM ; marge), agrégé global + par BU + par grade. DONNÉE CONFIDENTIELLE (coût/marge) → lecture
  // gouvernée « rentabilite » (comme la marge P&L) — un commercial n'y accède pas.
  const resourcePnl = onCallG("resourcePnl", { memoryMiB: 256, timeoutSeconds: 60 }, async (req) => {
    await requireRead(req, "rentabilite");
    const { monthsRange } = require("../domain/assignment");
    const { computeConstat } = require("../domain/timesheet");
    const { computeResourcePnl } = require("../domain/resourcePnl");
    const now = new Date();
    let [cy, cm] = [now.getFullYear(), now.getMonth() + 1];
    const span = Math.min(18, Math.max(1, Number(req.data?.months) || 6));
    let sm = cm - span + 1, sy = cy; while (sm < 1) { sm += 12; sy -= 1; }
    const fromYm = req.data?.fromMonth && /^\d{4}-\d{2}$/.test(req.data.fromMonth) ? req.data.fromMonth : `${sy}-${String(sm).padStart(2, "0")}`;
    const months = monthsRange(fromYm, `${cy}-${String(cm).padStart(2, "0")}`);
    const [cSnap, tSnap, aSnap] = await Promise.all([
      db.collection("consultants").select("name", "bu", "grade", "tjmTarget", "cjm").limit(MAX_SCAN + 1).get(),
      db.collection("timesheets").limit(MAX_SCAN + 1).get(),
      // Affectations : nécessaires pour retenir le TJM CONTRACTUALISÉ couvrant chaque mois (parité pré-facturation).
      db.collection("assignments").select("consultantId", "startMonth", "endMonth", "tjmBilled", "status").limit(MAX_SCAN + 1).get(),
    ]);
    const consultants = sliceCapped(cSnap.docs).docs.map((d) => ({ id: d.id, ...d.data() }));
    // Valorisation au TJM : on ÉCARTE TOUJOURS la contribution « mnt » (jours couverts par le forfait du
    // contrat, ADR-005 → jamais re-valorisés au TJM en marge, décision 2A), quel que soit le drapeau.
    const timesheets = excludeMaintenance(sliceCapped(tSnap.docs).docs.map((d) => ({ id: d.id, ...d.data() })));
    const assignments = sliceCapped(aSnap.docs).docs.map((d) => ({ id: d.id, ...d.data() }));
    const constat = computeConstat(timesheets, months);
    const byId = {};
    for (const r of constat.rows) byId[r.consultantId] = { billedDays: r.billedDays, months: r.months };
    // CA au taux contractualisé : détail des jours facturés PAR MOIS (dans la plage) pour appliquer le TJM
    // d'affectation couvrant chaque mois — sinon Rentabilité et Pré-facturation affichent deux « CA » divergents.
    const monthSet = new Set(months);
    const byMonth = {};
    for (const t of timesheets) {
      if (!t || !monthSet.has(t.month) || (Number(t.billedDays) || 0) <= 0) continue;
      (byMonth[t.consultantId] || (byMonth[t.consultantId] = [])).push({ month: t.month, billedDays: Number(t.billedDays) || 0 });
    }
    const pnl = computeResourcePnl(consultants, byId, { byMonth, assignments });
    return { ok: true, months, ...pnl };
  });

  // PRÉ-FACTURATION DEPUIS LE CRA (Lot 21) — proposition de facturation mensuelle = jours FACTURÉS au CRA ×
  // TJM (taux d'affectation contractualisé prioritaire, sinon TJM cible annuaire), par consultant / BU / mois.
  // LECTURE SEULE : ne crée aucune facture. Gouverné « rentabilite » : expose le TJM et le CA par ressource.
  const preBillingFromCra = onCallG("preBillingFromCra", { memoryMiB: 256, timeoutSeconds: 60 }, async (req) => {
    await requireRead(req, "rentabilite");
    const { monthsRange } = require("../domain/assignment");
    const { computePreBilling } = require("../domain/preBilling");
    const now = new Date();
    let [cy, cm] = [now.getFullYear(), now.getMonth() + 1];
    // Par défaut : les 3 DERNIERS mois (la facturation cadre le passé proche à transmettre à la compta).
    const span = Math.min(18, Math.max(1, Number(req.data?.months) || 3));
    let sm = cm - span + 1, sy = cy; while (sm < 1) { sm += 12; sy -= 1; }
    const fromYm = req.data?.fromMonth && /^\d{4}-\d{2}$/.test(req.data.fromMonth) ? req.data.fromMonth : `${sy}-${String(sm).padStart(2, "0")}`;
    const months = monthsRange(fromYm, `${cy}-${String(cm).padStart(2, "0")}`);
    const [cSnap, tSnap, aSnap] = await Promise.all([
      db.collection("consultants").select("name", "bu", "tjmTarget").limit(MAX_SCAN + 1).get(),
      db.collection("timesheets").limit(MAX_SCAN + 1).get(),
      db.collection("assignments").select("consultantId", "startMonth", "endMonth", "tjmBilled", "projectFp", "label", "status").limit(MAX_SCAN + 1).get(),
    ]);
    const consultants = sliceCapped(cSnap.docs).docs.map((d) => ({ id: d.id, ...d.data() }));
    // Pré-facturation au TJM : contribution « mnt » ÉCARTÉE (forfait, ADR-005 → pas de double facturation, 2A).
    const timesheets = excludeMaintenance(sliceCapped(tSnap.docs).docs.map((d) => ({ id: d.id, ...d.data() })));
    const assignments = sliceCapped(aSnap.docs).docs.map((d) => ({ id: d.id, ...d.data() }));
    const result = computePreBilling(consultants, timesheets, assignments, months);
    return { ok: true, months, ...result };
  });

  // MARGE DE LIVRAISON PAR AFFAIRE (DO Lot 2) : confronte la marge « papier » du carnet à la main-d'œuvre
  // réellement consommée sur l'affaire (labor imputé, keystone Lot 1). Gouverné « rentabilite » comme
  // resourcePnl (expose coûts/marges). Le coût carnet vient du carnet ISOLÉ marge (commandesRowsMargin).
  const deliveryMarginByAffaire = onCallG("deliveryMarginByAffaire", { memoryMiB: 512, timeoutSeconds: 120 }, async (req) => {
    await requireRead(req, "rentabilite");
    const { imputeLaborByFp } = require("../domain/laborImpute");
    const { deliveryMargin } = require("../domain/deliveryMargin");
    const readChunks = async (coll) => {
      const snap = await db.collection(coll).limit(MAX_SCAN + 1).get();
      const out = [];
      for (const d of sliceCapped(snap.docs).docs) for (const r of ((d.data() || {}).rows || [])) out.push(r);
      return out;
    };
    // Astreintes (ADR-035) : chargées SEULEMENT si le module maintenance est ALLUMÉ. Éteint ⇒ aucune lecture
    // mnt_astreintes, aucune soustraction → marge de livraison STRICTEMENT celle d'avant le module (invariant
    // « éteint = ERP d'avant », comme les KPI d'activité de ce fichier).
    const mntOn = await mntEnabled();
    const [cSnap, tSnap, aSnap, astSnap, carnetRows, marginRows] = await Promise.all([
      db.collection("consultants").select("cjm").limit(MAX_SCAN + 1).get(),
      db.collection("timesheets").limit(MAX_SCAN + 1).get(),
      db.collection("assignments").select("consultantId", "startMonth", "endMonth", "allocationPct", "projectFp").limit(MAX_SCAN + 1).get(),
      mntOn ? db.collection("mnt_astreintes").limit(MAX_SCAN + 1).get() : Promise.resolve({ docs: [] }), // charges d'astreinte (ADR-035), gaté drapeau
      readChunks("commandesRows"),        // carnet (vente/facturé par affaire)
      readChunks("commandesRowsMargin"),  // marge isolée (mb/costTotal) — même droit rentabilite
    ]);
    const consultants = sliceCapped(cSnap.docs).docs.map((d) => ({ id: d.id, ...d.data() }));
    // Labor : contribution « mnt » écartée par imputeLaborByFp (forfait, ADR-005) ; imputée sur TOUS les mois
    // présents dans les CRA (la marge de livraison couvre la VIE ENTIÈRE de l'affaire, pas une fenêtre).
    const timesheets = sliceCapped(tSnap.docs).docs.map((d) => ({ id: d.id, ...d.data() }));
    const assignments = sliceCapped(aSnap.docs).docs.map((d) => ({ id: d.id, ...d.data() }));
    const months = [...new Set(timesheets.map((t) => t && t.month).filter(Boolean))];
    const labor = imputeLaborByFp(assignments, timesheets, consultants, months);
    // Charge des astreintes VALIDÉES par FP (ADR-035) — retranchée EN PLUS du labor dans la marge de livraison.
    const { astreinteCostByFp } = require("../domain/mntAstreinte");
    const astreinteByFp = astreinteCostByFp(sliceCapped(astSnap.docs).docs.map((d) => d.data()));
    const rows = deliveryMargin(carnetRows, marginRows, labor.byFp, true, astreinteByFp);
    return { ok: true, rows, unassignedDays: labor.unassignedDays, missingCjm: labor.missingCjm };
  });

  return { upsertTimesheet, deleteTimesheet, timesheetKpis, taceHistory, importTimesheets, syncClickupTimesheets, resourcePnl, preBillingFromCra, deliveryMarginByAffaire };
}

module.exports = { createTimesheets };
