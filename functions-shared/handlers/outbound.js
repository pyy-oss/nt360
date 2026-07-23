// HANDLER — Webhooks sortants (R3 architecture : 1re extraction hors du monolithe index.js).
//
// Sous-système AUTONOME de livraison d'événements métier vers un SI tiers, avec LIVRAISON DURABLE
// (file de rejeu outboundQueue + backoff + dead-letter, cf. domain/outboundRetry). Exposé sous forme
// de FABRIQUE `createOutbound(deps)` : les dépendances d'infrastructure (Firestore, logger, FieldValue,
// onSchedule) sont INJECTÉES → le handler ne référence aucun global d'index.js. C'est le patron
// d'extraction documenté dans docs/ARCHITECTURE.md pour amincir progressivement index.js sans changer
// le modèle de déploiement (les exports restent déclarés dans index.js pour le garde-fou de déploiement).

// POST JSON simple ; lève sur réponse non-2xx (utilisé aussi par le test de config du webhook).
async function postJson(url, obj) {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(obj) });
  if (!res.ok) throw new Error(`webhook HTTP ${res.status}`);
}

function createOutbound({ db, logger, FieldValue, onSchedule }) {
  // Diffuse un événement métier vers le webhook sortant si configuré/souscrit. Best-effort (n'échoue
  // JAMAIS l'action appelante). LIVRAISON DURABLE : sur échec, mise en file (outboundQueue) + rejeu.
  async function fireOutbound(event, data) {
    let cfg;
    try {
      cfg = (await db.doc("config/outboundWebhooks").get()).data();
      if (!cfg || !cfg.enabled || !cfg.url || !Array.isArray(cfg.events) || !cfg.events.includes(event)) return;
    } catch (e) { logger.warn("fireOutbound: config illisible", { event, message: e && e.message }); return; }
    const payload = { event, data, ts: new Date().toISOString() };
    try {
      await postJson(cfg.url, payload);
    } catch (e) {
      logger.warn("fireOutbound: échec, mise en file de rejeu", { event, message: e && e.message });
      try {
        const { nextBackoffMs } = require("../domain/outboundRetry");
        await db.collection("outboundQueue").add({
          event, url: cfg.url, payload, status: "pending", attempts: 1,
          nextAttemptMs: Date.now() + nextBackoffMs(1), lastError: String((e && e.message) || e).slice(0, 500),
          createdAt: FieldValue.serverTimestamp(),
        });
      } catch (qe) { logger.error("fireOutbound: mise en file impossible", { event, message: qe && qe.message }); }
    }
  }

  // REJEU DURABLE des webhooks sortants en échec — planifié toutes les 10 min : reprend les événements
  // dus, les re-poste, met à jour l'état (livré / reprogrammé backoff / dead-letter après MAX_ATTEMPTS).
  const retryOutbound = onSchedule({ schedule: "every 10 minutes", timeoutSeconds: 120 }, async () => {
    const { isDue, nextState } = require("../domain/outboundRetry");
    const now = Date.now();
    const snap = await db.collection("outboundQueue").where("status", "==", "pending").limit(200).get();
    const due = snap.docs.filter((d) => isDue(d.data(), now));
    let delivered = 0, requeued = 0, dead = 0;
    for (const d of due) {
      const item = d.data();
      let ok = false, err = null;
      try { await postJson(item.url, item.payload); ok = true; }
      catch (e) { err = (e && e.message) || String(e); }
      const patch = nextState(item, ok, Date.now(), err);
      if (patch.status === "delivered") delivered++;
      else if (patch.status === "failed") dead++;
      else requeued++;
      try { await d.ref.set(patch, { merge: true }); } catch (_) { /* best-effort */ }
    }
    if (due.length) logger.info("retryOutbound", { due: due.length, delivered, requeued, dead });
  });

  return { postJson, fireOutbound, retryOutbound };
}

module.exports = { createOutbound, postJson };
