import { z } from "zod";

const checkoutZodSchema = z.object({
  planId: z.uuid("A valid plan is required"),
});

/**
 * What an agency sends after paying by bKash.
 *
 * Both values are copied off a phone, so they are bounded here and checked
 * properly in the service. The operator reading the receipt is the real check:
 * a format rule strict enough to reject a genuine transaction id would be
 * worse than one that lets a wrong one through to be refused by a person.
 */
const manualPaymentZodSchema = z.object({
  planId: z.uuid("Choose a plan"),
  senderNumber: z
    .string()
    .trim()
    .min(11, "Enter the bKash number you paid from")
    .max(20, "That is longer than a bKash number"),
  senderReference: z
    .string()
    .trim()
    .min(6, "Enter the transaction ID from your bKash message")
    .max(32, "That is longer than a bKash transaction ID"),
});

/** An operator accepting or refusing one claim, and why. */
const reviewManualPaymentZodSchema = z.object({
  approve: z.boolean(),
  note: z.string().trim().max(500).optional(),
});

export const BillingValidation = {
  checkoutZodSchema,
  manualPaymentZodSchema,
  reviewManualPaymentZodSchema,
};
