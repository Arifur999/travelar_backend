import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type LogFields, type LogLevel, setLogLevel, setLogWriter } from "../src/app/lib/logger.js";
import { startTestApp, type Session, type TestApp } from "./helpers/app.js";
import { type FakeSslcommerz, installFakeSslcommerz } from "./helpers/fakeSslcommerz.js";

/**
 * The SaaS revenue path: checkout, the gateway's IPN, and renewal.
 *
 * SSLCommerz is faked at `fetch` (helpers/fakeSslcommerz.ts), so these run
 * without gateway credentials. The IPN is posted form-encoded, as the real
 * gateway sends it, to the real public route.
 */

const DAY = 86_400_000;
const PRICE = 2500;

let t: TestApp;
let gateway: FakeSslcommerz;
let planId: string;

beforeAll(async () => {
  t = await startTestApp();
  gateway = installFakeSslcommerz();

  const operator = await t.api.loginOperator();
  const plan = await t.api.ok(
    "POST",
    "/admin/plans",
    { name: "Pro", price: PRICE, durationDays: 30, features: ["TICKETING", "VISA"] },
    operator,
  );
  planId = plan.id;
});

afterAll(async () => {
  gateway.restore();
  await t.close();
});

/** Posts an IPN exactly as SSLCommerz does: form-encoded, no session. */
const postIpn = (fields: Record<string, string>) =>
  fetch(`${t.api.baseUrl}/api/v1/billing/sslcommerz/ipn`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "X-Forwarded-For": "103.26.139.1" },
    body: new URLSearchParams(fields),
  });

const checkout = async (owner: Session) =>
  (await t.api.ok("POST", "/billing/checkout", { planId }, owner)) as { transactionId: string; gatewayUrl: string };

const orderStatus = async (owner: Session, transactionId: string) =>
  (await t.api.ok("GET", `/billing/orders/${transactionId}/status`, undefined, owner)).status as string;

const subscription = async (owner: Session) =>
  (await t.api.ok("GET", "/billing/my-subscription", undefined, owner)) as {
    status: string;
    subscriptionEndsAt: string | null;
    plan: { id: string } | null;
  };

/** Days from now until the subscription ends, rounded — immune to test runtime. */
const daysBought = async (owner: Session) => {
  const { subscriptionEndsAt } = await subscription(owner);
  return subscriptionEndsAt ? Math.round((new Date(subscriptionEndsAt).getTime() - Date.now()) / DAY) : 0;
};

/** The customer pays on the gateway page and the gateway notifies us. */
const payAndNotify = async (transactionId: string, amount = PRICE) => {
  const valId = gateway.pay(transactionId, amount);
  const res = await postIpn({ tran_id: transactionId, val_id: valId, status: "VALID", amount: String(amount) });
  expect(res.status).toBe(200);
  return valId;
};

describe("checkout", () => {
  it("opens a session under an opaque reference and records a pending order", async () => {
    const owner = await t.api.registerAgency("Checkout");
    const { transactionId, gatewayUrl } = await checkout(owner);

    expect(transactionId).toMatch(/^ORD-\d+-[0-9a-f]{12}$/);
    // The old format embedded the agency id, putting a tenant identifier into
    // the gateway's records and the customer's browser history.
    expect(transactionId).not.toContain(owner.user.agencyId!);
    expect(gatewayUrl).toContain("sslcommerz.com");
    expect(gateway.sessionsOpened).toContain(transactionId);
    expect(await orderStatus(owner, transactionId)).toBe("PENDING");
  });

  it("records a refused session as failed and answers 502", async () => {
    const owner = await t.api.registerAgency("Refused");
    gateway.setSessionMode("refuse");
    try {
      const res = await t.api.post("/billing/checkout", { planId }, owner);
      expect(res.status).toBe(502);
      expect(res.body.message).toBe("Store is not active");
    } finally {
      gateway.setSessionMode("ok");
    }

    const history = await t.api.ok("GET", "/billing/payment-history", undefined, owner);
    expect(history).toHaveLength(1);
    expect(history[0].status).toBe("FAILED");
  });

  it("records an unreachable gateway as failed and answers 502", async () => {
    const owner = await t.api.registerAgency("Unreachable");
    gateway.setSessionMode("unreachable");
    try {
      expect((await t.api.post("/billing/checkout", { planId }, owner)).status).toBe(502);
    } finally {
      gateway.setSessionMode("ok");
    }

    const history = await t.api.ok("GET", "/billing/payment-history", undefined, owner);
    expect(history[0].status).toBe("FAILED");
  });

  it("only offers plans that are on sale", async () => {
    const owner = await t.api.registerAgency("Unlisted");
    const res = await t.api.post("/billing/checkout", { planId: "00000000-0000-4000-8000-000000000000" }, owner);
    expect(res.status).toBe(400);
  });
});

