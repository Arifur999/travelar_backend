import { z } from "zod";

const upsertGoalZodSchema = z.object({
  year: z.coerce.number("Year is required").int().min(2000).max(2100),
  month: z.coerce.number("Month is required").int().min(1, "Month must be 1-12").max(12, "Month must be 1-12"),
  salesGoal: z.coerce.number().nonnegative("Goal cannot be negative").optional(),
  profitGoal: z.coerce.number().nonnegative("Goal cannot be negative").optional(),
});

export const DashboardValidation = { upsertGoalZodSchema };
