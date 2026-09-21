import { HotelBookingStatus } from "../../../generated/prisma/enums.js";

/// One-way lifecycle. CANCELLED and COMPLETED are final.
export const HOTEL_BOOKING_TRANSITIONS: Record<HotelBookingStatus, HotelBookingStatus[]> = {
  RESERVED: [HotelBookingStatus.CONFIRMED, HotelBookingStatus.CANCELLED],
  CONFIRMED: [HotelBookingStatus.COMPLETED, HotelBookingStatus.CANCELLED],
  CANCELLED: [],
  COMPLETED: [],
};

export const hotelBookingSearchableFields = [
  "hotelName",
  "city",
  "guestName",
  "confirmationNo",
  "bookedThrough",
  "customer.name",
  "customer.phone",
];

export const hotelBookingFilterableFields = ["status", "customerId", "city"];
