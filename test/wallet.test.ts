import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestApp, type Session, type TestApp } from "./helpers/app.js";

/**
 * Money a customer pays in before there is an invoice for it, and what happens
 * when an invoice finally consumes it.
 *
 * The rule everything here protects: that money is counted once. It reaches the
 * books as a collection, which takes it off what the customer owes. Settling an
 * invoice from it moves nothing — no posting, no second credit.
 */

let t: TestApp;
let owner: Session;
let phoneSeq = 0;

const balanceOf = async (id: string) =>
  (await t.api.ok("GET", `/accounts/${id}`, undefined, owner)).currentBalance as number;
const dueOf = async (id: string) =>
  (await t.api.ok("GET", `/customers/${id}`, undefined, owner)).currentDue as number;
const walletOf = async (id: string) =>
  (await t.api.ok("GET", `/wallet/${id}`, undefined, owner)).balance as number;

const newAccount = () =>
  t.api.ok("POST", "/accounts", { name: `Counter ${++phoneSeq}`, openingBalance: 0 }, owner);
const newCustomer = () =>
  t.api.ok(
    "POST",
    "/customers",
    { name: `Wallet ${++phoneSeq}`, phone: `0172${String(phoneSeq).padStart(7, "0")}` },
    owner,
  );
const newTicket = (customerId: string, pnr: string, fare: number) =>
  t.api.ok(
    "POST",
    "/ticketing",
    { customerId, passengerName: "Pax", pnr, fare, cost: Math.round(fare * 0.8) },
    owner,
  );

beforeAll(async () => {
  t = await startTestApp();
  owner = await t.api.registerAgency("Wallet");
});
afterAll(() => t.close());

describe("paying in advance", () => {
  it("is held for the customer and leaves them in credit", async () => {
    const account = await newAccount();
    const customer = await newCustomer();

    await t.api.ok(
      "POST",
      "/due-received",
      { customerId: customer.id, cashAccount1Id: account.id, amount1: 50_000 },
      owner,
    );

    expect(await balanceOf(account.id)).toBe(50_000);
    expect(await dueOf(customer.id)).toBe(-50_000);
    expect(await walletOf(customer.id)).toBe(50_000);
  });
});

describe("settling an invoice from the balance", () => {
  it("pays the ticket without moving money or crediting the customer twice", async () => {
    const account = await newAccount();
    const customer = await newCustomer();

    await t.api.ok(
      "POST",
      "/due-received",
      { customerId: customer.id, cashAccount1Id: account.id, amount1: 50_000 },
      owner,
    );
    const ticket = await newTicket(customer.id, "WALLET1", 30_000);

    // Selling puts the customer back towards owing; the wallet is untouched.
    expect(await dueOf(customer.id)).toBe(-20_000);
    expect(await walletOf(customer.id)).toBe(50_000);

    await t.api.ok(
      "POST",
      `/ticketing/${ticket.id}/payments`,
      { fromWallet: true, amount: 30_000 },
      owner,
    );

    const paid = await t.api.ok("GET", `/ticketing/${ticket.id}`, undefined, owner);
    expect(paid.totalPaid).toBe(30_000);
    expect(paid.dueAmount).toBe(0);

    // The cash arrived when it was paid in: nothing moves now.
    expect(await balanceOf(account.id)).toBe(50_000);
    // And it is not credited a second time — this is the double count the
    // whole design exists to prevent.
    expect(await dueOf(customer.id)).toBe(-20_000);
    expect(await walletOf(customer.id)).toBe(20_000);
  });

  it("shows on the statement as settled, without a second credit", async () => {
    const account = await newAccount();
    const customer = await newCustomer();

    await t.api.ok(
      "POST",
      "/due-received",
      { customerId: customer.id, cashAccount1Id: account.id, amount1: 10_000 },
      owner,
    );
    const ticket = await newTicket(customer.id, "WALLET2", 4_000);
    await t.api.ok(
      "POST",
      `/ticketing/${ticket.id}/payments`,
      { fromWallet: true, amount: 4_000 },
      owner,
    );

    const ledger = await t.api.ok("GET", `/customers/${customer.id}/ledger`, undefined, owner);
    const settlement = ledger.rows.find((row: { type: string }) => row.type === "ticket-payment");

    expect(settlement.credit).toBe(0);
    expect(settlement.description).toContain("settled from balance");
    // The statement must still land on what the customer owes.
    expect(ledger.rows.at(-1).runningDue).toBe(-6_000);
    expect(await dueOf(customer.id)).toBe(-6_000);
  });

  it("refuses more than the customer has paid in", async () => {
    const account = await newAccount();
    const customer = await newCustomer();

    await t.api.ok(
      "POST",
      "/due-received",
      { customerId: customer.id, cashAccount1Id: account.id, amount1: 1_000 },
      owner,
    );
    const ticket = await newTicket(customer.id, "WALLET3", 5_000);

    const refused = await t.api.post(
      `/ticketing/${ticket.id}/payments`,
      { fromWallet: true, amount: 2_000 },
      owner,
    );

    expect(refused.status).toBe(400);
    expect(refused.body.message).toContain("1000.00");
    expect(await walletOf(customer.id)).toBe(1_000);
  });

  it("refuses a customer who has paid in nothing", async () => {
    const customer = await newCustomer();
    const ticket = await newTicket(customer.id, "WALLET4", 5_000);

    const refused = await t.api.post(
      `/ticketing/${ticket.id}/payments`,
      { fromWallet: true, amount: 100 },
      owner,
    );

    expect(refused.status).toBe(400);
    expect(refused.body.message).toContain("nothing paid in advance");
  });

  it("still insists on an account when the money is arriving now", async () => {
    const customer = await newCustomer();
    const ticket = await newTicket(customer.id, "WALLET5", 5_000);

    const refused = await t.api.post(`/ticketing/${ticket.id}/payments`, { amount: 100 }, owner);

    expect(refused.status).toBe(400);
    expect(refused.body.message).toContain("account");
  });

  it("no amount of simultaneous settlements can overdraw the balance", async () => {
    const account = await newAccount();
    const customer = await newCustomer();

    await t.api.ok(
      "POST",
      "/due-received",
      { customerId: customer.id, cashAccount1Id: account.id, amount1: 1_000 },
      owner,
    );

    // Five tickets, so the invoice guard cannot be what refuses them: each
    // could be paid in full on its own, but the wallet only covers two.
    const tickets = await Promise.all(
      [1, 2, 3, 4, 5].map((i) => newTicket(customer.id, `RACE${i}`, 400)),
    );

    const results = await Promise.all(
      tickets.map((ticket) =>
        t.api.post(`/ticketing/${ticket.id}/payments`, { fromWallet: true, amount: 400 }, owner),
      ),
    );

    expect(results.filter((r) => r.status < 300).length).toBe(2);
    expect(await walletOf(customer.id)).toBe(200);
  });
});

