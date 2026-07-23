// HANDLER — Fiches d'affaire (circuit de validation 6 étapes). Extraction hors du monolithe index.js
// (patron R3, comme handlers/opportunities.js). La logique métier PURE vit dans domain/ficheAffaire.js
// (normalizeFiche/applyEdit/advance/reject/presentFor/toProjectSheet/toBcLines) ; ici seulement l'I/O
// (persistance fiche + journal append-only + masquage marge PM côté serveur) et l'alimentation P&L à la
// validation FINALE (backbone orders + projectSheets/margin isolée + bcLines source « fiche »), consommée
// par mergeCommandes au prochain recompute. Doc id = safeId(FP) → 1 fiche par commande. Fabrique
// `createFiches(deps)` à injection ; exports déclarés dans index.js (garde-fou de déploiement par nom).
// Comportement IDENTIQUE à l'inline d'origine.

function createFiches({ onCallG, HttpsError, db, FieldValue, requestRecompute }) {
  function ficheActor(req) {
    return { id: req.auth.uid, name: req.auth.token?.name || req.auth.token?.email || req.auth.uid, role: req.auth.token?.nt360Role || "" };
  }
  // Droit de voir la marge (confidentiel) : direction, ou droit de lecture « rentabilite » dans la matrice.
  async function ficheCanSeeMargin(req) {
    const role = req.auth.token?.nt360Role;
    if (role === "direction") return true;
    const { canRead } = require("../domain/authz");
    const matrix = ((await db.doc("config/permissions").get()).data() || {}).matrix || {};
    return canRead(matrix, role, "rentabilite");
  }
  // Persiste la fiche mise à jour + APPEND l'événement de circuit au journal (append-only, immuable).
  async function writeFicheTransition(id, fiche, event, req) {
    const batch = db.batch();
    batch.set(db.doc(`fiches/${id}`), { ...fiche, _id: id, updatedBy: req.auth.uid, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    batch.set(db.collection(`fiches/${id}/history`).doc(), { ...event, uid: req.auth.uid, ts: FieldValue.serverTimestamp() });
    await batch.commit();
  }
  // Alimente le P&L à la validation FINALE : backbone commande (sinon mergeCommandes ignore la fiche)
  // + identité (projectSheets, public) + marge/coût (projectSheetsMargin, isolé « rentabilite »).
  async function feedPnlFromFiche(fiche) {
    const { toProjectSheet, toBcLines } = require("../domain/ficheAffaire");
    const { safeId } = require("../lib/sheets");
    const { cleanBu } = require("../lib/ids");
    const sheet = toProjectSheet(fiche);
    if (!sheet) return null;
    const id = safeId(sheet.fp);
    // Lignes fournisseur de la fiche (N° BC saisis à l'étape 3) → bcLines source "fiche", pour la TRAÇABILITÉ
    // et la réconciliation logistics↔fiche (bcKey), à parité avec le chemin d'import Excel. source "fiche" =
    // achats PLANIFIÉS, EXCLUS de la SOA/cash/engagement par tous les consommateurs → impact financier NUL.
    // Idempotent : on PURGE les lignes fiche existantes de ce FP (requête mono-champ ficheId, auto-indexée)
    // avant de réécrire → une re-validation ne duplique pas et une ligne retirée disparaît.
    const bcRows = toBcLines(fiche);
    const existing = await db.collection("bcLines").where("ficheId", "==", id).get();
    const batch = db.batch();
    existing.forEach((d) => { if ((d.data() || {}).source === "fiche") batch.delete(d.ref); });
    bcRows.forEach((b, i) => { const bid = `bcfiche_${id}_${i}`; batch.set(db.doc(`bcLines/${bid}`), { ...b, _id: bid, ficheId: id, updatedAt: FieldValue.serverTimestamp() }); });
    batch.set(db.doc(`orders/${id}`), {
      _id: id, fp: sheet.fp, client: sheet.client, designation: sheet.affaire, am: sheet.commercial,
      bu: cleanBu(fiche.bu), cas: sheet.saleTotal, raf: null, suppliers: [],
      source: "fiche_affaire", ficheId: id, updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    batch.set(db.doc(`projectSheets/${id}`), { _id: id, fp: sheet.fp, client: sheet.client, affaire: sheet.affaire, commercial: sheet.commercial, source: "fiche_affaire", ficheId: id }, { merge: true });
    batch.set(db.doc(`projectSheetsMargin/${id}`), { _id: id, fp: sheet.fp, saleTotal: sheet.saleTotal, costTotal: sheet.costTotal, margin: sheet.margin, marginPct: sheet.marginPct }, { merge: true });
    await batch.commit();
    return id;
  }

  // createFiche : crée une fiche en BROUILLON (étape 0). Réservé à l'AC (assistante) — ou direction.
  // id déterministe = safeId(FP) → refuse un doublon (numero_fp UNIQUE) et lie la fiche à la commande.
  const createFiche = onCallG("createFiche", { memoryMiB: 256 }, async (req) => {
    if (!req.auth) throw new HttpsError("unauthenticated", "connexion requise");
    const role = req.auth.token?.nt360Role;
    if (role !== "assistante" && role !== "direction") throw new HttpsError("permission-denied", "création réservée à l'assistance commerciale");
    const { normalizeFiche } = require("../domain/ficheAffaire");
    const { fpKey } = require("../lib/ids");
    const { safeId } = require("../lib/sheets");
    const fp = fpKey((req.data || {}).numero_fp);
    if (!fp) throw new HttpsError("invalid-argument", "N° de FP requis (format FP/AAAA/N)");
    const id = safeId(fp);
    if ((await db.doc(`fiches/${id}`).get()).exists) throw new HttpsError("already-exists", "une fiche d'affaire existe déjà pour ce FP");
    const now = Date.now();
    const fiche = { ...normalizeFiche({ ...(req.data || {}), numero_fp: fp }), etape_started_ms: now, createdBy: req.auth.uid, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() };
    await db.doc(`fiches/${id}`).set({ ...fiche, _id: id }, { merge: true });
    await db.collection("auditLog").add({ uid: req.auth.uid, action: "create_fiche", module: "overview", entity: "fiche", entityId: id, detail: { fp }, ts: FieldValue.serverTimestamp() });
    return { ok: true, id, fp };
  });

  // updateFiche : édite les champs autorisés À L'ÉTAPE COURANTE (verrou serveur porté par applyEdit).
  const updateFiche = onCallG("updateFiche", { memoryMiB: 256 }, async (req) => {
    if (!req.auth) throw new HttpsError("unauthenticated", "connexion requise");
    if (!req.auth.token?.nt360Role) throw new HttpsError("permission-denied", "compte nt360 requis"); // projet partagé : pas d'accès par l'app sœur (+ pas de lecture Firestore inutile)
    const { applyEdit } = require("../domain/ficheAffaire");
    const id = String((req.data || {}).id || "");
    if (!id) throw new HttpsError("invalid-argument", "identifiant de fiche requis");
    const snap = await db.doc(`fiches/${id}`).get();
    if (!snap.exists) throw new HttpsError("not-found", "fiche introuvable");
    const cur = { _id: id, ...snap.data() };
    // Étape 0 = édition des MONTANTS (lignes, vente, provisions). Un rôle qui ne VOIT pas la marge reçoit
    // une fiche aux montants OMIS (presentFor) : le laisser réécrire les lignes détruirait des montants
    // qu'il n'a jamais vus (écrasement aveugle → montants à 0). On refuse — sans effet pour les habilités,
    // et l'étape 3 (saisie des N° de BC, sans montant) reste ouverte au rôle de l'étape.
    if ((cur.etape_courante || 0) === 0 && !(await ficheCanSeeMargin(req))) {
      throw new HttpsError("permission-denied", "édition des montants réservée à un rôle habilité « rentabilité »");
    }
    const r = applyEdit(cur, (req.data || {}).patch || {}, req.auth.token?.nt360Role);
    if (!r.ok) throw new HttpsError("permission-denied", r.error);
    await db.doc(`fiches/${id}`).set({ ...r.fiche, _id: id, updatedBy: req.auth.uid, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    return { ok: true, id };
  });

  // ficheAdvance : SOUMET (étape 0) ou VALIDE une étape → étape suivante. Le DRO pose numero_dc ici.
  // À la validation finale (CDG/DF), alimente le P&L + déclenche le recompute différé.
  const ficheAdvance = onCallG("ficheAdvance", { memoryMiB: 256 }, async (req) => {
    if (!req.auth) throw new HttpsError("unauthenticated", "connexion requise");
    if (!req.auth.token?.nt360Role) throw new HttpsError("permission-denied", "compte nt360 requis");
    const { advance, presentFor } = require("../domain/ficheAffaire");
    const d = req.data || {};
    const id = String(d.id || "");
    if (!id) throw new HttpsError("invalid-argument", "identifiant de fiche requis");
    const snap = await db.doc(`fiches/${id}`).get();
    if (!snap.exists) throw new HttpsError("not-found", "fiche introuvable");
    const r = advance({ _id: id, ...snap.data() }, ficheActor(req), { nowMs: Date.now(), numero_dc: d.numero_dc, commentaire: d.commentaire });
    if (!r.ok) throw new HttpsError(r.errors ? "failed-precondition" : "permission-denied", r.error || "champs obligatoires manquants", { errors: r.errors || null });
    await writeFicheTransition(id, r.fiche, r.event, req);
    let recomputed = false;
    if (r.fiche.terminee) { await feedPnlFromFiche(r.fiche); await requestRecompute(); recomputed = true; }
    await db.collection("auditLog").add({ uid: req.auth.uid, action: "fiche_advance", module: "overview", entity: "fiche", entityId: id, detail: { etape: r.fiche.etape_courante, statut: r.fiche.statut, terminee: !!r.fiche.terminee }, ts: FieldValue.serverTimestamp() });
    return { ok: true, id, fiche: presentFor(r.fiche, req.auth.token?.nt360Role, await ficheCanSeeMargin(req)), recomputed };
  });

  // ficheReject : REJETTE une étape de validation (motif obligatoire) → retour édition AC, vide DC + BC.
  const ficheReject = onCallG("ficheReject", { memoryMiB: 256 }, async (req) => {
    if (!req.auth) throw new HttpsError("unauthenticated", "connexion requise");
    if (!req.auth.token?.nt360Role) throw new HttpsError("permission-denied", "compte nt360 requis");
    const { reject, presentFor } = require("../domain/ficheAffaire");
    const d = req.data || {};
    const id = String(d.id || "");
    if (!id) throw new HttpsError("invalid-argument", "identifiant de fiche requis");
    const snap = await db.doc(`fiches/${id}`).get();
    if (!snap.exists) throw new HttpsError("not-found", "fiche introuvable");
    const r = reject({ _id: id, ...snap.data() }, ficheActor(req), { nowMs: Date.now(), commentaire: d.commentaire });
    if (!r.ok) throw new HttpsError("failed-precondition", r.error);
    await writeFicheTransition(id, r.fiche, r.event, req);
    await db.collection("auditLog").add({ uid: req.auth.uid, action: "fiche_reject", module: "overview", entity: "fiche", entityId: id, detail: { motif: d.commentaire || null }, ts: FieldValue.serverTimestamp() });
    return { ok: true, id, fiche: presentFor(r.fiche, req.auth.token?.nt360Role, await ficheCanSeeMargin(req)) };
  });

  // getFiche : retourne UNE fiche + son journal, MASQUÉE selon le rôle (PM / non-habilité : sans marge).
  const getFiche = onCallG("getFiche", { memoryMiB: 256 }, async (req) => {
    if (!req.auth?.token?.nt360Role) throw new HttpsError("permission-denied", "compte nt360 requis");
    const { presentFor } = require("../domain/ficheAffaire");
    const id = String((req.data || {}).id || "");
    if (!id) throw new HttpsError("invalid-argument", "identifiant de fiche requis");
    const snap = await db.doc(`fiches/${id}`).get();
    if (!snap.exists) throw new HttpsError("not-found", "fiche introuvable");
    const hist = await db.collection(`fiches/${id}/history`).orderBy("horodatage_ms", "desc").limit(200).get();
    return { ok: true, fiche: presentFor({ _id: id, ...snap.data() }, req.auth.token.nt360Role, await ficheCanSeeMargin(req)), history: hist.docs.map((h) => h.data()) };
  });

  // listFiches : liste paginée (bornée), filtrable (statut/client/commercial), MASQUÉE selon le rôle.
  const listFiches = onCallG("listFiches", { memoryMiB: 256 }, async (req) => {
    if (!req.auth?.token?.nt360Role) throw new HttpsError("permission-denied", "compte nt360 requis");
    const { presentFor } = require("../domain/ficheAffaire");
    const d = req.data || {};
    const canSee = await ficheCanSeeMargin(req);
    const role = req.auth.token.nt360Role;
    let q = db.collection("fiches");
    if (d.statut) q = q.where("statut", "==", String(d.statut));
    const snap = await q.limit(Math.min(Number(d.limit) || 500, 1000)).get();
    const cli = d.client ? String(d.client).trim().toUpperCase() : null;
    const com = d.commercial ? String(d.commercial).trim().toUpperCase() : null;
    const rows = snap.docs
      .map((s) => ({ _id: s.id, ...s.data() }))
      .filter((f) => (!cli || String(f.client || "").toUpperCase().includes(cli)) && (!com || String(f.commercial || "").toUpperCase().includes(com)))
      .map((f) => presentFor(f, role, canSee));
    return { ok: true, fiches: rows, count: rows.length };
  });

  // feedPnlFromFiche exposé : réutilisé par d'éventuels appels d'orchestration ; ficheActor/… restent internes.
  return { createFiche, updateFiche, ficheAdvance, ficheReject, getFiche, listFiches, feedPnlFromFiche };
}

module.exports = { createFiches };
