import { z } from "zod";

const createTicketZodSchema = z.object({
  subject: z.string("Subject is required").min(4, "Subject is too short"),
  message: z.string("Message is required").min(4, "Message is too short"),
  category: z.enum(["BILLING", "TECHNICAL", "FEATURE_REQUEST", "OTHER"], "Invalid category").optional(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH"], "Invalid priority").optional(),
});

const addMessageZodSchema = z.object({
  message: z.string("Message is required").min(1, "Message cannot be empty"),
});

const updateTicketStatusZodSchema = z.object({
  status: z.enum(["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"], "Invalid status"),
});

const createAnnouncementZodSchema = z.object({
  title: z.string("Title is required").min(3, "Title is too short"),
  message: z.string("Message is required").min(3, "Message is too short"),
  type: z.enum(["INFO", "FEATURE", "MAINTENANCE", "WARNING"], "Invalid type").optional(),
});

const updateAnnouncementZodSchema = createAnnouncementZodSchema.partial().extend({
  isActive: z.boolean().optional(),
});

export const SupportValidation = {
  createTicketZodSchema,
  addMessageZodSchema,
  updateTicketStatusZodSchema,
  createAnnouncementZodSchema,
  updateAnnouncementZodSchema,
};
