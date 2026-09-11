# Hajj/Umrah Module

Manages Hajj/Umrah packages, batches (departures), pilgrim bookings, room
sharing/allocation, payments, document checklists, invoices, advanced
filtering, and reporting — for a travel agency's Hajj/Umrah business line.
Gated behind the `"Hajj/Umrah"` plan feature (`"Reports"` is a separate plan
feature that gates the reporting endpoints specifically). Built by adapting
the Ticketing and Visa Processing modules' established patterns.

## Models

### `HajjPackage` (`server/src/models/HajjPackage.js`)
The sellable package master list (e.g. "Umrah Economy — Ramadan 2027").

| Field | Type | Notes |
|---|---|---|
| `agencyId` | ObjectId → Agency | required |
| `name` | String | required |
| `type` | enum `["hajj", "umrah"]` | required — drives the document checklist preset |
| `tier` | enum `["economy", "premium", "vip"]` | default `economy` |
| `price` | Number | required, > 0 |
| `durationDays` | Number | optional |
| `makkahHotel` / `makkahDistance` | String | optional |
| `madinahHotel` / `madinahDistance` | String | optional |
| `muallim` | String | optional |
| `mealPlan` | enum `["none", "breakfast", "full_board"]` | default `none` |
| `description` | String | optional |
| `isActive` | Boolean | default `true` — inactive packages are hidden from new-booking pickers |
| `isDeleted` | Boolean | soft delete |

### `HajjBatch` (`server/src/models/HajjBatch.js`)
A specific departure/group tied to one package.

| Field | Type | Notes |
|---|---|---|
| `agencyId`, `packageId` | ObjectId | required |
| `name` | String | required |
| `departureDate` | Date | required |
| `returnDate` | Date | optional |
| `seatCapacity` | Number | required, ≥ 1 |
| `status` | enum `["open", "full", "departed", "completed", "cancelled"]` | default `open` |
| `isDeleted` | Boolean | soft delete |

`bookedSeats`/`availableSeats` are **not stored** — computed on read as a
count of non-cancelled `HajjBooking`s against `seatCapacity`.

### `HajjRoom` (`server/src/models/HajjRoom.js`)
A hotel room available for pilgrim assignment, scoped to one batch.

| Field | Type | Notes |
|---|---|---|
| `agencyId`, `batchId` | ObjectId | required |
| `hotelType` | enum `["makkah", "madinah"]` | required |
| `roomNumber` | String | required |
| `capacity` | Number | required, ≥ 1 |
| `isDeleted` | Boolean | soft delete — blocked while any pilgrim is still assigned |

`occupancy`/`availableSlots` are computed on read (not stored), by counting
`HajjBooking`s whose `makkahRoomId`/`madinahRoomId` points at the room.

### `HajjBooking` (`server/src/models/HajjBooking.js`)
One document per pilgrim — the central record of the module.

