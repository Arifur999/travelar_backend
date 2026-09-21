import { TourBookingStatus } from "../../../generated/prisma/enums.js";

/// One-way lifecycle. CANCELLED and COMPLETED are final.
export const TOUR_BOOKING_TRANSITIONS: Record<TourBookingStatus, TourBookingStatus[]> = {
  RESERVED: [TourBookingStatus.CONFIRMED, TourBookingStatus.CANCELLED],
  CONFIRMED: [TourBookingStatus.COMPLETED, TourBookingStatus.CANCELLED],
  CANCELLED: [],
  COMPLETED: [],
};

export const tourPackageSearchableFields = ["name", "destination", "description"];

export const tourPackageFilterableFields = ["status"];

export const tourBookingSearchableFields = [
  "leadTraveller",
  "customer.name",
  "customer.phone",
  "tourPackage.name",
  "tourPackage.destination",
];

export const tourBookingFilterableFields = ["status", "customerId", "packageId"];
