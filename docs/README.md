# Specs

These are the original module specifications for Travelar, written against the first
implementation (Express 4 + Mongoose + Vite React). That implementation has been replaced by
this TypeScript + Prisma backend and the Next.js frontend, but the documents remain the
functional specification for each module — the endpoints, state machines, document checklists
and business rules described here are what the ported modules must reproduce.

| File | Module |
|---|---|
| `TICKETING_MODULE.md` | Airline ticket sales, customers, payments, invoices |
| `VISA_MODULE.md` | Visa cases, agents, document checklists, analytics |
| `HAJJ_UMRAH_MODULE.md` | Packages, batches, rooms, pilgrim bookings |
| `PAYMENT_GATEWAY_MODULE.md` | SSLCommerz subscription billing and the IPN flow |
| `LEGACY_README.md` | The original project README (MongoDB-era setup notes) |

**Read them as requirements, not as instructions.** They describe Mongoose models and Express 4
routes; the current stack is Prisma + Express 5. Where a document conflicts with the
accounting model, the accounting model wins — see the money-model rules in the root `README.md`.

Known defects in the original implementation were catalogued during the port and deliberately
**not** carried forward (dead trial-expiry middleware, feature gating that ignored agency
status, a stored-vs-derived account balance that could disagree, racy over-payment guards,
and a retry path that could double-charge). Do not reintroduce them by following the old code.
