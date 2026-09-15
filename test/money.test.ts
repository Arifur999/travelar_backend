import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestApp, type Session, type TestApp } from "./helpers/app.js";

/**
 * The money model's invariants, checked end to end:
 *   balance  = Σ in − Σ out, from one posting ledger (the opening balance is a posting)
 *   payable  = opening + Σ purchases − Σ payments
 *   due      = opening + Σ sales − Σ collections − Σ discounts
 * and every posting reverses exactly.
 */

let t: TestApp;
let owner: Session;
let phoneSeq = 0;

const balanceOf = async (id: string) => (await t.api.ok("GET", `/accounts/${id}`, undefined, owner)).currentBalance as number;
const newAccount = (name: string, openingBalance = 0) => t.api.ok("POST", "/accounts", { name, openingBalance }, owner);
const newCustomer = (openingDue = 0) =>
  t.api.ok("POST", "/customers", { name: `Customer ${++phoneSeq}`, phone: `0171${String(phoneSeq).padStart(7, "0")}`, openingDue }, owner);

beforeAll(async () => {
  t = await startTestApp();
  owner = await t.api.registerAgency("Money");
});
afterAll(() => t.close());

describe("cash accounts", () => {
  it("balance is money in − money out, and a reversal restores it exactly", async () => {
    const account = await newAccount("Front desk", 10_000);
    const customer = await newCustomer();
    const ticket = await t.api.ok(
      "POST",
      "/ticketing",
      { customerId: customer.id, passengerName: "Pax One", pnr: "CASH01", fare: 8000, cost: 7000 },
      owner,
    );

    await t.api.ok("POST", `/ticketing/${ticket.id}/payments`, { cashAccountId: account.id, amount: 3000 }, owner);
    const after = await t.api.ok("GET", `/accounts/${account.id}`, undefined, owner);
    // The opening balance is itself an IN posting (source OPENING), so the
    // ledger alone explains the figure: 10,000 opening + 3,000 payment.
    expect(after).toMatchObject({ openingBalance: 10_000, totalIn: 13_000, totalOut: 0, currentBalance: 13_000 });
    expect(after.currentBalance).toBe(after.totalIn - after.totalOut);

    const detail = await t.api.ok("GET", `/ticketing/${ticket.id}`, undefined, owner);
    const paymentId = detail.payments[0].id;
    expect((await t.api.delete(`/ticketing/${ticket.id}/payments/${paymentId}`, owner)).status).toBe(200);
    expect(await balanceOf(account.id)).toBe(10_000);
  });
});

describe("balance transfers", () => {
  it("move money between accounts without changing the total", async () => {
    const from = await newAccount("Vault", 5000);
    const to = await newAccount("bKash", 0);
    const totalBefore = (await t.api.ok("GET", "/accounts/overview", undefined, owner)).totalBalance ?? null;

    const transfer = await t.api.ok("POST", "/balance-transfers", { fromAccountId: from.id, toAccountId: to.id, amount: 1500 }, owner);
    expect(await balanceOf(from.id)).toBe(3500);
    expect(await balanceOf(to.id)).toBe(1500);

    if (totalBefore !== null) {
      const totalAfter = (await t.api.ok("GET", "/accounts/overview", undefined, owner)).totalBalance;
      expect(totalAfter).toBe(totalBefore);
    }

    expect((await t.api.delete(`/balance-transfers/${transfer.id}`, owner)).status).toBe(200);
    expect(await balanceOf(from.id)).toBe(5000);
    expect(await balanceOf(to.id)).toBe(0);
  });

  it("cannot overdraw the source account, and nothing moves when refused", async () => {
    const from = await newAccount("Petty", 1000);
    const to = await newAccount("Bank", 0);
    const res = await t.api.post("/balance-transfers", { fromAccountId: from.id, toAccountId: to.id, amount: 1000.01 }, owner);
    expect(res.status).toBe(400);
    expect(await balanceOf(from.id)).toBe(1000);
    expect(await balanceOf(to.id)).toBe(0);
  });
});

describe("over-payment guards", () => {
  it("a ticket cannot be paid beyond what is due", async () => {
    const account = await newAccount("Guard", 0);
    const customer = await newCustomer();
    const ticket = await t.api.ok("POST", "/ticketing", { customerId: customer.id, passengerName: "Pax One", pnr: "GUARD1", fare: 5000, cost: 4000 }, owner);

    await t.api.ok("POST", `/ticketing/${ticket.id}/payments`, { cashAccountId: account.id, amount: 4000 }, owner);
    const over = await t.api.post(`/ticketing/${ticket.id}/payments`, { cashAccountId: account.id, amount: 1000.01 }, owner);
    expect(over.status).toBe(400);
    expect(await balanceOf(account.id)).toBe(4000);
  });

  it("a visa case cannot be paid beyond its fees", async () => {
    const account = await newAccount("Visa guard", 0);
    const customer = await newCustomer();
    const visa = await t.api.ok("POST", "/visa", { customerId: customer.id, country: "Japan", visaType: "Tourist", serviceFee: 2000, embassyFee: 3000 }, owner);
    expect((await t.api.post(`/visa/${visa.id}/payments`, { cashAccountId: account.id, amount: 5000.01 }, owner)).status).toBe(400);
    expect((await t.api.post(`/visa/${visa.id}/payments`, { cashAccountId: account.id, amount: 5000 }, owner)).status).toBe(201);
  });
});

