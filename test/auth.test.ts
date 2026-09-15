import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestApp, type TestApp } from "./helpers/app.js";

let t: TestApp;
beforeAll(async () => {
  t = await startTestApp();
});
afterAll(() => t.close());

describe("health", () => {
  it("reports the database as up", async () => {
    const res = await t.api.get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ database: "up" });
  });
});

describe("better-auth's own HTTP routes", () => {
  // Regression: POST /api/auth/sign-up/email accepted role: "SUPER_ADMIN"
  // from an anonymous body, and update-user let a user rewrite role/agencyId.
  it.each(["/api/auth/sign-up/email", "/api/auth/sign-in/email", "/api/auth/update-user"])(
    "%s is not exposed",
    async (path) => {
      const res = await t.api.request("POST", path, {
        body: { name: "x", email: "x@example.test", password: "Xxxxxxxx1", role: "SUPER_ADMIN" },
      });
      expect(res.status).toBe(404);
    },
  );
});

describe("registration", () => {
  it("creates an AGENCY_ADMIN attached to a new trial agency", async () => {
    const owner = await t.api.registerAgency("Reg");
    expect(owner.user.role).toBe("AGENCY_ADMIN");
    expect(owner.user.agencyId).toBeTruthy();

    const me = await t.api.get("/auth/me", owner);
    expect(me.body.data).toMatchObject({ role: "AGENCY_ADMIN", agency: { status: "TRIAL" } });
  });

  it("ignores a role or agency smuggled into the body", async () => {
    const victim = await t.api.registerAgency("Victim");
    const res = await t.api.post("/auth/register", {
      agencyName: "Sneaky",
      name: "Sneaky",
      email: `sneaky-${Date.now()}@example.test`,
      password: "Sneaky@12345",
      role: "SUPER_ADMIN",
      agencyId: victim.user.agencyId,
    });
    expect(res.status).toBe(201);
    expect(res.body.data.user.role).toBe("AGENCY_ADMIN");
    expect(res.body.data.user.agencyId).not.toBe(victim.user.agencyId);
  });

  it("rejects a duplicate email regardless of case", async () => {
    const owner = await t.api.registerAgency("Dup");
    const res = await t.api.post("/auth/register", {
      agencyName: "Dup again",
      name: "Dup",
      email: owner.email.toUpperCase(),
      password: "Owner@12345",
    });
    expect(res.status).toBe(409);
  });
});

describe("login", () => {
  // Regression: better-auth stores emails lowercased but lookups used the
  // address as typed, so "Rahim@Gmail.com" could never sign in.
  it("accepts the email in any case and with surrounding spaces", async () => {
    const owner = await t.api.registerAgency("Case");
    const session = await t.api.login(`  ${owner.email.toUpperCase()}  `, owner.password);
    expect(session.user.id).toBe(owner.user.id);
  });

  it("rejects a wrong password without saying which part was wrong", async () => {
    const owner = await t.api.registerAgency("Wrong");
    const res = await t.api.post("/auth/login", { email: owner.email, password: "Nope@12345" });
    expect(res.status).toBe(401);
    expect(res.body.message).toBe("Invalid email or password");
  });

  it("requires both the session cookie and the access token", async () => {
    const owner = await t.api.registerAgency("Both");
    const withoutToken = await t.api.request("GET", "/api/v1/auth/me", {
      session: { ...owner, accessToken: "" },
    });
    expect(withoutToken.status).toBe(401);

    const withoutSession = await t.api.request("GET", "/api/v1/auth/me", {
      session: { ...owner, token: "" },
    });
    expect(withoutSession.status).toBe(401);
  });

  it("logout revokes the session", async () => {
    const owner = await t.api.registerAgency("Logout");
    expect((await t.api.post("/auth/logout", {}, owner)).status).toBe(200);
    expect((await t.api.get("/auth/me", owner)).status).toBe(401);
  });
});

describe("change password", () => {
  // Regression: the session was forwarded to better-auth as a raw cookie it
  // could not read, so every change answered 401.
  it("changes the password and clears the forced-change flag", async () => {
    const owner = await t.api.registerAgency("Pw");
    const res = await t.api.post(
      "/auth/change-password",
      { currentPassword: owner.password, newPassword: "Changed@12345" },
      owner,
    );
    expect(res.status).toBe(200);

    const old = await t.api.post("/auth/login", { email: owner.email, password: owner.password });
    expect(old.status).toBe(401);
    const fresh = await t.api.login(owner.email, "Changed@12345");
    expect(fresh.user.needPasswordChange).toBe(false);
  });

  it("refuses a wrong current password", async () => {
    const owner = await t.api.registerAgency("PwWrong");
    const res = await t.api.post(
      "/auth/change-password",
      { currentPassword: "Wrong@12345", newPassword: "Changed@12345" },
      owner,
    );
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect((await t.api.login(owner.email, owner.password)).user.id).toBe(owner.user.id);
  });
});

describe("self rename", () => {
  it("changes the name but never the role", async () => {
    const owner = await t.api.registerAgency("Rename");
    const res = await t.api.patch("/auth/me", { name: "New Name", role: "SUPER_ADMIN" }, owner);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ name: "New Name", role: "AGENCY_ADMIN" });
  });
});
