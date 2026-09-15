import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestApp, type TestApp } from "./helpers/app.js";

let t: TestApp;
beforeAll(async () => {
  t = await startTestApp();
});
afterAll(() => t.close());

describe("API security headers", () => {
  it.each([
    ["a JSON success", "/health"],
    ["a JSON error", "/api/v1/customers"],
    ["an unknown route", "/api/v1/nope"],
  ])("are sent on %s", async (_label, path) => {
    const res = await t.api.get(path);
    const h = res.headers;

    expect(h.get("x-powered-by")).toBeNull();
    expect(h.get("content-security-policy")).toBe("default-src 'none';frame-ancestors 'none';base-uri 'none';form-action 'none'");
    expect(h.get("x-content-type-options")).toBe("nosniff");
    expect(h.get("x-frame-options")).toBe("SAMEORIGIN");
    expect(h.get("referrer-policy")).toBe("no-referrer");
    expect(h.get("cross-origin-resource-policy")).toBe("same-site");
    expect(h.get("strict-transport-security")).toBe("max-age=31536000");
  });

  it("do not break the PDF invoices", async () => {
    const owner = await t.api.registerAgency("Headers");
    const customer = await t.api.ok("POST", "/customers", { name: "Header Customer", phone: "01755555555" }, owner);
    const ticket = await t.api.ok("POST", "/ticketing", { customerId: customer.id, passengerName: "Pax One", pnr: "HDR001", fare: 1000, cost: 900 }, owner);

    const res = await t.api.get(`/ticketing/${ticket.id}/invoice`, owner);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("content-security-policy")).toContain("default-src 'none'");
  });
});