describe("the gateway's notification", () => {
  it("marks the order paid, renews once, and puts the agency on that plan", async () => {
    const owner = await t.api.registerAgency("Paid");
    expect((await subscription(owner)).status).toBe("TRIAL");

    const { transactionId } = await checkout(owner);
    await payAndNotify(transactionId);

    expect(await orderStatus(owner, transactionId)).toBe("SUCCESS");
    const after = await subscription(owner);
    expect(after.status).toBe("ACTIVE");
    expect(after.plan?.id).toBe(planId);
    expect(await daysBought(owner)).toBe(30);
    // The IPN body is never trusted: the payment was confirmed with the gateway.
    expect(gateway.validations.length).toBeGreaterThan(0);
  });

  it("does not renew twice when the same notification is replayed", async () => {
    const owner = await t.api.registerAgency("Replay");
    const { transactionId } = await checkout(owner);
    const valId = await payAndNotify(transactionId);

    for (let i = 0; i < 3; i += 1) {
      await postIpn({ tran_id: transactionId, val_id: valId, status: "VALID" });
    }

    expect(await daysBought(owner)).toBe(30);
  });

  it("renews exactly once when duplicate notifications arrive together", async () => {
    const owner = await t.api.registerAgency("Duplicate");
    const { transactionId } = await checkout(owner);
    const valId = gateway.pay(transactionId, PRICE);

    const responses = await Promise.all(
      Array.from({ length: 5 }, () => postIpn({ tran_id: transactionId, val_id: valId, status: "VALID" })),
    );

    expect(responses.every((res) => res.status === 200)).toBe(true);
    expect(await daysBought(owner)).toBe(30);
  });

  /**
   * Regression: the validator's answer was checked for status, amount and
   * currency, but never for which order it confirmed. One real payment could
   * therefore be replayed against any other pending order of the same price —
   * pay once, open five checkouts, post five IPNs, get five periods.
   */
  it("cannot use one payment to pay for a different order", async () => {
    const owner = await t.api.registerAgency("Reuse");
    const first = await checkout(owner);
    const second = await checkout(owner);

    const valId = await payAndNotify(first.transactionId);
    expect(await daysBought(owner)).toBe(30);

    const forged = await postIpn({ tran_id: second.transactionId, val_id: valId, status: "VALID" });
    expect(forged.status).toBe(200);

    expect(await orderStatus(owner, second.transactionId)).not.toBe("SUCCESS");
    expect(await daysBought(owner)).toBe(30);
  });

  it("cannot use one agency's payment to pay another agency's order", async () => {
    const payer = await t.api.registerAgency("Payer");
    const other = await t.api.registerAgency("Beneficiary");
    const paid = await checkout(payer);
    const unpaid = await checkout(other);

    const valId = await payAndNotify(paid.transactionId);
    await postIpn({ tran_id: unpaid.transactionId, val_id: valId, status: "VALID" });

    expect(await orderStatus(other, unpaid.transactionId)).not.toBe("SUCCESS");
    expect((await subscription(other)).status).toBe("TRIAL");
  });

  /**
   * An invented val_id tells us nothing about this order, so the order is left
   * alone — not marked FAILED. Otherwise anyone who knew a tran_id could flip a
   * customer's in-progress payment to "failed". The real IPN still lands after.
   */
  it("leaves the order alone when the gateway does not recognise the payment", async () => {
    const owner = await t.api.registerAgency("Unknown val");
    const { transactionId } = await checkout(owner);

    await postIpn({ tran_id: transactionId, val_id: "VAL-never-issued", status: "VALID" });

    expect(await orderStatus(owner, transactionId)).toBe("PENDING");
    expect((await subscription(owner)).status).toBe("TRIAL");

    // And the genuine payment is still accepted afterwards.
    await payAndNotify(transactionId);
    expect(await orderStatus(owner, transactionId)).toBe("SUCCESS");
    expect(await daysBought(owner)).toBe(30);
  });

  it("records a rejection the gateway makes about this very order", async () => {
    const owner = await t.api.registerAgency("Rejected");
    const { transactionId } = await checkout(owner);
    // The validator names this order, but says it is not a valid payment.
    const valId = gateway.pay(transactionId, PRICE, { status: "INVALID_TRANSACTION" });

    await postIpn({ tran_id: transactionId, val_id: valId, status: "VALID" });

    expect(await orderStatus(owner, transactionId)).toBe("FAILED");
  });

  it.each([
    ["the wrong amount", { amount: "1.00" }],
    ["another currency", { currency: "USD" }],
    ["a status the gateway has not confirmed", { status: "PENDING" }],
  ])("refuses a payment reported with %s", async (_label, overrides) => {
    const owner = await t.api.registerAgency("Mismatch");
    const { transactionId } = await checkout(owner);
    const valId = gateway.pay(transactionId, PRICE, overrides);

    await postIpn({ tran_id: transactionId, val_id: valId, status: "VALID" });

    expect(await orderStatus(owner, transactionId)).toBe("FAILED");
    expect((await subscription(owner)).status).toBe("TRIAL");
  });

  it("accepts an amount within the gateway's one-taka rounding", async () => {
    const owner = await t.api.registerAgency("Rounding");
    const { transactionId } = await checkout(owner);
    const valId = gateway.pay(transactionId, PRICE, { amount: (PRICE - 0.5).toFixed(2) });

    await postIpn({ tran_id: transactionId, val_id: valId, status: "VALID" });

    expect(await orderStatus(owner, transactionId)).toBe("SUCCESS");
  });

  it("marks the order failed when the notification itself reports failure", async () => {
    const owner = await t.api.registerAgency("Declined");
    const { transactionId } = await checkout(owner);

    await postIpn({ tran_id: transactionId, status: "FAILED", error: "Card declined" });

    expect(await orderStatus(owner, transactionId)).toBe("FAILED");
  });

  it("still takes a genuine payment after a failed notification", async () => {
    // A failed attempt on the gateway page followed by a successful one is an
    // ordinary sequence; FAILED must not block the later success.
    const owner = await t.api.registerAgency("Second try");
    const { transactionId } = await checkout(owner);

    await postIpn({ tran_id: transactionId, status: "FAILED" });
    await payAndNotify(transactionId);

    expect(await orderStatus(owner, transactionId)).toBe("SUCCESS");
    expect(await daysBought(owner)).toBe(30);
  });

  it("acknowledges a notification for an unknown or missing transaction", async () => {
    expect((await postIpn({ tran_id: "ORD-0-000000000000", val_id: "x", status: "VALID" })).status).toBe(200);
    expect((await postIpn({})).status).toBe(200);
  });
});

