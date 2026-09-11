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

| Module | Feature gate | Status |
|---|---|---|
| Auth / agency registration | — | in progress |
| Ticketing + Customers | `TICKETING` | schema ready |
| Visa processing | `VISA` | schema ready |
| Hajj/Umrah | `HAJJ_UMRAH` | schema ready |
| Reports | `REPORTS` | schema ready |
| Billing (SSLCommerz) | — | schema ready |

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
