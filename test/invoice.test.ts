import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestApp, type Session, type TestApp } from "./helpers/app.js";

let t: TestApp;
let owner: Session;
const ids: Record<string, string> = {};

const pageCount = (pdf: Buffer) => (pdf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? []).length;

beforeAll(async () => {
  t = await startTestApp();
  owner = await t.api.registerAgency("Invoice");

  const account = await t.api.ok("POST", "/accounts", { name: "bKash merchant" }, owner);
  const customer = await t.api.ok(
    "POST",
    "/customers",
    // Bangla name and address: the standard PDF fonts cannot draw these.
    { name: "রহিম উদ্দিন", phone: "01711111111", address: "গ্রাম: শ্রীপুর" },
    owner,
  );
  const route = await t.api.ok("POST", "/routes-master", { name: "DAC → JED" }, owner);

  const ticket = await t.api.ok(
    "POST",
    "/ticketing",
    { customerId: customer.id, routeId: route.id, passengerName: "Rahim Uddin", pnr: "INV001", fare: 42_500, cost: 39_000 },
    owner,
  );
  await t.api.ok("POST", `/ticketing/${ticket.id}/payments`, { cashAccountId: account.id, amount: 20_000 }, owner);

  const visa = await t.api.ok("POST", "/visa", { customerId: customer.id, country: "Saudi Arabia", visaType: "Umrah", serviceFee: 4500 }, owner);

  const pkg = await t.api.ok("POST", "/hajj/packages", { name: "Hajj Premium", type: "HAJJ", tier: "PREMIUM", price: 950_000 }, owner);
  const batch = await t.api.ok("POST", "/hajj/batches", { packageId: pkg.id, name: "Batch A", departureDate: "2027-05-01", seatCapacity: 45 }, owner);
  const booking = await t.api.ok("POST", "/hajj/bookings", { customerId: customer.id, packageId: pkg.id, batchId: batch.id, pilgrimName: "রহিম উদ্দিন" }, owner);
  // Enough instalments to run the payments table onto a second page.
  for (let i = 0; i < 40; i++) {
    await t.api.ok("POST", `/hajj/bookings/${booking.id}/payments`, { cashAccountId: account.id, amount: 5000, transactionRef: `INST-${i + 1}` }, owner);
  }

  Object.assign(ids, { ticket: ticket.id, visa: visa.id, booking: booking.id });
});
afterAll(() => t.close());

describe("invoice PDFs", () => {
  it.each([
    ["ticket", () => `/ticketing/${ids.ticket}/invoice`, "TKT-"],
    ["visa case", () => `/visa/${ids.visa}/invoice`, "VIS-"],
    ["hajj booking", () => `/hajj/bookings/${ids.booking}/invoice`, "HAJ-"],
  ])("a %s renders as an inline, uncached PDF", async (_label, path, prefix) => {
    const res = await t.api.get(path(), owner);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("content-disposition")).toMatch(new RegExp(`^inline; filename="${prefix}[0-9A-F]{10}\\.pdf"$`));
    expect(res.headers.get("cache-control")).toContain("no-store");
    expect(res.raw.subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("embeds the Unicode fonts rather than the WinAnsi built-ins", async () => {
    const res = await t.api.get(`/ticketing/${ids.ticket}/invoice`, owner);
    const pdf = res.raw.toString("latin1");
    expect(pdf).toMatch(/NotoSans/);
    expect(pdf).toMatch(/NotoSansBengali/);
    expect(pdf).not.toMatch(/\/BaseFont\s*\/Helvetica/);
  });

  it("runs a long payments list onto further pages", async () => {
    const res = await t.api.get(`/hajj/bookings/${ids.booking}/invoice`, owner);
    expect(pageCount(res.raw)).toBeGreaterThanOrEqual(2);
  });

  it("answers errors as JSON, not as a broken PDF", async () => {
    const wrongKind = await t.api.get(`/hajj/bookings/${ids.ticket}/invoice`, owner);
    expect(wrongKind.status).toBe(404);
    expect(wrongKind.headers.get("content-type")).toContain("application/json");

    expect((await t.api.get(`/ticketing/${ids.ticket}/invoice`)).status).toBe(401);
  });
});
