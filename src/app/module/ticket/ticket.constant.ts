import { TicketStatus } from "../../../generated/prisma/enums.js";

/// One-way lifecycle. REFUNDED and VOID are final — an empty list means no
/// further change is allowed.
export const TICKET_TRANSITIONS: Record<TicketStatus, TicketStatus[]> = {
  ISSUED: [TicketStatus.REISSUED, TicketStatus.REFUNDED, TicketStatus.VOID],
  REISSUED: [TicketStatus.REFUNDED, TicketStatus.VOID],
  REFUNDED: [],
  VOID: [],
};

export const ticketSearchableFields = [
  "pnr",
  "passengerName",
  "customer.name",
  "customer.phone",
  "airline.name",
  "supplier.name",
  "route.name",
];

export const ticketFilterableFields = [
  "status",
  "customerId",
  "supplierId",
  "airlineId",
  "routeId",
  "pnr",
  "travelDate",
  "issueDate",
  "fare",
  "cost",
];