describe("visa and Hajj settle the same way", () => {
  it("draws both from the same balance", async () => {
    const account = await newAccount();
    const customer = await newCustomer();

    await t.api.ok(
      "POST",
      "/due-received",
      { customerId: customer.id, cashAccount1Id: account.id, amount1: 20_000 },
      owner,
    );

    const visa = await t.api.ok(
      "POST",
      "/visa",
      { customerId: customer.id, country: "Saudi Arabia", visaType: "Umrah", serviceFee: 5_000, embassyFee: 2_000 },
      owner,
    );
    await t.api.ok("POST", `/visa/${visa.id}/payments`, { fromWallet: true, amount: 7_000 }, owner);

    expect(await walletOf(customer.id)).toBe(13_000);
    expect(await balanceOf(account.id)).toBe(20_000);
    expect((await t.api.ok("GET", `/visa/${visa.id}`, undefined, owner)).dueAmount).toBe(0);
  });
});

describe("the wallet endpoints", () => {
  it("list who is holding a balance, and what the agency owes them in total", async () => {
    const other = await t.api.registerAgency("Wallet other");
    const account = await newAccount();
    const customer = await newCustomer();

    await t.api.ok(
      "POST",
      "/due-received",
      { customerId: customer.id, cashAccount1Id: account.id, amount1: 7_000 },
      owner,
    );

    const holders = await t.api.ok("GET", "/wallet", undefined, owner);
    const mine = holders.find((h: { customerId: string }) => h.customerId === customer.id);
    expect(mine.balance).toBe(7_000);

    const summary = await t.api.ok("GET", "/wallet/summary", undefined, owner);
    expect(summary.totalHeld).toBeGreaterThanOrEqual(7_000);
    expect(summary.customersInCredit).toBeGreaterThanOrEqual(1);

    // Another agency sees neither the list nor the statement.
    expect(await t.api.ok("GET", "/wallet", undefined, other)).toEqual([]);
    expect((await t.api.get(`/wallet/${customer.id}`, other)).status).toBe(404);
  });

  it("shows a running balance, oldest movement first", async () => {
    const account = await newAccount();
    const customer = await newCustomer();

    await t.api.ok(
      "POST",
      "/due-received",
      { customerId: customer.id, cashAccount1Id: account.id, amount1: 9_000 },
      owner,
    );
    const ticket = await newTicket(customer.id, "WALLET6", 3_000);
    await t.api.ok(
      "POST",
      `/ticketing/${ticket.id}/payments`,
      { fromWallet: true, amount: 3_000 },
      owner,
    );

    const statement = await t.api.ok("GET", `/wallet/${customer.id}`, undefined, owner);

    expect(statement.movements.map((m: { type: string }) => m.type)).toEqual(["PAID_IN", "SPENT"]);
    expect(statement.movements.map((m: { balance: number }) => m.balance)).toEqual([9_000, 6_000]);
    expect(statement.balance).toBe(6_000);
    expect(statement.paidIn).toBe(9_000);
    expect(statement.usedUp).toBe(3_000);
  });
});
