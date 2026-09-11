# Visa Processing Module

The second agency-side business module. Reuses the Ticketing module's `Customer`
model directly (no separate Visa customer model) and its Balance-module
transaction patterns for account-affecting operations. Multi-tenant isolation
follows the exact fetch-then-compare-403 pattern established in Ticketing.

## Models

| Model | File | Purpose |
|---|---|---|
| `VisaCase` | `server/src/models/VisaCase.js` | A visa application — customer, agent, visaType/country, serviceFee/embassyFee, status + `statusHistory`, `documentChecklist[]` |
| `VisaPayment` | `server/src/models/VisaPayment.js` | Payments recorded against a case's `totalFee` (serviceFee + embassyFee) |
| `VisaAgent` | `server/src/models/VisaAgent.js` | Embassy/agent/consultancy master list a case can be routed through |

`VisaCase.status` follows a one-way state machine (`VISA_TRANSITIONS`):
`submitted → processing`, `processing → approved/rejected`, `approved → delivered`;
`rejected` and `delivered` are final states. Every change is appended to
`statusHistory` (who, when, note). The generic `PATCH /visa/:id` deliberately
does **not** accept a `status` field — the only path to change it is
`PATCH /visa/:id/status`.

`documentChecklist` is auto-populated from `visaDocumentPresets.js` based on
`visaType` at creation (all starting `pending`); custom items can be appended.
Items are addressed by array index (`:docIndex`), not a sub-document id — safe
since there is no delete endpoint for checklist items, so indices never shift.

`totalFee`, `totalPaid`, `dueAmount`, and `documentsProgress` are **not**
stored fields — they're computed at query time (via `$lookup`/aggregation),
the same convention as Ticketing's `totalPaid`/`dueAmount`.

## API Routes

All under `/api/agency`, requiring a logged-in `agency_admin`/`agency_staff`,
gated behind `checkFeatureAccess('Visa')` unless noted otherwise.

### Visa Cases
| Method | Path | Notes |
|---|---|---|
| GET | `/visa` | Paginated list. Filters: `search` (customer name), `status`, `hasDue`, `dateFrom`/`dateTo` (applicationDate), `country` (partial match), `visaType` (exact), `agentId` (exact). Each row includes `totalFee`/`totalPaid`/`dueAmount`/`documentsProgress` (counts only, no file data). |
| POST | `/visa` | Create a case. `customerId` required; `agentId` optional (validated if given). Seeds `documentChecklist` from the visaType preset and an initial `statusHistory` entry. |
| GET | `/visa/:id` | Full detail incl. `totalFee`/`totalPaid`/`dueAmount`/`documentsProgress`, populated customer/agent/statusHistory |
| PATCH | `/visa/:id` | Edit non-status fields (customerId, agentId, visaType, country, applicationDate, serviceFee, embassyFee, notes) |
| PATCH | `/visa/:id/status` | Status transition (`{ status, note }`) — validated against `VISA_TRANSITIONS` |
| DELETE | `/visa/:id` | Soft delete |

