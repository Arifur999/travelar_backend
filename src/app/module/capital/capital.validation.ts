import { z } from "zod";

const createCapitalFlowZodSchema = z.object({
  ownerName: z.string("Owner name is required").min(2, "Owner name is too short"),
  type: z.enum(["INVEST", "WITHDRAW"], "Type must be INVEST or WITHDRAW"),
  amount: z.coerce.number("Amount is required").positive("Amount must be greater than zero"),
  cashAccountId: z.uuid("A valid account is required"),
  date: z.string().optional(),
  note: z.string().max(500).optional(),
});

const updateCapitalFlowZodSchema = z.object({
  date: z.string().optional(),
  note: z.string().max(500).optional(),
});

const createProfitWithdrawalZodSchema = z.object({
  receivedBy: z.string("Recipient is required").min(2, "Recipient name is too short"),
  amount: z.coerce.number("Amount is required").positive("Amount must be greater than zero"),
  cashAccountId: z.uuid("A valid account is required"),
  date: z.string().optional(),
  note: z.string().max(500).optional(),
});

const updateProfitWithdrawalZodSchema = z.object({
  date: z.string().optional(),
  note: z.string().max(500).optional(),
});

export const CapitalValidation = {
  createCapitalFlowZodSchema,
  updateCapitalFlowZodSchema,
  createProfitWithdrawalZodSchema,
  updateProfitWithdrawalZodSchema,
};
