# Ticketing Module

The first agency-side business module. Everything here is scoped per-agency
(multi-tenant isolation enforced via `agencyId` on every query) and gated
behind the `Ticketing` plan feature (`Customer` management is bundled in;
`Reports` is a separate, higher plan feature).

## Models

| Model | File | Purpose |
|---|---|---|
| `Ticket` | `server/src/models/Ticket.js` | Airline ticket bookings — passenger/PNR/airline/route/fare/cost/profit, status + `statusHistory`, `documents[]`, `supplier` |
| `Customer` | `server/src/models/Customer.js` | Agency's customers (name, phone, email, passport, address, notes) |
| `TicketPayment` | `server/src/models/TicketPayment.js` | Payments recorded against a ticket's fare (amount, method, reference, note) |

`Ticket.status` follows a one-way state machine: `issued → reissued/refunded/void`,
`reissued → refunded/void`; `refunded` and `void` are final. Every change is
appended to `statusHistory` (who, when, note). `profit` (`fare - cost`) is
recalculated automatically in a pre-save hook whenever `fare`/`cost` change.

`totalPaid` / `dueAmount` are **not** stored on the ticket — they're computed
at query time via a `$lookup` into `TicketPayment`.

## API Routes

All under `/api/agency`, requiring a logged-in `agency_admin`/`agency_staff`
(`protect` + role check applied at the router level).

### Tickets — `checkFeatureAccess('Ticketing')`
| Method | Path | Notes |
|---|---|---|
| GET | `/ticketing` | Paginated list. Filters: `search`, `status`, `hasDue`, `dateFrom`/`dateTo` (travelDate), `airline`, `supplier`, `minFare`/`maxFare`. Returns `totalDueAmount` across all matches too. |
| POST | `/ticketing` | Create a booking |
| GET | `/ticketing/:id` | Full detail incl. `totalPaid`/`dueAmount`, populated customer + status history |
| PATCH | `/ticketing/:id` | Edit non-status fields |
| PATCH | `/ticketing/:id/status` | Status transition (`{ status, note, refundAmount?, reissueFare? }`) — validated against the state machine |
| DELETE | `/ticketing/:id` | Soft delete |
| POST | `/ticketing/:id/documents` | Upload PDF/JPG/PNG (max 5MB) via multer, stored at `/uploads/tickets/{agencyId}/{unique file}` |
| GET / DELETE | `/ticketing/:id/documents/:docId` | Download (streamed, auth'd) / delete (DB + disk) |
| GET / POST | `/ticketing/:id/payments` | Payment history / record a payment (blocked if it would exceed the due amount) |
| DELETE | `/ticketing/:id/payments/:paymentId` | **agency_admin only** |
| GET | `/ticketing/:id/invoice` | Streams a generated PDF invoice |
| GET | `/ticketing/analytics/by-supplier` | Grouped totals by supplier |
| GET | `/ticketing/analytics/by-airline` | Grouped totals by airline |

### Reports — `checkFeatureAccess('Reports')` (separate, higher-tier feature)
| Method | Path | Notes |
|---|---|---|
| GET | `/ticketing/reports/summary` | `dateFrom`/`dateTo` (default: current month), by `createdAt` |
| GET | `/ticketing/reports/monthly-trend` | Last 6 months, bookings + profit |
| GET | `/ticketing/reports/by-staff` | **agency_admin only** |

### Customers — `checkFeatureAccess('Ticketing')`
| Method | Path | Notes |
|---|---|---|
| GET / POST | `/customers` | List (search by name/phone) / create |
| GET | `/customers/:id` | Detail + that customer's ticket history |
| PATCH | `/customers/:id` | Edit |
| DELETE | `/customers/:id` | Soft delete — blocked (400) if the customer has any non-deleted tickets |

### Dashboard — no feature gate (it's the agency's own landing page)
| Method | Path | Notes |
|---|---|---|
| GET | `/dashboard/summary` | This month's bookings/revenue/profit, all-time total due, last 5 bookings |

## Frontend

- `pages/Ticketing.jsx` — tabs: Bookings, Customers, By Supplier, By Airline. Search/status/hasDue quick filters + an Advanced Filters panel (date range, airline, supplier, fare range) with removable chips.
- `pages/Reports.jsx` — date-range summary cards, status breakdown donut, 6-month trend line chart, by-staff table (admin only).
- `pages/Dashboard.jsx` — welcome + trial banner, this-month stat cards, recent bookings (click-through to the ticket), locked-module teasers.
- `components/TicketDetailModal.jsx` — the hub: full ticket info, Payments (record/delete), Documents (upload/view/delete), Status History + transition actions, Download Invoice.
- `components/NewBookingModal.jsx`, `CustomerFormModal.jsx` / `CustomerFormFields.jsx`, `CustomerDetailModal.jsx`, `RecordTicketPaymentModal.jsx`, `StatusChangeModal.jsx`, `UpgradePrompt.jsx`.
- `utils/downloadInvoice.js` — shared blob-download helper (fetches via axios so the JWT header is attached, unlike a plain `<a href>`).

## How to Test (basic flow)

1. **Register an agency**: `POST /api/auth/register` with `agencyName`, `name`, `email`, `password` → returns a token + starts a 7-day trial (all features unlocked during trial).
2. **(Optional) Seed a super admin and assign a plan**: `cd server && npm run seed`, log in as the super admin, assign a plan with the `Ticketing` feature (and `Reports` if you want that section too) via `PATCH /api/admin/agencies/:id/plan`.
3. **Log in** as the agency: `POST /api/auth/login`.
4. **Create a customer**: `POST /api/agency/customers` with `{ name, phone }`.
5. **Book a ticket**: `POST /api/agency/ticketing` with `{ customerId, passengerName, pnr, airline, fare, cost }`.
6. **Record a payment**: `POST /api/agency/ticketing/:id/payments` with `{ amount }` (≤ the ticket's `dueAmount`).
7. **Change status**: `PATCH /api/agency/ticketing/:id/status` with `{ status: "reissued", reissueFare }` (or `refunded`/`void`).
8. **Download the invoice**: `GET /api/agency/ticketing/:id/invoice` → streams a PDF with agency/customer info, ticket details, and the fare/paid/due summary.

Every route above enforces `agencyId` scoping — a second agency's token
against any of these with another agency's `:id` gets a `403`.
