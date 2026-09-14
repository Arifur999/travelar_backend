import { z } from "zod";
import { loginEmail } from "../../utils/loginEmail.js";

const registerZodSchema = z.object({
  agencyName: z.string("Agency name is required").min(2, "Agency name must be at least 2 characters"),
  agencyPhone: z.string().optional(),
  name: z.string("Your name is required").min(2, "Name must be at least 2 characters"),
  email: loginEmail(),
  password: z.string("Password is required").min(8, "Password must be at least 8 characters"),
});

const loginZodSchema = z.object({
  email: loginEmail(),
  password: z.string("Password is required").min(1, "Password is required"),
});

const changePasswordZodSchema = z.object({
  currentPassword: z.string("Current password is required").min(1, "Current password is required"),
  newPassword: z.string("New password is required").min(8, "New password must be at least 8 characters"),
});

// Only the display name. Email is the login identifier and role/tenant are
// decided by an admin, so none of those are self-service.
const updateMeZodSchema = z.object({
  name: z.string("Name is required").trim().min(2, "Name must be at least 2 characters").max(80),
});

export const AuthValidation = {
  registerZodSchema,
  loginZodSchema,
  changePasswordZodSchema,
  updateMeZodSchema,
};
