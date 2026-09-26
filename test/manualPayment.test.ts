import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestApp, type Session, type TestApp } from "./helpers/app.js";

/**
 * Paying a subscription by bKash.
 *
 * The gateway confirms itself; bKash cannot. What an agency sends here is what
 * they typed off their phone — a number and a transaction id — so every test
 * below is really the same question: can anything an agency sends turn its own
 * plan on? It must not. Only an operator who has read the receipt can.
 */

const PRICE = 1500;

let t: TestApp;
let planId: string;
let operator: Session;

beforeAll(async () => {
  t = await startTestApp();
  operator = await t.api.loginOperator();

  const plan = await t.api.ok(
    "POST",
    "/admin/plans",
    { name: "Manual", price: PRICE, durationDays: 30, features: ["TICKETING"] },
    operator,
  );
  planId = plan.id;

  // bKash is only offered once the operator has set both the number and the
  // QR, so every test below needs them in place first.
  await t.api.ok("PATCH", "/admin/payment-settings", { bkashNumber: "01711111111" }, operator);
  await uploadQr();
});

afterAll(() => t.close());

let receiptSeq = 0;
const receipt = () => `BKX${(receiptSeq += 1)}${Date.now().toString().slice(-6)}`;

/** A one-pixel PNG is a valid image and is the smallest thing to upload. */
const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

const uploadQr = async () => {
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(PNG_1X1)], { type: "image/png" }), "qr.png");

  const response = await fetch(`${t.api.baseUrl}/api/v1/admin/payment-settings/qr`, {
    method: "POST",
    headers: {
      Cookie: `accessToken=${operator.accessToken}; better-auth.session_token=${operator.token}`,
      "X-Forwarded-For": "10.9.9.9",
    },
    body: form,
  });

  return { status: response.status, body: await response.json() };
};

const submit = (agency: Session, senderReference: string) =>
  t.api.post(
    "/billing/manual-payment",
    { planId, senderNumber: "01712345678", senderReference },
    agency,
  );

describe("an agency saying it has paid by bKash", () => {
  it("is told where to send the money", async () => {
    const agency = await t.api.registerAgency("Where to pay");

    const info = await t.api.ok("GET", "/billing/manual-payment", undefined, agency);

    expect(info.available).toBe(true);
    expect(info.number).toBe("01711111111");
  });

  it("records the claim and turns nothing on", async () => {
    const agency = await t.api.registerAgency("Claim");

    const { status: code, body } = await submit(agency, receipt());

    // 202: received, not done. The plan is still whatever it was.
    expect(code).toBe(202);
    expect(body.data.status).toBe("PENDING");

    const subscription = await t.api.ok("GET", "/billing/my-subscription", undefined, agency);
    expect(subscription.plan).toBeNull();
    expect(subscription.subscriptionEndsAt).toBeNull();
  });

  it("shows the agency what it is waiting on", async () => {
    const agency = await t.api.registerAgency("Waiting");
    const reference = receipt();
    await submit(agency, reference);

    const pending = await t.api.ok(
      "GET",
      "/billing/manual-payment/pending",
      undefined,
      agency,
    );

    expect(pending).toMatchObject({ senderReference: reference, amount: PRICE });
  });

  it("refuses a second claim while the first is unread", async () => {
    const agency = await t.api.registerAgency("Twice");
    await submit(agency, receipt());

    const { status: code, body } = await submit(agency, receipt());

    // Otherwise a double-click is two receipts, and somebody has to work out
    // which of them was real.
    expect(code).toBe(409);
    expect(body.message).toMatch(/already have a bKash payment/i);
  });

  it("refuses a transaction id that has been used before", async () => {
    const first = await t.api.registerAgency("Receipt owner");
    const second = await t.api.registerAgency("Receipt borrower");
    const reference = receipt();

    await submit(first, reference);
    const { status: code, body } = await submit(second, reference);

    // One receipt, one payment — whoever is holding it.
    expect(code).toBe(409);
    expect(body.message).toMatch(/already been submitted/i);
  });
});

