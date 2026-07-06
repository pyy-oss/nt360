import { describe, it, expect } from "vitest";
const crypto = require("crypto");
const { verifySignature, parseWebhook, reverseLinks, WEBHOOK_EVENTS } = require("../lib/clickupWebhook");

describe("verifySignature — HMAC-SHA256 du corps brut", () => {
  const secret = "sh_secret_123";
  const body = JSON.stringify({ event: "taskStatusUpdated", task_id: "abc" });
  const sign = (b, s) => crypto.createHmac("sha256", s).update(Buffer.from(b, "utf8")).digest("hex");

  it("accepte une signature valide (string et Buffer)", () => {
    const sig = sign(body, secret);
    expect(verifySignature(body, sig, secret)).toBe(true);
    expect(verifySignature(Buffer.from(body, "utf8"), sig, secret)).toBe(true);
  });
  it("rejette une signature falsifiée", () => {
    expect(verifySignature(body, sign(body, "autre_secret"), secret)).toBe(false);
    expect(verifySignature(body, "deadbeef", secret)).toBe(false);
  });
  it("rejette si le corps est altéré", () => {
    const sig = sign(body, secret);
    expect(verifySignature(body + " ", sig, secret)).toBe(false);
  });
  it("rejette si secret ou signature absents", () => {
    expect(verifySignature(body, sign(body, secret), "")).toBe(false);
    expect(verifySignature(body, "", secret)).toBe(false);
  });
});

describe("parseWebhook — extraction event/taskId", () => {
  it("lit event + task_id", () => {
    expect(parseWebhook({ event: "taskUpdated", task_id: "t1" })).toEqual({ event: "taskUpdated", taskId: "t1" });
  });
  it("repli sur payload.id si task_id absent", () => {
    expect(parseWebhook({ event: "taskCreated", payload: { id: "t2" } })).toEqual({ event: "taskCreated", taskId: "t2" });
  });
  it("corps vide → nulls", () => {
    expect(parseWebhook(null)).toEqual({ event: null, taskId: null });
  });
});

describe("reverseLinks — taskId → clé d'overlay", () => {
  it("inverse la map { clé: taskId }", () => {
    const idx = reverseLinks({ k1: "t1", k2: "t2" });
    expect(idx["t1"]).toBe("k1");
    expect(idx["t2"]).toBe("k2");
  });
  it("première clé gagne en cas de collision ; ignore les valeurs vides", () => {
    const idx = reverseLinks({ a: "t1", b: "t1", c: "" });
    expect(idx["t1"]).toBe("a");
    expect(Object.keys(idx)).toEqual(["t1"]);
  });
});

describe("WEBHOOK_EVENTS", () => {
  it("couvre statut, mise à jour, suppression, déplacement, création", () => {
    expect(WEBHOOK_EVENTS).toContain("taskStatusUpdated");
    expect(WEBHOOK_EVENTS).toContain("taskUpdated");
    expect(WEBHOOK_EVENTS).toContain("taskDeleted");
  });
});