| Field | Type | Notes |
|---|---|---|
| `agencyId`, `customerId`, `packageId`, `batchId` | ObjectId | required |
| `pilgrimName` | String | required |
| `passportNumber`, `munajjimNumber` | String | optional |
| `packagePrice` | Number | required — snapshotted at booking time (defaults to the package's current price, but can be overridden) |
| `status` | enum `["booked", "confirmed", "cancelled", "completed"]` | default `booked` |
| `statusHistory` | `[{status, changedAt, changedBy, note}]` | append-only, written by the status-transition route |
| `documentChecklist` | `[{name, status, receivedAt, fileName, originalName, fileSize, mimeType}]` | auto-populated from the package-type preset at creation |
| `makkahRoomId`, `madinahRoomId` | ObjectId → HajjRoom | optional, independently assignable |
| `createdBy` | ObjectId → User | required |
| `isDeleted` | Boolean | soft delete |

State machine (`HAJJ_BOOKING_TRANSITIONS`, one-way, enforced server-side):
`booked → {confirmed, cancelled}`, `confirmed → {completed, cancelled}`,
`cancelled`/`completed` are final. Status can only change via
`PATCH /hajj-bookings/:id/status` — the generic `PATCH /hajj-bookings/:id`
never accepts a `status` field.

`totalPaid`/`dueAmount`/`documentsProgress` are **not stored** — computed on
read from `HajjPayment` and `documentChecklist` respectively.

### `HajjPayment` (`server/src/models/HajjPayment.js`)
Free-form payment record against a booking (no installment schedule).

| Field | Type | Notes |
|---|---|---|
| `agencyId`, `bookingId` | ObjectId | required |
| `amount` | Number | required, > 0 |
| `method` | enum `["cash", "bKash", "Nagad", "Bank Transfer", "Other"]` | default `cash` |
| `transactionRef`, `note` | String | optional |
| `recordedBy` | ObjectId → User | required |
| `paidAt` | Date | default `now` |

A payment is rejected (400) if `amount` exceeds the booking's current due
amount. Deleting a payment is `agency_admin`-only.

### Document checklist presets (`server/src/config/hajjDocumentPresets.js`)
- Base (every booking): Passport Copy, Photo, Vaccination Certificate, Mahram
  Certificate (if applicable), Medical Fitness Certificate.
- `type: "hajj"` adds: Hajj Visa Copy, Ihram Preparation Confirmation.
- `type: "umrah"` gets the base list only.

## API Routes

All routes are mounted under `/api/agency` and require `protect` +
`authorize("agency_admin", "agency_staff")`. Routes below additionally
require `checkFeatureAccess("Hajj/Umrah")` unless noted otherwise.

### Packages
| Method | Path |
|---|---|
| GET | `/hajj-packages` |
| POST | `/hajj-packages` |
| GET | `/hajj-packages/:id` |
| PATCH | `/hajj-packages/:id` |
| DELETE | `/hajj-packages/:id` (soft delete) |

### Batches
| Method | Path |
|---|---|
| GET | `/hajj-batches` |
| POST | `/hajj-batches` |
| GET | `/hajj-batches/:id` |
| PATCH | `/hajj-batches/:id` |
| DELETE | `/hajj-batches/:id` (soft delete) |
| GET | `/hajj-batches/:id/payment-summary` — `{ totalCollected, totalDue }` |
| GET | `/hajj-batches/:id/summary` — `{ totalPilgrims, statusBreakdown, totalRevenue, totalCollected, totalDue, bookedSeats, availableSeats, roomOccupancy }` |

### Rooms
| Method | Path |
|---|---|
| GET | `/hajj-rooms` (filters: `batchId`, `hotelType`; each room annotated with `occupancy`/`availableSlots`) |
| POST | `/hajj-rooms` |
| PATCH | `/hajj-rooms/:id` |
| DELETE | `/hajj-rooms/:id` (soft delete, blocked while occupied) |

### Bookings
| Method | Path |
|---|---|
| GET | `/hajj-bookings` (filters: `search`, `packageId`, `batchId`, `status`, `dateFrom`/`dateTo`, `hasDue`, all combinable) |
| POST | `/hajj-bookings` |
| GET | `/hajj-bookings/:id` |
| PATCH | `/hajj-bookings/:id` (non-status fields only) |
| PATCH | `/hajj-bookings/:id/status` (state-machine transition) |
| PATCH | `/hajj-bookings/:id/room` — body `{ hotelType, roomId }`, `roomId: null` unassigns |
| DELETE | `/hajj-bookings/:id` (soft delete) |

### Document checklist (sub-resource of a booking)
| Method | Path |
|---|---|
| POST | `/hajj-bookings/:id/documents` — add a custom checklist item |
| PATCH | `/hajj-bookings/:id/documents/:docIndex/status` — toggle pending/received |
| POST | `/hajj-bookings/:id/documents/:docIndex/upload` — multipart file upload (PDF/JPG/PNG, max 5MB), marks the item received |
| GET | `/hajj-bookings/:id/documents/:docIndex/download` |

### Payments (sub-resource of a booking)
| Method | Path |
|---|---|
| GET | `/hajj-bookings/:id/payments` |
| POST | `/hajj-bookings/:id/payments` — 400 if amount exceeds due |
| DELETE | `/hajj-bookings/:id/payments/:paymentId` — `agency_admin` only |

### Invoice
| Method | Path |
|---|---|
| GET | `/hajj-bookings/:id/invoice` — streams a PDF (pdfkit) |

### Reports (require `checkFeatureAccess("Reports")` instead of `"Hajj/Umrah"`)
| Method | Path |
|---|---|
| GET | `/hajj-bookings/reports/summary` — `dateFrom`/`dateTo` (default: current month) |
| GET | `/hajj-bookings/reports/monthly-trend` — last 6 months |
| GET | `/hajj-bookings/reports/by-package` — package popularity, revenue-sorted |
| GET | `/hajj-bookings/reports/by-staff` — `agency_admin` only |

### Dashboard integration
`GET /agency/dashboard/summary` (no feature gate) additionally returns
`thisMonthHajjBookings`, `thisMonthHajjRevenue`, `totalHajjDue`, and
`recentHajjBookings` (latest 5).

## Multi-tenant isolation

Every route scopes its query by `req.user.agencyId`. Single-record routes
(`:id`) use the fetch-then-compare pattern: 404 if the document doesn't
exist at all, 403 if it exists but belongs to another agency. Sub-resource
routes (documents, payments) go through a shared `verifyHajjBookingOwnership`
guard that attaches the checked booking as `req.hajjBooking`. List endpoints
are inherently scoped by `agencyId` in their query, so a cross-tenant filter
(e.g. `?batchId=<another agency's batch>`) returns an empty result rather
than leaking data or erroring.

## Frontend

- `client/src/pages/Hajj.jsx` — four sub-tabs: **Packages**, **Batches**,
  **Rooms**, **Pilgrims**. Pilgrims tab has search, a "due only" toggle, and
  an Advanced Filters panel (package/batch/status/date-range) with removable
  filter chips. Batches tab has per-batch 💰 Payment Summary and 📊 View
  Summary (status breakdown pie chart + room occupancy bars) modals.
- `client/src/components/HajjBookingDetailModal.jsx` — single scrollable
  modal covering info, Payments, Room Assignment, Documents Checklist,
  Status History, and status-transition actions, plus a Download Invoice
  button.
- `client/src/components/HajjPackageFormModal.jsx`,
  `HajjBatchFormModal.jsx`, `HajjRoomFormModal.jsx`, `HajjBookingFormModal.jsx`
  — create/edit forms with client-side validation mirroring the backend's.
  `RecordTicketPaymentModal.jsx` (generic, from the Ticketing module) is
  reused as-is for recording Hajj payments.
- `client/src/pages/Reports.jsx` — "Hajj/Umrah Reports" tab alongside
  Ticketing/Visa: stat cards, status-breakdown donut, monthly-trend line
  chart, By Package and By Staff tables.
- `client/src/pages/Dashboard.jsx` — Hajj/Umrah Summary stat cards and a
  "Recent Pilgrim Bookings" list; clicking a row navigates to `/hajj` with
  `location.state.openBookingId`, which the Pilgrims tab picks up to open
  that booking's detail modal directly.

## End-to-end test flow (used for manual/scripted verification)

1. Register an agency, assign it a plan with the `Hajj/Umrah` and `Reports`
   features, activate it.
2. Create a `type: "hajj"` package (auto-populates a 7-item document
   checklist on any booking against it; `type: "umrah"` gets 5 items).
3. Create a batch against that package with a small `seatCapacity`.
4. Book pilgrims up to capacity; confirm the next booking is blocked (400).
5. Cancel one booking; confirm the seat frees up and a new booking succeeds.
6. Create a room with a small `capacity`; assign pilgrims up to capacity;
   confirm the next assignment is blocked (400); confirm unassigning
   (`roomId: null`) frees the slot.
7. Confirm the document checklist auto-populated correctly; upload a file to
   one item and confirm it flips to `received` with file metadata attached.
8. Record two payments against one booking; confirm `totalPaid`/`dueAmount`
   update correctly and a payment exceeding the due amount is rejected.
9. Generate that booking's invoice PDF; extract its text and confirm pilgrim
   name, package, batch, assigned room, and fee figures are all present.
10. Call the batch summary endpoint and manually recompute
    `totalPilgrims`/`statusBreakdown`/`totalRevenue`/`totalCollected`/
    `totalDue`/`bookedSeats`/`availableSeats`/`roomOccupancy` to confirm a
    match.
11. Call `reports/summary` and `reports/monthly-trend` and manually recompute
    the same figures for the current month.
12. Call the dashboard summary and confirm the Hajj/Umrah figures and
    `recentHajjBookings` reflect the data just created.
13. Repeat every read/write above with a second agency's token against the
    first agency's IDs and confirm 403 throughout (or an empty result for
    agency-scoped list/report endpoints, which are not `:id`-based).

This flow (with concrete numbers) was run as `_test-hajj-full-verification.mjs`
during the module's final verification pass — 76/76 checks passed, and all
test data plus temporary scripts/dependencies were cleaned up afterward.
