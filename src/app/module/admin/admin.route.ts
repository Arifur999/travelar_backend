import { Router } from "express";
import { Role } from "../../../generated/prisma/enums.js";
import { checkAuth } from "../../middleware/checkAuth.js";
import { validateRequest } from "../../middleware/validateRequest.js";
import { AdminController } from "./admin.controller.js";
import { BillingController } from "../billing/billing.controller.js";
import { BillingValidation } from "../billing/billing.validation.js";
import { AdminValidation } from "./admin.validation.js";

const router = Router();

// The platform operator. Not a tenant, so none of the agency guards apply.
router.use(checkAuth(Role.SUPER_ADMIN));

router.get("/stats", AdminController.getPlatformStats);
router.get("/activity-log", AdminController.listActivityLog);

// Expire lapsed agencies and send due subscription emails now. The same pass
// also runs hourly in-process and can be triggered from /internal.
router.post("/jobs/subscription-lifecycle", AdminController.runSubscriptionLifecycle);

router.get("/plans", AdminController.listPlans);
router.post("/plans", validateRequest(AdminValidation.createPlanZodSchema), AdminController.createPlan);
router.patch("/plans/:id", validateRequest(AdminValidation.updatePlanZodSchema), AdminController.updatePlan);
router.delete("/plans/:id", AdminController.deactivatePlan);

// bKash payments an agency says it has made. Approving one renews the plan,
// so it is the operator who does it and nobody else.
router.get("/manual-payments", BillingController.listManualPaymentsForReview);
router.post(
  "/manual-payments/:id/review",
  validateRequest(BillingValidation.reviewManualPaymentZodSchema),
  BillingController.reviewManualPayment,
);

router.get("/agencies", AdminController.listAgencies);
router.get("/agencies/:id", AdminController.getAgencyById);
router.patch(
  "/agencies/:id/status",
  validateRequest(AdminValidation.updateAgencyStatusZodSchema),
  AdminController.updateAgencyStatus,
);
router.patch(
  "/agencies/:id/plan",
  validateRequest(AdminValidation.assignPlanZodSchema),
  AdminController.assignPlan,
);
router.patch(
  "/agencies/:id/extend-trial",
  validateRequest(AdminValidation.extendTrialZodSchema),
  AdminController.extendTrial,
);
router.delete("/agencies/:id", AdminController.deleteAgency);

export const AdminRoutes = router;
