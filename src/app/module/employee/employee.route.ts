import { Router } from "express";
import { PlanFeature, Role } from "../../../generated/prisma/enums.js";
import { checkAuth } from "../../middleware/checkAuth.js";
import { checkFeatureAccess, requireActiveSubscription } from "../../middleware/tenantGuards.js";
import { validateRequest } from "../../middleware/validateRequest.js";
import { EmployeeController } from "./employee.controller.js";
import { EmployeeValidation } from "./employee.validation.js";

const router = Router();

// Staff payouts debit a cash account, so this sits behind the same feature as
// the rest of the money modules rather than having one of its own.
router.use(
  checkAuth(Role.AGENCY_ADMIN, Role.AGENCY_STAFF),
  requireActiveSubscription,
  checkFeatureAccess(PlanFeature.EXPENSE),
);

// Payouts
router.get("/transactions", EmployeeController.getAllTransactions);
router.post(
  "/transactions",
  validateRequest(EmployeeValidation.createTransactionZodSchema),
  EmployeeController.createTransaction,
);
router.delete("/transactions/:id", checkAuth(Role.AGENCY_ADMIN), EmployeeController.deleteTransaction);

// Attendance
router.get("/attendance/summary", EmployeeController.getAttendanceSummary);
router.get("/attendance", EmployeeController.getAllAttendance);
router.post(
  "/attendance",
  validateRequest(EmployeeValidation.createAttendanceZodSchema),
  EmployeeController.createAttendance,
);
router.delete("/attendance/:id", EmployeeController.deleteAttendance);

// Employees
router.get("/dashboard", EmployeeController.getEmployeeDashboard);
router.get("/", EmployeeController.getAllEmployees);
router.post("/", validateRequest(EmployeeValidation.createEmployeeZodSchema), EmployeeController.createEmployee);
router.get("/:id", EmployeeController.getEmployeeById);
router.patch("/:id", validateRequest(EmployeeValidation.updateEmployeeZodSchema), EmployeeController.updateEmployee);
router.delete("/:id", EmployeeController.deleteEmployee);

export const EmployeeRoutes = router;
