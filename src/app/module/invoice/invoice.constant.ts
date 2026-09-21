import {
  HajjBookingStatus,
  HajjPackageType,
  HajjTier,
  PaymentMethod,
  TicketStatus,
  TourBookingStatus,
  VisaStatus,
} from "../../../generated/prisma/enums.js";

/**
 * Human wording for enums printed on an invoice. Kept in step with the web
 * app's label maps (src/types/enums.types.ts there), so a customer reads the
 * same word on paper as the agent sees on screen.
 */

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  CASH: "Cash",
  BANK_TRANSFER: "Bank transfer",
  CARD: "Card",
  MOBILE_BANKING: "Mobile banking",
  CHEQUE: "Cheque",
  OTHER: "Other",
};

export const TICKET_STATUS_LABELS: Record<TicketStatus, string> = {
  ISSUED: "Issued",
  REISSUED: "Reissued",
  REFUNDED: "Refunded",
  VOID: "Void",
};

export const VISA_STATUS_LABELS: Record<VisaStatus, string> = {
  SUBMITTED: "Submitted",
  PROCESSING: "Processing",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  DELIVERED: "Delivered",
};

export const HAJJ_BOOKING_STATUS_LABELS: Record<HajjBookingStatus, string> = {
  RESERVED: "Reserved",
  CONFIRMED: "Confirmed",
  CANCELLED: "Cancelled",
  COMPLETED: "Completed",
};

export const HAJJ_PACKAGE_TYPE_LABELS: Record<HajjPackageType, string> = {
  HAJJ: "Hajj",
  UMRAH: "Umrah",
};

export const HAJJ_TIER_LABELS: Record<HajjTier, string> = {
  ECONOMY: "Economy",
  PREMIUM: "Premium",
  VIP: "VIP",
};

export const TOUR_BOOKING_STATUS_LABELS: Record<TourBookingStatus, string> = {
  RESERVED: "Reserved",
  CONFIRMED: "Confirmed",
  CANCELLED: "Cancelled",
  COMPLETED: "Completed",
};
