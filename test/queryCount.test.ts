import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestApp, type Session, type TestApp } from "./helpers/app.js";

/**
 * List endpoints must cost the same number of queries for 5 rows as for 30.
 *
 * Counted at the driver: every statement Prisma sends goes through
 * pg.Client#query (pool clients included), and @prisma/adapter-pg uses the
 * same pg module instance as this file.
 */

let statements = 0;
const originalQuery = pg.Client.prototype.query;

const countQueries = async (fn: () => Promise<unknown>) => {
  statements = 0;
  await fn();
  return statements;
};

let t: TestApp;
let owner: Session;
const ROWS = 30;

beforeAll(async () => {
  t = await startTestApp();
  owner = await t.api.registerAgency("Queries");

  const account = await t.api.ok("POST", "/accounts", { name: "Query cash" }, owner);
  const customer = await t.api.ok("POST", "/customers", { name: "Query Customer", phone: "01766666666" }, owner);
  const pkg = await t.api.ok("POST", "/hajj/packages", { name: "Query Umrah", type: "UMRAH", price: 100_000 }, owner);
  const batch = await t.api.ok("POST", "/hajj/batches", { packageId: pkg.id, name: "Query batch", departureDate: "2027-02-01", seatCapacity: ROWS + 5 }, owner);

  for (let i = 0; i < ROWS; i++) {
    const ticket = await t.api.ok("POST", "/ticketing", { customerId: customer.id, passengerName: `Pax ${i}`, pnr: `QRY${String(i).padStart(3, "0")}`, fare: 1000, cost: 800 }, owner);
    await t.api.ok("POST", `/ticketing/${ticket.id}/payments`, { cashAccountId: account.id, amount: 100 + i }, owner);

    const visa = await t.api.ok("POST", "/visa", { customerId: customer.id, country: "Qatar", visaType: "Work", serviceFee: 500 }, owner);
    await t.api.ok("POST", `/visa/${visa.id}/payments`, { cashAccountId: account.id, amount: 50 + i }, owner);

    const booking = await t.api.ok("POST", "/hajj/bookings", { customerId: customer.id, packageId: pkg.id, batchId: batch.id, pilgrimName: `Pilgrim ${i}` }, owner);
    await t.api.ok("POST", `/hajj/bookings/${booking.id}/payments`, { cashAccountId: account.id, amount: 1000 + i }, owner);
  }

  pg.Client.prototype.query = function (this: pg.Client, ...args: unknown[]) {
    statements += 1;
    return (originalQuery as (...a: unknown[]) => unknown).apply(this, args);
  } as typeof originalQuery;
});

afterAll(async () => {
  pg.Client.prototype.query = originalQuery;
  await t.close();
});

describe("list endpoints do not run a query per row", () => {
  it.each([
    ["tickets", "/ticketing"],
    ["visa cases", "/visa"],
    ["hajj bookings", "/hajj/bookings"],
  ])("%s: 5 rows and 30 rows cost the same", async (_label, path) => {
    const small = await countQueries(() => t.api.get(`${path}?limit=5`, owner));
    const large = await countQueries(() => t.api.get(`${path}?limit=${ROWS}`, owner));
    expect({ small, large }).toEqual({ small, large: small });
  });
});

describe("the batched figures are still right", () => {
  it("ticket rows carry their own totals", async () => {
    const res = await t.api.get(`/ticketing?limit=${ROWS}&sortBy=pnr&sortOrder=asc`, owner);
    const rows = res.body.data.tickets as { pnr: string; totalPaid: number; dueAmount: number; customerCharge: number }[];
    expect(rows).toHaveLength(ROWS);
    for (const row of rows) {
      const i = Number(row.pnr.slice(3));
      expect(row.totalPaid).toBe(100 + i);
      expect(row.dueAmount).toBe(row.customerCharge - (100 + i));
    }
  });

  it("visa rows carry their own paid, due and document progress", async () => {
    const res = await t.api.get(`/visa?limit=${ROWS}`, owner);
    const rows = res.body.data.cases ?? res.body.data.visaCases ?? res.body.data;
    const list = (Array.isArray(rows) ? rows : []) as { totalFee: number; totalPaid: number; dueAmount: number; documentsProgress: { received: number; total: number } }[];
    expect(list).toHaveLength(ROWS);
    const paid = list.map((r) => r.totalPaid).sort((a, b) => a - b);
    expect(paid).toEqual(Array.from({ length: ROWS }, (_, i) => 50 + i));
    for (const row of list) {
      expect(row.dueAmount).toBe(row.totalFee - row.totalPaid);
      expect(row.documentsProgress.total).toBeGreaterThanOrEqual(0);
      expect(row.documentsProgress.received).toBeLessThanOrEqual(row.documentsProgress.total);
    }
  });

  it("hajj rows carry their own paid and due", async () => {
    const res = await t.api.get(`/hajj/bookings?limit=${ROWS}`, owner);
    const rows = res.body.data.bookings ?? res.body.data;
    const list = (Array.isArray(rows) ? rows : []) as { packagePrice: number; totalPaid: number; dueAmount: number }[];
    expect(list).toHaveLength(ROWS);
    const paid = list.map((r) => r.totalPaid).sort((a, b) => a - b);
    expect(paid).toEqual(Array.from({ length: ROWS }, (_, i) => 1000 + i));
    for (const row of list) expect(row.dueAmount).toBe(row.packagePrice - row.totalPaid);
  });
});