describe("the operator reading the receipt", () => {
  it("sees the claim in the queue, with who sent it", async () => {
    const agency = await t.api.registerAgency("Queued");
    const reference = receipt();
    await submit(agency, reference);

    const queue = await t.api.ok("GET", "/admin/manual-payments", undefined, operator);
    const mine = queue.find((row: { senderReference: string }) => row.senderReference === reference);

    expect(mine).toBeDefined();
    expect(mine.senderNumber).toBe("01712345678");
    expect(mine.agency.name).toMatch(/Queued/);
  });

  it("turns the plan on by approving it", async () => {
    const agency = await t.api.registerAgency("Approved");
    const reference = receipt();
    const { body } = await submit(agency, reference);

    await t.api.ok(
      "POST",
      `/admin/manual-payments/${body.data.id}/review`,
      { approve: true },
      operator,
    );

    const subscription = await t.api.ok("GET", "/billing/my-subscription", undefined, agency);
    expect(subscription.plan?.id).toBe(planId);
    expect(subscription.status).toBe("ACTIVE");
    expect(subscription.subscriptionDaysLeft).toBeGreaterThan(25);
  });

  it("leaves the plan off when it refuses one", async () => {
    const agency = await t.api.registerAgency("Refused");
    const { body } = await submit(agency, receipt());

    await t.api.ok(
      "POST",
      `/admin/manual-payments/${body.data.id}/review`,
      { approve: false, note: "No such transaction in the statement" },
      operator,
    );

    const subscription = await t.api.ok("GET", "/billing/my-subscription", undefined, agency);
    expect(subscription.plan).toBeNull();

    // And the agency can try again — the refusal cleared the way.
    const { status: code } = await submit(agency, receipt());
    expect(code).toBe(202);
  });

  it("cannot approve the same receipt twice", async () => {
    const agency = await t.api.registerAgency("Once only");
    const { body } = await submit(agency, receipt());
    const path = `/admin/manual-payments/${body.data.id}/review`;

    await t.api.ok("POST", path, { approve: true }, operator);
    const again = await t.api.post(path, { approve: true }, operator);

    // One receipt buys one renewal, however many times the button is pressed.
    expect(again.status).toBe(400);
    expect(again.body.message).toMatch(/already been approved/i);
  });
});

describe("who is allowed to approve", () => {
  it("is not the agency that sent the payment", async () => {
    const agency = await t.api.registerAgency("Self approver");
    const { body } = await submit(agency, receipt());

    const attempt = await t.api.post(
      `/admin/manual-payments/${body.data.id}/review`,
      { approve: true },
      agency,
    );

    // The whole point: the claim and the confirmation are different people.
    expect(attempt.status).toBe(403);

    const subscription = await t.api.ok("GET", "/billing/my-subscription", undefined, agency);
    expect(subscription.plan).toBeNull();
  });

  it("is not a signed-out stranger", async () => {
    const agency = await t.api.registerAgency("Stranger");
    const { body } = await submit(agency, receipt());

    const attempt = await t.api.post(
      `/admin/manual-payments/${body.data.id}/review`,
      { approve: true },
    );

    expect(attempt.status).toBe(401);
  });
});

/**
 * The number and QR an agency is asked to pay into.
 *
 * These belong to whoever runs the platform, not to whoever deploys it: they
 * used to be an environment variable and a file committed into the web app,
 * so changing the account subscriptions are paid into meant a deploy.
 */
describe("the payment details the operator sets", () => {
  it("serves the QR as an image, not as JSON", async () => {
    const agency = await t.api.registerAgency("Scanner");

    const response = await fetch(`${t.api.baseUrl}/api/v1/billing/manual-payment/qr`, {
      headers: {
        Cookie: `accessToken=${agency.accessToken}; better-auth.session_token=${agency.token}`,
        "X-Forwarded-For": "10.9.9.9",
      },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    // The bytes come back, not a base64 string wrapped in an envelope.
    expect((await response.arrayBuffer()).byteLength).toBe(PNG_1X1.byteLength);
  });

  it("cannot be changed by an agency", async () => {
    const agency = await t.api.registerAgency("Not the operator");

    const attempt = await t.api.patch(
      "/admin/payment-settings",
      { bkashNumber: "01999999999" },
      agency,
    );

    // A tenant setting the account its own subscription is paid into would be
    // the whole billing system, undone.
    expect(attempt.status).toBe(403);

    const info = await t.api.ok("GET", "/billing/manual-payment", undefined, agency);
    expect(info.number).toBe("01711111111");
  });

  it("refuses something that is not an image", async () => {
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array([1, 2, 3])], { type: "text/plain" }), "qr.txt");

    const response = await fetch(`${t.api.baseUrl}/api/v1/admin/payment-settings/qr`, {
      method: "POST",
      headers: {
        Cookie: `accessToken=${operator.accessToken}; better-auth.session_token=${operator.token}`,
        "X-Forwarded-For": "10.9.9.9",
      },
      body: form,
    });

    expect(response.status).toBe(400);
  });
});
