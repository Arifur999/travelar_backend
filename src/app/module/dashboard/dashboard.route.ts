import { Router } from "express";
import { PlanFeature, Role } from "../../../generated/prisma/enums.js";
import { checkAuth } from "../../middleware/checkAuth.js";
import { checkFeatureAccess, requireActiveSubscription } from "../../middleware/tenantGuards.js";
import { validateRequest } from "../../middleware/validateRequest.js";
import { DashboardController } from "./dashboard.controller.js";
import { DashboardValidation } from "./dashboard.validation.js";

const router = Router();

router.use(checkAuth(Role.AGENCY_ADMIN, Role.AGENCY_STAFF), requireActiveSubscription);

// The landing summary is a base feature — it is the agency's own front page.
router.get("/summary", DashboardController.getSummary);

// Goals are settings, readable by staff and writable by the admin.
router.get("/goals", DashboardController.getGoals);
router.post(
  "/goals",
  checkAuth(Role.AGENCY_ADMIN),
  validateRequest(DashboardValidation.upsertGoalZodSchema),
  DashboardController.upsertGoal,
);

// The analytical views are the REPORTS feature.
router.use(checkFeatureAccess(PlanFeature.REPORTS));

router.get("/custom", DashboardController.getCustom);
router.get("/monthly", DashboardController.getMonthly);
router.get("/yearly", DashboardController.getYearly);
router.get("/cash-flow", DashboardController.getCashFlow);

export const DashboardRoutes = router;
