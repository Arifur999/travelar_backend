import { z } from "zod";

const createAirlineZodSchema = z.object({
  name: z.string("Airline name is required").min(2, "Name must be at least 2 characters"),
  shortCode: z.string("Short code is required").min(1).max(5, "Short code must be 5 characters or fewer"),
  logoUrl: z.url("Logo must be a valid URL").optional(),
  remark: z.string().max(500).optional(),
});

const updateAirlineZodSchema = z.object({
  name: z.string().min(2).optional(),
  shortCode: z.string().min(1).max(5).optional(),
  logoUrl: z.url("Logo must be a valid URL").optional(),
  remark: z.string().max(500).optional(),
});

export const AirlineMasterValidation = { createAirlineZodSchema, updateAirlineZodSchema };
