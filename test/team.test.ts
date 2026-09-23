import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestApp, type Session, type TestApp } from "./helpers/app.js";

let t: TestApp;
let owner: Session;

const addMember = async (as: Session, role: "AGENCY_ADMIN" | "AGENCY_STAFF" = "AGENCY_STAFF") => {
  const email = `member-${Math.random().toString(36).slice(2)}@example.test`;
  const res = await t.api.post("/team", { name: "Member", email, password: "Temp@12345", role }, as);
  return { res, email, password: "Temp@12345" };
};

/** Adds a member and signs them in with their new password already set. */
const activeMember = async (role: "AGENCY_ADMIN" | "AGENCY_STAFF") => {
  const { res, email } = await addMember(owner, role);
  expect(res.status).toBe(201);
  const first = await t.api.login(email, "Temp@12345");
  await t.api.ok("POST", "/auth/change-password", { currentPassword: "Temp@12345", newPassword: "Member@12345" }, first);
  return { id: res.body.data.id as string, email, session: await t.api.login(email, "Member@12345") };
};

beforeAll(async () => {
  t = await startTestApp();
  owner = await t.api.registerAgency("Team");
});
afterAll(() => t.close());

describe("adding members", () => {
  it("creates staff with a temporary password they must change", async () => {
    const { res, email } = await addMember(owner);
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ role: "AGENCY_STAFF", needPasswordChange: true, isOwner: false });

    const session = await t.api.login(email, "Temp@12345");
    expect(session.user.needPasswordChange).toBe(true);
  });

  it("never exposes auth internals", async () => {
    const list = await t.api.get("/team", owner);
    for (const member of list.body.data) {
      expect(member).not.toHaveProperty("password");
      expect(member).not.toHaveProperty("image");
      expect(member).not.toHaveProperty("isDeleted");
    }
    expect(list.body.data.find((m: { id: string }) => m.id === owner.user.id)?.isOwner).toBe(true);
  });

  it("rejects SUPER_ADMIN as a role and a duplicate email", async () => {
    const bad = await t.api.post("/team", { name: "Xavier", email: "x1@example.test", password: "Temp@12345", role: "SUPER_ADMIN" }, owner);
    expect(bad.status).toBe(400);

    const { email } = await addMember(owner);
    const dup = await t.api.post("/team", { name: "Xavier", email: email.toUpperCase(), password: "Temp@12345" }, owner);
    expect(dup.status).toBe(409);
  });

  it("staff can see the team but add no one", async () => {
    const staff = await activeMember("AGENCY_STAFF");
    expect((await t.api.get("/team", staff.session)).status).toBe(200);
    expect((await addMember(staff.session)).res.status).toBe(403);
  });
});

describe("who may act on whom", () => {
  it("a non-owner admin manages staff but not admins, the owner, or themselves", async () => {
    const admin = await activeMember("AGENCY_ADMIN");
    const staff = await activeMember("AGENCY_STAFF");
    const otherAdmin = await activeMember("AGENCY_ADMIN");

    expect((await t.api.patch(`/team/${staff.id}`, { name: "Renamed" }, admin.session)).status).toBe(200);
    expect((await addMember(admin.session, "AGENCY_ADMIN")).res.status).toBe(403);
    expect((await t.api.patch(`/team/${staff.id}`, { role: "AGENCY_ADMIN" }, admin.session)).status).toBe(403);
    expect((await t.api.patch(`/team/${otherAdmin.id}/status`, { status: "BLOCKED" }, admin.session)).status).toBe(403);
    expect((await t.api.patch(`/team/${owner.user.id}/status`, { status: "BLOCKED" }, admin.session)).status).toBe(403);
    expect((await t.api.patch(`/team/${admin.id}/status`, { status: "BLOCKED" }, admin.session)).status).toBe(400);
  });

  it("the owner cannot change their own access either", async () => {
    expect((await t.api.patch(`/team/${owner.user.id}`, { role: "AGENCY_STAFF" }, owner)).status).toBe(400);
  });
});

