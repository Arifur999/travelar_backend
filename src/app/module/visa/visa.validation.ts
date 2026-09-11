import { z } from "zod";

const METHODS = ["CASH", "BANK_TRANSFER", "CARD", "MOBILE_BANKING", "CHEQUE", "OTHER"] as const;

const createVisaCaseZodSchema = z.object({
  customerId: z.uuid("A valid customer is required"),
  visaAgentId: z.uuid("Invalid visa agent").optional(),
  country: z.string("Country is required").min(2, "Country is too short"),
  visaType: z.string("Visa type is required").min(2, "Visa type is too short"),
  applicationNo: z.string().max(80).optional(),
  submittedAt: z.string().optional(),
  serviceFee: z.coerce.number().nonnegative("Service fee cannot be negative").optional(),
  embassyFee: z.coerce.number().nonnegative("Embassy fee cannot be negative").optional(),
});

/// Status is absent on purpose — the status route is the only way through the
/// lifecycle, and creation always starts at SUBMITTED.
const updateVisaCaseZodSchema = createVisaCaseZodSchema.partial().omit({ customerId: true });

const changeStatusZodSchema = z.object({
  status: z.enum(["PROCESSING", "APPROVED", "REJECTED", "DELIVERED"], "Invalid target status"),
  note: z.string().max(1000).optional(),
});

const addDocumentZodSchema = z.object({
  title: z.string("Document name is required").min(2, "Document name is too short"),
});

const setDocumentStatusZodSchema = z.object({
  status: z.enum(["PENDING", "RECEIVED", "VERIFIED"], "Invalid document status"),
});

const recordPaymentZodSchema = z.object({
  cashAccountId: z.uuid("A valid account is required"),
  amount: z.coerce.number("Amount is required").positive("Amount must be greater than zero"),
  method: z.enum(METHODS, "Invalid payment method").optional(),
  reference: z.string().max(120).optional(),
  note: z.string().max(500).optional(),
  paidAt: z.string().optional(),
});

const createVisaAgentZodSchema = z.object({
  name: z.string("Agent name is required").min(2, "Name is too short"),
  type: z.string().max(40).optional(),
  contact: z.string().max(80).optional(),
  email: z.email("Invalid email").optional(),
  address: z.string().max(500).optional(),
  note: z.string().max(1000).optional(),
});

const updateVisaAgentZodSchema = createVisaAgentZodSchema.partial();

export const VisaValidation = {
  createVisaCaseZodSchema,
  updateVisaCaseZodSchema,
  changeStatusZodSchema,
  addDocumentZodSchema,
  setDocumentStatusZodSchema,
  recordPaymentZodSchema,
  createVisaAgentZodSchema,
  updateVisaAgentZodSchema,
};
