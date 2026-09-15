# travelar_backend

Travelar — multi-tenant B2B travel agency management API.
Express 5 + TypeScript (ESM) + Prisma 7 + PostgreSQL + better-auth.

The frontend lives in [travelar](https://github.com/Arifur999/travelar).

## Run it

```bash
pnpm install
cp .env.example .env          # then fill in the values
docker compose up -d          # Postgres on host port 5433
pnpm generate                 # prisma generate + ESM import fixup
pnpm migrate --name init      # apply migrations
pnpm dev                      # API on http://localhost:5050
```

> Host port **5433**, not 5432 — a native Postgres install commonly holds 5432
> and silently wins over the container, which shows up as `P1000: Authentication
> failed`.

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

This is separate from `docker-compose.yaml`, which is only the local
development database; the two use different project names, volumes and ports.

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

- **ESM**: every relative import ends in `.js`, even from a `.ts` file. `scripts/fix-esm-imports.mjs` fixes the generated Prisma client and runs as part of `pnpm generate`.
- Controllers are always `catchAsync` + `sendResponse`; services throw `AppError`.
- List endpoints go through `QueryBuilder` — `?searchTerm=`, `?page=`, `?limit=`, `?sortBy=`, `?sortOrder=`, `?field[gte]=`, `?include=`. Searchable/filterable/include whitelists live in `<feature>.constant.ts`.
- `app.set("query parser", qs.parse)` is mandatory or bracket range filters never parse.

## Scripts

| Script | Does |
|---|---|
| `pnpm dev` | tsx watch |
| `pnpm generate` | prisma generate + ESM import fixup |
| `pnpm migrate` | prisma migrate dev |
| `pnpm studio` | Prisma Studio |
| `pnpm lint` | eslint |
