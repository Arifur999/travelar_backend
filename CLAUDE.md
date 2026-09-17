# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Travelar API is a multi-tenant B2B API for travel agencies, where each agency is a tenant. It uses Express 5, TypeScript ESM, Prisma 7 + PostgreSQL, and better-auth. The web app is [travelar](https://github.com/Arifur999/travelar), checked out locally next to this repo as `../travel_agency`.

`docs/*.md` are the functional specs for the ticketing, visa, Hajj/Umrah and payment-gateway modules. They were written for the old Mongoose/Express 4 app, so treat them as requirements, not code to copy. `docs/README.md` lists known defects from that app that must not come back.

## Commands

```bash
docker compose up -d                 # dev Postgres on host port 5433 (not 5432)
pnpm generate                        # after any prisma/schema change; client -> src/generated/prisma (gitignored)
pnpm migrate --name <name>           # prisma migrate dev
pnpm dev                             # tsx watch, http://localhost:5050
pnpm lint                            # eslint + scripts/check-esm-imports.mjs
pnpm typecheck                       # tsc over src + test (tsconfig.test.json)
pnpm test                            # integration suite; creates + migrates travelar_test on first run
pnpm test test/money.test.ts         # one file
pnpm test test/money.test.ts -t "overdraw"   # tests whose name matches
```

CI runs `generate → lint → typecheck → test` against a Postgres service container, then builds the Docker image. `pnpm generate` needs `DATABASE_URL` set because `prisma.config.ts` reads it, but any placeholder URL works since generate never connects.

`docker-compose.yaml` is only the dev database. `docker-compose.production.yaml` runs the whole stack (db → migrate → api → web) and builds the web app from `../travel_agency`.

**Production** is `travelar.softech.agency` on a shared VPS (`deploy/README.md`).
- **Release path:** a push to `main` runs `Deploy`, which uses CI as its quality gate and then pushes `ghcr.io/arifur999/travelar-api`. A timer on the server pulls the image, migrates, and rolls back when the release is not healthy. The web repo publishes `travelar-web` the same way.
- **Migrations must be additive.** A rollback restores the image but not the schema, and the two repos release independently.
- **`deploy/` scripts run next to other live sites.** Keep their safeguards:
  - never edit furnify's files beyond the one mount line;
  - `nginx -t` before every reload;
  - write bind-mounted files in place, never with `sed -i` or `mv`;
  - name every service `travelar-*`, because the proxy network is shared.

## Contracts with the web app

- **`ACCESS_TOKEN_SECRET` must equal the web app's `JWT_ACCESS_SECRET`.** If they differ, nothing reports an error: every protected page just redirects to `/login`.
- **Only the Next server calls this API.** It forwards the browser's entire cookie jar plus `X-Forwarded-For`. `trust proxy` is set, and login limits are counted per `req.ip` and per account.
- The success envelope is `{ success, data, meta, message }` from `sendResponse`, mirrored by the web app's `ApiResponse<T>`. Error bodies carry `requestId`, which is also sent as the `x-request-id` header. The web app shows it to users on a 5xx.
- Some rules here are duplicated in the web app so the UI can disable what the API would refuse. When you change one here, update the copy and its test:
  - the plan feature for each module (`checkFeatureAccess` in route files) ↔ `src/lib/navItem.ts`
  - `TeamService.assertCanManage` ↔ `src/lib/teamPermissions.ts`
  - auth password and token bounds ↔ `src/zod/auth.validation.ts`
- **Request schemas are a contract.** Zod objects here strip unknown keys, so a field the web app names differently is dropped without an error. The web repo's CI (`pnpm check:contract` there) reads these schemas and fails when a payload type disagrees — renaming or requiring a field here breaks that check until the web type follows.
- List query params (`searchTerm`, `page`, `limit`, `sortBy`, `sortOrder`, `field[op]=value`, `include`) are produced by the web app's URL-driven tables. Renaming one breaks every table.

## Architecture

**Request pipeline** (`src/app.ts`): `requestLogger` (assigns the request id) → helmet → cors → body parsers → `/api/v1` → `notFound` → `globalErrorHandler`.
- The `qs` query parser is required. Without it, bracket range filters are silently ignored.
- better-auth's own HTTP router is deliberately **not** mounted, and must stay that way: its sign-up route let an anonymous request set `role` and `agencyId`. All auth goes through `/api/v1/auth`, which calls `auth.api.*` in-process.

