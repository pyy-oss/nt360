// HANDLER — Opportunités (source 'saisie') : CRUD + correction + export/import en masse. Extraction hors
// du monolithe index.js (patron R3, comme handlers/staffing.js & timesheets.js). Écriture « pipeline » ;
// sécurité par enregistrement (OWD privé) via assertRecordVisible/visibleToFor ; recompute CIBLÉ (élargi
// aux summaries carnet dès qu'une opp gagnée est touchée, cf. oppScope). Journal de transition d'étape
// (oppHistory → funnel de conversion). Fabrique `createOpportunities(deps)` à injection ; exports déclarés
// dans index.js (garde-fou de déploiement par nom). Comportement IDENTIQUE à l'inline d'origine.
const { MAX_SCAN, sliceCapped } = require("../domain/scan");

function createOpportunities({
  onCallG, HttpsError, db, FieldValue, logger,
  requireWrite, assertRecordVisible, visibleToFor, isRecordAdmin, recordAccessOwd,
  assertPlainId, requestRecompute, oppScope, OPP_RECOMPUTE, OPP_RECOMPUTE_WON,
  fireOutbound, readWorkbook, aoaToXlsxBase64, rateLimit,
}) {
  // Journalise une TRANSITION d'étape dans oppHistory (Lot C) → funnel de conversion réel. La source
  // n'ayant ni date de création ni historique, on construit le funnel à partir de MAINTENANT. Best-effort
  // (n'échoue jamais l'action). Admin SDK → hors rules (oppHistory est write:false côté client).
  async function recordOppTransition({ oppId, from, to, amount, client, am, bu, uid }) {
    try {
      await db.collection("oppHistory").add({
        oppId: oppId || null, from: Number(from) || 0, to: Number(to) || 0, amount: Number(amount) || 0,
        client: client || null, am: am || null, bu: bu || null, uid: uid || null, at: FieldValue.serverTimestamp(),
      });
    } catch (e) { logger.warn("oppHistory: écriture impossible", { message: e && e.message }); }
  }

  const upsertOpportunity = onCallG("upsertOpportunity", { memoryMiB: 512, timeoutSeconds: 120 }, async (req) => {
    await requireWrite(req, "pipeline");
    const { fpKey } = require("../lib/ids");
    const { DEFAULT_PROBA, STAGE_LABEL } = require("../parsers/salesData");
    const { clampStage, oppWeighted } = require("../domain/mutations");
    const d = req.data || {};
    const client = String(d.client || "").trim();
    if (!client) throw new HttpsError("invalid-argument", "client requis");
    const stage = clampStage(d.stage);
    const amount = Number(d.amount) || 0;
    // Étape précédente (édition d'une saisie existante) → journal de transition si elle change.
    let prevStage = null;
    if (typeof d.id === "string" && d.id.startsWith("saisie_")) {
      const ps = await db.doc(`opportunities/${d.id}`).get();
      if (ps.exists) { await assertRecordVisible(req, "opportunities", ps.data() || {}); prevStage = Number(ps.data().stage) || 0; } // OWD privé : édition dans le périmètre
    }
    // IdC (%) : valeur fournie (0..100) sinon défaut de l'étape — évite un pondéré à 0 par oubli.
    // Une valeur historique en 0-1 reste acceptée (p01 la normalise au calcul).
    const pr = Number(d.probability);
    const probability = pr > 0 && pr <= 100 ? pr : (DEFAULT_PROBA[stage] ?? 0);
    // Édition : id fourni préfixé « saisie_ » ; sinon nouvelle saisie. On ne touche QUE les saisies.
    const isNew = !(typeof d.id === "string" && d.id.startsWith("saisie_"));
    const id = isNew
      ? ("saisie_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8))
      : d.id;
    // Propriété (Lot 2 sécurité par enregistrement) : owner explicite si fourni ; sinon, à la CRÉATION,
    // le créateur devient propriétaire (standard Salesforce). En édition sans owner fourni → inchangé.
    let ownerUid;
    if (d.ownerUid !== undefined) ownerUid = d.ownerUid ? String(d.ownerUid) : null;
    else if (isNew) ownerUid = req.auth.uid;
    // MB prévisionnel : % de marge brute PRÉVISIONNELLE saisie (prévision commerciale, NON confidentielle
    // — distincte de la marge P&L réelle qui, elle, reste isolée dans projectSheetsMargin/rentabilité).
    // Clamp [0,100] ; vide/absent → null. Porté par l'opportunité (lisible au niveau pipeline, par choix).
    const mbRaw = d.mbPrev;
    const mbPrev = (mbRaw === undefined || mbRaw === null || mbRaw === "") ? null : Math.min(100, Math.max(0, Number(mbRaw) || 0));
    const { toISO } = require("../lib/sheets");
    const doc = {
      oppId: id, source: "saisie",
      client, am: String(d.am || "").trim(), bu: String(d.bu || "AUTRE").trim().toUpperCase(),
      fp: fpKey(d.fp) || null,
      amount, stage, stageLabel: STAGE_LABEL[stage] || String(stage),
      probability, weighted: oppWeighted(amount, probability),
      closingDate: d.closingDate || null,
      mbPrev,          // % marge brute prévisionnelle (prévision, non confidentiel)
      // Catégorie de prévision GOUVERNÉE (Lot 5) : posée par le commercial (Commit/Best Case/Pipeline/
      // Omitted), distincte de l'étape. Absente → défaut dérivé de l'étape au calcul (domain/forecast).
      forecastCategory: require("../domain/forecast").FORECAST_CATEGORIES.includes(d.forecastCategory) ? d.forecastCategory : null,
      dr: d.dr === true, // DR (Deal Registration / demande de remise) — booléen Oui/Non
      // Suivi commercial (Lot B) : prochaine action + son échéance (date QU'ON MAÎTRISE → aging honnête
      // du suivi, distinct de la D Prev) ; motif de perte (analytique win/loss sur les opps stage 7).
      nextStep: String(d.nextStep || "").trim().slice(0, 500) || null,
      nextStepDate: d.nextStepDate ? (toISO(d.nextStepDate) || null) : null,
      lostReason: String(d.lostReason || "").trim().slice(0, 200) || null,
      updatedAt: FieldValue.serverTimestamp(),
    };
    if (ownerUid !== undefined) { doc.ownerUid = ownerUid; doc.visibleTo = await visibleToFor(ownerUid); }
    if (d.custom !== undefined) { // champs custom (Lot 7b) : validés contre les définitions actives
      const { sanitizeCustom } = require("../domain/customField");
      const defs = ((await db.doc("config/customFields").get()).data() || {}).fields || [];
      doc.custom = sanitizeCustom(defs, d.custom);
    }
    if (d.lines !== undefined) { // lignes produit / CPQ-lite (Lot 8) : montant DÉRIVÉ des lignes
      const { computeLines } = require("../domain/quote");
      const q = computeLines(d.lines);
      doc.lines = q.lines;
      if (q.lines.length) { doc.amount = q.total; doc.weighted = oppWeighted(q.total, probability); }
    }
    await db.doc(`opportunities/${id}`).set(doc, { merge: true });
    // On propage le montant RÉELLEMENT stocké (doc.amount = total dérivé des lignes si fournies, sinon le
    // montant saisi) au journal funnel et au webhook — sinon amount=0 quand seules des lignes sont posées.
    if (prevStage != null && prevStage !== stage) {
      await recordOppTransition({ oppId: id, from: prevStage, to: stage, amount: doc.amount, client, am: doc.am, bu: doc.bu, uid: req.auth.uid });
    }
    // Webhook sortant (Lot 7b) : opportunité GAGNÉE (transition vers l'étape 6), best-effort.
    if (stage === 6 && prevStage !== 6) await fireOutbound("opp_won", { oppId: id, client, amount: doc.amount, fp: doc.fp, am: doc.am, bu: doc.bu });
    await db.collection("auditLog").add({
      uid: req.auth.uid, action: "upsert_opp", module: "pipeline", entity: "opportunity", entityId: id,
      detail: { client, stage, fp: doc.fp }, ts: FieldValue.serverTimestamp(),
    });
    await requestRecompute(oppScope(prevStage, stage)); // CIBLÉ (élargi si l'opp est/devient « Gagné » → réconciliation carnet)
    return { ok: true, id };
  });

  const deleteOpportunity = onCallG("deleteOpportunity", { memoryMiB: 256, timeoutSeconds: 120 }, async (req) => {
    await requireWrite(req, "pipeline");
    const id = String(req.data?.id || "");
    if (!id.startsWith("saisie_")) throw new HttpsError("failed-precondition", "seules les opportunités saisies sont supprimables");
    // TRAÇABILITÉ (cf. audit) : lecture AVANT suppression pour capturer le contenu supprimé dans auditLog —
    // sinon une suppression manuelle (bouton « Suppr. ») ne laissait AUCUNE trace de qui/quand/quoi.
    const snap = await db.doc(`opportunities/${id}`).get();
    const cur = snap.exists ? (snap.data() || {}) : {};
    await assertRecordVisible(req, "opportunities", cur); // OWD privé : pas de suppression hors périmètre
    await db.doc(`opportunities/${id}`).delete();
    await db.collection("auditLog").add({
      uid: req.auth.uid, action: "delete_opp", module: "pipeline", entity: "opportunity", entityId: id,
      detail: { client: cur.client || null, am: cur.am || null, fp: cur.fp || null, stage: cur.stage ?? null, amount: cur.amount ?? null }, ts: FieldValue.serverTimestamp(),
    });
    await requestRecompute(oppScope(cur.stage, cur.stage)); // CIBLÉ (élargi si l'opp supprimée était « Gagné » → carnet revient au P&L)
    return { ok: true };
  });

  // --- Correction d'une opportunité EXISTANTE (importée ou saisie) : N° FP, D Prev (date de clôture),
  // montant, étape, AM, BU. Contrairement à upsertOpportunity (qui ne crée/édite que des saisies),
  // ce callable corrige N'IMPORTE QUELLE opp SANS toucher à sa `source` — donc pas de détournement
  // (la règle Firestore continue d'interdire au client de basculer une opp importée en 'saisie').
  // Comble le blocage majeur « opp GAGNÉE importée sans N° FP » (non corrigeable in-app jusqu'ici).
  // Au ré-import Sales_DATA, la source reste prioritaire (elle réécrit l'opp) — cohérent « Excel prioritaire ». ---
  const patchOpportunity = onCallG("patchOpportunity", { memoryMiB: 256, timeoutSeconds: 120 }, async (req) => {
    await requireWrite(req, "pipeline");
    const { fpKey } = require("../lib/ids");
    const { STAGE_LABEL } = require("../parsers/salesData");
    const { clampStage, oppWeighted } = require("../domain/mutations");
    const d = req.data || {};
    const id = String(d.id || "");
    if (!id) throw new HttpsError("invalid-argument", "id opportunité requis");
    assertPlainId(id, "id opportunité");
    const ref = db.doc(`opportunities/${id}`);
    const snap = await ref.get();
    if (!snap.exists) throw new HttpsError("not-found", "opportunité introuvable");
    const cur = snap.data() || {};
    await assertRecordVisible(req, "opportunities", cur); // OWD privé : pas d'édition hors périmètre
    const patch = { updatedAt: FieldValue.serverTimestamp() };
    if (d.fp !== undefined) patch.fp = fpKey(d.fp) || null; // '' → détache le FP
    if (d.closingDate !== undefined) patch.closingDate = d.closingDate || null;
    if (d.am !== undefined) patch.am = String(d.am || "").trim();
    if (d.bu !== undefined) patch.bu = String(d.bu || "").trim().toUpperCase();
    if (d.ownerUid !== undefined) { // réaffectation de propriété + visibleTo (Lot 2 sécurité)
      patch.ownerUid = d.ownerUid ? String(d.ownerUid) : null;
      patch.visibleTo = await visibleToFor(patch.ownerUid);
    }
    if (d.forecastCategory !== undefined) { // catégorie de prévision gouvernée (Lot 5)
      const { FORECAST_CATEGORIES } = require("../domain/forecast");
      patch.forecastCategory = FORECAST_CATEGORIES.includes(d.forecastCategory) ? d.forecastCategory : null;
    }
    // Suivi commercial (Lot B) : prochaine action + échéance + motif de perte — éditables sur toute opp.
    if (d.nextStep !== undefined) patch.nextStep = String(d.nextStep || "").trim().slice(0, 500) || null;
    if (d.nextStepDate !== undefined) { const { toISO } = require("../lib/sheets"); patch.nextStepDate = d.nextStepDate ? (toISO(d.nextStepDate) || null) : null; }
    if (d.lostReason !== undefined) patch.lostReason = String(d.lostReason || "").trim().slice(0, 200) || null;
    if (d.stage !== undefined) {
      const stage = clampStage(d.stage);
      patch.stage = stage;
      patch.stageLabel = STAGE_LABEL[stage] || String(stage);
    }
    if (d.amount !== undefined && String(d.amount) !== "") {
      const a = Number(d.amount);
      if (!Number.isFinite(a) || a < 0) throw new HttpsError("invalid-argument", "montant invalide");
      patch.amount = a;
    }
    // IdC (%) éditable : la projection pondère par PALIER d'IdC, pas par étape — corriger l'étape sans
    // pouvoir ajuster l'IdC laissait le pondéré figé. Bornée [0,100] (échelle canonique en %).
    if (d.probability !== undefined && String(d.probability) !== "") {
      const pr = Number(d.probability);
      if (!Number.isFinite(pr) || pr < 0 || pr > 100) throw new HttpsError("invalid-argument", "IdC (0..100) invalide");
      patch.probability = pr;
    }
    if (d.lines !== undefined) { // lignes produit / CPQ-lite (Lot 8) : montant DÉRIVÉ des lignes
      const { computeLines } = require("../domain/quote");
      const q = computeLines(d.lines);
      patch.lines = q.lines;
      if (q.lines.length) patch.amount = q.total; // le pondéré est recalculé par le bloc ci-dessous
    }
    // Pondéré recalculé si le montant OU la probabilité change (valeurs courantes conservées sinon).
    if (patch.amount !== undefined || patch.probability !== undefined) {
      patch.weighted = oppWeighted(patch.amount !== undefined ? patch.amount : cur.amount, patch.probability !== undefined ? patch.probability : cur.probability);
    }
    if (d.custom !== undefined) { // champs custom (Lot 7b) : validés contre les définitions actives
      const { sanitizeCustom } = require("../domain/customField");
      const defs = ((await db.doc("config/customFields").get()).data() || {}).fields || [];
      patch.custom = sanitizeCustom(defs, d.custom);
    }
    if (Object.keys(patch).length <= 1) throw new HttpsError("invalid-argument", "rien à corriger");
    await ref.set(patch, { merge: true });
    // Transition d'étape (inclut le board Kanban qui passe par ici) → journal du funnel (Lot C).
    if (patch.stage !== undefined && patch.stage !== (Number(cur.stage) || 0)) {
      await recordOppTransition({ oppId: id, from: Number(cur.stage) || 0, to: patch.stage, amount: patch.amount !== undefined ? patch.amount : (Number(cur.amount) || 0), client: cur.client, am: patch.am !== undefined ? patch.am : cur.am, bu: patch.bu !== undefined ? patch.bu : cur.bu, uid: req.auth.uid });
    }
    // Webhook sortant (Lot 7b) : transition vers Gagné (étape 6), best-effort.
    if (patch.stage === 6 && (Number(cur.stage) || 0) !== 6) await fireOutbound("opp_won", { oppId: id, client: cur.client, amount: patch.amount !== undefined ? patch.amount : (Number(cur.amount) || 0), fp: patch.fp !== undefined ? patch.fp : cur.fp, am: patch.am !== undefined ? patch.am : cur.am });
    await db.collection("auditLog").add({
      uid: req.auth.uid, action: "patch_opp", module: "pipeline", entity: "opportunity", entityId: id,
      detail: { fp: patch.fp ?? null, stage: patch.stage ?? null, amount: patch.amount ?? null }, ts: FieldValue.serverTimestamp(),
    });
    // CIBLÉ, élargi si l'opp est/devient « Gagné » : attacher/détacher un FP, changer le montant ou passer
    // à/de l'étape Gagné modifie la réconciliation de la commande → il faut rafraîchir le carnet.
    await requestRecompute(oppScope(cur.stage, patch.stage !== undefined ? patch.stage : cur.stage));
    return { ok: true, id };
  });

  // --- Lot 9 : EXPORT du modèle round-trip des opportunités (.xlsx). Réservé au droit « pipeline »
  // (seul un rédacteur a besoin du modèle pour le ré-importer). En-têtes EXACTS du parseur (parité). ---
  const exportOpportunities = onCallG("exportOpportunities", { memoryMiB: 512, timeoutSeconds: 120 }, async (req) => {
    await requireWrite(req, "pipeline");
    const { buildTemplateAoa } = require("../parsers/oppImport");
    // Scan borné (R1) : lecture à MAX_SCAN+1 → troncature SIGNALÉE si dépassement (jamais silencieuse).
    const snap = await db.collection("opportunities").limit(MAX_SCAN + 1).get();
    const { docs, capped } = sliceCapped(snap.docs);
    let opps = docs.map((d) => ({ id: d.id, ...d.data() }));
    // Sécurité par enregistrement : sous OWD « private », un rédacteur non-administrateur n'exporte que
    // les opportunités de sa ligne hiérarchique (même filtre que les autres lecteurs d'opps — re-audit).
    if ((await recordAccessOwd("opportunities")) === "private" && !(await isRecordAdmin(req))) {
      opps = opps.filter((o) => Array.isArray(o.visibleTo) && o.visibleTo.includes(req.auth.uid));
    }
    // Tri lisible : client puis étape (regroupe les lignes à compléter — ex. perdues sans motif).
    opps.sort((a, b) => String(a.client || "").localeCompare(String(b.client || "")) || (Number(a.stage) || 0) - (Number(b.stage) || 0));
    const fileB64 = await aoaToXlsxBase64(buildTemplateAoa(opps), "Opportunités");
    await db.collection("auditLog").add({
      uid: req.auth.uid, action: "export_opps", module: "pipeline", entity: "opportunity", entityId: "*",
      detail: { count: opps.length, capped }, ts: FieldValue.serverTimestamp(),
    });
    const stamp = new Date().toISOString().slice(0, 10);
    return { ok: true, filename: `nt360-opportunites-${stamp}.xlsx`, fileB64, count: opps.length, capped };
  });

  // --- Lot 9 : IMPORT / MISE À JOUR EN MASSE des opportunités (.xlsx/.csv). Deux temps comme le
  // dédoublonnage : apply=false → APERÇU (dry-run, n'écrit RIEN), apply=true → applique. Rapprochement
  // Opp ID → N° FP → création `saisie` ; met à jour uniquement les champs mutables RENSEIGNÉS (jamais
  // l'identité, jamais d'effacement). Réservé au droit « pipeline ». Audité + recompute complet. ---
  const importOpportunities = onCallG("importOpportunities", { memoryMiB: 512, timeoutSeconds: 300 }, async (req) => {
    await requireWrite(req, "pipeline");
    if (rateLimit && !(await rateLimit(req.auth.uid, "heavy", 30, 60_000))) throw new HttpsError("resource-exhausted", "Trop d'imports en peu de temps — patientez un instant.");
    const { fpKey } = require("../lib/ids");
    const { parseOpportunitiesImport } = require("../parsers/oppImport");
    const { planOpportunityImport, finalizeUpdatePatch, buildCreateDoc } = require("../domain/oppImport");
    const b64 = req.data?.fileB64;
    const filename = String(req.data?.filename || "opportunites.xlsx");
    const apply = req.data?.apply === true;
    if (!b64 || typeof b64 !== "string") throw new HttpsError("invalid-argument", "fichier requis (fileB64)");
    // Plafond de charge serveur (défense en profondeur, cf. importDelta) : ~30 M car. base64 ≈ 22 Mo.
    if (b64.length > 30_000_000) throw new HttpsError("invalid-argument", "fichier trop volumineux (> ~22 Mo)");
    let parsed;
    try { parsed = parseOpportunitiesImport(await readWorkbook(Buffer.from(b64, "base64"))); }
    catch (e) { throw new HttpsError("invalid-argument", "classeur illisible : " + (e.message || e)); }
    const { rows, report } = parsed;
    if (!rows.length) throw new HttpsError("failed-precondition", "aucune ligne exploitable dans le fichier");

    // Index des opps existantes : par doc id ET oppId (match Opp ID), par N° FP (1re rencontrée si doublon).
    const snap = await db.collection("opportunities").limit(MAX_SCAN + 1).get(); // scan borné (R1)
    const { docs: idxDocs } = sliceCapped(snap.docs);
    const byId = new Map(), byFp = new Map();
    for (const d of idxDocs) {
      const o = { id: d.id, ...d.data() };
      byId.set(d.id, o);
      if (o.oppId) byId.set(o.oppId, o);
      const fk = fpKey(o.fp);
      if (fk && !byFp.has(fk)) byFp.set(fk, o);
    }
    const { toUpdate, toCreate, skipped } = planOpportunityImport(byId, byFp, rows);

    // Échantillons (aperçu ET trace) — bornés pour ne pas gonfler la réponse callable.
    const cap = (a) => a.slice(0, 50);
    const samples = {
      update: cap(toUpdate).map((u) => ({ line: u.line, id: u.id, client: u.client, matchBy: u.matchBy, changed: u.changed })),
      create: cap(toCreate).map((c) => ({ line: c.line, client: c.client, fp: c.fp })),
      skip: cap(skipped).map((s) => ({ line: s.line, id: s.id || null, reason: s.reason })),
    };
    const counts = { updated: toUpdate.length, created: toCreate.length, skipped: skipped.length, rowsParsed: report.rowsParsed };

    if (!apply) return { ok: true, applied: false, ...counts, samples };

    // --- Application (upsert par batch de 400 ; transitions d'étape journalisées après commit). ---
    let batch = db.batch(), n = 0;
    const flush = async () => { if (n) { await batch.commit(); batch = db.batch(); n = 0; } };
    const transitions = [];
    // Une opp GAGNÉE (stage 6) touchée par l'import réconcilie une commande (mergeCommandes) → portée élargie
    // (cf. oppScope). On lève le drapeau si une MAJ part de/arrive à Gagné, ou si une création naît Gagné.
    let wonTouched = false;
    for (const u of toUpdate) {
      const cur = byId.get(u.id) || {};
      const patch = finalizeUpdatePatch(cur, u.patch);
      patch.updatedAt = FieldValue.serverTimestamp();
      if (u.stageFrom === 6 || patch.stage === 6) wonTouched = true;
      batch.set(db.doc(`opportunities/${u.id}`), patch, { merge: true });
      if (patch.stage !== undefined && patch.stage !== u.stageFrom) {
        transitions.push({ oppId: u.id, from: u.stageFrom, to: patch.stage, amount: patch.amount !== undefined ? patch.amount : (Number(cur.amount) || 0), client: cur.client, am: patch.am !== undefined ? patch.am : cur.am, bu: patch.bu !== undefined ? patch.bu : cur.bu, uid: req.auth.uid });
      }
      if (++n % 400 === 0) await flush();
    }
    let seq = 0;
    const mkId = () => "saisie_" + Date.now().toString(36) + (seq++).toString(36) + Math.random().toString(36).slice(2, 6);
    // Sécurité par enregistrement (Lot 2) : les opps créées en masse appartiennent au créateur, comme la
    // saisie interactive (upsertOpportunity). Sans ça, sous OWD « private », elles seraient invisibles à
    // leur propre créateur jusqu'à un réindex direction (re-audit). Chaîne calculée une fois.
    const creatorVisible = await visibleToFor(req.auth.uid);
    for (const c of toCreate) {
      const id = mkId();
      const doc = buildCreateDoc(c.values, c.fp, id);
      doc.ownerUid = req.auth.uid;
      doc.visibleTo = creatorVisible;
      doc.updatedAt = FieldValue.serverTimestamp();
      if ((doc.stage || 0) === 6) wonTouched = true;
      batch.set(db.doc(`opportunities/${id}`), doc, { merge: true });
      if (++n % 400 === 0) await flush();
    }
    await flush();
    for (const t of transitions) await recordOppTransition(t); // journal funnel (parité patch/upsert)

    await db.collection("imports").add({
      uid: req.auth.uid, kinds: ["opportunities"], filename, objectKey: null, mode: "opp_bulk",
      rowsIn: report.rowsIn, rowsOk: counts.updated + counts.created, rowsSkipped: counts.skipped,
      report: { ...counts }, ts: FieldValue.serverTimestamp(),
    });
    await db.collection("auditLog").add({
      uid: req.auth.uid, action: "import_opps", module: "pipeline", entity: "opportunity", entityId: filename,
      detail: { ...counts }, ts: FieldValue.serverTimestamp(),
    });
    await requestRecompute(wonTouched ? OPP_RECOMPUTE_WON : OPP_RECOMPUTE); // CIBLÉ (élargi si une opp gagnée est touchée → carnet)
    return { ok: true, applied: true, ...counts, samples };
  });

  return { upsertOpportunity, deleteOpportunity, patchOpportunity, exportOpportunities, importOpportunities, recordOppTransition };
}

module.exports = { createOpportunities };
