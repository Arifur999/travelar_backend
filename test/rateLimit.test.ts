import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestApp, type TestApp } from "./helpers/app.js";

/**
 * The suite runs without REDIS_URL, which is exactly the case these guard:
 * the limiter used to fail open without Redis, leaving login unthrottled.
 */

let t: TestApp;
beforeAll(async () => {
  t = await startTestApp();
});
afterAll(() => t.close());

const attemptLogin = (email: string, ip: string) =>
  t.api.request("POST", "/api/v1/auth/login", { body: { email, password: "Wrong@12345" }, ip });

describe("login rate limits", () => {
  it("block the 21st attempt from one address, even with no Redis configured", async () => {
    const statuses: number[] = [];
    for (let i = 1; i <= 21; i++) {
      // Different accounts, so only the per-address limit can trip.
      statuses.push((await attemptLogin(`nobody-${i}@example.test`, "198.51.100.7")).status);
    }
    expect(statuses.slice(0, 20).every((status) => status === 401)).toBe(true);
    expect(statuses[20]).toBe(429);
  });

  it("do not throttle different addresses together", async () => {
    for (let i = 1; i <= 25; i++) {
      const res = await attemptLogin(`crowd-${i}@example.test`, `203.0.113.${i}`);
      expect(res.status).toBe(401);
    }
  });

  // A client that reaches the API directly can forge X-Forwarded-For, so the
  // per-address limit alone cannot protect one account.
  it("cap attempts on one account at 10, whatever addresses they come from", async () => {
    const statuses: number[] = [];
    for (let i = 1; i <= 11; i++) {
      statuses.push((await attemptLogin("victim@example.test", `192.0.2.${i}`)).status);
    }
    expect(statuses.slice(0, 10).every((status) => status === 401)).toBe(true);
    expect(statuses[10]).toBe(429);
  });

  it("count the account case-insensitively", async () => {
    const statuses: number[] = [];
    for (let i = 1; i <= 11; i++) {
      const email = i % 2 ? "Mixed@Example.test" : "mixed@example.TEST";
      statuses.push((await attemptLogin(email, `192.0.2.${100 + i}`)).status);
    }
    expect(statuses[10]).toBe(429);
  });
});
