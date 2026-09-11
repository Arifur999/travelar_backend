import { Router } from "express";
import { PlanFeature, Role } from "../../../generated/prisma/enums.js";
import { checkAuth } from "../../middleware/checkAuth.js";
import { checkFeatureAccess, requireActiveSubscription } from "../../middleware/tenantGuards.js";
import { validateRequest } from "../../middleware/validateRequest.js";
import { CashAccountController } from "./cashAccount.controller.js";
import { CashAccountValidation } from "./cashAccount.validation.js";

const router = Router();

// Balance lives behind the EXPENSE feature, matching how the modules were sold.
router.use(
  checkAuth(Role.AGENCY_ADMIN, Role.AGENCY_STAFF),
  requireActiveSubscription,
  checkFeatureAccess(PlanFeature.EXPENSE),
);

// Static segments before /:id, or "overview" is swallowed as an id.
router.get("/overview", CashAccountController.getOverview);

router.get("/", CashAccountController.getAllCashAccounts);
router.post(
  "/",
  validateRequest(CashAccountValidation.createCashAccountZodSchema),
  CashAccountController.createCashAccount,
);

router.get("/:id", CashAccountController.getCashAccountById);
router.patch(
  "/:id",
  validateRequest(CashAccountValidation.updateCashAccountZodSchema),
  CashAccountController.updateCashAccount,
);
router.delete("/:id", CashAccountController.deleteCashAccount);

export const CashAccountRoutes = router;
