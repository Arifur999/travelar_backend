import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../src/app/lib/prisma.js";
import { testOutbox } from "../src/app/utils/email.js";
import { startTestApp, type TestApp } from "./helpers/app.js";

let t: TestApp;
beforeAll(async () => {
  t = await startTestApp();
});
afterAll(() => t.close());
beforeEach(() => {
  testOutbox.length = 0;
});

const GENERIC = "If an account exists for that email, a link to reset the password is on its way.";

/** The email is sent after the response, so wait briefly for it to land. */
const waitForEmail = async (to: string, timeoutMs = 3000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const message = testOutbox.find((m) => m.to === to);
    if (message) return message;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return undefined;
};
const noEmailFor = async (to: string) => {
  await new Promise((resolve) => setTimeout(resolve, 400));
  return !testOutbox.some((m) => m.to === to);
};
const tokenFrom = (html: string) => {
  const match = html.match(/\/reset-password\?token=([^"&\s<]+)/);
  return match ? decodeURIComponent(match[1]!) : undefined;
};

describe("requesting a reset", () => {
  it("emails a single-use link to the web app and answers generically", async () => {
    const owner = await t.api.registerAgency("Forgot");
    const res = await t.api.post("/auth/forgot-password", { email: owner.email.toUpperCase() });
    expect(res.status).toBe(200);
    expect(res.body.message).toBe(GENERIC);

    const email = await waitForEmail(owner.email);
    expect(email?.subject).toBe("Reset your Travelar password");
    expect(email?.html).toContain(`${process.env.FRONTEND_URL}/reset-password?token=`);
    expect(email?.text).toContain("expires in 60 minutes");
    // Not better-auth's own URL, which points at its unmounted router.
    expect(email?.html).not.toContain("/api/auth/");
  });

  it("answers an unknown address exactly the same, and sends nothing", async () => {
    const res = await t.api.post("/auth/forgot-password", { email: "nobody-here@example.test" });
    expect(res.status).toBe(200);
    expect(res.body.message).toBe(GENERIC);
    expect(await noEmailFor("nobody-here@example.test")).toBe(true);
  });

  it("sends nothing to a blocked account, with the same answer", async () => {
    const owner = await t.api.registerAgency("BlockedReset");
    const member = await t.api.ok("POST", "/team", { name: "Blocked One", email: `blocked-${Date.now()}@example.test`, password: "Temp@12345" }, owner);
    await t.api.ok("PATCH", `/team/${member.id}/status`, { status: "BLOCKED" }, owner);

    const res = await t.api.post("/auth/forgot-password", { email: member.email });
    expect(res.body.message).toBe(GENERIC);
    expect(await noEmailFor(member.email)).toBe(true);
  });

  // Anyone could otherwise flood a victim's inbox.
  it("allows three requests an hour per address, then refuses — known or not", async () => {
    const owner = await t.api.registerAgency("Flood");
    const statuses: number[] = [];
    for (let i = 0; i < 4; i++) statuses.push((await t.api.post("/auth/forgot-password", { email: owner.email })).status);
    expect(statuses).toEqual([200, 200, 200, 429]);

    const unknown: number[] = [];
    for (let i = 0; i < 4; i++) unknown.push((await t.api.post("/auth/forgot-password", { email: "ghost@example.test" })).status);
    expect(unknown).toEqual([200, 200, 200, 429]);
  });
});

describe("using the link", () => {
  it("sets the new password, retires the old one and signs out every session", async () => {
    const owner = await t.api.registerAgency("Reset");
    await t.api.post("/auth/forgot-password", { email: owner.email });
    const token = tokenFrom((await waitForEmail(owner.email))!.html)!;
    expect(token).toBeTruthy();

    const res = await t.api.post("/auth/reset-password", { token, newPassword: "BrandNew@12345" });
    expect(res.status).toBe(200);

    expect((await t.api.get("/auth/me", owner)).status).toBe(401);
    expect((await t.api.post("/auth/login", { email: owner.email, password: owner.password })).status).toBe(401);
    expect((await t.api.login(owner.email, "BrandNew@12345")).user.id).toBe(owner.user.id);
  });

  it("works exactly once", async () => {
    const owner = await t.api.registerAgency("Once");
    await t.api.post("/auth/forgot-password", { email: owner.email });
    const token = tokenFrom((await waitForEmail(owner.email))!.html)!;

    expect((await t.api.post("/auth/reset-password", { token, newPassword: "First@12345" })).status).toBe(200);
    const again = await t.api.post("/auth/reset-password", { token, newPassword: "Second@12345" });
    expect(again.status).toBe(400);
    expect(again.body.message).toMatch(/invalid or has expired/);
  });

  it("is refused once expired", async () => {
    const owner = await t.api.registerAgency("Expired");
    await t.api.post("/auth/forgot-password", { email: owner.email });
    const token = tokenFrom((await waitForEmail(owner.email))!.html)!;

    await prisma.verification.updateMany({
      where: { identifier: `reset-password:${token}` },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    expect((await t.api.post("/auth/reset-password", { token, newPassword: "Late@123456" })).status).toBe(400);
    expect((await t.api.login(owner.email, owner.password)).user.id).toBe(owner.user.id);
  });

  it("rejects a made-up token and a too-short password", async () => {
    expect((await t.api.post("/auth/reset-password", { token: "made-up-token-value", newPassword: "Whatever@123" })).status).toBe(400);

    const owner = await t.api.registerAgency("Short");
    await t.api.post("/auth/forgot-password", { email: owner.email });
    const token = tokenFrom((await waitForEmail(owner.email))!.html)!;
    expect((await t.api.post("/auth/reset-password", { token, newPassword: "short" })).status).toBe(400);
    // Validation failed before the token was touched, so it still works.
    expect((await t.api.post("/auth/reset-password", { token, newPassword: "LongEnough@1" })).status).toBe(200);
  });

  it("clears a temporary password set by an admin", async () => {
    const owner = await t.api.registerAgency("TempReset");
    const email = `temp-${Date.now()}@example.test`;
    await t.api.ok("POST", "/team", { name: "Temp Member", email, password: "Temp@12345" }, owner);

    await t.api.post("/auth/forgot-password", { email });
    const token = tokenFrom((await waitForEmail(email))!.html)!;
    await t.api.ok("POST", "/auth/reset-password", { token, newPassword: "MyOwn@12345" });

    expect((await t.api.login(email, "MyOwn@12345")).user.needPasswordChange).toBe(false);
  });
});
