import { z } from "zod";

const createCategoryZodSchema = z.object({
  name: z.string("Category name is required").min(2, "Name must be at least 2 characters"),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Colour must be a hex value like #2563eb").optional(),
  monthlyBudget: z.coerce.number().nonnegative("Budget cannot be negative").optional(),
  yearlyBudget: z.coerce.number().nonnegative("Budget cannot be negative").optional(),
});

const updateCategoryZodSchema = createCategoryZodSchema.partial();

const createExpenseZodSchema = z.object({
  categoryId: z.uuid("A valid category is required"),
  cashAccountId: z.uuid("A valid account is required"),
  amount: z.coerce.number("Amount is required").positive("Amount must be greater than zero"),
  date: z.string().optional(),
  notes: z.string().max(1000).optional(),
});

/// Amount and account are immutable once posted — they have already moved a
/// balance. Delete and recreate to correct them.
const updateExpenseZodSchema = z.object({
  categoryId: z.uuid("A valid category is required").optional(),
  date: z.string().optional(),
  notes: z.string().max(1000).optional(),
});

export const ExpenseValidation = {
  createCategoryZodSchema,
  updateCategoryZodSchema,
  createExpenseZodSchema,
  updateExpenseZodSchema,
};
