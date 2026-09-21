import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestApp, type Session, type TestApp } from "./helpers/app.js";

/**
 * Selling a hotel stay: nights that follow the dates, money that lands once,
 * and a cancellation that stops billing.
 */

let t: TestApp;
let owner: Session;
let account: { id: string };
let seq = 0;

const balanceOf = async (id: string) =>
  (await t.api.ok("GET", `/accounts/${id}`, undefined, owner)).currentBalance as number;
const dueOf = async (id: string) =>
  (await t.api.ok("GET", `/customers/${id}`, undefined, owner)).currentDue as number;

const newCustomer = () =>
  t.api.ok(
    "POST",
    "/customers",
    { name: `Guest ${++seq}`, phone: `0174${String(seq).padStart(7, "0")}` },
    owner,
  );

const book = (customerId: string, overrides: Record<string, unknown> = {}) =>
  t.api.ok(
    "POST",
    "/hotels",
    {
      customerId,
      hotelName: "Sea Palace",
      city: "Cox's Bazar",
      guestName: "Karim",
      checkIn: "2026-12-01",
      checkOut: "2026-12-04",
      rooms: 2,
      guests: 4,
      sellAmount: 30_000,
      costAmount: 21_000,
      ...overrides,
    },
    owner,
  );

beforeAll(async () => {
  t = await startTestApp();
  owner = await t.api.registerAgency("Hotels");
  account = await t.api.ok("POST", "/accounts", { name: "Counter", openingBalance: 0 }, owner);
});
afterAll(() => t.close());

describe("a stay", () => {
  it("counts its nights from the dates and bills the customer", async () => {
    const customer = await newCustomer();

    const booking = await book(customer.id);

    expect(booking.nights).toBe(3);
    expect(booking.sellAmount).toBe(30_000);
    expect(booking.profit).toBe(9_000);
    expect(booking.dueAmount).toBe(30_000);
    expect(booking.status).toBe("RESERVED");
    expect(await dueOf(customer.id)).toBe(30_000);
  });

  it("counts a same-day booking as one night, which is what a hotel charges", async () => {
    const customer = await newCustomer();

    const booking = await book(customer.id, { checkIn: "2026-12-01", checkOut: "2026-12-01" });

    expect(booking.nights).toBe(1);
  });

  it("recounts the nights when the dates move", async () => {
    const customer = await newCustomer();
    const booking = await book(customer.id);

    const after = await t.api.ok(
      "PATCH",
      `/hotels/${booking.id}`,
      { checkOut: "2026-12-08" },
      owner,
    );

    // Derived, never stored — an edit cannot leave a stale night count behind.
    expect(after.nights).toBe(7);
  });

  it("refuses a check-out before the check-in", async () => {
    const customer = await newCustomer();

    const refused = await t.api.post(
      "/hotels",
      {
        customerId: customer.id,
        hotelName: "Sea Palace",
        city: "Cox's Bazar",
        guestName: "Karim",
        checkIn: "2026-12-10",
        checkOut: "2026-12-02",
        sellAmount: 5_000,
      },
      owner,
    );

    expect(refused.status).toBe(400);
    expect(refused.body.message).toContain("Check-out cannot be before check-in");
  });

  it("stops billing when it is cancelled", async () => {
    const customer = await newCustomer();
    const booking = await book(customer.id);

    await t.api.ok("PATCH", `/hotels/${booking.id}/status`, { status: "CANCELLED" }, owner);

    expect(await dueOf(customer.id)).toBe(0);
  });

  it("only moves the way the lifecycle allows", async () => {
    const customer = await newCustomer();
    const booking = await book(customer.id);

    // RESERVED cannot jump straight to COMPLETED.
    const refused = await t.api.patch(
      `/hotels/${booking.id}/status`,
      { status: "COMPLETED" },
      owner,
    );
    expect(refused.status).toBe(400);

    await t.api.ok("PATCH", `/hotels/${booking.id}/status`, { status: "CONFIRMED" }, owner);
    const done = await t.api.ok(
      "PATCH",
      `/hotels/${booking.id}/status`,
      { status: "COMPLETED" },
      owner,
    );
    expect(done.status).toBe("COMPLETED");

    // COMPLETED is final.
    const again = await t.api.patch(
      `/hotels/${booking.id}/status`,
      { status: "CANCELLED" },
      owner,
    );
    expect(again.status).toBe(400);
  });
});

