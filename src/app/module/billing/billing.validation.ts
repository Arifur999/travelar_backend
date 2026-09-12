import { z } from "zod";

const checkoutZodSchema = z.object({
  planId: z.uuid("A valid plan is required"),
});

export const BillingValidation = { checkoutZodSchema };