describe("the customer's return from the gateway", () => {
  /**
   * Regression, with the IPN tests above: these routes were mounted behind the
   * billing router's session check, so a customer who had just paid landed on a
   * JSON "401 No session token provided" instead of the result page.
   */
  it.each([
    ["success", "success"],
    ["fail", "failed"],
    ["cancel", "cancelled"],
  ])("sends /%s back to the web app's result page without a session", async (route, resultStatus) => {
    for (const method of ["GET", "POST"]) {
      const res = await fetch(`${t.api.baseUrl}/api/v1/billing/sslcommerz/${route}?transactionId=ORD-123-abc`, {
        method,
        redirect: "manual",
      });

      expect(res.status, `${method} /${route}`).toBe(302);
      expect(res.headers.get("location")).toBe(
        `${process.env.FRONTEND_URL}/billing/payment-result?status=${resultStatus}&tran_id=ORD-123-abc`,
      );
    }
  });

  it("does not let the return trip change an order — only the IPN can", async () => {
    // Anyone can open these URLs, so reaching /success must not mark anything paid.
    const owner = await t.api.registerAgency("Return trip");
    const { transactionId } = await checkout(owner);

    await fetch(`${t.api.baseUrl}/api/v1/billing/sslcommerz/success?transactionId=${transactionId}`, {
      method: "POST",
      redirect: "manual",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ tran_id: transactionId, status: "VALID" }),
    });

    expect(await orderStatus(owner, transactionId)).toBe("PENDING");
    expect((await subscription(owner)).status).toBe("TRIAL");
  });
});

