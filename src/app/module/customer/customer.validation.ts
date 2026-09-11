import { z } from "zod";

const createCustomerZodSchema = z.object({
  name: z.string("Customer name is required").min(2, "Name must be at least 2 characters"),
  phone: z.string("Phone is required").min(6, "Phone must be at least 6 characters"),
  email: z.email("Invalid email").optional(),
  passportNo: z.string().max(40).optional(),
  address: z.string().max(500).optional(),
  note: z.string().max(1000).optional(),
  openingDue: z.coerce.number("Opening due must be a number").optional(),
});

const updateCustomerZodSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters").optional(),
  phone: z.string().min(6, "Phone must be at least 6 characters").optional(),
  email: z.email("Invalid email").optional(),
  passportNo: z.string().max(40).optional(),
  address: z.string().max(500).optional(),
  note: z.string().max(1000).optional(),
  openingDue: z.coerce.number().optional(),
});

export const CustomerValidation = {
  createCustomerZodSchema,
  updateCustomerZodSchema,
};
