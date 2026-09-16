import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setLogLevel, setLogWriter, type LogFields, type LogLevel } from "../src/app/lib/logger.js";
import { startTestApp, type TestApp } from "./helpers/app.js";

/**
 * What an operator needs when someone reports a failure: an id on every
 * response, the same id in the logs, and no secrets in either.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

type Entry = LogFields & { level: LogLevel; msg: string };

let t: TestApp;
let lines: Entry[] = [];
let restoreWriter: () => void;

beforeAll(async () => {
  t = await startTestApp();
});
afterAll(() => t.close());

beforeEach(() => {
  lines = [];
  // Tests run at "error"; the access lines under test are info and warn.
  setLogLevel("debug");
  restoreWriter = setLogWriter((_line, entry) => void lines.push(entry));
});
afterEach(() => {
  restoreWriter();
  setLogLevel("error");
});

/** The access line is written on the socket's "finish", which can land just after fetch resolves. */
const lineFor = async (requestId: string, msg?: string) => {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const found = lines.find((entry) => entry.requestId === requestId && (msg === undefined || entry.msg === msg));
    if (found) return found;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`No log line for request ${requestId}${msg ? ` (${msg})` : ""}. Saw: ${JSON.stringify(lines)}`);
};

describe("request ids", () => {
  it.each([
    ["a success", "/health", 200],
    ["a rejection", "/api/v1/customers", 401],
    ["an unknown route", "/api/v1/nope", 404],
  ])("are returned on %s", async (_label, path, expected) => {
    const res = await t.api.get(path);
    expect(res.status).toBe(expected);
    expect(res.headers.get("x-request-id")).toMatch(UUID);
  });

  it("continue a trace the caller started", async () => {
    const inbound = "web-01JCQ7Z3K9TRACE";
    const res = await t.api.request("GET", "/health", { headers: { "x-request-id": inbound } });

    expect(res.headers.get("x-request-id")).toBe(inbound);
    expect(await lineFor(inbound)).toMatchObject({ msg: "request", path: "/health", status: 200 });
  });

  it("replace an id the caller made up", async () => {
    // Anything that could confuse a log line or bloat a field: whitespace,
    // punctuation, non-ASCII, or simply too long. (A newline is not in the
    // list because the HTTP layer refuses to carry one in a header at all.)
    for (const hostile of ["short", "has spaces", "a".repeat(65), '"quoted"', "semi;colon", "id/with/slash", "trace=1&x=2"]) {
      const res = await t.api.request("GET", "/health", { headers: { "x-request-id": hostile } });
      const returned = res.headers.get("x-request-id");

      expect(returned).not.toBe(hostile);
      expect(returned).toMatch(UUID);
    }
  });

  it("appear in the error body, matching the header", async () => {
    const res = await t.api.get("/api/v1/customers");

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
    expect(res.body).toHaveProperty("requestId", res.headers.get("x-request-id"));
  });
});

describe("access logging", () => {
  it("records the rejection without the query string", async () => {
    const id = "trace-query-redaction";
    // A search term is user data and a token would be worse; neither may be logged.
    const res = await t.api.request("GET", "/api/v1/customers?searchTerm=top-secret-value", {
      headers: { "x-request-id": id },
    });
    expect(res.status).toBe(401);

    const line = await lineFor(id, "request rejected");
    expect(line.level).toBe("warn");
    expect(line.status).toBe(401);
    expect(String(line.path)).toContain("customers");
    expect(JSON.stringify(line)).not.toContain("top-secret-value");
    expect(String(line.path)).not.toContain("?");
    expect(typeof line.durationMs).toBe("number");
  });

  it("says which user and agency a request belonged to", async () => {
    const owner = await t.api.registerAgency("Observability");
    const id = "trace-authenticated-call";

    const res = await t.api.request("GET", "/api/v1/customers", {
      session: owner,
      headers: { "x-request-id": id },
    });
    expect(res.status).toBe(200);

    expect(await lineFor(id, "request")).toMatchObject({
      level: "info",
      status: 200,
      userId: owner.user.id,
      agencyId: owner.user.agencyId,
    });
  });

  it("keeps health checks out of the way at debug", async () => {
    const id = "trace-health-check-ok";
    await t.api.request("GET", "/health", { headers: { "x-request-id": id } });

    expect((await lineFor(id)).level).toBe("debug");
  });
});
