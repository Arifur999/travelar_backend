import status from "http-status";
import {
  HajjBookingStatus,
  HotelBookingStatus,
  TourBookingStatus,
} from "../../../generated/prisma/enums.js";
import AppError from "../../errorHelpers/AppError.js";
import { prisma } from "../../lib/prisma.js";
import { PostingService } from "../cashAccount/posting.service.js";
import { HajjBookingService } from "../hajj/hajjBooking.service.js";
import { HotelService } from "../hotel/hotel.service.js";
import { TicketService } from "../ticket/ticket.service.js";
import { TourBookingService } from "../tour/tourBooking.service.js";
import { VisaService } from "../visa/visa.service.js";
import {
  HAJJ_BOOKING_STATUS_LABELS,
  HAJJ_PACKAGE_TYPE_LABELS,
  HAJJ_TIER_LABELS,
  HOTEL_BOOKING_STATUS_LABELS,
  PAYMENT_METHOD_LABELS,
  TICKET_STATUS_LABELS,
  TOUR_BOOKING_STATUS_LABELS,
  VISA_STATUS_LABELS,
} from "./invoice.constant.js";
import { IInvoiceDocument } from "./invoice.interface.js";
import { formatInvoiceDate, renderInvoicePdf } from "./invoice.pdf.js";

const toNumber = PostingService.toNumber;

/**
 * Builds invoices from each module's own getById, so the total, paid and due
 * printed on paper are the same figures the app shows — there is no second
 * money calculation here to drift. Those lookups are already scoped to the
 * agency and answer 404 for anyone else's record.
 */

/**
 * The tail of the id rather than the head: ids are UUIDv7, whose leading
 * characters are a timestamp, so two records made in the same minute would
 * share a prefix. The tail is random.
 */
const invoiceNumber = (prefix: string, id: string) => `${prefix}-${id.replace(/-/g, "").slice(-10).toUpperCase()}`;

const loadParties = async (agencyId: string, customerId: string) => {
  const [agency, customer] = await Promise.all([
    prisma.agency.findFirst({
      where: { id: agencyId, isDeleted: false },
      select: { name: true, address: true, phone: true, email: true },
    }),
    // Not filtered on isDeleted: an invoice for an old sale must still print
    // after the customer record has been removed.
    prisma.customer.findFirst({
      where: { id: customerId, agencyId },
      select: { name: true, phone: true, email: true, address: true, passportNo: true },
    }),
  ]);

  if (!agency) throw new AppError(status.NOT_FOUND, "Agency not found");
  if (!customer) throw new AppError(status.NOT_FOUND, "Customer not found");
  return { agency, customer };
};

type PaymentRow = {
  paidAt: Date;
  method: keyof typeof PAYMENT_METHOD_LABELS;
  amount: Parameters<typeof toNumber>[0];
  /// Null when the payment was settled from what the customer had already paid
  /// in: no account received it now.
  cashAccount: { name: string } | null;
  fromWallet?: boolean;
};

const toPayments = (payments: (PaymentRow & { reference?: string | null; transactionRef?: string | null })[]) =>
  payments.map((payment) => ({
    date: payment.paidAt,
    method: PAYMENT_METHOD_LABELS[payment.method],
    account: payment.fromWallet ? "Customer balance" : (payment.cashAccount?.name ?? "—"),
    reference: payment.reference ?? payment.transactionRef ?? null,
    amount: toNumber(payment.amount),
  }));

const formatDay = (date: Date | null | undefined) => (date ? formatInvoiceDate(date) : null);

/* --------------------------------- ticket --------------------------------- */

const buildTicketInvoice = async (agencyId: string, id: string): Promise<IInvoiceDocument> => {
  const ticket = await TicketService.getTicketById(agencyId, id);
  const { agency, customer } = await loadParties(agencyId, ticket.customerId);

  const dateChangeFee = toNumber(ticket.dateChangeFee);
  const refundAmount = toNumber(ticket.refundAmount);
  const airline = ticket.airline ? `${ticket.airline.name} (${ticket.airline.shortCode})` : null;

  const lines = [
    { description: `Air ticket — ${ticket.passengerName}, PNR ${ticket.pnr}`, amount: toNumber(ticket.fare) },
  ];
  if (dateChangeFee > 0) lines.push({ description: "Date change fee", amount: dateChangeFee });
  if (refundAmount > 0) lines.push({ description: "Refund", amount: -refundAmount });

  return {
    number: invoiceNumber("TKT", ticket.id),
    kind: "Air ticket",
    status: TICKET_STATUS_LABELS[ticket.status],
    issuedAt: ticket.issueDate ?? ticket.createdAt,
    agency,
    customer,
    details: [
      { label: "Passenger", value: ticket.passengerName },
      { label: "PNR", value: ticket.pnr },
      { label: "Airline", value: airline },
      { label: "Route", value: ticket.route?.name },
      { label: "Travel date", value: formatDay(ticket.travelDate) },
      { label: "Date changed", value: formatDay(ticket.dateChangedAt) },
    ],
    lines,
    payments: toPayments(ticket.payments),
    total: ticket.customerCharge,
    paid: ticket.totalPaid,
    due: ticket.dueAmount,
    note:
      ticket.status === "VOID"
        ? "This ticket was voided."
        : ticket.status === "REFUNDED"
          ? "This ticket was refunded; the refund is shown as a reduction above."
          : null,
  };
};

