import { z } from "zod";

const createRouteZodSchema = z.object({
  name: z.string("Route is required").min(3, "Route must be at least 3 characters"),
  remark: z.string().max(500).optional(),
});

const updateRouteZodSchema = z.object({
  name: z.string().min(3, "Route must be at least 3 characters").optional(),
  remark: z.string().max(500).optional(),
});

export const RouteMasterValidation = { createRouteZodSchema, updateRouteZodSchema };
