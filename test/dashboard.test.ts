import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DashboardService, SUMMARY_TREND_MONTHS } from "../src/app/module/dashboard/dashboard.service.js";
import { startTestApp, type Session, type TestApp } from "./helpers/app.js";

/**
 * The landing dashboard's summary: this month, the cash position, and the
 * six-month trend its charts draw. The trend must agree with the rest of the
 * product about what a month's figures are — it goes through the same
 * getSalesAndProfit — and the page must work on every plan.
 */

let t: TestApp;
let operator: Session;

beforeAll(async () => {
  t = await startTestApp();
  operator = await t.api.loginOperator();
});
afterAll(() => t.close());

/** Mid-month at noon, so no timezone can push it into a neighbouring month. */
const monthsAgo = (count: number) => {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth() - count, 15, 12).toISOString();
};

describe("landing summary", () => {
  it("adds up this month, the cash position and a six-month trend", async () => {
    const owner = await t.api.registerAgency("Summary");
    const vault = await t.api.ok("POST", "/accounts", { name: "Vault", openingBalance: 50_000 }, owner);
    const bkash = await t.api.ok("POST", "/accounts", { name: "bKash", openingBalance: 10_000 }, owner);
    const customer = await t.api.ok("POST", "/customers", { name: "Summary Customer", phone: "01711111111" }, owner);

    // This month: a ticket (10,000 sales, 2,000 profit) and a visa case
    // (4,000 sales; the service fee of 1,000 is the agency's margin).
    await t.api.ok("POST", "/ticketing", { customerId: customer.id, passengerName: "Pax Now", pnr: "SUMNOW", fare: 10_000, cost: 8000 }, owner);
    await t.api.ok("POST", "/visa", { customerId: customer.id, country: "Japan", visaType: "Tourist", serviceFee: 1000, embassyFee: 3000 }, owner);

    // Two months ago: 6,000 sales, 1,000 profit.
    await t.api.ok(
      "POST",
      "/ticketing",
      { customerId: customer.id, passengerName: "Pax Past", pnr: "SUMOLD", fare: 6000, cost: 5000, issueDate: monthsAgo(2) },
      owner,
    );

    const category = await t.api.ok("POST", "/expenses/categories", { name: "Office" }, owner);
    await t.api.ok("POST", "/expenses", { categoryId: category.id, cashAccountId: bkash.id, amount: 500 }, owner);

    const { thisMonth, cashFlow, trend } = await t.api.ok("GET", "/dashboard/summary", undefined, owner);

    // The trend: six months, oldest first, ending with this one.
    const now = new Date();
    expect(trend).toHaveLength(SUMMARY_TREND_MONTHS);
    expect(trend.at(-1)).toMatchObject({ year: now.getFullYear(), month: now.getMonth() + 1 });
    for (let i = 1; i < trend.length; i += 1) {
      const previous = trend[i - 1].year * 12 + trend[i - 1].month;
      expect(trend[i].year * 12 + trend[i].month).toBe(previous + 1);
    }

    // One definition: the trend's current month is exactly this month's figures.
    expect(trend.at(-1)).toMatchObject({
      sales: thisMonth.actualSales,
      profit: thisMonth.actualProfit,
      expenses: thisMonth.expenses,
    });
    expect(thisMonth).toMatchObject({ actualSales: 14_000, actualProfit: 3000, expenses: 500 });

    expect(trend.at(-3)).toMatchObject({ sales: 6000, profit: 1000, expenses: 0 });
    for (const month of [trend[0], trend[1], trend[2], trend[4]]) {
      expect(month).toMatchObject({ sales: 0, profit: 0, expenses: 0 });
    }

    // Accounts: largest first, and they add up to the headline balance.
    expect(cashFlow.accounts.map((a: { id: string }) => a.id)).toEqual([vault.id, bkash.id]);
    expect(cashFlow.accounts.map((a: { balance: number }) => a.balance)).toEqual([50_000, 9500]);
    const summed = cashFlow.accounts.reduce((sum: number, a: { balance: number }) => sum + a.balance, 0);
    expect(summed).toBe(cashFlow.accountBalance);
    // What customers owe is all-time, not this month: both tickets and the visa.
    expect(cashFlow.customerDue).toBe(20_000);
  });

  it("is served on a plan without Reports, while the analytical views are not", async () => {
    const owner = await t.api.registerAgency("No reports");
    const plan = await t.api.ok(
      "POST",
      "/admin/plans",
      { name: "Tickets only (summary)", price: 500, durationDays: 30, features: ["TICKETING"] },
      operator,
    );
    await t.api.ok("PATCH", `/admin/agencies/${owner.user.agencyId}/plan`, { planId: plan.id }, operator);

    const summary = await t.api.get("/dashboard/summary", owner);
    expect(summary.status).toBe(200);
    expect(summary.body.data.trend).toHaveLength(SUMMARY_TREND_MONTHS);

    expect((await t.api.get("/dashboard/monthly", owner)).status).toBe(403);
    expect((await t.api.get("/dashboard/cash-flow", owner)).status).toBe(403);
  });

  it("shows a new agency nothing but zeros, and never another agency's figures", async () => {
    const fresh = await t.api.registerAgency("Fresh");
    const { thisMonth, cashFlow, trend } = await t.api.ok("GET", "/dashboard/summary", undefined, fresh);

    expect(thisMonth).toMatchObject({ actualSales: 0, actualProfit: 0, expenses: 0 });
    expect(cashFlow).toMatchObject({ accountBalance: 0, customerDue: 0, supplierPayable: 0, accounts: [] });
    expect(trend.every((m: { sales: number; profit: number; expenses: number }) => m.sales === 0 && m.profit === 0 && m.expenses === 0)).toBe(true);
  });

  it("lets staff read it too", async () => {
    const owner = await t.api.registerAgency("Staff summary");
    const email = `staff-summary-${Date.now()}@example.test`;
    await t.api.ok("POST", "/team", { name: "Front Desk", email, role: "AGENCY_STAFF", password: "Staff@12345" }, owner);
    const staff = await t.api.login(email, "Staff@12345");

    expect((await t.api.get("/dashboard/summary", staff)).status).toBe(200);
  });
});

describe("the six-month window", () => {
  it("rolls back across a year boundary", async () => {
    const agency = await t.api.registerAgency("Window");
    const months = await DashboardService.getRecentMonths(agency.user.agencyId!, 6, new Date(2027, 1, 10));

    expect(months.map((m) => `${m.year}-${m.month}`)).toEqual([
      "2026-9",
      "2026-10",
      "2026-11",
      "2026-12",
      "2027-1",
      "2027-2",
    ]);
  });
});
