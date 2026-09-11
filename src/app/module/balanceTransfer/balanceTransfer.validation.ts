import { z } from "zod";

const createBalanceTransferZodSchema = z
  .object({
    fromAccountId: z.uuid("A valid source account is required"),
    toAccountId: z.uuid("A valid destination account is required"),
    amount: z.coerce.number("Amount is required").positive("Amount must be greater than zero"),
    date: z.string().optional(),
    note: z.string().max(500).optional(),
  })
  .refine((data) => data.fromAccountId !== data.toAccountId, {
    message: "Source and destination account cannot be the same",
    path: ["toAccountId"],
  });

/// Amount and accounts are immutable once posted — they have already moved
/// balances. Delete and recreate to correct them.
const updateBalanceTransferZodSchema = z.object({
  date: z.string().optional(),
  note: z.string().max(500).optional(),
});

export const BalanceTransferValidation = {
  createBalanceTransferZodSchema,
  updateBalanceTransferZodSchema,
};
