import { z } from "zod";

const METHODS = ["CASH", "BANK_TRANSFER", "CARD", "MOBILE_BANKING", "CHEQUE", "OTHER"] as const;

const createBookingZodSchema = z.object({
  customerId: z.uuid("A valid customer is required"),
  hotelName: z.string("Hotel name is required").min(2, "Hotel name is too short"),
  city: z.string("City is required").min(2, "City is too short"),
  country: z.string().max(80).optional(),
  bookedThrough: z.string().max(160).optional(),
  confirmationNo: z.string().max(80).optional(),
  guestName: z.string("Guest name is required").min(2, "Guest name is too short"),
  checkIn: z.string("Check-in date is required"),
  checkOut: z.string("Check-out date is required"),
  rooms: z.coerce.number().int().positive("At least one room").optional(),
  guests: z.coerce.number().int().positive("At least one guest").optional(),
  roomType: z.string().max(80).optional(),
  sellAmount: z.coerce.number("Price is required").nonnegative("Price cannot be negative"),
  costAmount: z.coerce.number().nonnegative("Cost cannot be negative").optional(),
  note: z.string().max(1000).optional(),
});

/// The customer is absent: a stay cannot change hands. Status is absent too —
/// the status route is the only way through the lifecycle.
const updateBookingZodSchema = createBookingZodSchema.partial().omit({ customerId: true });

const changeStatusZodSchema = z.object({
  status: z.enum(["CONFIRMED", "CANCELLED", "COMPLETED"], "Invalid target status"),
  note: z.string().max(1000).optional(),
});

const recordPaymentZodSchema = z.object({
  // Optional only because a wallet payment has no account; the service refuses
  // a payment that has neither.
  cashAccountId: z.uuid("A valid account is required").optional(),
  fromWallet: z.boolean().optional(),
  amount: z.coerce.number("Amount is required").positive("Amount must be greater than zero"),
  method: z.enum(METHODS, "Invalid payment method").optional(),
  reference: z.string().max(120).optional(),
  note: z.string().max(500).optional(),
  paidAt: z.string().optional(),
});

export const HotelValidation = {
  createBookingZodSchema,
  updateBookingZodSchema,
  changeStatusZodSchema,
  recordPaymentZodSchema,
};
