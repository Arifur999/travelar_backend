import { Router } from "express";
import { PlanFeature, Role } from "../../../generated/prisma/enums.js";
import { checkAuth } from "../../middleware/checkAuth.js";
import { checkFeatureAccess, requireActiveSubscription } from "../../middleware/tenantGuards.js";
import { validateRequest } from "../../middleware/validateRequest.js";
import { BalanceTransferController } from "./balanceTransfer.controller.js";
import { BalanceTransferValidation } from "./balanceTransfer.validation.js";

const router = Router();

router.use(
  checkAuth(Role.AGENCY_ADMIN, Role.AGENCY_STAFF),
  requireActiveSubscription,
  checkFeatureAccess(PlanFeature.EXPENSE),
);

router.get("/", BalanceTransferController.getAllBalanceTransfers);
router.post(
  "/",
  validateRequest(BalanceTransferValidation.createBalanceTransferZodSchema),
  BalanceTransferController.createBalanceTransfer,
);

router.get("/:id", BalanceTransferController.getBalanceTransferById);
router.patch(
  "/:id",
  validateRequest(BalanceTransferValidation.updateBalanceTransferZodSchema),
  BalanceTransferController.updateBalanceTransfer,
);
router.delete("/:id", BalanceTransferController.deleteBalanceTransfer);

export const BalanceTransferRoutes = router;
