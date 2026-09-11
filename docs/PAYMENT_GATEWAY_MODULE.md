# Payment Gateway Module (SSLCommerz)

Self-service subscription checkout for agencies, backed by SSLCommerz, plus
unified visibility into online + manually-recorded payments on both the
agency side and the Super Admin side. This is the final phase of the module
— the flow is complete end-to-end in code, but **no real sandbox payment has
been executed yet** (see "What has NOT been tested" at the bottom).

## Models

### `SubscriptionOrder` (`server/src/models/SubscriptionOrder.js`)
One document per checkout/retry attempt — never mutated into a "new"
attempt; retrying always creates a fresh document instead.

| Field | Type | Notes |
|---|---|---|
| `agencyId`, `planId` | ObjectId | required |
| `amount` | Number | snapshotted from the plan's price at checkout time |
| `transactionId` | String | our own id, unique — sent to SSLCommerz as `tran_id`, format `ORDER-<agencyId>-<timestamp>` |
| `sslcommerzSessionKey` | String | set right after session creation |
| `sslcommerzValId` | String | set only once the IPN's `val_id` has been independently confirmed |
| `status` | enum `["pending", "success", "failed", "cancelled"]` | default `pending` |
| `paymentMethod` | String | `card_type` or `bank_tran_id` from the Order Validation API response |
| `rawGatewayResponse` | Mixed | full IPN payload + validation response, kept for dispute/debugging |

