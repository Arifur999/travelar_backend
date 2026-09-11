import { z } from "zod";

const createSupplierZodSchema = z.object({
  name: z.string("Supplier name is required").min(2, "Supplier name must be at least 2 characters"),
  contactName: z.string().max(120).optional(),
  phone: z.string().max(40).optional(),
  address: z.string().max(500).optional(),
  openingPayable: z.coerce.number("Opening payable must be a number").optional(),
});

const updateSupplierZodSchema = z.object({
  name: z.string().min(2, "Supplier name must be at least 2 characters").optional(),
  contactName: z.string().max(120).optional(),
  phone: z.string().max(40).optional(),
  address: z.string().max(500).optional(),
  openingPayable: z.coerce.number().optional(),
});

export const SupplierValidation = {
  createSupplierZodSchema,
  updateSupplierZodSchema,
};
