import { z } from "zod";
import { loginEmail } from "../../utils/loginEmail.js";

const TEAM_ROLES = ["AGENCY_ADMIN", "AGENCY_STAFF"] as const;

const createMemberZodSchema = z.object({
  name: z.string("Name is required").min(2, "Name must be at least 2 characters"),
  email: loginEmail(),
  password: z.string("A temporary password is required").min(8, "Password must be at least 8 characters"),
  role: z.enum(TEAM_ROLES, "Invalid role").optional(),
});

const updateMemberZodSchema = z
  .object({
    name: z.string().min(2, "Name must be at least 2 characters").optional(),
    role: z.enum(TEAM_ROLES, "Invalid role").optional(),
  })
  .refine((value) => value.name !== undefined || value.role !== undefined, {
    message: "Nothing to update",
  });

const updateMemberStatusZodSchema = z.object({
  // DELETED is not settable here — removal goes through DELETE, which also
  // soft-deletes the row.
  status: z.enum(["ACTIVE", "BLOCKED"], "Status must be ACTIVE or BLOCKED"),
});

const resetMemberPasswordZodSchema = z.object({
  newPassword: z.string("A new password is required").min(8, "Password must be at least 8 characters"),
});

export const TeamValidation = {
  createMemberZodSchema,
  updateMemberZodSchema,
  updateMemberStatusZodSchema,
  resetMemberPasswordZodSchema,
};