### `Payment` (`server/src/models/Payment.js`)
Pre-existing manual/admin-recorded payment model (super_admin's "Record
Payment" flow) — unchanged by this module, just read alongside
`SubscriptionOrder` wherever a unified view is needed.

### `Agency` (relevant fields, pre-existing)
`planId`, `status` (`trial`/`active`/`expired`/`suspended`),
`trialEndsAt`, `subscriptionEndsAt`. `renewAgencySubscription(agencyId, durationDays)`
(`server/src/utils/agencySubscription.js`) is the single place that extends
`subscriptionEndsAt` and flips `status` to `active` — reused unchanged from
the Balance module, called only by the IPN handler and the admin's manual
"record payment + renew" flow.

## Routes

### Agency-side (authenticated, `/api/agency/billing/*`)
| Method | Path | Access | Purpose |
|---|---|---|---|
| GET | `/billing/plans` | admin/staff | Active plans, flags the agency's current one |
| GET | `/billing/my-subscription` | admin/staff | Current plan + status + dates |
| GET | `/billing/payment-history` | admin/staff | Unified online+manual history, merged & sorted |
| GET | `/billing/orders` | admin/staff | Paginated online-order-only history |
| GET | `/billing/orders/:transactionId/status` | admin/staff | Poll one order's status |
| POST | `/billing/checkout` | **admin only** | Start a new order + SSLCommerz session |
| POST | `/billing/orders/:transactionId/retry` | **admin only** | New order at the same plan, for a stuck pending/failed one |

### Gateway callbacks (public, unauthenticated, `/api/billing/*`)
Mounted separately from the agency router (`server/src/routes/billingWebhookRoutes.js`)
since SSLCommerz's servers and the customer's browser never carry our JWT.

| Method | Path | Caller | Purpose |
|---|---|---|---|
| POST | `/sslcommerz/ipn` | SSLCommerz's server | **Source of truth** — validates and renews |
| GET/POST | `/sslcommerz/success` | Customer's browser | UX-only redirect to the client |
| GET/POST | `/sslcommerz/fail` | Customer's browser | UX-only redirect to the client |
| GET/POST | `/sslcommerz/cancel` | Customer's browser | UX-only redirect to the client |

### Super Admin side
| Method | Path | Purpose |
|---|---|---|
| GET | `/api/admin/agencies/:id/payments` | Unified manual+online (success only) history for one agency |
| GET | `/api/admin/stats` | Platform stats, now including `onlineRevenue`/`manualRevenue` |

## Full flow (text diagram)

```
Agency admin clicks "Subscribe/Renew Now" on a plan card (Billing.jsx)
        │
        ▼
POST /api/agency/billing/checkout  { planId }
        │  creates SubscriptionOrder (status: pending)
        │  calls SSLCommerz Session API (createPaymentSession)
        ▼
200 { gatewayUrl }  →  browser does window.location.href = gatewayUrl
        │
        ▼
Customer pays on SSLCommerz's hosted page (card / bKash / Nagad / ...)
        │
        ├──────────────────────────────────────────────┐
        │ (browser redirect — UNRELIABLE, UX only)      │ (server-to-server — RELIABLE, the real signal)
        ▼                                                ▼
GET/POST /api/billing/sslcommerz/success?transactionId=X   POST /api/billing/sslcommerz/ipn
   just 302-redirects to                                      1. look up SubscriptionOrder by tran_id
   {CLIENT_BASE_URL}/billing/payment-result                   2. if already "success" → 200, stop (idempotent)
   ?status=success&tran_id=X                                  3. if IPN body status != "VALID" → mark failed, 200
        │                                                      4. call validateOrder(val_id) — SSLCommerz's own
        ▼                                                         Order Validation API (never trust the IPN body)
PaymentResult.jsx polls                                        5. cross-check: status VALID/VALIDATED,
GET /api/agency/billing/orders/:tranId/status                     amount matches order.amount, currency is BDT
every 2s (up to 15x) until it                                  6. if any check fails → mark failed, 200
sees "success" (set by the IPN                                 7. if all pass → ATOMIC findOneAndUpdate
above, which may land a moment                                    (status: {$ne:"success"}) claims the order;
after the browser gets here)                                      a losing concurrent/duplicate IPN gets null
                                                                    back and stops here — no double-processing
                                                                8. renewAgencySubscription(agencyId, durationDays)
                                                                9. logAdminActivity("online_subscription_payment")
                                                               10. always respond 200 (SSLCommerz retries on non-2xx)
```

If the customer closes the browser before the redirect ever fires, the IPN
still arrives independently and the subscription still renews — that is the
entire reason the module is built this way.

## Security-critical points (re-verified in this final review)

- **Never trust the IPN body's own fields.** `status` from the body only
  short-circuits a *negative* result cheaply; a positive (`VALID`) result is
  always re-confirmed against SSLCommerz's Order Validation API
  (`validateOrder`) before anything is written as successful.
- **Amount/currency are cross-checked against the Validation API's response**,
  not the IPN body — `Math.abs(validation.amount - order.amount) < 1` and
  `validation.currency === "BDT"`. A mismatch marks the order failed and logs
  the discrepancy; it never renews.
- **Idempotency is atomic**, not read-then-write. A prior version of this
  handler read `order.status === "success"` and only later called
  `order.save()`, which left a TOCTOU race: two concurrent IPNs (a genuine
  SSLCommerz retry, or a forged duplicate) could both pass the check before
  either wrote, both call `renewAgencySubscription`, and double-renew the
  agency. This was found and fixed in this review — the final transition to
  `"success"` now goes through
  `SubscriptionOrder.findOneAndUpdate({ _id, status: { $ne: "success" } }, ...)`,
  which MongoDB applies atomically; only one concurrent caller can ever win
  it, and the loser's response is a no-op. Re-verified with a genuinely
  parallel (`Promise.all`) double-IPN test — renewal and the admin activity
  log entry each fire exactly once.
- **A narrower, unfixed edge case** (documented, not patched, in this phase):
  `renewAgencySubscription` itself is a plain read-then-save — if two
  *separate, both-legitimate* successful payments for the *same agency*
  somehow get IPN'd at literally the same instant (not a duplicate of one
  order — two distinct real transactions), the second write could overwrite
  the first's extension rather than stacking both. This is far rarer than
  the case just fixed (it requires two distinct real payments racing, not
  one payment's IPN being retried) and touches shared code also used by the
  admin's manual "record payment + renew" flow, so it was left as a known
  limitation rather than changed under this review's scope. Worth an atomic
  `$inc`-based rewrite before this handles real transaction volume.

## Error handling

Every gateway-facing failure path (network error reaching SSLCommerz,
non-`SUCCESS` session response, IPN validation failure) is caught and turned
into either a `502` with a Bangla user-facing message (checkout/retry) or a
silent `200` acknowledgement with the order marked `failed` and the raw
response preserved (IPN) — never a raw exception or a `500` reaching the
user. `checkout` and `retryOrder` share one `startCheckoutSession` helper so
this handling only exists in one place.

## `.env` variables (all present in `.env.example`)

| Variable | Used by | Notes |
|---|---|---|
| `SSLCOMMERZ_STORE_ID` | `sslcommerz.js` | Placeholder until you register a sandbox account |
| `SSLCOMMERZ_STORE_PASSWORD` | `sslcommerz.js` | ditto |
| `SSLCOMMERZ_IS_LIVE` | `sslcommerz.js` | `false` = sandbox domain, `true` = live domain |
| `APP_BASE_URL` | `sslcommerz.js` | Builds the four callback URLs sent to SSLCommerz |
| `CLIENT_BASE_URL` | `paymentGatewayController.js` | Where success/fail/cancel send the browser |

All five are read **inside functions, not at module load time** — an earlier
bug had them read at import time, which resolved before `dotenv.config()`
had run (ESM hoists static imports ahead of the importing file's own
statements), silently sending empty credentials. Fixed; documented here so
the pattern isn't reintroduced.

## How to test with real credentials (step-by-step)

1. Register a free Sandbox account at https://developer.sslcommerz.com and
   get your **Sandbox Store ID** and **Store Password**.
2. In `server/.env`, replace the placeholders:
   ```
   SSLCOMMERZ_STORE_ID=your_real_sandbox_store_id
   SSLCOMMERZ_STORE_PASSWORD=your_real_sandbox_store_password
   SSLCOMMERZ_IS_LIVE=false
   ```
3. Start `ngrok http 5000` (SSLCommerz's IPN is called from their servers —
   `localhost` is unreachable to them). Copy the `https://xxxx.ngrok-free.app`
   URL it gives you.
4. Set `APP_BASE_URL=https://xxxx.ngrok-free.app` in `server/.env` (leave
   `CLIENT_BASE_URL` as your local client URL — the browser reaches that
   directly, no tunnel needed for it).
5. Restart the server so the new env values load.
6. Log in as an agency admin, go to **Billing & Plan** (`/billing`), and
   click **Subscribe Now** / **Renew Now** on a plan.
7. You'll land on SSLCommerz's real sandbox checkout page. Use one of their
   published sandbox test instruments (test card numbers / test
   bKash-Nagad flows — see SSLCommerz's sandbox documentation for current
   test credentials) to complete a payment.
8. Watch `server/_server.log` (or wherever your dev server logs) for the
   `/api/billing/sslcommerz/ipn` request — that's the real webhook arriving.
9. Confirm in the app: the order's status flips to `success` on the
   Payment History table, the agency's `subscriptionEndsAt` extends, and the
   Super Admin's Agency Detail page shows the new payment with an "Online"
   badge.
10. Try a deliberately failed/cancelled sandbox payment too, to confirm the
    `fail`/`cancel` redirects and the "Retry Payment" button both work
    against a real order.

## What has NOT been tested yet

**No real SSLCommerz sandbox payment has been completed end-to-end.**
Everything up to the point where a human would fill in card/mobile-banking
details on SSLCommerz's hosted page has been verified against SSLCommerz's
*real* API (session creation, and the Order Validation API's real rejection
of a fake `val_id`). The one piece that cannot be scripted — an actual human
completing a sandbox payment and SSLCommerz's real IPN arriving at a real
publicly-reachable URL — has instead been exercised by stubbing only the
Order Validation API's response at the network boundary and running the
*entire* rest of the handler (lookup, idempotency, atomic claim, renewal,
activity log) for real against the database. This is a reasonable
substitute for development, but it is **not the same as a real payment**,
and should be the first thing verified (using the steps above) before this
module is trusted with real money.
