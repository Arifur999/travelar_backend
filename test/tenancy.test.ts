import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestApp, type Session, type TestApp } from "./helpers/app.js";

let t: TestApp;
let a: Session;
let b: Session;
let operator: Session;
const ids: Record<string, string> = {};

beforeAll(async () => {
  t = await startTestApp();
  operator = await t.api.loginOperator();
  a = await t.api.registerAgency("Alpha");
  b = await t.api.registerAgency("Bravo");

  const account = await t.api.ok("POST", "/accounts", { name: "Alpha cash", openingBalance: 5000 }, a);
  const customer = await t.api.ok("POST", "/customers", { name: "Alpha Customer", phone: "01700000001" }, a);
  const ticket = await t.api.ok(
    "POST",
    "/ticketing",
    { customerId: customer.id, passengerName: "Pax One", pnr: "ALPHA1", fare: 1000, cost: 900 },
    a,
  );
  const visa = await t.api.ok("POST", "/visa", { customerId: customer.id, country: "Nepal", visaType: "Tourist", serviceFee: 500 }, a);
  const pkg = await t.api.ok("POST", "/hajj/packages", { name: "Alpha Umrah", type: "UMRAH", price: 100000 }, a);
  const batch = await t.api.ok("POST", "/hajj/batches", { packageId: pkg.id, name: "B1", departureDate: "2027-01-10", seatCapacity: 10 }, a);
  const booking = await t.api.ok("POST", "/hajj/bookings", { customerId: customer.id, packageId: pkg.id, batchId: batch.id, pilgrimName: "Pilgrim One" }, a);
  const supplier = await t.api.ok("POST", "/suppliers", { name: "Alpha Supplier" }, a);

  Object.assign(ids, {
    account: account.id,
    customer: customer.id,
    ticket: ticket.id,
    visa: visa.id,
    pkg: pkg.id,
    booking: booking.id,
    supplier: supplier.id,
    owner: a.user.id,
  });
});
afterAll(() => t.close());

describe("another agency's records", () => {
  // 404, not 403: a 403 would confirm the id exists in some other tenant.
  const reads: [string, () => string][] = [
    ["cash account", () => `/accounts/${ids.account}`],
    ["customer", () => `/customers/${ids.customer}`],
    ["customer statement", () => `/customers/${ids.customer}/ledger`],
    ["ticket", () => `/ticketing/${ids.ticket}`],
    ["ticket invoice", () => `/ticketing/${ids.ticket}/invoice`],
    ["visa case", () => `/visa/${ids.visa}`],
    ["visa invoice", () => `/visa/${ids.visa}/invoice`],
    ["hajj booking", () => `/hajj/bookings/${ids.booking}`],
    ["hajj invoice", () => `/hajj/bookings/${ids.booking}/invoice`],
    ["supplier", () => `/suppliers/${ids.supplier}`],
    ["team member", () => `/team/${ids.owner}`],
  ];

  it.each(reads)("reading their %s is 404", async (_label, path) => {
    const res = await t.api.get(path(), b);
    expect(res.status).toBe(404);
  });

  it("writing to their ticket, customer and team is 404", async () => {
    expect((await t.api.patch(`/ticketing/${ids.ticket}`, { passengerName: "Hijack" }, b)).status).toBe(404);
    expect((await t.api.patch(`/customers/${ids.customer}`, { name: "Hijack" }, b)).status).toBe(404);
    expect((await t.api.patch(`/team/${ids.owner}/status`, { status: "BLOCKED" }, b)).status).toBe(404);
    expect((await t.api.delete(`/customers/${ids.customer}`, b)).status).toBe(404);
  });

  it("cannot book against their customer or pay into their account", async () => {
    const own = await t.api.ok("POST", "/customers", { name: "Bravo Customer", phone: "01700000002" }, b);
    const res = await t.api.post(
      "/ticketing",
      { customerId: ids.customer, passengerName: "Pax Two", pnr: "BRAVO1", fare: 1, cost: 1 },
      b,
    );
    expect(res.status).toBeGreaterThanOrEqual(400);

    const ownTicket = await t.api.ok("POST", "/ticketing", { customerId: own.id, passengerName: "Pax Two", pnr: "BRAVO2", fare: 100, cost: 50 }, b);
    const pay = await t.api.post(`/ticketing/${ownTicket.id}/payments`, { cashAccountId: ids.account, amount: 50 }, b);
    expect(pay.status).toBeGreaterThanOrEqual(400);

    const alphaBalance = await t.api.ok("GET", `/accounts/${ids.account}`, undefined, a);
    expect(alphaBalance.currentBalance).toBe(5000);
  });

  it("lists never include the other agency's rows", async () => {
    const customers = await t.api.get("/customers", b);
    expect(customers.body.data.some((c: { id: string }) => c.id === ids.customer)).toBe(false);
    const team = await t.api.get("/team", b);
    expect(team.body.data.map((m: { id: string }) => m.id)).toEqual([b.user.id]);
  });
});

describe("the platform boundary", () => {
  it("an agency user is refused the operator console", async () => {
    expect((await t.api.get("/admin/stats", a)).status).toBe(403);
    expect((await t.api.get("/admin/agencies", a)).status).toBe(403);
  });

  it("the operator is not a tenant and is refused agency routes", async () => {
    expect((await t.api.get("/team", operator)).status).toBe(403);
    expect((await t.api.get("/customers", operator)).status).toBe(403);
  });

  it("anonymous requests are 401", async () => {
    expect((await t.api.get("/customers")).status).toBe(401);
    expect((await t.api.get("/admin/stats")).status).toBe(401);
  });
});

describe("subscription state", () => {
  it("a suspended agency can still read but cannot write", async () => {
    const c = await t.api.registerAgency("Charlie");
    await t.api.ok("PATCH", `/admin/agencies/${c.user.agencyId}/status`, { status: "SUSPENDED" }, operator);

    expect((await t.api.get("/customers", c)).status).toBe(200);
    const write = await t.api.post("/customers", { name: "Blocked", phone: "01700000003" }, c);
    expect(write.status).toBe(403);
  });

  it("a plan without a module locks that module, including its invoices", async () => {
    const d = await t.api.registerAgency("Delta");
    const customer = await t.api.ok("POST", "/customers", { name: "Delta Customer", phone: "01700000004" }, d);
    const visa = await t.api.ok("POST", "/visa", { customerId: customer.id, country: "India", visaType: "Tourist", serviceFee: 900 }, d);

    const plan = await t.api.ok("POST", "/admin/plans", { name: "Tickets only", price: 500, durationDays: 30, features: ["TICKETING"] }, operator);
    await t.api.ok("PATCH", `/admin/agencies/${d.user.agencyId}/plan`, { planId: plan.id }, operator);

    expect((await t.api.get("/visa", d)).status).toBe(403);
    expect((await t.api.get(`/visa/${visa.id}/invoice`, d)).status).toBe(403);
    expect((await t.api.get("/ticketing", d)).status).toBe(200);
    // Customers are a base feature on every plan.
    expect((await t.api.get("/customers", d)).status).toBe(200);
  });

  it("a deleted agency's users are locked out", async () => {
    const e = await t.api.registerAgency("Echo");
    await t.api.ok("DELETE", `/admin/agencies/${e.user.agencyId}`, undefined, operator);

    expect((await t.api.get("/customers", e)).status).toBe(401);
    const login = await t.api.post("/auth/login", { email: e.email, password: e.password });
    expect(login.status).not.toBe(200);
  });
});
