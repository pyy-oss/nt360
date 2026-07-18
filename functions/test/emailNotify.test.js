import { describe, it, expect, beforeEach } from "vitest";
const em = require("../domain/emailNotify");
const { getToken, sendMail, _resetTokenCache } = require("../lib/graphMail");

describe("emailNotify — config & résolution", () => {
  it("normalise la config (défauts + nettoyage emails)", () => {
    const c = em.normalizeEmailConfig({ enabled: true, tenantId: "t", clientId: "c", sender: "no-reply@x.com", recipients: { alerts: ["A@X.com", "bad", "a@x.com"], codir: ["dir@x.com"] } });
    expect(c.enabled).toBe(true);
    expect(c.recipients.alerts).toEqual(["a@x.com"]); // dédup + minuscule + email invalide retiré
    expect(c.recipients.codir).toEqual(["dir@x.com"]);
    expect(c.triggers).toEqual({ approvals: true, relances: true, alerts: true, codir: true, maintenance: true, partenariats: true });
  });
  it("triggers désactivables individuellement (maintenance/partenariats additifs = défaut true)", () => {
    const c = em.normalizeEmailConfig({ triggers: { relances: false, alerts: false } });
    expect(c.triggers).toEqual({ approvals: true, relances: false, alerts: false, codir: true, maintenance: true, partenariats: true });
  });
  it("canSend exige enabled + tenant + client + sender", () => {
    expect(em.canSend(em.normalizeEmailConfig({ enabled: true, tenantId: "t", clientId: "c", sender: "s@x.com" }))).toBe(true);
    expect(em.canSend(em.normalizeEmailConfig({ enabled: true, tenantId: "t" }))).toBe(false);
    expect(em.canSend(em.normalizeEmailConfig({ enabled: false, tenantId: "t", clientId: "c", sender: "s@x.com" }))).toBe(false);
  });
  it("emailForName résout via l'annuaire (nom normalisé)", () => {
    const users = { "awa dupont": { email: "Awa@x.com" } };
    expect(em.emailForName("Awa Dupont", users)).toBe("awa@x.com");
    expect(em.emailForName("Inconnu", users)).toBe(null);
  });
  it("buildApprovalEmail / buildAlertsEmail produisent sujet + html échappé", () => {
    const a = em.buildApprovalEmail({ type: "discount", label: "Remise 15%", amount: 1000000, requester: "Awa <b>" });
    expect(a.subject).toContain("Remise 15%");
    expect(a.html).toContain("&lt;b&gt;"); // requester échappé
    expect(a.html).toContain("FCFA");
    const al = em.buildAlertsEmail([{ message: "3 factures orphelines", count: 3 }], 2026);
    expect(al.subject).toContain("1 alerte");
    expect(al.html).toContain("3 factures orphelines");
  });
  it("buildRelancesEmail : compteurs/totaux depuis les agrégats byResp (pas des items tronqués)", () => {
    // Agrégats COMPLETS par responsable (250 créances, au-delà du plafond d'items 200) → totaux exacts.
    const r = em.buildRelancesEmail("Awa Dupont", { creances: { count: 250, total: 12_000_000 }, bc: { count: 3, total: 0 }, jalons: { count: 0, total: 0 } });
    expect(r.subject).toContain("Awa Dupont");
    expect(r.html).toContain(">250</b> créance"); // compteur complet, pas tronqué à 200
    expect(r.html).toContain("BC fournisseur");
    expect(r.html).not.toContain("jalon"); // count 0 → section omise
  });
  it("buildMntRisqueEmail : digest direction & AM, libellés FR des signaux, données échappées", () => {
    const items = [{ client: "Client <b>", fp: "FP/2026/1", niveau: "critique", score: 85, signals: [{ type: "sla_rompu", count: 2 }, { type: "sous_facturation", ecart: 150000 }] }];
    const dir = em.buildMntRisqueEmail(items, "direction");
    expect(dir.subject).toContain("1 à surveiller");
    expect(dir.html).toContain("Critique");
    expect(dir.html).toContain("SLA rompu");
    expect(dir.html).toContain("Sous-facturation");
    expect(dir.html).toContain("&lt;b&gt;"); // client échappé
    const am = em.buildMntRisqueEmail(items, "Awa Dupont");
    expect(am.subject).toContain("Awa Dupont");
    expect(am.html).toContain("Bonjour Awa Dupont");
    expect(em.buildMntRisqueEmail([], "direction").html).toContain("Aucun contrat à risque");
  });
  it("partenariats — groupParRelancesByManager regroupe par managerUid, ignore les sans-manager", () => {
    const items = [
      { managerUid: "u1", cert: "NSE4", consultantName: "Awa" },
      { managerUid: "u2", cert: "CCNA", consultantName: "Koffi" },
      { managerUid: "u1", cert: "NSE7", consultantName: "Binta" },
      { managerUid: null, cert: "orpheline", consultantName: "Sans manager" },
    ];
    const groups = em.groupParRelancesByManager(items);
    expect(groups).toHaveLength(2); // u1, u2 ; l'item sans managerUid est ignoré
    expect(groups.find((g) => g.managerUid === "u1").items).toHaveLength(2);
    expect(em.groupParRelancesByManager([])).toEqual([]);
    expect(em.groupParRelancesByManager(undefined)).toEqual([]);
  });
  it("partenariats — parBucketLabel : retard/expired + j<offset>", () => {
    expect(em.parBucketLabel("retard")).toBe("En retard");
    expect(em.parBucketLabel("expired")).toBe("Expirée");
    expect(em.parBucketLabel("j30")).toBe("≤ 30 j");
    expect(em.parBucketLabel("j7")).toBe("≤ 7 j");
  });
  it("partenariats — buildParManagerEmail : sujet + lignes échappées, vide géré", () => {
    const m = em.buildParManagerEmail("Awa Dupont", [
      { consultantName: "Koffi <b>", cert: "NSE7", targetDate: "2026-09-30", bucket: "retard" },
    ]);
    expect(m.subject).toContain("Awa Dupont");
    expect(m.subject).toContain("1");
    expect(m.html).toContain("Bonjour Awa Dupont");
    expect(m.html).toContain("&lt;b&gt;"); // consultant échappé
    expect(m.html).toContain("En retard");
    expect(em.buildParManagerEmail("X", []).html).toContain("Aucune assignation");
  });
  it("partenariats — buildParDirectionEmail : compteurs relances + renouvellements (dont expirées)", () => {
    const rel = [{ bucket: "retard" }, { bucket: "j30" }, { bucket: "retard" }];
    const al = [{ bucket: "expired", consultantName: "Awa", certName: "NSE4", expiryDate: "2026-01-01" }, { bucket: "j60", consultantName: "Koffi", certName: "CCNA", expiryDate: "2026-08-01" }];
    const d = em.buildParDirectionEmail(rel, al);
    expect(d.subject).toContain("3 relance");
    expect(d.subject).toContain("2 renouvellement");
    expect(d.html).toContain(">2</b> en retard"); // 2 relances en retard
    expect(d.html).toContain(">1</b> expirée"); // 1 renouvellement expiré
    expect(d.html).toContain("Awa"); // échantillon renouvellements
  });
});

