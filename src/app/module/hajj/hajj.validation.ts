import { z } from "zod";

const METHODS = ["CASH", "BANK_TRANSFER", "CARD", "MOBILE_BANKING", "CHEQUE", "OTHER"] as const;

const createPackageZodSchema = z.object({
  name: z.string("Package name is required").min(3, "Name is too short"),
  type: z.enum(["HAJJ", "UMRAH"], "Type must be HAJJ or UMRAH"),
  tier: z.enum(["ECONOMY", "PREMIUM", "VIP"], "Invalid tier").optional(),
  price: z.coerce.number("Price is required").positive("Price must be greater than zero"),
  durationDays: z.coerce.number().int().positive().optional(),
  makkahHotel: z.string().max(160).optional(),
  makkahDistance: z.string().max(80).optional(),
  madinahHotel: z.string().max(160).optional(),
  madinahDistance: z.string().max(80).optional(),
  muallim: z.string().max(160).optional(),
  mealPlan: z.enum(["NONE", "BREAKFAST", "FULL_BOARD"], "Invalid meal plan").optional(),
  description: z.string().max(2000).optional(),
  isActive: z.boolean().optional(),
});

const updatePackageZodSchema = createPackageZodSchema.partial();

const createBatchZodSchema = z.object({
  packageId: z.uuid("A valid package is required"),
  name: z.string("Batch name is required").min(2, "Name is too short"),
  departureDate: z.string("Departure date is required"),
  returnDate: z.string().optional(),
  seatCapacity: z.coerce.number("Seat capacity is required").int().positive("Capacity must be at least 1"),
});

const updateBatchZodSchema = createBatchZodSchema.partial().extend({
  status: z.enum(["OPEN", "FULL", "DEPARTED", "COMPLETED", "CANCELLED"], "Invalid batch status").optional(),
});

const createRoomZodSchema = z.object({
  batchId: z.uuid("A valid batch is required"),
  hotelType: z.enum(["MAKKAH", "MADINAH"], "Hotel must be MAKKAH or MADINAH"),
  roomNumber: z.string("Room number is required").min(1),
  capacity: z.coerce.number("Capacity is required").int().positive("Capacity must be at least 1"),
});

const createBookingZodSchema = z.object({
  customerId: z.uuid("A valid customer is required"),
  packageId: z.uuid("A valid package is required"),
  batchId: z.uuid("A valid batch is required"),
  pilgrimName: z.string("Pilgrim name is required").min(2, "Name is too short"),
  passportNumber: z.string().max(40).optional(),
  munajjimNumber: z.string().max(40).optional(),
  packagePrice: z.coerce.number().nonnegative("Price cannot be negative").optional(),
});

const changeStatusZodSchema = z.object({
  status: z.enum(["CONFIRMED", "CANCELLED", "COMPLETED"], "Invalid target status"),
  note: z.string().max(1000).optional(),
});

const assignRoomZodSchema = z.object({
  hotelType: z.enum(["MAKKAH", "MADINAH"], "Hotel must be MAKKAH or MADINAH"),
  roomId: z.uuid("Invalid room").nullable().optional(),
});

const setDocumentStatusZodSchema = z.object({
  status: z.enum(["PENDING", "RECEIVED", "VERIFIED"], "Invalid document status"),
});

const recordPaymentZodSchema = z.object({
  cashAccountId: z.uuid("A valid account is required"),
  amount: z.coerce.number("Amount is required").positive("Amount must be greater than zero"),
  method: z.enum(METHODS, "Invalid payment method").optional(),
  transactionRef: z.string().max(120).optional(),
  note: z.string().max(500).optional(),
  paidAt: z.string().optional(),
});

export const HajjValidation = {
  createPackageZodSchema,
  updatePackageZodSchema,
  createBatchZodSchema,
  updateBatchZodSchema,
  createRoomZodSchema,
  createBookingZodSchema,
  changeStatusZodSchema,
  assignRoomZodSchema,
  setDocumentStatusZodSchema,
  recordPaymentZodSchema,
};
