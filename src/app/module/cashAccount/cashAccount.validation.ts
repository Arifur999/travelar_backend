import { z } from "zod";

const CATEGORIES = ["OWNER_FUNDS", "LOANS", "SALES_BUYING", "OTHERS"] as const;

const createCashAccountZodSchema = z.object({
  name: z.string("Account name is required").min(2, "Account name must be at least 2 characters"),
  category: z.enum(CATEGORIES, "Invalid account category").optional(),
  openingBalance: z.coerce.number("Opening balance must be a number").optional(),
  isActive: z.boolean().optional(),
});

/// Opening balance is intentionally absent: it seeds the ledger at creation, so
/// changing it later would silently rewrite history.
const updateCashAccountZodSchema = z.object({
  name: z.string().min(2, "Account name must be at least 2 characters").optional(),
  category: z.enum(CATEGORIES, "Invalid account category").optional(),
  isActive: z.boolean().optional(),
});

export const CashAccountValidation = {
  createCashAccountZodSchema,
  updateCashAccountZodSchema,
};
