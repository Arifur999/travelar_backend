import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../src/app/lib/prisma.js";
import { startTestApp, type TestApp } from "./helpers/app.js";

/**
 * Two things every list page depends on and neither side's other tests cover:
 * the order is stable across pages, and the database can produce it without
 * sorting the whole table.
 */

let t: TestApp;
beforeAll(async () => {
  t = await startTestApp();
});
afterAll(async () => {
  await t.close();
  await prisma.$disconnect();
});

/**
 * Every list is filtered by agency, usually by isDeleted too, then ordered by
 * createdAt. Without an index covering that, Postgres reads the tenant's rows
 * and sorts them on every page.
 */
const LIST_INDEXES = [
  "tickets_agencyId_isDeleted_createdAt_idx",
  "visa_cases_agencyId_isDeleted_createdAt_idx",
  "hajj_bookings_agencyId_isDeleted_createdAt_idx",
  "tour_bookings_agencyId_isDeleted_createdAt_idx",
  "tour_packages_agencyId_isDeleted_createdAt_idx",
  "customers_agencyId_isDeleted_createdAt_idx",
  "employees_agencyId_isDeleted_createdAt_idx",
  "suppliers_agencyId_isDeleted_createdAt_idx",
  "cash_accounts_agencyId_isDeleted_createdAt_idx",
  "expenses_agencyId_createdAt_idx",
  "due_received_agencyId_createdAt_idx",
  "employee_transactions_agencyId_createdAt_idx",
  "employee_attendance_agencyId_createdAt_idx",
  "supplier_transactions_agencyId_createdAt_idx",
  "balance_transfers_agencyId_createdAt_idx",
];

describe("list indexes", () => {
  it("exist for every list a user pages through", async () => {
    const found = await prisma.$queryRaw<{ indexname: string }[]>`
      SELECT indexname FROM pg_indexes
      WHERE schemaname = 'public' AND indexname = ANY(${LIST_INDEXES})`;

    const names = found.map((row) => row.indexname);
    for (const index of LIST_INDEXES) {
      expect(names, `${index} is missing — a list would sort the whole table`).toContain(index);
    }
  });
});

describe("list order", () => {
  it("never repeats or drops a row when rows share a createdAt", async () => {
    const owner = await t.api.registerAgency("Order");
    const customer = await t.api.ok<{ id: string }>(
      "POST",
      "/customers",
      { name: "Pager", phone: "01700000001" },
      owner,
    );

    for (let i = 1; i <= 6; i += 1) {
      await t.api.ok(
        "POST",
        "/ticketing",
        { customerId: customer.id, passengerName: `Pax ${i}`, pnr: `ORDER${i}`, fare: 1000, cost: 800 },
        owner,
      );
    }

    // The tie the ordering has to survive: a bulk import, or simply six rows
    // written inside the same millisecond.
    await prisma.ticket.updateMany({ data: { createdAt: new Date("2026-09-01T10:00:00.000Z") } });

    const seen: string[] = [];
    for (const page of [1, 2, 3]) {
      const result = await t.api.ok<{ tickets: { id: string; pnr: string }[] }>(
        "GET",
        `/ticketing?page=${page}&limit=2`,
        undefined,
        owner,
      );
      seen.push(...result.tickets.map((ticket) => ticket.pnr));
    }

    expect(seen).toHaveLength(6);
    expect(new Set(seen).size).toBe(6);
    // Ids are uuid v7, so the newest row is still first when createdAt ties.
    expect(seen).toEqual(["ORDER6", "ORDER5", "ORDER4", "ORDER3", "ORDER2", "ORDER1"]);
  });

  it("keeps the caller's own sort, with the same tie-break", async () => {
    const owner = await t.api.registerAgency("Order");
    const customer = await t.api.ok<{ id: string }>(
      "POST",
      "/customers",
      { name: "Sorter", phone: "01700000002" },
      owner,
    );

    for (const fare of [3000, 1000, 2000]) {
      await t.api.ok(
        "POST",
        "/ticketing",
        { customerId: customer.id, passengerName: "Pax", pnr: `FARE${fare}`, fare, cost: 100 },
        owner,
      );
    }

    const result = await t.api.ok<{ tickets: { pnr: string }[] }>(
      "GET",
      "/ticketing?sortBy=fare&sortOrder=asc",
      undefined,
      owner,
    );

    expect(result.tickets.map((ticket) => ticket.pnr)).toEqual([
      "FARE1000",
      "FARE2000",
      "FARE3000",
    ]);
  });
});