/* ---------------------------------- visa ---------------------------------- */

const buildVisaInvoice = async (agencyId: string, id: string): Promise<IInvoiceDocument> => {
  const visaCase = await VisaService.getVisaCaseById(agencyId, id);
  const { agency, customer } = await loadParties(agencyId, visaCase.customerId);

  const serviceFee = toNumber(visaCase.serviceFee);
  const embassyFee = toNumber(visaCase.embassyFee);
  const label = `${visaCase.country} ${visaCase.visaType} visa`;

  const lines = [{ description: `Service fee — ${label}`, amount: serviceFee }];
  if (embassyFee > 0) lines.push({ description: "Embassy fee", amount: embassyFee });

  return {
    number: invoiceNumber("VIS", visaCase.id),
    kind: "Visa processing",
    status: VISA_STATUS_LABELS[visaCase.status],
    issuedAt: visaCase.submittedAt ?? visaCase.createdAt,
    agency,
    customer,
    details: [
      { label: "Country", value: visaCase.country },
      { label: "Visa type", value: visaCase.visaType },
      { label: "Application no.", value: visaCase.applicationNo },
      { label: "Processed via", value: visaCase.visaAgent?.name },
      { label: "Submitted", value: formatDay(visaCase.submittedAt) },
      { label: "Decided", value: formatDay(visaCase.decidedAt) },
    ],
    lines,
    payments: toPayments(visaCase.payments),
    total: visaCase.totalFee,
    paid: visaCase.totalPaid,
    due: visaCase.dueAmount,
    note: visaCase.status === "REJECTED" && visaCase.rejectionNote ? `Rejected: ${visaCase.rejectionNote}` : null,
  };
};

/* ---------------------------------- hajj ---------------------------------- */

const buildHajjInvoice = async (agencyId: string, id: string): Promise<IInvoiceDocument> => {
  const booking = await HajjBookingService.getBookingById(agencyId, id);
  const { agency, customer } = await loadParties(agencyId, booking.customerId);

  const cancelled = booking.status === HajjBookingStatus.CANCELLED;
  // Already a number: HajjBookingService.decorate converts it.
  const packagePrice = booking.packagePrice;
  const pkg = booking.hajjPackage;
  const packageLabel = `${pkg.name} (${HAJJ_PACKAGE_TYPE_LABELS[pkg.type]}, ${HAJJ_TIER_LABELS[pkg.tier]})`;

  const lines = [{ description: `${packageLabel} — ${booking.pilgrimName}`, amount: packagePrice }];

  // A cancelled booking bills nothing — the rule the customer's balance and
  // statement already follow — so it is cancelled out on the invoice too, and
  // anything already paid shows as credit rather than as money still owed.
  if (cancelled) lines.push({ description: "Booking cancelled", amount: -packagePrice });
  const total = cancelled ? 0 : packagePrice;

  return {
    number: invoiceNumber("HAJ", booking.id),
    kind: HAJJ_PACKAGE_TYPE_LABELS[pkg.type],
    status: HAJJ_BOOKING_STATUS_LABELS[booking.status],
    issuedAt: booking.createdAt,
    agency,
    customer,
    details: [
      { label: "Pilgrim", value: booking.pilgrimName },
      { label: "Passport", value: booking.passportNumber },
      { label: "Package", value: pkg.name },
      { label: "Batch", value: booking.batch.name },
      { label: "Departure", value: formatDay(booking.batch.departureDate) },
      { label: "Makkah room", value: booking.makkahRoom?.roomNumber },
      { label: "Madinah room", value: booking.madinahRoom?.roomNumber },
    ],
    lines,
    payments: toPayments(booking.payments),
    total,
    paid: booking.totalPaid,
    due: total - booking.totalPaid,
    note: cancelled
      ? "This booking was cancelled, so nothing is payable. Payments received against it are held as credit for the customer."
      : null,
  };
};

/* ---------------------------------- tour ---------------------------------- */

