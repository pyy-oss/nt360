// HANDLER — Automatisation déclarative (Lot 4b) : extraction hors du monolithe index.js (patron R3).
//
// Règles configurables (config/automations) qui génèrent des TÂCHES (objet Activité) quand une opp
// entre dans un état à traiter. Idempotent (clé autoKey `type:oppId`). Fabrique `createAutomations(deps)`
// à injection : aucun global d'index.js référencé. `runAutomationsCore` est RETOURNÉE en plus des deux
// callables car le planifié quotidien (index.js) l'appelle directement. Exports déclarés dans index.js
// (garde-fou de déploiement par nom). Comportement identique à l'inline d'origine.
const { MAX_SCAN, sliceCapped } = require("../domain/scan");
const AUTOMATION_RULE_TYPES = ["opp_no_nextstep", "opp_stale"];

function createAutomations({ onCallG, HttpsError, db, FieldValue, loadUsersMap, nowISO10 }) {
  const setAutomations = onCallG("setAutomations", async (req) => {
    if (req.auth?.token?.nt360Role !== "direction") throw new HttpsError("permission-denied", "admin requis");
    const rulesIn = Array.isArray(req.data?.rules) ? req.data.rules : [];
    const rules = rulesIn
      .filter((r) => r && AUTOMATION_RULE_TYPES.includes(r.type))
      .slice(0, 20)
      .map((r) => ({ type: r.type, enabled: r.enabled === true, dueInDays: Math.min(90, Math.max(1, Math.trunc(Number(r.dueInDays)) || 7)) }));
    await db.doc("config/automations").set({ rules }, { merge: false });
    await db.collection("auditLog").add({ uid: req.auth.uid, action: "set_automations", module: "habilitations", entity: "config", entityId: "automations", detail: { rules: rules.length }, ts: FieldValue.serverTimestamp() });
    return { ok: true, rules };
  });

  // Exécute les règles actives → crée les tâches manquantes (idempotent). Best-effort, borné.
  async function runAutomationsCore(actorUid) {
    const { evaluateAutomations } = require("../domain/automation");
    const cfg = (await db.doc("config/automations").get()).data() || {};
    const rules = Array.isArray(cfg.rules) ? cfg.rules.filter((r) => r.enabled) : [];
    if (!rules.length) return { created: 0, evaluated: 0 };
    const [oppSnap, existingSnap, usersMap] = await Promise.all([
      // Scans BORNÉS (MAX_SCAN+1 + sliceCapped) — `activities` (tâches auto quotidiennes) croît sans limite.
      // source/ageDays/probability : requis pour EXCLURE les auto-perdues par âge (parité cockpit/scoring).
      db.collection("opportunities").select("client", "stage", "nextStep", "stale", "ownerUid", "source", "ageDays", "probability").limit(MAX_SCAN + 1).get(),
      db.collection("activities").where("auto", "==", true).select("autoKey").limit(MAX_SCAN + 1).get(),
      loadUsersMap(),
    ]);
    const { isAgedLost } = require("../domain/oppLifecycle");
    // Ne pas générer de tâche « définir la prochaine action » sur une affaire AUTO-PERDUE PAR ÂGE : le cockpit
    // la traite comme morte (retirée du pipeline actif) → une tâche dessus serait du bruit sur une affaire zombie.
    const opps = sliceCapped(oppSnap.docs).docs.map((d) => ({ id: d.id, ...d.data() })).filter((o) => !isAgedLost(o));
    const existing = new Set(sliceCapped(existingSnap.docs).docs.map((d) => d.data().autoKey).filter(Boolean));
    const tasks = evaluateAutomations(rules, opps, existing);
    if (!tasks.length) return { created: 0, evaluated: opps.length };
    const { ownerChain } = require("../domain/hierarchy");
    const today = nowISO10();
    const dueISO = (days) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };
    let created = 0;
    let batch = db.batch(); let n = 0;
    for (const t of tasks.slice(0, 1000)) {
      const ref = db.collection("activities").doc();
      batch.set(ref, {
        type: "task", subject: t.subject, body: "Tâche générée automatiquement (règle nt360).",
        relatedType: "opportunity", relatedId: t.oppId, relatedName: t.relatedName,
        at: today, dueDate: dueISO(t.dueInDays), done: false,
        ownerUid: t.ownerUid, visibleTo: ownerChain(usersMap, t.ownerUid),
        auto: true, autoKey: t.autoKey, ruleType: t.type,
        createdBy: actorUid || null, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
      });
      created++; n++;
      if (n >= 400) { await batch.commit(); batch = db.batch(); n = 0; }
    }
    if (n) await batch.commit();
    return { created, evaluated: opps.length };
  }

  const runAutomations = onCallG("runAutomations", { memoryMiB: 512, timeoutSeconds: 300 }, async (req) => {
    if (req.auth?.token?.nt360Role !== "direction") throw new HttpsError("permission-denied", "admin requis");
    const r = await runAutomationsCore(req.auth.uid);
    await db.collection("auditLog").add({ uid: req.auth.uid, action: "run_automations", module: "habilitations", entity: "config", entityId: "automations", detail: r, ts: FieldValue.serverTimestamp() });
    return { ok: true, ...r };
  });

  return { setAutomations, runAutomations, runAutomationsCore };
}

module.exports = { createAutomations };
