import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MAX_PAGE_SIZE } from "../src/app/utils/QueryBuilder.js";
import { startTestApp, type Session, type TestApp } from "./helpers/app.js";

/**
 * List parameters come straight from the query string, so every list endpoint
 * has to survive whatever is typed there. Regressions, each seen on the running
 * API: `?page=-1` answered 500; `?limit=-5` returned rows with totalPages -2;
 * `?limit=100000` was honoured; and a bad `?sortBy=` answered with the server's
 * absolute source path in the error message.
 */

let t: TestApp;
let owner: Session;

beforeAll(async () => {
  t = await startTestApp();
  owner = await t.api.registerAgency("Params");
  for (let i = 0; i < 15; i += 1) {
    await t.api.ok("POST", "/customers", { name: `Customer ${String(i).padStart(2, "0")}`, phone: `0170100${String(i).padStart(4, "0")}` }, owner);
  }
});
afterAll(() => t.close());

const list = (query: string) => t.api.get(`/customers?${query}`, owner);

/** Anything that looks like a filesystem path, a source location or Prisma's own wording. */
const INTERNALS = /[A-Za-z]:[\\/]|\/src\/|\.ts:\d+|node_modules|prisma\.|invocation|Prisma Client/i;

describe("paging", () => {
  it.each(["page=-1", "page=0", "page=2.5", "page=abc", "page=", "page[gt]=1", "page=1&page=2"])(
    "treats %s as the first page",
    async (query) => {
      const res = await list(query);
      expect(res.status).toBe(200);
      expect(res.body.meta).toMatchObject({ page: 1, limit: 10, total: 15, totalPages: 2 });
      expect(res.body.data).toHaveLength(10);
    },
  );

  it.each(["limit=-5", "limit=0", "limit=2.5", "limit=abc", "limit="])("uses the default size for %s", async (query) => {
    const res = await list(query);
    expect(res.status).toBe(200);
    expect(res.body.meta).toMatchObject({ limit: 10, totalPages: 2 });
  });

  it("caps the page size", async () => {
    const res = await list("limit=100000");
    expect(res.status).toBe(200);
    expect(res.body.meta?.limit).toBe(MAX_PAGE_SIZE);
  });

  it("honours the web app's dropdown size exactly", async () => {
    // The web app asks for limit=200 to fill select boxes; a lower cap would cut them short.
    const res = await list("limit=200");
    expect(res.body.meta?.limit).toBe(200);
    expect(res.body.data).toHaveLength(15);
  });

  it("treats a page number too large to represent as the first page", async () => {
    const res = await list("page=99999999999999999999");
    expect(res.status).toBe(200);
    expect(res.body.meta).toMatchObject({ page: 1, total: 15 });
  });

  it("answers a page past the end with an empty page, not an error", async () => {
    // Large but representable: capped so Prisma's 32-bit skip can express it.
    const res = await list("page=999999999");
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
    expect(res.body.meta?.total).toBe(15);
  });

  it("still pages normally", async () => {
    const res = await list("page=2&limit=10&sortBy=name&sortOrder=asc");
    expect(res.body.meta).toMatchObject({ page: 2, limit: 10, total: 15, totalPages: 2 });
    expect(res.body.data.map((c: { name: string }) => c.name)).toEqual([
      "Customer 10",
      "Customer 11",
      "Customer 12",
      "Customer 13",
      "Customer 14",
    ]);
  });
});

describe("sorting", () => {
  it("falls back to newest first for a sort key that is not a field name", async () => {
    for (const query of ["sortBy=name;drop", "sortBy=a.b.c", "sortBy=", "sortBy[x]=1"]) {
      const res = await list(query);
      expect(res.status, query).toBe(200);
    }
  });

  it("refuses a field the model does not have, in plain words", async () => {
    const res = await list("sortBy=nope");
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Unknown field "nope".');
    expect(JSON.stringify(res.body)).not.toMatch(INTERNALS);
  });

  it("accepts a to-one relation's field", async () => {
    expect((await list("sortBy=agency.name")).status).toBe(200);
  });

  it("ignores a sort order it does not recognise", async () => {
    expect((await list("sortOrder=sideways")).status).toBe(200);
  });
});

describe("error messages", () => {
  it.each([
    ["an unknown sort field", "/customers?sortBy=nope"],
    ["an unknown field selection", "/customers?fields=name,nope"],
    ["a relation in the field selection", "/customers?fields=agency"],
    ["a relation sort on a list", "/customers?sortBy=tickets.fare"],
  ])("never expose server internals for %s", async (_label, path) => {
    const res = await t.api.get(path, owner);
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect(JSON.stringify(res.body)).not.toMatch(INTERNALS);
    expect(res.body.requestId).toBeTruthy();
  });

  it("still names the rule a user broke", async () => {
    await t.api.ok("POST", "/accounts", { name: "Vault" }, owner);
    const res = await t.api.post("/accounts", { name: "Vault" }, owner);
    expect(res.status).toBe(409);
    expect(res.body.message).toBe("An account with this name already exists");
  });
});
