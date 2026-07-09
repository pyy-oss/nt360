import { describe, it, expect } from "vitest";
import { MAX_ATTEMPTS, nextBackoffMs, isDue, nextState } from "../domain/outboundRetry.js";

describe("outboundRetry — politique de rejeu durable (R7)", () => {
  it("backoff exponentiel plafonné à 1 h", () => {
    expect(nextBackoffMs(1)).toBe(60_000);          // 1 min après 1er échec
    expect(nextBackoffMs(2)).toBe(120_000);         // 2 min
    expect(nextBackoffMs(3)).toBe(240_000);         // 4 min
    expect(nextBackoffMs(20)).toBe(60 * 60_000);    // plafonné à 1 h
  });

  it("isDue : en attente ET échéance atteinte", () => {
    expect(isDue({ status: "pending", nextAttemptMs: 1000 }, 1000)).toBe(true);
    expect(isDue({ status: "pending", nextAttemptMs: 2000 }, 1000)).toBe(false);
    expect(isDue({ status: "delivered", nextAttemptMs: 0 }, 9999)).toBe(false);
    expect(isDue(null, 1)).toBe(false);
  });

  it("nextState : succès → delivered", () => {
    const s = nextState({ attempts: 2 }, true, 5000);
    expect(s.status).toBe("delivered");
    expect(s.attempts).toBe(3);
    expect(s.deliveredMs).toBe(5000);
  });

  it("nextState : échec avant le plafond → pending reprogrammé", () => {
    const s = nextState({ attempts: 1 }, false, 5000, "HTTP 503");
    expect(s.status).toBe("pending");
    expect(s.attempts).toBe(2);
    expect(s.nextAttemptMs).toBe(5000 + nextBackoffMs(2));
    expect(s.lastError).toBe("HTTP 503");
  });

  it("nextState : échec au plafond → failed (dead-letter)", () => {
    const s = nextState({ attempts: MAX_ATTEMPTS - 1 }, false, 5000, "HTTP 500");
    expect(s.status).toBe("failed");
    expect(s.attempts).toBe(MAX_ATTEMPTS);
  });
});
