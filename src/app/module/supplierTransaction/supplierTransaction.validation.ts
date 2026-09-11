import { z } from "zod";

const createSupplierTransactionZodSchema = z.object({
  supplierId: z.uuid("A valid supplier is required"),
  cashAccountId: z.uuid("A valid account is required"),
  amount: z.coerce.number("Amount is required").positive("Amount must be greater than zero"),
  date: z.string().optional(),
  note: z.string().max(500).optional(),
});

/// Amount and account are immutable once posted — they have already moved a
/// balance. Delete and recreate to correct them.
const updateSupplierTransactionZodSchema = z.object({
  date: z.string().optional(),
  note: z.string().max(500).optional(),
});

export const SupplierTransactionValidation = {
  createSupplierTransactionZodSchema,
  updateSupplierTransactionZodSchema,
};