describe("renewal", () => {
  it("keeps the days already bought when paying early", async () => {
    const owner = await t.api.registerAgency("Early");

    await payAndNotify((await checkout(owner)).transactionId);
    expect(await daysBought(owner)).toBe(30);

    await payAndNotify((await checkout(owner)).transactionId);
    expect(await daysBought(owner)).toBe(60);
  });
});

describe("retrying a checkout", () => {
  it("cancels the previous attempt and opens a new one", async () => {
    const owner = await t.api.registerAgency("Retry");
    const first = await checkout(owner);

    const retried = await t.api.ok("POST", `/billing/orders/${first.transactionId}/retry`, undefined, owner);

    expect(retried.transactionId).not.toBe(first.transactionId);
    expect(await orderStatus(owner, first.transactionId)).toBe("CANCELLED");
    expect(await orderStatus(owner, retried.transactionId)).toBe("PENDING");

    // A cancelled attempt cannot itself be retried again.
    expect((await t.api.post(`/billing/orders/${first.transactionId}/retry`, {}, owner)).status).toBe(400);
  });

  it("refuses to retry a payment that already succeeded", async () => {
    const owner = await t.api.registerAgency("Retry paid");
    const { transactionId } = await checkout(owner);
    await payAndNotify(transactionId);

    expect((await t.api.post(`/billing/orders/${transactionId}/retry`, {}, owner)).status).toBe(400);
  });

  /**
   * Cancelling an attempt cannot stop the customer finishing it: its gateway
   * page may still be open in another tab. When that payment settles, the money
   * has really been taken, so it is honoured — dropping it would keep the money
   * and deliver nothing. It is logged, because it most likely means the
   * customer paid twice and is owed a refund.
   */
  it("still honours a payment that settles on a cancelled attempt, and flags it", async () => {
    const owner = await t.api.registerAgency("Late settle");
    const first = await checkout(owner);
    const retried = await t.api.ok("POST", `/billing/orders/${first.transactionId}/retry`, undefined, owner);

    const lines: (LogFields & { level: LogLevel; msg: string })[] = [];
    setLogLevel("warn");
    const restore = setLogWriter((_line, entry) => void lines.push(entry));
    try {
      await payAndNotify(retried.transactionId);
      await payAndNotify(first.transactionId);
    } finally {
      restore();
      setLogLevel("error");
    }

    expect(await orderStatus(owner, first.transactionId)).toBe("SUCCESS");
    expect(await daysBought(owner)).toBe(60);

    const flagged = lines.find((entry) => entry.msg === "payment settled on a cancelled checkout");
    expect(flagged).toMatchObject({ level: "warn", transactionId: first.transactionId, agencyId: owner.user.agencyId });
  });
});

describe("tenancy", () => {
  it("does not show one agency's orders to another", async () => {
    const owner = await t.api.registerAgency("Owner orders");
    const stranger = await t.api.registerAgency("Stranger");
    const { transactionId } = await checkout(owner);

    expect((await t.api.get(`/billing/orders/${transactionId}/status`, stranger)).status).toBe(404);
    expect((await t.api.post(`/billing/orders/${transactionId}/retry`, {}, stranger)).status).toBe(404);
    expect(await t.api.ok("GET", "/billing/payment-history", undefined, stranger)).toHaveLength(0);
  });

  it("lets only the agency admin start a checkout", async () => {
    const owner = await t.api.registerAgency("Staff checkout");
    const staffEmail = `staff-${Date.now()}@example.test`;
    await t.api.ok(
      "POST",
      "/team",
      { name: "Front Desk", email: staffEmail, role: "AGENCY_STAFF", password: "Staff@12345" },
      owner,
    );
    const staff = await t.api.login(staffEmail, "Staff@12345");

    expect((await t.api.post("/billing/checkout", { planId }, staff)).status).toBe(403);
    // Staff can still see what is owed.
    expect((await t.api.get("/billing/my-subscription", staff)).status).toBe(200);
  });
});
