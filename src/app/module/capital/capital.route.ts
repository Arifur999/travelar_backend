import { Router } from "express";
import { PlanFeature, Role } from "../../../generated/prisma/enums.js";
import { checkAuth } from "../../middleware/checkAuth.js";
import { checkFeatureAccess, requireActiveSubscription } from "../../middleware/tenantGuards.js";
import { validateRequest } from "../../middleware/validateRequest.js";
import { CapitalController } from "./capital.controller.js";
import { CapitalValidation } from "./capital.validation.js";

const router = Router();

// Owner capital is the agency admin's business, not general staff's.
router.use(
  checkAuth(Role.AGENCY_ADMIN),
  requireActiveSubscription,
  checkFeatureAccess(PlanFeature.EXPENSE),
);

// Static segments before /:id.
router.get("/summary", CapitalController.getCapitalSummary);

router.get("/withdrawals", CapitalController.getAllProfitWithdrawals);
router.post(
  "/withdrawals",
  validateRequest(CapitalValidation.createProfitWithdrawalZodSchema),
  CapitalController.createProfitWithdrawal,
);
router.patch(
  "/withdrawals/:id",
  validateRequest(CapitalValidation.updateProfitWithdrawalZodSchema),
  CapitalController.updateProfitWithdrawal,
);
router.delete("/withdrawals/:id", CapitalController.deleteProfitWithdrawal);

router.get("/", CapitalController.getAllCapitalFlows);
router.post(
  "/",
  validateRequest(CapitalValidation.createCapitalFlowZodSchema),
  CapitalController.createCapitalFlow,
);
router.patch(
  "/:id",
  validateRequest(CapitalValidation.updateCapitalFlowZodSchema),
  CapitalController.updateCapitalFlow,
);
router.delete("/:id", CapitalController.deleteCapitalFlow);

export const CapitalRoutes = router;
