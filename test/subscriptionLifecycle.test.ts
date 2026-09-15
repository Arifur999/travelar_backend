import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../src/app/lib/prisma.js";
import { testOutbox } from "../src/app/utils/email.js";
import { startTestApp, type Session, type TestApp } from "./helpers/app.js";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

let t: TestApp;
let operator: Session;

beforeAll(async () => {
  t = await startTestApp();
  operator = await t.api.loginOperator();
});
afterAll(() => t.close());
beforeEach(() => {
  testOutbox.length = 0;
});

/** The operator's "run now" — the same pass the hourly schedule runs. */
const runJob = async () => {
  const res = await t.api.post("/admin/jobs/subscription-lifecycle", {}, operator);
  expect(res.status).toBe(200);
  return res.body.data as { expired: number; reminders: number; emails: number };
};

const setAgency = (agencyId: string, data: { status?: "TRIAL" | "ACTIVE" | "EXPIRED" | "SUSPENDED"; trialEndsAt?: Date | null; subscriptionEndsAt?: Date | null }) =>
  prisma.agency.update({ where: { id: agencyId }, data });

const mailTo = (email: string) => testOutbox.filter((m) => m.to === email);

describe("trial reminders", () => {
  it("emails every active admin once, three days out, then again on the last day", async () => {
    const owner = await t.api.registerAgency("TrialSoon");
    const agencyId = owner.user.agencyId!;
    const adminEmail = `second-admin-${Date.now()}@example.test`;
    const staffEmail = `staff-${Date.now()}@example.test`;
    await t.api.ok("POST", "/team", { name: "Second Admin", email: adminEmail, password: "Temp@12345", role: "AGENCY_ADMIN" }, owner);
    await t.api.ok("POST", "/team", { name: "Counter Staff", email: staffEmail, password: "Temp@12345" }, owner);

    await setAgency(agencyId, { trialEndsAt: new Date(Date.now() + 2 * DAY + 3 * HOUR) });
    const first = await runJob();
    expect(first.reminders).toBeGreaterThanOrEqual(1);

    expect(mailTo(owner.email)).toHaveLength(1);
    expect(mailTo(owner.email)[0]!.subject).toMatch(/^Your Travelar trial ends on /);
    expect(mailTo(owner.email)[0]!.html).toContain(`${process.env.FRONTEND_URL}/dashboard/billing`);
    expect(mailTo(adminEmail)).toHaveLength(1);
    expect(mailTo(staffEmail)).toHaveLength(0);

    // Hourly re-runs within the same window send nothing more.
    await runJob();
    await runJob();
    expect(mailTo(owner.email)).toHaveLength(1);

    // Into the final day: the 1-day reminder is a different one, so it goes.
    await prisma.agency.update({ where: { id: agencyId }, data: { trialEndsAt: new Date(Date.now() + 10 * HOUR) } });
    testOutbox.length = 0;
    await runJob();
    expect(mailTo(owner.email)).toHaveLength(1);
    expect(mailTo(owner.email)[0]!.subject).toMatch(/trial ends tomorrow/);
  });

  it("sends only the most urgent reminder when the job missed the earlier window", async () => {
    const owner = await t.api.registerAgency("Missed");
    await setAgency(owner.user.agencyId!, { trialEndsAt: new Date(Date.now() + 5 * HOUR) });
    await runJob();

    const sent = mailTo(owner.email);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.subject).toMatch(/tomorrow/);
    const kinds = await prisma.agencyReminder.findMany({ where: { agencyId: owner.user.agencyId! }, select: { kind: true } });
    expect(kinds.map((k) => k.kind)).toEqual(["TRIAL_ENDING_1_DAY"]);
  });

  it("skips blocked admins and trials that are not close to ending", async () => {
    const owner = await t.api.registerAgency("Blocked");
    const blockedEmail = `blocked-admin-${Date.now()}@example.test`;
    const member = await t.api.ok("POST", "/team", { name: "Blocked Admin", email: blockedEmail, password: "Temp@12345", role: "AGENCY_ADMIN" }, owner);
    await t.api.ok("PATCH", `/team/${member.id}/status`, { status: "BLOCKED" }, owner);

    const far = await t.api.registerAgency("FarAway");
    await setAgency(far.user.agencyId!, { trialEndsAt: new Date(Date.now() + 6 * DAY) });

    await setAgency(owner.user.agencyId!, { trialEndsAt: new Date(Date.now() + 2 * DAY) });
    await runJob();

    expect(mailTo(owner.email)).toHaveLength(1);
    expect(mailTo(blockedEmail)).toHaveLength(0);
    expect(mailTo(far.email)).toHaveLength(0);
  });
});

