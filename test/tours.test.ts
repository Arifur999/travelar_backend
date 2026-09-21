import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestApp, type Session, type TestApp } from "./helpers/app.js";

/**
 * Selling a tour: seats that a cancellation gives back, a price snapshotted so
 * it cannot move under a customer, and money that lands in exactly one place.
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
    { name: `Traveller ${++seq}`, phone: `0173${String(seq).padStart(7, "0")}` },
    owner,
  );

const newTour = (overrides: Record<string, unknown> = {}) =>
  t.api.ok(
    "POST",
    "/tours",
    {
      name: `Cox's Bazar ${++seq}`,
      destination: "Cox's Bazar",
      pricePerPerson: 10_000,
      costPerPerson: 7_000,
      seatCapacity: 10,
      ...overrides,
    },
    owner,
  );

const book = (
  packageId: string,
  customerId: string,
  overrides: Record<string, unknown> = {},
) =>
  t.api.ok(
    "POST",
    "/tours/bookings",
    { packageId, customerId, leadTraveller: "Karim", travellers: 2, ...overrides },
    owner,
  );

beforeAll(async () => {
  t = await startTestApp();
  owner = await t.api.registerAgency("Tours");
  account = await t.api.ok("POST", "/accounts", { name: "Counter", openingBalance: 0 }, owner);
});
afterAll(() => t.close());

describe("a tour", () => {
  it("prices a booking from its own rate, and says what is left", async () => {
    const tour = await newTour();
    const customer = await newCustomer();

    const booking = await book(tour.id, customer.id);

    // Two seats at the tour's own rate, both sides of it.
    expect(booking.sellAmount).toBe(20_000);
    expect(booking.costAmount).toBe(14_000);
    expect(booking.profit).toBe(6_000);
    expect(booking.dueAmount).toBe(20_000);
    expect(booking.status).toBe("RESERVED");

    const listed = await t.api.ok("GET", `/tours/${tour.id}`, undefined, owner);
    expect(listed.seatsSold).toBe(2);
    expect(listed.seatsLeft).toBe(8);
    expect(listed.totalRevenue).toBe(20_000);
  });

  it("takes a negotiated price without touching the tour's rate", async () => {
    const tour = await newTour();
    const customer = await newCustomer();

    const booking = await book(tour.id, customer.id, { sellAmount: 17_500 });

    expect(booking.sellAmount).toBe(17_500);
    expect((await t.api.ok("GET", `/tours/${tour.id}`, undefined, owner)).pricePerPerson).toBe(
      "10000",
    );
  });

  it("keeps the price a booking was sold at when the tour is repriced", async () => {
    const tour = await newTour();
    const customer = await newCustomer();
    const booking = await book(tour.id, customer.id);

    await t.api.ok("PATCH", `/tours/${tour.id}`, { pricePerPerson: 15_000 }, owner);

    const after = await t.api.ok("GET", `/tours/bookings/${booking.id}`, undefined, owner);
    expect(after.sellAmount).toBe(20_000);
    expect(await dueOf(customer.id)).toBe(20_000);
  });

  it("refuses to sell more seats than it has", async () => {
    const tour = await newTour({ seatCapacity: 3 });
    const customer = await newCustomer();
    await book(tour.id, customer.id, { travellers: 2 });

    const refused = await t.api.post(
      "/tours/bookings",
      { packageId: tour.id, customerId: customer.id, leadTraveller: "Rahim", travellers: 2 },
      owner,
    );

    expect(refused.status).toBe(400);
    expect(refused.body.message).toContain("1 seats are left");
  });

  it("gives the seats back when a booking is cancelled", async () => {
    const tour = await newTour({ seatCapacity: 2 });
    const customer = await newCustomer();
    const booking = await book(tour.id, customer.id, { travellers: 2 });

    await t.api.ok(
      "PATCH",
      `/tours/bookings/${booking.id}/status`,
      { status: "CANCELLED" },
      owner,
    );

    expect((await t.api.ok("GET", `/tours/${tour.id}`, undefined, owner)).seatsLeft).toBe(2);
    // And a cancelled booking bills nothing.
    expect(await dueOf(customer.id)).toBe(0);

    const resold = await book(tour.id, customer.id, { travellers: 2 });
    expect(resold.id).not.toBe(booking.id);
  });

  it("has no limit when no capacity was set", async () => {
    const tour = await newTour({ seatCapacity: undefined });
    const customer = await newCustomer();

    await book(tour.id, customer.id, { travellers: 40 });

    const listed = await t.api.ok("GET", `/tours/${tour.id}`, undefined, owner);
    expect(listed.seatsSold).toBe(40);
    // Null, not zero — "no limit" and "full" must not read the same.
    expect(listed.seatsLeft).toBeNull();
  });

  it("cannot be cut below the seats already sold", async () => {
    const tour = await newTour({ seatCapacity: 10 });
    const customer = await newCustomer();
    await book(tour.id, customer.id, { travellers: 6 });

    const refused = await t.api.patch(`/tours/${tour.id}`, { seatCapacity: 4 }, owner);

    expect(refused.status).toBe(400);
    expect(refused.body.message).toContain("6 seats are already sold");
  });

  it("cannot be deleted while anyone is booked on it", async () => {
    const tour = await newTour();
    const customer = await newCustomer();
    await book(tour.id, customer.id);

    const refused = await t.api.delete(`/tours/${tour.id}`, owner);

    expect(refused.status).toBe(400);
    expect(refused.body.message).toContain("bookings");
  });

  it("stops taking bookings once it is closed", async () => {
    const tour = await newTour();
    const customer = await newCustomer();

    await t.api.ok("PATCH", `/tours/${tour.id}`, { status: "CLOSED" }, owner);

    const refused = await t.api.post(
      "/tours/bookings",
      { packageId: tour.id, customerId: customer.id, leadTraveller: "Karim" },
      owner,
    );
    expect(refused.status).toBe(400);
    expect(refused.body.message).toContain("closed");
  });
});

describe("taking payment on a tour", () => {
  it("lands in the account and comes off what the customer owes", async () => {
    const tour = await newTour();
    const customer = await newCustomer();
    const booking = await book(tour.id, customer.id);
    const before = await balanceOf(account.id);

    await t.api.ok(
      "POST",
      `/tours/bookings/${booking.id}/payments`,
      { cashAccountId: account.id, amount: 12_000 },
      owner,
    );

    expect(await balanceOf(account.id)).toBe(before + 12_000);
    expect(await dueOf(customer.id)).toBe(8_000);

    const after = await t.api.ok("GET", `/tours/bookings/${booking.id}`, undefined, owner);
    expect(after.totalPaid).toBe(12_000);
    expect(after.dueAmount).toBe(8_000);
  });

  it("refuses more than the booking owes", async () => {
    const tour = await newTour();
    const customer = await newCustomer();
    const booking = await book(tour.id, customer.id);

    const refused = await t.api.post(
      `/tours/bookings/${booking.id}/payments`,
      { cashAccountId: account.id, amount: 20_001 },
      owner,
    );

    expect(refused.status).toBe(400);
    expect(refused.body.message).toContain("20000.00");
  });

  it("cannot be taken twice over by two clerks at once", async () => {
    const tour = await newTour();
    const customer = await newCustomer();
    const booking = await book(tour.id, customer.id);

    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        t.api.post(
          `/tours/bookings/${booking.id}/payments`,
          { cashAccountId: account.id, amount: 20_000 },
          owner,
        ),
      ),
    );

    expect(results.filter((r) => r.status < 300).length).toBe(1);
    expect(
      (await t.api.ok("GET", `/tours/bookings/${booking.id}`, undefined, owner)).totalPaid,
    ).toBe(20_000);
  });

  it("can be settled from what the customer paid in earlier", async () => {
    const tour = await newTour();
    const customer = await newCustomer();
    await t.api.ok(
      "POST",
      "/due-received",
      { customerId: customer.id, cashAccount1Id: account.id, amount1: 25_000 },
      owner,
    );
    const booking = await book(tour.id, customer.id);
    const before = await balanceOf(account.id);

    await t.api.ok(
      "POST",
      `/tours/bookings/${booking.id}/payments`,
      { fromWallet: true, amount: 20_000 },
      owner,
    );

    // The cash arrived when it was paid in: nothing moves, and the customer is
    // not credited a second time.
    expect(await balanceOf(account.id)).toBe(before);
    expect(await dueOf(customer.id)).toBe(-5_000);
    expect((await t.api.ok("GET", `/wallet/${customer.id}`, undefined, owner)).balance).toBe(5_000);
  });

  it("gives the money back when it is reversed", async () => {
    const tour = await newTour();
    const customer = await newCustomer();
    const booking = await book(tour.id, customer.id);
    const payment = await t.api.ok(
      "POST",
      `/tours/bookings/${booking.id}/payments`,
      { cashAccountId: account.id, amount: 5_000 },
      owner,
    );
    const before = await balanceOf(account.id);
    const paymentId = payment.payments.at(-1).id;

    await t.api.ok(
      "DELETE",
      `/tours/bookings/${booking.id}/payments/${paymentId}`,
      undefined,
      owner,
    );

    expect(await balanceOf(account.id)).toBe(before - 5_000);
    expect(await dueOf(customer.id)).toBe(20_000);
  });

  it("cannot be left owing a negative amount by an edit", async () => {
    const tour = await newTour();
    const customer = await newCustomer();
    const booking = await book(tour.id, customer.id);
    await t.api.ok(
      "POST",
      `/tours/bookings/${booking.id}/payments`,
      { cashAccountId: account.id, amount: 15_000 },
      owner,
    );

    const refused = await t.api.patch(
      `/tours/bookings/${booking.id}`,
      { sellAmount: 10_000 },
      owner,
    );

    expect(refused.status).toBe(400);
    expect(refused.body.message).toContain("15000.00");
  });
});

describe("the customer statement", () => {
  it("lists the tour and still ends on what they owe", async () => {
    const tour = await newTour();
    const customer = await newCustomer();
    const booking = await book(tour.id, customer.id);
    await t.api.ok(
      "POST",
      `/tours/bookings/${booking.id}/payments`,
      { cashAccountId: account.id, amount: 5_000 },
      owner,
    );

    const ledger = await t.api.ok("GET", `/customers/${customer.id}/ledger`, undefined, owner);
    const types = ledger.rows.map((row: { type: string }) => row.type);

    expect(types).toContain("tour");
    expect(types).toContain("tour-payment");
    expect(ledger.rows.at(-1).runningDue).toBe(15_000);
    expect(await dueOf(customer.id)).toBe(15_000);
  });
});

describe("another agency", () => {
  it("cannot see or touch this one's tours", async () => {
    const other = await t.api.registerAgency("Tours other");
    const tour = await newTour();
    const customer = await newCustomer();
    const booking = await book(tour.id, customer.id);

    expect((await t.api.get(`/tours/${tour.id}`, other)).status).toBe(404);
    expect((await t.api.get(`/tours/bookings/${booking.id}`, other)).status).toBe(404);
    expect((await t.api.patch(`/tours/${tour.id}`, { pricePerPerson: 1 }, other)).status).toBe(404);

    const theirs = await t.api.ok("GET", "/tours", undefined, other);
    expect(theirs).toEqual([]);
  });
});

describe("the module summary", () => {
  it("adds up what is sold, owed and earned", async () => {
    const solo = await t.api.registerAgency("Tours summary");
    const soloAccount = await t.api.ok(
      "POST",
      "/accounts",
      { name: "Counter", openingBalance: 0 },
      solo,
    );
    const tour = await t.api.ok(
      "POST",
      "/tours",
      {
        name: "Bandarban weekend",
        destination: "Bandarban",
        pricePerPerson: 5_000,
        costPerPerson: 3_000,
        seatCapacity: 20,
      },
      solo,
    );
    const customer = await t.api.ok(
      "POST",
      "/customers",
      { name: "Summary", phone: "01799999999" },
      solo,
    );
    const booking = await t.api.ok(
      "POST",
      "/tours/bookings",
      { packageId: tour.id, customerId: customer.id, leadTraveller: "Sumi", travellers: 3 },
      solo,
    );
    await t.api.ok(
      "POST",
      `/tours/bookings/${booking.id}/payments`,
      { cashAccountId: soloAccount.id, amount: 5_000 },
      solo,
    );

    const summary = await t.api.ok("GET", "/tours/summary", undefined, solo);

    expect(summary.totalTours).toBe(1);
    expect(summary.totalBookings).toBe(1);
    expect(summary.totalTravellers).toBe(3);
    expect(summary.totalRevenue).toBe(15_000);
    expect(summary.totalCost).toBe(9_000);
    expect(summary.totalProfit).toBe(6_000);
    expect(summary.totalCollected).toBe(5_000);
    expect(summary.totalDue).toBe(10_000);
  });
});