**Modules** live in `src/app/module/<feature>/` as `route / controller / service / validation / interface / constant` files, and each router is registered in `src/app/routes/index.ts`.
- **Route files** apply guards once at router level: `router.use(checkAuth(...roles), requireActiveSubscription, checkFeatureAccess(PlanFeature.X))`. Declare static segments before `/:id`. Deleting or reversing posted money is restricted to `AGENCY_ADMIN`, with a per-route `checkAuth`.
- **Validation:** `validateRequest(zodSchema)` replaces `req.body` with the parsed data. For multipart requests it first unwraps the JSON sent in the `data` field.
- **Controllers** always use `catchAsync` + `sendResponse` and pass `requireAgencyId(req)` as the service's first argument. `requireAgencyId` throws instead of returning null.
- **Services** throw `AppError` and scope every query with `agencyId` (and usually `isDeleted: false`, since deletes are soft). A record owned by another agency must return **404**, not 403. `test/tenancy.test.ts` checks this.
- **List endpoints** use `QueryBuilder`, with searchable, filterable and include whitelists in `<feature>.constant.ts`. Look up per-row figures in one batched query, never one query per row: `test/queryCount.test.ts` checks that a list costs the same number of queries for 5 rows as for 30.

**Auth.** `checkAuth(...roles)` requires **both** credentials:
- a better-auth session cookie, re-checked against the DB so a blocked user is cut off immediately
- the `accessToken` JWT

It then sets `req.user = { userId, role, email, agencyId }`. The roles are:
- `SUPER_ADMIN`: the platform operator, belongs to no agency, never gated
- `AGENCY_ADMIN` and `AGENCY_STAFF`

`requireActiveSubscription` makes a lapsed or suspended agency read-only. `checkFeatureAccess` unlocks every feature during the trial.

**Money model** (`src/app/module/cashAccount/posting.service.ts`):
- **Postings are the only source of truth.** A cash balance is always computed from its postings; no running total is stored. The opening balance is itself a posting.
- Every write that moves money calls `PostingService.post(tx, …)` inside its own transaction, with a `source` and `sourceId`. Undo it with `PostingService.reverse(tx, source, sourceId)`, which deletes those postings. Never write compensating arithmetic.
- Only transfers refuse to overdraw an account. Expenses, supplier payments and staff payouts may take a balance negative.

**Concurrency.** Any guard that sums rows and then decides must start its transaction with `lockRow(tx, kind, id, agencyId)` (`src/app/utils/rowLock.ts`) and then re-read through `tx`.
- Each writer takes **at most one** row lock, on the row its guard is about, so the guards cannot deadlock. Don't add a second lock unless you also define a global lock order.
- A new lockable table goes in `LOCKABLE_ROWS`. `test/rowLock.test.ts` checks those names against the schema's `@@map`.

**Prisma 7:**
- The schema is split across `prisma/schema/*.prisma`, and the client is created with the `@prisma/adapter-pg` driver adapter in `src/app/lib/prisma.ts`.
- Import types and enums from `src/generated/prisma/client.js` / `enums.js`, never from `@prisma/client`.
- `prisma.config.ts` loads `.env` itself.

**ESM:** every relative import ends in `.js`, even in `.ts` files. `pnpm lint` fails otherwise. The generated client already emits `.js` imports because `schema.prisma` sets `importFileExtension = "js"`.

**Runtime:**
- The app runs through `tsx` in production too; nothing is compiled to `dist/`.
- `src/config/env.ts` validates env with zod.
- `server.ts` seeds the `SUPER_ADMIN_*` operator, then starts the in-process jobs (`src/app/jobs/scheduler.ts`). Jobs must be safe when several instances run at once.
- Everything logs through `src/app/lib/logger.ts`, controlled by `LOG_LEVEL`. Query strings are never logged, because they carry search terms and reset tokens.
- With no `EMAIL_SENDER_SMTP_HOST`, emails (EJS templates in `src/app/templates/`) are printed to the console instead of sent.
- PDF invoices use PDFKit with embedded Noto Sans and Noto Sans Bengali, so Bangla names and `৳` render.

## Tests

See `TESTING.md` for the per-file coverage table.

- **Integration tests only:** the real app on a free port, against a real Postgres.
- **Database safety:** the test database name must end in `_test`. `test/globalSetup.ts` and `test/helpers/app.ts` both refuse any other name, because every file truncates all tables. `vitest.config.ts` sets all env vars before the app loads, so a developer's `.env` cannot redirect a run. Use `TEST_DATABASE_URL` to point elsewhere.
- **Run order:** files run one at a time. Tests import `app.ts`, not `server.ts`, so scheduled jobs never start during a run.
- **File shape:** `beforeAll(() => startTestApp())`, which truncates, seeds the operator and starts listening. Use `t.api.registerAgency()` to create a fresh trial tenant, `t.api.ok(...)` to set up state (it throws on failure), and `t.api.get/post/patch/delete(...)` for the call under test.
- The test client sends a new `X-Forwarded-For` on every request to stay under the per-IP login limit. `rateLimit.test.ts` pins addresses on purpose.
- A test written for a real bug says so in a comment. Keep it during refactors.