const buildTourInvoice = async (agencyId: string, id: string): Promise<IInvoiceDocument> => {
  const booking = await TourBookingService.getBookingById(agencyId, id);
  const { agency, customer } = await loadParties(agencyId, booking.customerId);

  const cancelled = booking.status === TourBookingStatus.CANCELLED;
  // Already a number: TourBookingService.decorate converts it.
  const sellAmount = booking.sellAmount;
  const tour = booking.tourPackage;
  const seats = booking.travellers === 1 ? "1 traveller" : `${booking.travellers} travellers`;

  const lines = [
    { description: `${tour.name} — ${tour.destination}, ${seats}`, amount: sellAmount },
  ];

  // A cancelled booking bills nothing — the rule the customer's balance and
  // statement already follow — so it is cancelled out here too, and anything
  // already paid shows as credit rather than as money still owed.
  if (cancelled) lines.push({ description: "Booking cancelled", amount: -sellAmount });
  const total = cancelled ? 0 : sellAmount;

  return {
    number: invoiceNumber("TUR", booking.id),
    kind: "Tour package",
    status: TOUR_BOOKING_STATUS_LABELS[booking.status],
    issuedAt: booking.createdAt,
    agency,
    customer,
    details: [
      { label: "Lead traveller", value: booking.leadTraveller },
      { label: "Travellers", value: String(booking.travellers) },
      { label: "Tour", value: tour.name },
      { label: "Destination", value: tour.destination },
      { label: "Departure", value: formatDay(tour.departureDate) },
      { label: "Return", value: formatDay(tour.returnDate) },
    ],
    lines,
    payments: toPayments(booking.payments),
    total,
    paid: booking.totalPaid,
    due: total - booking.totalPaid,
    note: cancelled
      ? "This booking was cancelled, so nothing is payable. Payments received against it are held as credit for the customer."
      : null,
  };
};

/* ---------------------------------- hotel --------------------------------- */

const buildHotelInvoice = async (agencyId: string, id: string): Promise<IInvoiceDocument> => {
  const booking = await HotelService.getBookingById(agencyId, id);
  const { agency, customer } = await loadParties(agencyId, booking.customerId);

  const cancelled = booking.status === HotelBookingStatus.CANCELLED;
  // Already numbers: HotelService.decorate converts them.
  const sellAmount = booking.sellAmount;
  const nights = booking.nights === 1 ? "1 night" : `${booking.nights} nights`;
  const rooms = booking.rooms === 1 ? "1 room" : `${booking.rooms} rooms`;

  const lines = [
    {
      description: `${booking.hotelName}, ${booking.city} — ${rooms}, ${nights}`,
      amount: sellAmount,
    },
  ];

  // A cancelled stay bills nothing — the rule the customer's balance and
  // statement already follow — so it is cancelled out here too.
  if (cancelled) lines.push({ description: "Booking cancelled", amount: -sellAmount });
  const total = cancelled ? 0 : sellAmount;

  return {
    number: invoiceNumber("HTL", booking.id),
    kind: "Hotel booking",
    status: HOTEL_BOOKING_STATUS_LABELS[booking.status],
    issuedAt: booking.createdAt,
    agency,
    customer,
    details: [
      { label: "Guest", value: booking.guestName },
      { label: "Hotel", value: booking.hotelName },
      { label: "City", value: [booking.city, booking.country].filter(Boolean).join(", ") },
      { label: "Room type", value: booking.roomType },
      { label: "Check-in", value: formatDay(booking.checkIn) },
      { label: "Check-out", value: formatDay(booking.checkOut) },
      { label: "Confirmation", value: booking.confirmationNo },
    ],
    lines,
    payments: toPayments(booking.payments),
    total,
    paid: booking.totalPaid,
    due: total - booking.totalPaid,
    note: cancelled
      ? "This booking was cancelled, so nothing is payable. Payments received against it are held as credit for the customer."
      : null,
  };
};

const BUILDERS = {
  ticket: buildTicketInvoice,
  visa: buildVisaInvoice,
  hajj: buildHajjInvoice,
  tour: buildTourInvoice,
  hotel: buildHotelInvoice,
} as const;

export type InvoiceKind = keyof typeof BUILDERS;

/** The invoice as a PDF, plus a filename that says what it is. */
const generateInvoice = async (kind: InvoiceKind, agencyId: string, id: string) => {
  const invoice = await BUILDERS[kind](agencyId, id);
  const pdf = await renderInvoicePdf(invoice);
  return { pdf, filename: `${invoice.number}.pdf` };
};

export const InvoiceService = {
  generateInvoice,
  buildTicketInvoice,
  buildVisaInvoice,
  buildHajjInvoice,
  buildTourInvoice,
  buildHotelInvoice,
};