describe("graphMail — jeton (client credentials) + sendMail via fetch injecté", () => {
  beforeEach(() => _resetTokenCache());
  const okTokenFetch = () => {
    let tokenCalls = 0, mailCalls = 0;
    const fetchImpl = async (url, opts) => {
      if (url.includes("/oauth2/v2.0/token")) { tokenCalls++; return { ok: true, status: 200, json: async () => ({ access_token: "TK", expires_in: 3600 }) }; }
      mailCalls++; return { status: 202, text: async () => "" };
    };
    return { fetchImpl, calls: () => ({ tokenCalls, mailCalls }) };
  };

  it("obtient un jeton puis envoie (202 = succès)", async () => {
    const h = okTokenFetch();
    const r = await sendMail({ tenant: "t", clientId: "c", clientSecret: "s", sender: "no-reply@x.com", to: "a@x.com", subject: "Hi", html: "<p>x</p>", fetchImpl: h.fetchImpl });
    expect(r).toEqual({ ok: true, sent: 1 });
  });
  it("met le jeton en cache (2e envoi ne redemande pas de jeton)", async () => {
    const t = { access_token: "TK", expires_in: 3600 };
    let tokenCalls = 0;
    const fetchImpl = async (url) => { if (url.includes("token")) { tokenCalls++; return { ok: true, status: 200, json: async () => t }; } return { status: 202, text: async () => "" }; };
    await sendMail({ tenant: "t", clientId: "c", clientSecret: "s", sender: "s@x.com", to: "a@x.com", subject: "1", html: "x", fetchImpl });
    await sendMail({ tenant: "t", clientId: "c", clientSecret: "s", sender: "s@x.com", to: "b@x.com", subject: "2", html: "x", fetchImpl });
    expect(tokenCalls).toBe(1);
  });
  it("sans destinataire → skip (pas d'appel réseau)", async () => {
    const r = await sendMail({ tenant: "t", clientId: "c", clientSecret: "s", sender: "s@x.com", to: [], subject: "x", html: "x", fetchImpl: async () => { throw new Error("ne doit pas être appelé"); } });
    expect(r.skipped).toBe("no-recipient");
  });
  it("jeton refusé → lève", async () => {
    const fetchImpl = async () => ({ ok: false, status: 401, json: async () => ({ error_description: "bad secret" }) });
    await expect(getToken({ tenant: "t", clientId: "c", clientSecret: "bad", fetchImpl })).rejects.toThrow(/401|bad secret/);
  });
  it("sendMail non-202 → lève", async () => {
    const fetchImpl = async (url) => url.includes("token") ? { ok: true, status: 200, json: async () => ({ access_token: "TK", expires_in: 3600 }) } : { status: 403, text: async () => "Forbidden" };
    await expect(sendMail({ tenant: "t", clientId: "c", clientSecret: "s", sender: "s@x.com", to: "a@x.com", subject: "x", html: "x", fetchImpl })).rejects.toThrow(/403/);
  });
});