describe("taking payment on a stay", () => {
  it("lands in the account and comes off what the customer owes", async () => {
    const customer = await newCustomer();
    const booking = await book(customer.id);
    const before = await balanceOf(account.id);

    await t.api.ok(
      "POST",
      `/hotels/${booking.id}/payments`,
      { cashAccountId: account.id, amount: 10_000 },
      owner,
    );

    expect(await balanceOf(account.id)).toBe(before + 10_000);
    expect(await dueOf(customer.id)).toBe(20_000);
  });

  it("refuses more than the stay owes", async () => {
    const customer = await newCustomer();
    const booking = await book(customer.id);

    const refused = await t.api.post(
      `/hotels/${booking.id}/payments`,
      { cashAccountId: account.id, amount: 30_001 },
      owner,
    );

    expect(refused.status).toBe(400);
    expect(refused.body.message).toContain("30000.00");
  });

  it("cannot be taken twice over by two clerks at once", async () => {
    const customer = await newCustomer();
    const booking = await book(customer.id);

    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        t.api.post(
          `/hotels/${booking.id}/payments`,
          { cashAccountId: account.id, amount: 30_000 },
          owner,
        ),
      ),
    );

    expect(results.filter((r) => r.status < 300).length).toBe(1);
  });

  it("can be settled from what the customer paid in earlier", async () => {
    const customer = await newCustomer();
    await t.api.ok(
      "POST",
      "/due-received",
      { customerId: customer.id, cashAccount1Id: account.id, amount1: 40_000 },
      owner,
    );
    const booking = await book(customer.id);
    const before = await balanceOf(account.id);

    await t.api.ok(
      "POST",
      `/hotels/${booking.id}/payments`,
      { fromWallet: true, amount: 30_000 },
      owner,
    );

    // The cash arrived when it was paid in: nothing moves, and the customer is
    // not credited a second time.
    expect(await balanceOf(account.id)).toBe(before);
    expect(await dueOf(customer.id)).toBe(-10_000);
    expect((await t.api.ok("GET", `/wallet/${customer.id}`, undefined, owner)).balance).toBe(
      10_000,
    );
  });

  it("gives the money back when it is reversed", async () => {
    const customer = await newCustomer();
    const booking = await book(customer.id);
    const paid = await t.api.ok(
      "POST",
      `/hotels/${booking.id}/payments`,
      { cashAccountId: account.id, amount: 5_000 },
      owner,
    );
    const before = await balanceOf(account.id);

    await t.api.ok(
      "DELETE",
      `/hotels/${booking.id}/payments/${paid.payments.at(-1).id}`,
      undefined,
      owner,
    );

    expect(await balanceOf(account.id)).toBe(before - 5_000);
    expect(await dueOf(customer.id)).toBe(30_000);
  });

  it("cannot be left owing a negative amount by an edit", async () => {
    const customer = await newCustomer();
    const booking = await book(customer.id);
    await t.api.ok(
      "POST",
      `/hotels/${booking.id}/payments`,
      { cashAccountId: account.id, amount: 20_000 },
      owner,
    );

    const refused = await t.api.patch(`/hotels/${booking.id}`, { sellAmount: 10_000 }, owner);

    expect(refused.status).toBe(400);
    expect(refused.body.message).toContain("20000.00");
  });
});

describe("the customer statement", () => {
  it("lists the stay and still ends on what they owe", async () => {
    const customer = await newCustomer();
    const booking = await book(customer.id);
    await t.api.ok(
      "POST",
      `/hotels/${booking.id}/payments`,
      { cashAccountId: account.id, amount: 5_000 },
      owner,
    );

    const ledger = await t.api.ok("GET", `/customers/${customer.id}/ledger`, undefined, owner);
    const types = ledger.rows.map((row: { type: string }) => row.type);

    expect(types).toContain("hotel");
    expect(types).toContain("hotel-payment");
    expect(ledger.rows.at(-1).runningDue).toBe(25_000);
    expect(await dueOf(customer.id)).toBe(25_000);
  });
});

describe("another agency", () => {
  it("cannot see or touch this one's bookings", async () => {
    const other = await t.api.registerAgency("Hotels other");
    const customer = await newCustomer();
    const booking = await book(customer.id);

    expect((await t.api.get(`/hotels/${booking.id}`, other)).status).toBe(404);
    expect((await t.api.patch(`/hotels/${booking.id}`, { city: "Dhaka" }, other)).status).toBe(404);
    expect((await t.api.ok("GET", "/hotels", undefined, other)).bookings).toEqual([]);
  });
});

describe("the module summary", () => {
  it("adds up what is booked, owed and earned, and who is arriving", async () => {
    const solo = await t.api.registerAgency("Hotels summary");
    const soloAccount = await t.api.ok(
      "POST",
      "/accounts",
      { name: "Counter", openingBalance: 0 },
      solo,
    );
    const customer = await t.api.ok(
      "POST",
      "/customers",
      { name: "Summary", phone: "01788888888" },
      solo,
    );
    const booking = await t.api.ok(
      "POST",
      "/hotels",
      {
        customerId: customer.id,
        hotelName: "Hill View",
        city: "Bandarban",
        guestName: "Sumi",
        checkIn: "2027-01-10",
        checkOut: "2027-01-12",
        rooms: 3,
        guests: 6,
        sellAmount: 12_000,
        costAmount: 8_000,
      },
      solo,
    );
    await t.api.ok(
      "POST",
      `/hotels/${booking.id}/payments`,
      { cashAccountId: soloAccount.id, amount: 4_000 },
      solo,
    );

    const summary = await t.api.ok("GET", "/hotels/summary", undefined, solo);

    expect(summary.totalBookings).toBe(1);
    expect(summary.totalRooms).toBe(3);
    expect(summary.totalGuests).toBe(6);
    expect(summary.totalRevenue).toBe(12_000);
    expect(summary.totalProfit).toBe(4_000);
    expect(summary.totalCollected).toBe(4_000);
    expect(summary.totalDue).toBe(8_000);
    // A future check-in, so it is on the arrivals list with its nights counted.
    expect(summary.arriving.map((row: { id: string }) => row.id)).toEqual([booking.id]);
    expect(summary.arriving[0].nights).toBe(2);
  });
});