describe("paid subscriptions", () => {
  it("reminds seven days out, and a renewal to a new end date re-arms the reminder", async () => {
    const owner = await t.api.registerAgency("Paid");
    const agencyId = owner.user.agencyId!;
    const firstEnd = new Date(Date.now() + 5 * DAY);
    await setAgency(agencyId, { status: "ACTIVE", subscriptionEndsAt: firstEnd });

    await runJob();
    expect(mailTo(owner.email)).toHaveLength(1);
    expect(mailTo(owner.email)[0]!.subject).toMatch(/^Your Travelar subscription ends on /);

    await runJob();
    expect(mailTo(owner.email)).toHaveLength(1);

    // Renewed, but the new period is also ending within a week (a short plan).
    await setAgency(agencyId, { subscriptionEndsAt: new Date(firstEnd.getTime() + 1 * DAY) });
    testOutbox.length = 0;
    await runJob();
    expect(mailTo(owner.email)).toHaveLength(1);
  });

  it("does not remind a suspended agency", async () => {
    const owner = await t.api.registerAgency("Suspended");
    await setAgency(owner.user.agencyId!, { status: "SUSPENDED", subscriptionEndsAt: new Date(Date.now() + 2 * DAY) });
    await runJob();
    expect(mailTo(owner.email)).toHaveLength(0);
  });
});

describe("expiry", () => {
  it("flips a lapsed trial to EXPIRED, emails once, and the console shows it at once", async () => {
    const owner = await t.api.registerAgency("Lapsed");
    const agencyId = owner.user.agencyId!;
    await setAgency(agencyId, { trialEndsAt: new Date(Date.now() - 2 * HOUR) });

    // The operator's agency detail already fixes the status, before any job run.
    const detail = await t.api.get(`/admin/agencies/${agencyId}`, operator);
    expect(detail.body.data.status).toBe("EXPIRED");

    await runJob();
    expect(mailTo(owner.email)).toHaveLength(1);
    expect(mailTo(owner.email)[0]!.subject).toMatch(/is now read-only on Travelar$/);

    await runJob();
    expect(mailTo(owner.email)).toHaveLength(1);

    // And the agency itself is read-only, as before.
    expect((await t.api.post("/customers", { name: "Late Customer", phone: "01799999999" }, owner)).status).toBe(403);
  });

  it("an expired subscription flips too", async () => {
    const owner = await t.api.registerAgency("SubLapsed");
    await setAgency(owner.user.agencyId!, { status: "ACTIVE", subscriptionEndsAt: new Date(Date.now() - HOUR) });
    const summary = await runJob();
    expect(summary.expired).toBeGreaterThanOrEqual(1);
    expect((await prisma.agency.findUnique({ where: { id: owner.user.agencyId! } }))!.status).toBe("EXPIRED");
  });

  // Turning the job on for the first time must not email every agency that
  // lapsed months ago.
  it("fixes long-lapsed agencies without emailing them", async () => {
    const owner = await t.api.registerAgency("LongGone");
    await setAgency(owner.user.agencyId!, { trialEndsAt: new Date(Date.now() - 40 * DAY) });
    await runJob();

    expect((await prisma.agency.findUnique({ where: { id: owner.user.agencyId! } }))!.status).toBe("EXPIRED");
    expect(mailTo(owner.email)).toHaveLength(0);
  });
});

describe("who may run it", () => {
  it("the operator's endpoint is SUPER_ADMIN only and is recorded in the activity log", async () => {
    const owner = await t.api.registerAgency("NotOperator");
    expect((await t.api.post("/admin/jobs/subscription-lifecycle", {}, owner)).status).toBe(403);
    expect((await t.api.post("/admin/jobs/subscription-lifecycle", {})).status).toBe(401);

    await runJob();
    const log = await t.api.get("/admin/activity-log?action=lifecycle_run", operator);
    expect(log.body.meta?.total).toBeGreaterThan(0);
  });

  it("the internal endpoint needs the exact cron secret", async () => {
    const path = "/api/v1/internal/jobs/subscription-lifecycle";
    const call = (secret?: string) =>
      fetch(`${t.api.baseUrl}${path}`, { method: "POST", headers: secret === undefined ? {} : { "x-cron-secret": secret } });

    expect((await call()).status).toBe(401);
    expect((await call("wrong")).status).toBe(401);
    expect((await call(`${process.env.CRON_SECRET}x`)).status).toBe(401);
    const ok = await call(process.env.CRON_SECRET);
    expect(ok.status).toBe(200);
    expect((await ok.json()).data).toMatchObject({ expired: expect.any(Number), reminders: expect.any(Number) });
  });
});
