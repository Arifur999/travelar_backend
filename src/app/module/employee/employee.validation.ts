import { z } from "zod";

const TIME_PATTERN = /^\d{1,2}:\d{2}\s*(AM|PM)$/i;

const createEmployeeZodSchema = z.object({
  name: z.string("Employee name is required").min(2, "Name is too short"),
  phone: z.string("Phone is required").min(6, "Phone is too short"),
  address: z.string().max(500).optional(),
  joinDate: z.string("Join date is required"),
  resignDate: z.string().nullable().optional(),
});

const updateEmployeeZodSchema = createEmployeeZodSchema.partial();

const createTransactionZodSchema = z.object({
  employeeId: z.uuid("A valid employee is required"),
  cashAccountId: z.uuid("A valid account is required"),
  type: z.enum(["SALARY", "BONUS"], "Type must be SALARY or BONUS"),
  amount: z.coerce.number("Amount is required").positive("Amount must be greater than zero"),
  totalDays: z.coerce.number().int().nonnegative("Days cannot be negative").optional(),
  date: z.string().optional(),
  note: z.string().max(500).optional(),
});

const createAttendanceZodSchema = z.object({
  employeeId: z.uuid("A valid employee is required"),
  date: z.string("Date is required"),
  status: z.enum(["PRESENT", "ABSENT"], "Status must be PRESENT or ABSENT"),
  startTime: z.string().regex(TIME_PATTERN, "Time must look like 09:30 AM").optional(),
  endTime: z.string().regex(TIME_PATTERN, "Time must look like 06:00 PM").optional(),
  note: z.string().max(500).optional(),
});

export const EmployeeValidation = {
  createEmployeeZodSchema,
  updateEmployeeZodSchema,
  createTransactionZodSchema,
  createAttendanceZodSchema,
};
