// HANDLER — Contrats de maintenance (mnt_). Lot 1 : contrat + engagements SLA embarqués. Lot 2 :
// tickets + interventions, avec ALIMENTATION DU CRA existant (timesheets) — une seule vérité du temps.
// Extraction hors du monolithe index.js (patron R3, injection). Collections mnt_* callable-only (rules
// read = drapeau + droit `maintenance`, write:false). DOUBLE garde à l'écriture : requireWrite +
// drapeau config/mntFeature ALLUMÉ (ADR-009). Exports déclarés dans index.js (déploiement par nom).
const { safeId } = require("../lib/sheets");
const { isMntEnabled } = require("../domain/mntFeature");
const { MAX_SCAN, sliceCapped } = require("../domain/scan");
const { monthOf, craDaysFromHours } = require("../domain/mntTicket");

function createMaintenance({ onCallG, HttpsError, db, FieldValue, requireWrite, assertPlainId, loadUsersMap, anyDirectionUid }) {
  // Le module doit être ALLUMÉ pour toute écriture. Sans ça, aucune donnée mnt_* ne se crée : l'ERP
  // reste strictement celui d'avant même si un rôle porte le droit `maintenance`.
  async function assertMntEnabled() {
    const cfg = (await db.doc("config/mntFeature").get()).data();
    if (!isMntEnabled(cfg)) throw new HttpsError("failed-precondition", "module Contrats de maintenance désactivé");
  }

  // Recalcule la CONTRIBUTION MAINTENANCE au CRA pour un (consultant × mois) : somme des heures des
  // interventions du mois → jours (ADR-013), écrite dans timesheets/mnt_<consultant>_<mois> avec
  // source « mnt » (id DISTINCT du CRA manuel → aucune collision ; computeConstat somme les deux).
  // 0 h ⇒ suppression du doc (pas de ligne fantôme). Le drapeau garde le tout : éteint ⇒ pas
  // d'interventions ⇒ pas de contribution ⇒ TACE strictement inchangée.
  async function refreshCra(consultantId, month) {
    if (!consultantId || !month) return;
    const snap = await db.collection("mnt_interventions").where("consultantId", "==", consultantId).limit(MAX_SCAN + 1).get();
    let hours = 0;
    for (const d of sliceCapped(snap.docs).docs) { const x = d.data(); if (monthOf(x.date) === month) hours += Number(x.heures) || 0; }
    const ref = db.doc(`timesheets/mnt_${safeId(consultantId)}_${month}`);
    if (hours > 0) await ref.set({ consultantId, month, billedDays: craDaysFromHours(hours), source: "mnt", updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    else await ref.delete().catch(() => {});
  }

  const upsertMntContrat = onCallG("upsertMntContrat", { memoryMiB: 256, timeoutSeconds: 60 }, async (req) => {
    await requireWrite(req, "maintenance");
    await assertMntEnabled();
    const { validateMntContrat } = require("../domain/mntContrat");
    const v = validateMntContrat(req.data);
    if (!v.ok) throw new HttpsError("invalid-argument", v.error);
    const id = safeId(v.value.fp); // 1 contrat = 1 affaire (ADR-001), idempotent
    const ref = db.doc(`mnt_contrats/${id}`);
    const exists = (await ref.get()).exists;
    const doc = { ...v.value, updatedAt: FieldValue.serverTimestamp() };
    if (exists) await ref.set(doc, { merge: true });
    else await ref.set({ ...doc, createdBy: req.auth.uid, createdAt: FieldValue.serverTimestamp() });
    await db.collection("auditLog").add({ uid: req.auth.uid, action: exists ? "update_mnt_contrat" : "create_mnt_contrat", module: "maintenance", entity: "mnt_contrat", entityId: id, detail: { fp: v.value.fp, statut: v.value.statut, montantEngage: v.value.montantEngage }, ts: FieldValue.serverTimestamp() });
    return { ok: true, id };
  });

  // IMPORT EN MASSE des contrats depuis un classeur (.xlsx/.csv). `apply=false` = APERÇU (dry-run,
  // n'écrit rien) ; `apply=true` = applique (upsert par id = safeId(fp), idempotent). Double garde
  // (requireWrite + drapeau) comme toute écriture mnt_. Parseur/plan PURS (parsers/mntImport +
  // domain/mntImport) ; exceljs requis PARESSEUSEMENT (readWorkbook async). Budget aligné import (512/300).
  const importMntContrats = onCallG("importMntContrats", { memoryMiB: 512, timeoutSeconds: 300 }, async (req) => {
    await requireWrite(req, "maintenance");
    await assertMntEnabled();
    const fileB64 = req.data && req.data.fileB64;
    const apply = !!(req.data && req.data.apply);
    if (!fileB64 || typeof fileB64 !== "string") throw new HttpsError("invalid-argument", "fichier manquant");
    const { readWorkbook } = require("../lib/xlsxRead");
    const { parseMntContratsImport } = require("../parsers/mntImport");
    const { planMntContratsImport } = require("../domain/mntImport");
    let wb;
    try { wb = await readWorkbook(Buffer.from(fileB64, "base64")); }
    catch (e) { throw new HttpsError("invalid-argument", "classeur illisible (.xlsx/.csv attendu)"); }
    const { rows, report } = parseMntContratsImport(wb);
    const CAP = 2000; // borne le volume traité (protège mémoire/temps ; au-delà, découper le fichier)
    if (rows.length > CAP) throw new HttpsError("invalid-argument", `trop de lignes (${rows.length} > ${CAP}) — découpez le fichier`);
    // Contrats existants (petite collection, callable-only) — scan borné par prudence.
    const snap = await db.collection("mnt_contrats").limit(MAX_SCAN + 1).get();
    const existing = new Set(sliceCapped(snap.docs).docs.map((d) => d.id));
    const plan = planMntContratsImport(rows, existing);
    const created = plan.toCreate.length, updated = plan.toUpdate.length, skipped = plan.errors.length;
    const s5 = (arr) => arr.slice(0, 5).map((r) => ({ fp: r.value.fp, client: r.value.client, statut: r.value.statut }));
    const samples = { create: s5(plan.toCreate), update: s5(plan.toUpdate), errors: plan.errors.slice(0, 10) };
    if (!apply) return { ok: true, applied: false, created, updated, skipped, rowsParsed: report.rowsParsed, samples };
    // Application : écritures batchées (limite Firestore 500/batch → chunks de 400).
    const all = [...plan.toCreate, ...plan.toUpdate];
    for (let i = 0; i < all.length; i += 400) {
      const batch = db.batch();
      for (const rec of all.slice(i, i + 400)) {
        const ref = db.doc(`mnt_contrats/${rec.id}`);
        const base = { ...rec.value, updatedAt: FieldValue.serverTimestamp() };
        if (existing.has(rec.id)) batch.set(ref, base, { merge: true });
        else batch.set(ref, { ...base, createdBy: req.auth.uid, createdAt: FieldValue.serverTimestamp() });
      }
      await batch.commit();
    }
    await db.collection("auditLog").add({ uid: req.auth.uid, action: "import_mnt_contrats", module: "maintenance", entity: "mnt_contrat", entityId: "(masse)", detail: { created, updated, skipped, rowsParsed: report.rowsParsed }, ts: FieldValue.serverTimestamp() });
    return { ok: true, applied: true, created, updated, skipped, rowsParsed: report.rowsParsed, samples };
  });

  const deleteMntContrat = onCallG("deleteMntContrat", { memoryMiB: 256, timeoutSeconds: 60 }, async (req) => {
    await requireWrite(req, "maintenance");
    await assertMntEnabled();
    const id = assertPlainId(req.data?.id, "id contrat");
    await db.doc(`mnt_contrats/${id}`).delete();
    await db.collection("auditLog").add({ uid: req.auth.uid, action: "delete_mnt_contrat", module: "maintenance", entity: "mnt_contrat", entityId: id, ts: FieldValue.serverTimestamp() });
    return { ok: true };
  });

  const upsertMntTicket = onCallG("upsertMntTicket", { memoryMiB: 256, timeoutSeconds: 60 }, async (req) => {
    await requireWrite(req, "maintenance");
    await assertMntEnabled();
    const { validateTicket } = require("../domain/mntTicket");
    const v = validateTicket(req.data);
    if (!v.ok) throw new HttpsError("invalid-argument", v.error);
    const doc = { ...v.value, updatedAt: FieldValue.serverTimestamp() };
    let id = req.data?.id ? assertPlainId(req.data.id, "id ticket") : null;
    if (id) {
      // Horodatages de TRANSITION (SLA à la minute) : posés UNE fois quand le statut franchit le seuil,
      // jamais réécrits (le SLA se mesure sur le premier passage). Prise en compte = passage en_cours ;
      // résolution = passage resolu/clos.
      const prev = (await db.doc(`mnt_tickets/${id}`).get()).data() || {};
      if (v.value.statut === "en_cours" && !prev.priseEnCompteLe) doc.priseEnCompteLe = FieldValue.serverTimestamp();
      if ((v.value.statut === "resolu" || v.value.statut === "clos") && !prev.resoluLe) doc.resoluLe = FieldValue.serverTimestamp();
      await db.doc(`mnt_tickets/${id}`).set(doc, { merge: true });
    } else { const ref = await db.collection("mnt_tickets").add({ ...doc, ouvertLe: FieldValue.serverTimestamp(), createdBy: req.auth.uid }); id = ref.id; }
    await db.collection("auditLog").add({ uid: req.auth.uid, action: id ? "upsert_mnt_ticket" : "create_mnt_ticket", module: "maintenance", entity: "mnt_ticket", entityId: id, detail: { contratId: v.value.contratId, statut: v.value.statut, priorite: v.value.priorite }, ts: FieldValue.serverTimestamp() });
    return { ok: true, id };
  });

  const deleteMntTicket = onCallG("deleteMntTicket", { memoryMiB: 256, timeoutSeconds: 60 }, async (req) => {
    await requireWrite(req, "maintenance");
    await assertMntEnabled();
    const id = assertPlainId(req.data?.id, "id ticket");
    await db.doc(`mnt_tickets/${id}`).delete();
    await db.collection("auditLog").add({ uid: req.auth.uid, action: "delete_mnt_ticket", module: "maintenance", entity: "mnt_ticket", entityId: id, ts: FieldValue.serverTimestamp() });
    return { ok: true };
  });

  const upsertMntIntervention = onCallG("upsertMntIntervention", { memoryMiB: 256, timeoutSeconds: 60 }, async (req) => {
    await requireWrite(req, "maintenance");
    await assertMntEnabled();
    const { validateIntervention } = require("../domain/mntTicket");
    const v = validateIntervention(req.data);
    if (!v.ok) throw new HttpsError("invalid-argument", v.error);
    const doc = { ...v.value, updatedAt: FieldValue.serverTimestamp() };
    // Édition : on relit l'ancienne valeur pour rafraîchir AUSSI l'ancien (consultant, mois) si changé.
    let id = req.data?.id ? assertPlainId(req.data.id, "id intervention") : null;
    let prev = null;
    if (id) { prev = (await db.doc(`mnt_interventions/${id}`).get()).data() || null; await db.doc(`mnt_interventions/${id}`).set(doc, { merge: true }); }
    else { const ref = await db.collection("mnt_interventions").add({ ...doc, createdBy: req.auth.uid, createdAt: FieldValue.serverTimestamp() }); id = ref.id; }
    await refreshCra(v.value.consultantId, monthOf(v.value.date));
    if (prev && (prev.consultantId !== v.value.consultantId || monthOf(prev.date) !== monthOf(v.value.date))) await refreshCra(prev.consultantId, monthOf(prev.date));
    await db.collection("auditLog").add({ uid: req.auth.uid, action: "upsert_mnt_intervention", module: "maintenance", entity: "mnt_intervention", entityId: id, detail: { ticketId: v.value.ticketId, consultantId: v.value.consultantId, heures: v.value.heures }, ts: FieldValue.serverTimestamp() });
    return { ok: true, id };
  });

  const deleteMntIntervention = onCallG("deleteMntIntervention", { memoryMiB: 256, timeoutSeconds: 60 }, async (req) => {
    await requireWrite(req, "maintenance");
    await assertMntEnabled();
    const id = assertPlainId(req.data?.id, "id intervention");
    const prev = (await db.doc(`mnt_interventions/${id}`).get()).data() || null;
    await db.doc(`mnt_interventions/${id}`).delete();
    if (prev) await refreshCra(prev.consultantId, monthOf(prev.date));
    await db.collection("auditLog").add({ uid: req.auth.uid, action: "delete_mnt_intervention", module: "maintenance", entity: "mnt_intervention", entityId: id, ts: FieldValue.serverTimestamp() });
    return { ok: true };
  });

  // Décision de contrat (renouvellement / résiliation) SOUMISE au moteur d'approbation EXISTANT
  // (ADR-004) — routée vers le manager du demandeur (sinon direction), visible via la sécurité par
  // enregistrement, décidée par le callable `decideApproval` et l'écran Approbations existants. On ne
  // recrée aucun circuit : on ajoute juste une entrée `maintenance`-gouvernée dans `approvals`.
  const submitMntDecision = onCallG("submitMntDecision", { memoryMiB: 256, timeoutSeconds: 60 }, async (req) => {
    await requireWrite(req, "maintenance");
    await assertMntEnabled();
    const kind = String(req.data?.kind || "");
    if (!["renouvellement_contrat", "resiliation_contrat"].includes(kind)) throw new HttpsError("invalid-argument", "nature de décision invalide");
    const contratId = assertPlainId(req.data?.contratId, "id contrat");
    const c = (await db.doc(`mnt_contrats/${contratId}`).get()).data();
    if (!c) throw new HttpsError("not-found", "contrat introuvable");
    const { validateApprovalRequest, approverFor } = require("../domain/approval");
    const { ownerChain } = require("../domain/hierarchy");
    const v = validateApprovalRequest({ kind, entityType: "mnt_contrat", entityId: contratId, entityLabel: `${c.client || ""} · ${c.fp || ""}`.trim(), note: req.data?.note });
    if (!v.ok) throw new HttpsError("invalid-argument", v.error);
    const requester = req.auth.uid;
    const usersMap = await loadUsersMap();
    const approverUid = approverFor(usersMap, requester, await anyDirectionUid(requester));
    if (!approverUid) throw new HttpsError("failed-precondition", "aucun approbateur disponible (définir un manager ou un compte direction)");
    const visibleTo = Array.from(new Set([...ownerChain(usersMap, requester), approverUid]));
    const doc = { ...v.value, status: "pending", requestedBy: requester, requestedByName: (usersMap[requester] && usersMap[requester].name) || null, approverUid, visibleTo, at: new Date().toISOString().slice(0, 10), createdAt: FieldValue.serverTimestamp() };
    const ref = await db.collection("approvals").add(doc);
    await db.collection("auditLog").add({ uid: requester, action: "mnt_decision_submit", module: "maintenance", entity: "approval", entityId: ref.id, detail: { kind, contratId, approverUid }, ts: FieldValue.serverTimestamp() });
    return { ok: true, id: ref.id, approverUid };
  });

  return { upsertMntContrat, importMntContrats, deleteMntContrat, upsertMntTicket, deleteMntTicket, upsertMntIntervention, deleteMntIntervention, submitMntDecision };
}

module.exports = { createMaintenance };
