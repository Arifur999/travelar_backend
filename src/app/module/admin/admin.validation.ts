import { z } from "zod";

const FEATURES = ["TICKETING", "VISA", "HAJJ_UMRAH", "EXPENSE", "REPORTS", "CRM"] as const;

const createPlanZodSchema = z.object({
  name: z.string("Plan name is required").min(2, "Name is too short"),
  description: z.string().max(1000).optional(),
  price: z.coerce.number("Price is required").nonnegative("Price cannot be negative"),
  durationDays: z.coerce.number("Duration is required").int().positive("Duration must be at least 1 day"),
  features: z.array(z.enum(FEATURES, "Unknown feature")).optional(),
  isActive: z.boolean().optional(),
});

const updatePlanZodSchema = createPlanZodSchema.partial();

const updateAgencyStatusZodSchema = z.object({
  status: z.enum(["ACTIVE", "EXPIRED", "SUSPENDED"], "Invalid status"),
});

const assignPlanZodSchema = z.object({
  planId: z.uuid("A valid plan is required"),
});

const extendTrialZodSchema = z.object({
  days: z.coerce.number("Days is required").int().positive("Days must be greater than zero").max(365),
});

export const AdminValidation = {
  createPlanZodSchema,
  updatePlanZodSchema,
  updateAgencyStatusZodSchema,
  assignPlanZodSchema,
  extendTrialZodSchema,
};