describe("supplier payable", () => {
  it("accrues from ticket cost and falls with payments that debit an account", async () => {
    const account = await newAccount("Supplier float", 50_000);
    const supplier = await t.api.ok("POST", "/suppliers", { name: "Sky Consolidator", openingPayable: 1000 }, owner);
    const customer = await newCustomer();

    await t.api.ok("POST", "/ticketing", { customerId: customer.id, supplierId: supplier.id, passengerName: "Pax One", pnr: "SUPP01", fare: 12_000, cost: 9000 }, owner);
    expect((await t.api.ok("GET", `/suppliers/${supplier.id}`, undefined, owner)).currentPayable).toBe(10_000);

    await t.api.ok("POST", "/supplier-transactions", { supplierId: supplier.id, cashAccountId: account.id, amount: 4000 }, owner);
    expect((await t.api.ok("GET", `/suppliers/${supplier.id}`, undefined, owner)).currentPayable).toBe(6000);
    expect(await balanceOf(account.id)).toBe(46_000);
  });
});

describe("collections", () => {
  it("split tender credits both accounts and reduces the due by amount + discount", async () => {
    const cash = await newAccount("Cash drawer", 0);
    const bank = await newAccount("City Bank", 0);
    const customer = await newCustomer(10_000);

    await t.api.ok(
      "POST",
      "/due-received",
      { customerId: customer.id, cashAccount1Id: cash.id, amount1: 3000, cashAccount2Id: bank.id, amount2: 2000, discount: 500 },
      owner,
    );

    expect(await balanceOf(cash.id)).toBe(3000);
    expect(await balanceOf(bank.id)).toBe(2000);
    expect((await t.api.ok("GET", `/customers/${customer.id}`, undefined, owner)).currentDue).toBe(4500);
  });
});

describe("customer statement", () => {
  // Regression: the statement listed tickets only, while currentDue also
  // counted visa and Hajj — so it stopped short of the balance above it.
  it("itemises every module and ends exactly on currentDue", async () => {
    const account = await newAccount("Statement cash", 0);
    const customer = await newCustomer(1000);

    const ticket = await t.api.ok("POST", "/ticketing", { customerId: customer.id, passengerName: "Pax One", pnr: "LEDG01", fare: 20_000, cost: 18_000, issueDate: "2026-09-01" }, owner);
    await t.api.ok("POST", `/ticketing/${ticket.id}/payments`, { cashAccountId: account.id, amount: 5000, paidAt: "2026-09-02" }, owner);

    const visa = await t.api.ok("POST", "/visa", { customerId: customer.id, country: "Saudi Arabia", visaType: "Umrah", submittedAt: "2026-09-03", serviceFee: 3000, embassyFee: 7000 }, owner);
    await t.api.ok("POST", `/visa/${visa.id}/payments`, { cashAccountId: account.id, amount: 4000, paidAt: "2026-09-04" }, owner);

    const pkg = await t.api.ok("POST", "/hajj/packages", { name: "Umrah Economy", type: "UMRAH", price: 150_000 }, owner);
    const batch = await t.api.ok("POST", "/hajj/batches", { packageId: pkg.id, name: "October", departureDate: "2026-10-10", seatCapacity: 40 }, owner);
    const live = await t.api.ok("POST", "/hajj/bookings", { customerId: customer.id, packageId: pkg.id, batchId: batch.id, pilgrimName: "Rahim Uddin" }, owner);
    await t.api.ok("POST", `/hajj/bookings/${live.id}/payments`, { cashAccountId: account.id, amount: 50_000 }, owner);
    const dropped = await t.api.ok("POST", "/hajj/bookings", { customerId: customer.id, packageId: pkg.id, batchId: batch.id, pilgrimName: "Karim Uddin" }, owner);
    await t.api.ok("POST", `/hajj/bookings/${dropped.id}/payments`, { cashAccountId: account.id, amount: 10_000 }, owner);
    await t.api.ok("PATCH", `/hajj/bookings/${dropped.id}/status`, { status: "CANCELLED" }, owner);

    await t.api.ok("POST", "/due-received", { customerId: customer.id, cashAccount1Id: account.id, amount1: 20_000, discount: 500, date: "2026-09-06" }, owner);

    const { customer: totals, rows } = await t.api.ok("GET", `/customers/${customer.id}/ledger`, undefined, owner);

    // opening + ticket + visa + live hajj (cancelled bills 0) − payments − collection − discount
    const expected = 1000 + 20_000 + 10_000 + 150_000 - 5000 - 4000 - 50_000 - 10_000 - 20_000 - 500;
    expect(totals.currentDue).toBe(expected);
    expect(rows.at(-1).runningDue).toBe(expected);

    const types = new Set(rows.map((r: { type: string }) => r.type));
    for (const type of ["opening", "ticket", "ticket-payment", "visa", "visa-payment", "hajj", "hajj-payment", "due-received", "discount"]) {
      expect(types).toContain(type);
    }

    let running = rows[0].runningDue;
    for (const row of rows.slice(1)) {
      running += row.debit - row.credit;
      expect(row.runningDue).toBeCloseTo(running, 2);
    }

    const cancelled = rows.find((r: { type: string; description: string }) => r.type === "hajj" && r.description.includes("cancelled"));
    expect(cancelled?.debit).toBe(0);
  });
});
