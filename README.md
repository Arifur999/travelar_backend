# travelar_backend

Travelar — multi-tenant B2B travel agency management API.
Express 5 + TypeScript (ESM) + Prisma 7 + PostgreSQL + better-auth.

The frontend lives in [travelar](https://github.com/Arifur999/travelar).

## Run it

```bash
pnpm install
cp .env.example .env          # then fill in the values
docker compose up -d          # Postgres on host port 5433
pnpm generate                 # prisma generate (client written with .js imports)
pnpm migrate --name init      # apply migrations
pnpm dev                      # API on http://localhost:5050
```

> Host port **5433**, not 5432 — a native Postgres install commonly holds 5432
> and silently wins over the container, which shows up as `P1000: Authentication
> failed`.

## Live site and releases

Production runs at **travance.softech.agency**, on the same VPS as two other
live sites. A push to `main` goes live only through this path:

1. The `Deploy` workflow runs CI (lint, typecheck, integration tests).
2. Only if CI passes, it publishes `ghcr.io/arifur999/travelar-api`.
3. Within two minutes, a timer on the server pulls the new image, runs the
   migrations and waits for the API to report healthy.
4. If the new release does not become healthy, the timer puts the previous
   release back.

The web repo releases `travelar-web` the same way. Server setup and
day-to-day operations are in [`deploy/README.md`](deploy/README.md).

## Run the full stack in Docker

Postgres, migrations, this API and the [web app](https://github.com/Arifur999/travelar)
as production containers. Expects the frontend repo checked out next to this one
(`../travel_agency`).

```bash
cp .env.production.example .env.production     # fill in every value
docker compose -f docker-compose.production.yaml --env-file .env.production up -d --build
```

Start-up order is enforced: `db` healthy → `migrate` runs `prisma migrate deploy`
and exits 0 → `api` healthy (`GET /health` runs `SELECT 1`) → `web`. The
operator account is created from `SUPER_ADMIN_*` on first boot. Both app
containers run as a non-root user and read all configuration at runtime.

- **Put it behind a TLS reverse proxy.** In production the auth cookies are
  `Secure`, and SSLCommerz must reach `API_PUBLIC_URL` over the internet.
- **One secret, two services.** The web container's `JWT_ACCESS_SECRET` is
  wired from `ACCESS_TOKEN_SECRET`, so the two cannot drift apart.
- **Set `REDIS_URL` when running more than one API instance.** Without it,
  login throttling is counted in memory: it still applies, but each instance
  keeps its own count.
- Logins arrive from the web server, not the browser, so the web app forwards
  the client address in `X-Forwarded-For` and the API (`trust proxy`) keys its
  per-IP limit on it. Sign-in attempts are also capped per account, which a
  forged address does not get around.

- **Backups.** A `backup` service dumps the database at start and nightly into
  `BACKUP_DIR` (default `./backups`, 14 days kept). Copy that folder off the
  machine. Restoring is documented, and rehearsed, in `ops/backup/README.md`.
- **Security headers.** The API sends a no-content CSP, `nosniff`, HSTS and
  no `X-Powered-By` (helmet); the web app sends a per-request nonce CSP and
  framing protection.

This is separate from `docker-compose.yaml`, which is only the local
development database; the two use different project names, volumes and ports.

## Scheduled jobs

One job, **subscription lifecycle**, runs inside the API at five past every
hour and once 15 s after boot:

- agencies whose trial or paid period has ended move to `EXPIRED` (access was
  already enforced from the dates; this keeps the console, filters and MRR true);
- agency admins are emailed 3 days and 1 day before a trial ends, 7 days and 1
  day before a subscription ends, and when it lapses. Only the most urgent due
  reminder goes out, each once per period — recorded in `agency_reminders`
  before sending, so several instances running it at once never double-send.
  Agencies that lapsed more than 3 days before the job first sees them are
  expired quietly, without an email.

Run it on demand from the operator overview (**Run now**), or
`POST /api/v1/admin/jobs/subscription-lifecycle`. Where the in-process
schedule cannot run (serverless), set `JOBS_ENABLED=false` and `CRON_SECRET`,
and have a scheduler call `POST /api/v1/internal/jobs/subscription-lifecycle`
with header `x-cron-secret`. Without `CRON_SECRET` that route answers 404.

## Logs

Everything the API says goes through `src/app/lib/logger.ts` — one JSON object
per line in production (`docker compose logs api | jq`), a short human line in
development, and quiet in tests. `LOG_LEVEL` (`debug`/`info`/`warn`/`error`/
`silent`) overrides the default, which is `info` in production and `debug`
otherwise.

Every request gets an id, returned as `x-request-id` and repeated as
`requestId` in any error body. So a user who reports "it said something went
wrong" can quote that id, and:

```sh
docker compose logs api | jq 'select(.requestId == "<the id>")'
```

gives the access line, the failure and its stack. An inbound `x-request-id`
is honoured — so a trace started at the proxy continues here — but only if it
is 8–64 characters of `[A-Za-z0-9._:-]`; anything else is replaced, because a
log field must never carry whatever a client felt like sending. Query strings
are deliberately not logged: they hold search terms and reset tokens.

## Architecture

Feature-first modules under `src/app/module/<feature>/`, one-way layering
`route → controller → service → prisma`:

```
src/
  server.ts                bootstrap + signal handlers
  app.ts                   express wiring, cors, /api/v1 mount
  config/                  env (zod-validated), cloudinary, multer
  generated/prisma/        prisma-client output (gitignored)
  app/
    lib/                   prisma, better-auth, redis, sentry
    middleware/            checkAuth, tenantGuards, validateRequest,
                           rateLimiter, globalErrorHandler, notFound
    errorHelpers/          AppError, zod + prisma error mappers
    shared/                catchAsync, sendResponse
    utils/                 QueryBuilder, jwt, cookie, token, email
    interfaces/            request user, error, query types
    module/<feature>/      route / controller / service / validation /
                           interface / constant
    routes/index.ts        one router.use per module
prisma/schema/*.prisma     split by domain
```

## Multi-tenancy

Every business row carries an `agencyId` and every query filters on it.

- `checkAuth(...roles)` — requires **both** a live better-auth session and a valid `accessToken` JWT, then attaches `req.user = { userId, role, email, agencyId }`.
- `requireActiveSubscription` — an expired trial or an inactive agency drops to **read-only**: `GET` still works, writes return 403.
- `checkFeatureAccess(PlanFeature.X)` — gates a module behind the agency's plan. Every feature is unlocked during the trial window.
- `requireAgencyId(req)` — throws rather than returning null, so a service can never run an unscoped query by accident.

Roles: `SUPER_ADMIN` (platform operator, belongs to no agency), `AGENCY_ADMIN`,
`AGENCY_STAFF`.

## Modules

All mounted under `/api/v1`. Deletes and reversals of posted money are
`AGENCY_ADMIN` only throughout.

| Mount | What it does | Plan feature |
|---|---|---|
| `/auth` | Register an agency, login, refresh, `me`, change password, forgot / reset password by email | — |
| `/agency`, `/team` | Agency profile; team members, roles, blocking, password resets | — |
| `/customers`, `/due-received` | Customers with derived due and a full statement; collections with split tender | — |
| `/ticketing`, `/airlines`, `/routes-master` | Ticket sales, payments, date changes, refunds, **PDF invoice** | `TICKETING` |
| `/visa` | Visa cases, agents, documents, status, payments, **PDF invoice** | `VISA` |
| `/hajj` | Packages, batches, rooms, bookings, payments, **PDF invoice** | `HAJJ_UMRAH` |
| `/accounts`, `/balance-transfers` | Cash accounts on one posting ledger; transfers | `EXPENSE` |
| `/suppliers`, `/supplier-transactions` | Supplier payable (accrued from purchases) and payments | `EXPENSE` |
| `/expenses`, `/capital`, `/employees` | Expenses and categories; investment and withdrawals; staff payouts and attendance | `EXPENSE` |
| `/dashboard` | Summary and goals; custom / monthly / yearly reports and cash flow | `REPORTS` for reports |
| `/billing` | Plans, SSLCommerz checkout and IPN, payment history | — |
| `/support` | Support tickets and announcements for agencies | — |
| `/admin` | Platform console: plans, agencies, stats, support inbox, announcements, activity log (`SUPER_ADMIN`) | — |

Invoices (`GET …/:id/invoice`) are rendered with PDFKit and embedded Noto
Sans + Noto Sans Bengali, so Bangla names and the `৳` sign print correctly.

## Conventions

- **ESM**: every relative import ends in `.js`, even from a `.ts` file. The Prisma generator emits them itself (`importFileExtension = "js"` in `schema.prisma`); `scripts/check-esm-imports.mjs` fails `pnpm lint` if any relative import lacks an extension, and never rewrites files.
- Controllers are always `catchAsync` + `sendResponse`; services throw `AppError`.
- List endpoints go through `QueryBuilder` — `?searchTerm=`, `?page=`, `?limit=`, `?sortBy=`, `?sortOrder=`, `?field[gte]=`, `?include=`. Searchable/filterable/include whitelists live in `<feature>.constant.ts`.
- `app.set("query parser", qs.parse)` is mandatory or bracket range filters never parse.
- **A guard that sums rows and then decides must hold a row lock.** Reading inside
  the transaction is not enough: under READ COMMITTED two concurrent transactions
  both see the world as it was before either started, and inserts do not conflict.
  Call `lockRow(tx, <parent>, id, agencyId)` as the transaction's first statement —
  the source account for a transfer, the ticket/case/booking for a payment — then
  re-read the parent through `tx` so the figures are the committed ones. Every
  writer takes **at most one** row lock, always the row its guard is about, so
  nothing holds one while waiting for another and none of this can deadlock. A
  second lock would need a global ordering; don't add one casually.

## Scripts

| Script | Does |
|---|---|
| `pnpm dev` | tsx watch |
| `pnpm generate` | prisma generate (the client is written with `.js` imports) |
| `pnpm migrate` | prisma migrate dev |
| `pnpm studio` | Prisma Studio |
| `pnpm lint` | eslint, then the ESM import-extension check |
| `pnpm test` | integration tests against a `_test` database (see TESTING.md) |
| `pnpm typecheck` | tsc over src and test |
