import { z } from "zod";

const METHODS = ["CASH", "BANK_TRANSFER", "CARD", "MOBILE_BANKING", "CHEQUE", "OTHER"] as const;

const createTicketZodSchema = z.object({
  customerId: z.uuid("A valid customer is required"),
  supplierId: z.uuid("Invalid supplier").optional(),
  airlineId: z.uuid("Invalid airline").optional(),
  routeId: z.uuid("Invalid route").optional(),
  passengerName: z.string("Passenger name is required").min(2, "Passenger name is too short"),
  pnr: z.string("PNR is required").min(3, "PNR must be at least 3 characters"),
  travelDate: z.string().optional(),
  issueDate: z.string().optional(),
  fare: z.coerce.number("Fare is required").nonnegative("Fare cannot be negative"),
  cost: z.coerce.number("Cost is required").nonnegative("Cost cannot be negative"),
});

const updateTicketZodSchema = createTicketZodSchema.partial();

const dateChangeZodSchema = z.object({
  dateChangedAt: z.string().optional(),
  travelDate: z.string().optional(),
  dateChangeCost: z.coerce.number().nonnegative("Change cost cannot be negative").optional(),
  dateChangeFee: z.coerce.number().nonnegative("Change fee cannot be negative").optional(),
});

/// Status is deliberately absent from updateTicketZodSchema — the status route
/// is the only path that can move a ticket through its lifecycle.
const changeStatusZodSchema = z.object({
  status: z.enum(["REISSUED", "REFUNDED", "VOID"], "Invalid target status"),
  refundAmount: z.coerce.number().nonnegative("Refund cannot be negative").optional(),
  note: z.string().max(500).optional(),
});

const recordPaymentZodSchema = z.object({
  cashAccountId: z.uuid("A valid account is required"),
  amount: z.coerce.number("Amount is required").positive("Amount must be greater than zero"),
  method: z.enum(METHODS, "Invalid payment method").optional(),
  reference: z.string().max(120).optional(),
  note: z.string().max(500).optional(),
  paidAt: z.string().optional(),
});

export const TicketValidation = {
  createTicketZodSchema,
  updateTicketZodSchema,
  dateChangeZodSchema,
  changeStatusZodSchema,
  recordPaymentZodSchema,
};
