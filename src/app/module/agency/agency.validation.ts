import { z } from "zod";

const updateAgencyProfileZodSchema = z
  .object({
    name: z.string().trim().min(2, "Agency name must be at least 2 characters").max(120).optional(),
    email: z.email("A valid email is required").nullable().optional(),
    phone: z.string().trim().max(30, "Phone is too long").nullable().optional(),
    address: z.string().trim().max(500, "Address is too long").nullable().optional(),
    // A URL, not an upload: the logo is printed on invoices and shown in the
    // sidebar, and a hosted image is all either needs.
    logo: z.url("Logo must be a valid URL").nullable().optional(),
  })
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    message: "Nothing to update",
  });

export const AgencyValidation = { updateAgencyProfileZodSchema };