### Documents Checklist
| Method | Path | Notes |
|---|---|---|
| POST | `/visa/:id/documents` | Add a custom checklist item (`{ name }`), beyond the visaType preset |
| PATCH | `/visa/:id/documents/:docIndex/status` | Toggle pending ↔ received. Going to `received` sets `receivedAt`; going back to `pending` clears `receivedAt` and any file info. |
| POST | `/visa/:id/documents/:docIndex/upload` | Upload PDF/JPG/PNG (max 5MB) via multer, stored at `/uploads/visa/{agencyId}/`; auto-marks the item `received` |
| GET | `/visa/:id/documents/:docIndex/download` | Download (streamed, auth'd); 404 if the item has no uploaded file yet |

### Payments
| Method | Path | Notes |
|---|---|---|
| GET / POST | `/visa/:id/payments` | Payment history / record a payment (blocked if it would exceed `dueAmount`) |
| DELETE | `/visa/:id/payments/:paymentId` | **agency_admin only** |

### Invoice & Analytics
| Method | Path | Notes |
|---|---|---|
| GET | `/visa/:id/invoice` | Streams a generated PDF invoice (agency/customer info, case details incl. agent if assigned, payment summary, status, footer) |
| GET | `/visa/analytics/by-agent` | Per-agent totalCases/approvedCount/rejectedCount/approvalRate%/totalRevenue |
| GET | `/visa/analytics/by-country` | Same shape, grouped by country |

### Reports — `checkFeatureAccess('Reports')` (separate, higher-tier feature)
| Method | Path | Notes |
|---|---|---|
| GET | `/visa/reports/summary` | `dateFrom`/`dateTo` (default: current month, by `createdAt`); totals, statusBreakdown, `overallApprovalRate` |
| GET | `/visa/reports/monthly-trend` | Last 6 months, cases + revenue |
| GET | `/visa/reports/by-staff` | **agency_admin only** |

### Embassy/Agent Master List
| Method | Path | Notes |
|---|---|---|
| GET | `/visa-agents` | List (all, or filter `?isActive=true/false`) |
| POST | `/visa-agents` | Create |
| PATCH | `/visa-agents/:id` | Edit (incl. `isActive` toggle) |
| DELETE | `/visa-agents/:id` | Soft delete — blocked (400, suggests deactivating) if any case uses it |

### Dashboard — no feature gate
`GET /api/agency/dashboard/summary` now also returns `thisMonthVisaCases`,
`thisMonthVisaRevenue`, `totalVisaDue`, `recentVisaCases` (last 5) alongside
the existing Ticketing fields.

## Frontend

- `pages/Visa.jsx` — 4 tabs: **Bookings** (list, search/status/hasDue quick
  filters + an Advanced Filters panel for date range/country/visaType/agent
  with removable chips, 📄 invoice icon per row), **Embassy/Agents**
  (management list with an active toggle), **By Agent** and **By Country**
  (analytics tables, sorted by approval rate).
- `pages/Reports.jsx` — now a "Ticketing Reports" / "Visa Reports" tab
  switcher on one page; the Visa tab has its own date-range summary cards,
  status donut, 6-month trend line chart, and by-staff table (admin only).
- `pages/Dashboard.jsx` — adds a Visa Summary card row and a "Recent Visa
  Cases" list (click-through opens that case in `Visa.jsx` via router state,
  mirroring the Ticketing dashboard pattern); the "Coming to your plan"
  teaser no longer lists Visa now that it has a real page.
- `components/VisaCaseDetailModal.jsx` — the hub: case info, Agent/Embassy
  (if assigned), Payments (record/delete + summary), Documents Checklist
  (upload/view/mark pending/add custom item + progress badge), Status
  History + transition actions, Download Invoice.
- `components/NewVisaApplicationModal.jsx`, `VisaStatusChangeModal.jsx`,
  `VisaAgentFormModal.jsx`.
- Shared with Ticketing: `utils/downloadInvoice.js` (generalized to take a
  full endpoint path + filename), `components/RecordTicketPaymentModal.jsx`
  (reused as-is for Visa payments — it's generic over `dueAmount`).

## How to Test (basic flow)

1. **Register an agency** and, as super admin, assign a plan with the `Visa`
   feature (and `Reports` if you want that tab too).
2. **Log in** as the agency.
3. **Create a customer**: `POST /api/agency/customers`.
4. **(Optional) Create an agent/embassy**: `POST /api/agency/visa-agents`.
5. **Create a visa case**: `POST /api/agency/visa` with
   `{ customerId, agentId?, visaType, country, serviceFee, embassyFee? }` —
   the document checklist is auto-populated from the visaType preset.
6. **Complete the checklist**: `POST /api/agency/visa/:id/documents/:docIndex/upload`
   for each item (or `PATCH .../status` to mark received without a file).
7. **Record a payment**: `POST /api/agency/visa/:id/payments`.
8. **Move the status along**: `PATCH /api/agency/visa/:id/status` through
   `submitted → processing → approved → delivered` (or `→ rejected`).
9. **Download the invoice**: `GET /api/agency/visa/:id/invoice`.
10. **Check the dashboard**: `GET /api/agency/dashboard/summary` reflects the
    new case in `thisMonthVisaCases`/`thisMonthVisaRevenue`/`totalVisaDue`/`recentVisaCases`.

Every route above enforces `agencyId` scoping — a second agency's token
against any of these with another agency's `:id` gets a `403`.
