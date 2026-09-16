# Testing

Integration tests with Vitest: the real Express app, started on a free port,
against a real Postgres. What this API has to get right — tenant isolation,
auth rules, balances that reconcile — only exists at the database, so that is
where it is tested.

```bash
docker compose up -d     # the dev Postgres on :5433
pnpm test                # creates travelar_test on first run, migrates, runs
pnpm typecheck           # src + test
```

## The test database

Tests never touch your dev data. They use a separate database whose name
**must end in `_test`** — `test/globalSetup.ts` refuses anything else before
a single table is truncated, and `test/helpers/app.ts` checks again.

- Local default: `postgresql://postgres:postgres@localhost:5433/travelar_test`,
  created automatically on the dev container.
- Anywhere else: set `TEST_DATABASE_URL`.

`vitest.config.ts` sets every env var the app needs before any module loads.
`env.ts` still calls dotenv, but dotenv never overrides a variable that is
already set, so a developer's `.env` cannot redirect a test run.

## How a test file is shaped

```ts
let t: TestApp;
beforeAll(async () => { t = await startTestApp(); }); // truncate, seed operator, listen
afterAll(() => t.close());

it("…", async () => {
  const owner = await t.api.registerAgency("Label");        // a fresh trial agency
  const account = await t.api.ok("POST", "/accounts", { name: "Cash" }, owner); // arrange
  const res = await t.api.get(`/accounts/${account.id}`, other);               // act
  expect(res.status).toBe(404);                                                 // assert
});
```

- `t.api.ok(...)` throws unless the call succeeded — use it to arrange state.
- `t.api.get/post/patch/delete(...)` return `{ status, body, headers, raw }` —
  use them for the call under test.
- Files run one at a time (one database); each resets it first.

## Rate limits and client addresses

The API limits logins per client address and per account. The test client
sends a different `X-Forwarded-For` on every request, so a suite full of
logins never trips the per-address limit; `rateLimit.test.ts` pins addresses
explicitly to test it. The suite runs without `REDIS_URL`, which is also the
case the in-memory limiter exists for.

## What is covered

| File | Guards |
|---|---|
| `auth.test.ts` | better-auth's own routes closed; role/tenant cannot be smuggled in; email case; session + token both required; logout; change password |
| `passwordReset.test.ts` | the emailed link works once and expires; unknown and blocked accounts get the same answer and no email; per-address request limit; sessions revoked; temporary password cleared |
| `tenancy.test.ts` | another agency gets 404 on every record and invoice; platform/agency boundary; suspended = read-only; plan gates; deleted agency locked out |
| `team.test.ts` | owner / admin / staff rules; sessions revoked on demote, block, reset, remove; lapsed agency can still lock someone out; agency profile |
| `money.test.ts` | ledger balance; exact reversal; transfers net to zero and cannot overdraw; over-payment guards; supplier payable; split-tender collections; the customer statement ends on `currentDue` |
| `invoice.test.ts` | PDFs for all three modules, embedded Unicode fonts, multi-page, JSON errors |
| `subscriptionLifecycle.test.ts` | trial and subscription reminders reach active admins only, once per period, most urgent only; renewal re-arms; expiry flips status and emails once; long-lapsed agencies expired quietly; suspended skipped; operator and cron-secret triggers |
| `securityHeaders.test.ts` | helmet headers on JSON successes, errors and 404s; no X-Powered-By; PDFs unaffected |
| `queryCount.test.ts` | list endpoints cost the same number of database queries for 5 rows as for 30 (counted at the pg driver), and the batched per-row figures are right |
| `rateLimit.test.ts` | per-address and per-account limits, without Redis |

Several of these are regression tests for real bugs — each says which in a
comment. Keep them when refactoring the code they cover.
