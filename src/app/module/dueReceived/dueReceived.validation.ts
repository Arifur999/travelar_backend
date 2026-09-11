import { z } from "zod";

const createDueReceivedZodSchema = z.object({
  customerId: z.uuid("A valid customer is required"),
  cashAccount1Id: z.uuid("A valid account is required"),
  amount1: z.coerce.number("Amount is required").positive("Amount must be greater than zero"),
  cashAccount2Id: z.uuid("Invalid second account").optional(),
  amount2: z.coerce.number().nonnegative("Second amount cannot be negative").optional(),
  discount: z.coerce.number().nonnegative("Discount cannot be negative").optional(),
  discountCategory: z.string().max(120).optional(),
  date: z.string().optional(),
  notes: z.string().max(1000).optional(),
});

/// Amounts and accounts are immutable once posted. The discount is editable
/// because it posts to no account — it only moves what the customer owes.
const updateDueReceivedZodSchema = z.object({
  date: z.string().optional(),
  discount: z.coerce.number().nonnegative("Discount cannot be negative").optional(),
  discountCategory: z.string().max(120).optional(),
  notes: z.string().max(1000).optional(),
});

export const DueReceivedValidation = {
  createDueReceivedZodSchema,
  updateDueReceivedZodSchema,
};