describe("changes take effect immediately", () => {
  it("demoting signs the member out", async () => {
    const admin = await activeMember("AGENCY_ADMIN");
    expect((await t.api.patch(`/team/${admin.id}`, { role: "AGENCY_STAFF" }, owner)).status).toBe(200);
    expect((await t.api.get("/team", admin.session)).status).toBe(401);
  });

  it("blocking signs them out and stops login; reactivating restores it", async () => {
    const staff = await activeMember("AGENCY_STAFF");
    expect((await t.api.patch(`/team/${staff.id}/status`, { status: "BLOCKED" }, owner)).status).toBe(200);
    expect((await t.api.get("/team", staff.session)).status).toBe(401);
    expect((await t.api.post("/auth/login", { email: staff.email, password: "Member@12345" })).status).toBe(403);

    await t.api.ok("PATCH", `/team/${staff.id}/status`, { status: "ACTIVE" }, owner);
    expect((await t.api.login(staff.email, "Member@12345")).user.id).toBe(staff.id);
  });

  it("a password reset kills sessions, retires the old password and forces a change", async () => {
    const staff = await activeMember("AGENCY_STAFF");
    expect((await t.api.patch(`/team/${staff.id}/reset-password`, { newPassword: "Reset@12345" }, owner)).status).toBe(200);
    expect((await t.api.get("/team", staff.session)).status).toBe(401);
    expect((await t.api.post("/auth/login", { email: staff.email, password: "Member@12345" })).status).toBe(401);
    expect((await t.api.login(staff.email, "Reset@12345")).user.needPasswordChange).toBe(true);
  });

  it("removal stops login and drops them from the list", async () => {
    const staff = await activeMember("AGENCY_STAFF");
    expect((await t.api.delete(`/team/${staff.id}`, owner)).status).toBe(200);
    expect((await t.api.post("/auth/login", { email: staff.email, password: "Member@12345" })).status).toBe(401);
    const list = await t.api.get("/team", owner);
    expect(list.body.data.some((m: { id: string }) => m.id === staff.id)).toBe(false);
  });
});

describe("with a lapsed subscription", () => {
  it("adding members is blocked but locking someone out still works", async () => {
    const other = await t.api.registerAgency("Lapsed");
    const { res } = await addMember(other);
    const memberId = res.body.data.id;

    const operator = await t.api.loginOperator();
    await t.api.ok("PATCH", `/admin/agencies/${other.user.agencyId}/status`, { status: "SUSPENDED" }, operator);

    expect((await addMember(other)).res.status).toBe(403);
    expect((await t.api.patch(`/team/${memberId}/status`, { status: "BLOCKED" }, other)).status).toBe(200);
  });
});

describe("agency profile", () => {
  it("admins edit contact details; null clears; billing fields are refused", async () => {
    const updated = await t.api.patch("/agency/profile", { phone: "+8801700000000", address: "Dhaka" }, owner);
    expect(updated.status).toBe(200);
    expect(updated.body.data).toMatchObject({ phone: "+8801700000000", address: "Dhaka" });

    const cleared = await t.api.patch("/agency/profile", { phone: null }, owner);
    expect(cleared.body.data.phone).toBeNull();

    const sneaky = await t.api.patch("/agency/profile", { status: "ACTIVE", subscriptionEndsAt: "2099-01-01" }, owner);
    expect(sneaky.status).toBe(400);
  });

  it("keeps the contact email the agency registered with", async () => {
    const before = await t.api.ok("GET", "/agency/profile", undefined, owner);
    expect(before.email).toBeTruthy();

    // Sent by an old page, or by anyone poking the API: the field is stripped,
    // and everything alongside it still saves.
    const res = await t.api.patch(
      "/agency/profile",
      { email: "someone-else@example.test", phone: "+8801999999999" },
      owner,
    );

    expect(res.status).toBe(200);
    expect(res.body.data.email).toBe(before.email);
    expect(res.body.data.phone).toBe("+8801999999999");
  });

  it("staff can read it but not change it", async () => {
    const staff = await activeMember("AGENCY_STAFF");
    expect((await t.api.get("/agency/profile", staff.session)).status).toBe(200);
    expect((await t.api.patch("/agency/profile", { name: "Hijack" }, staff.session)).status).toBe(403);
  });
});
