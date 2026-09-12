import { Router } from "express";
import { Role } from "../../../generated/prisma/enums.js";
import { checkAuth } from "../../middleware/checkAuth.js";
import { validateRequest } from "../../middleware/validateRequest.js";
import { AdminController } from "./admin.controller.js";
import { AdminValidation } from "./admin.validation.js";

const router = Router();

// The platform operator. Not a tenant, so none of the agency guards apply.
router.use(checkAuth(Role.SUPER_ADMIN));

router.get("/stats", AdminController.getPlatformStats);
router.get("/activity-log", AdminController.listActivityLog);

router.get("/plans", AdminController.listPlans);
router.post("/plans", validateRequest(AdminValidation.createPlanZodSchema), AdminController.createPlan);
router.patch("/plans/:id", validateRequest(AdminValidation.updatePlanZodSchema), AdminController.updatePlan);
router.delete("/plans/:id", AdminController.deactivatePlan);

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
