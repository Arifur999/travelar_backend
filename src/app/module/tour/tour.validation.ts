import { z } from "zod";

const METHODS = ["CASH", "BANK_TRANSFER", "CARD", "MOBILE_BANKING", "CHEQUE", "OTHER"] as const;

const createPackageZodSchema = z.object({
  name: z.string("Tour name is required").min(3, "Name is too short"),
  destination: z.string("Destination is required").min(2, "Destination is too short"),
  departureDate: z.string().optional(),
  returnDate: z.string().optional(),
  durationDays: z.coerce.number().int().positive("Duration must be at least a day").optional(),
  // Omitted means the tour has no fixed limit, which is different from zero.
  seatCapacity: z.coerce.number().int().positive("Capacity must be at least 1").optional(),
  pricePerPerson: z.coerce
    .number("Price per person is required")
    .positive("Price must be greater than zero"),
  costPerPerson: z.coerce.number().nonnegative("Cost cannot be negative").optional(),
  inclusions: z.string().max(2000).optional(),
  description: z.string().max(2000).optional(),
});

/// Status is absent from create on purpose — a new tour always opens.
const updatePackageZodSchema = createPackageZodSchema.partial().extend({
  status: z.enum(["OPEN", "CLOSED", "COMPLETED", "CANCELLED"], "Invalid tour status").optional(),
});

const createBookingZodSchema = z.object({
  customerId: z.uuid("A valid customer is required"),
  packageId: z.uuid("A valid tour is required"),
  leadTraveller: z.string("Lead traveller name is required").min(2, "Name is too short"),
  travellers: z.coerce.number().int().positive("At least one traveller").optional(),
  sellAmount: z.coerce.number().nonnegative("Price cannot be negative").optional(),
  costAmount: z.coerce.number().nonnegative("Cost cannot be negative").optional(),
  note: z.string().max(1000).optional(),
});

/// The customer and the tour are absent: a booking cannot change hands, and
/// moving it to another tour would silently rewrite its seats and price.
const updateBookingZodSchema = createBookingZodSchema
  .partial()
  .omit({ customerId: true, packageId: true });

/// Status is absent from the update schema — the status route is the only way
/// through the lifecycle.
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

export const TourValidation = {
  createPackageZodSchema,
  updatePackageZodSchema,
  createBookingZodSchema,
  updateBookingZodSchema,
  changeStatusZodSchema,
  recordPaymentZodSchema,
};
