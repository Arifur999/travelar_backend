import { Router } from "express";
import { PlanFeature, Role } from "../../../generated/prisma/enums.js";
import { checkAuth } from "../../middleware/checkAuth.js";
import { checkFeatureAccess, requireActiveSubscription } from "../../middleware/tenantGuards.js";
import { validateRequest } from "../../middleware/validateRequest.js";
import { ExpenseController } from "./expense.controller.js";
import { ExpenseValidation } from "./expense.validation.js";

const router = Router();

router.use(
  checkAuth(Role.AGENCY_ADMIN, Role.AGENCY_STAFF),
  requireActiveSubscription,
  checkFeatureAccess(PlanFeature.EXPENSE),
);

// Static segments before /:id.
router.get("/dashboard", ExpenseController.getExpenseDashboard);

router.get("/categories", ExpenseController.getAllCategories);
router.post(
  "/categories",
  validateRequest(ExpenseValidation.createCategoryZodSchema),
  ExpenseController.createCategory,
);
router.patch(
  "/categories/:id",
  validateRequest(ExpenseValidation.updateCategoryZodSchema),
  ExpenseController.updateCategory,
);
router.delete("/categories/:id", ExpenseController.deleteCategory);

router.get("/", ExpenseController.getAllExpenses);
router.post(
  "/",
  validateRequest(ExpenseValidation.createExpenseZodSchema),
  ExpenseController.createExpense,
);
router.get("/:id", ExpenseController.getExpenseById);
router.patch(
  "/:id",
  validateRequest(ExpenseValidation.updateExpenseZodSchema),
  ExpenseController.updateExpense,
);
router.delete("/:id", ExpenseController.deleteExpense);

export const ExpenseRoutes = router;
