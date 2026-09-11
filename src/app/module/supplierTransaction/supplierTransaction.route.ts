import { Router } from "express";
import { PlanFeature, Role } from "../../../generated/prisma/enums.js";
import { checkAuth } from "../../middleware/checkAuth.js";
import { checkFeatureAccess, requireActiveSubscription } from "../../middleware/tenantGuards.js";
import { validateRequest } from "../../middleware/validateRequest.js";
import { SupplierTransactionController } from "./supplierTransaction.controller.js";
import { SupplierTransactionValidation } from "./supplierTransaction.validation.js";

const router = Router();

router.use(
  checkAuth(Role.AGENCY_ADMIN, Role.AGENCY_STAFF),
  requireActiveSubscription,
  checkFeatureAccess(PlanFeature.EXPENSE),
);

router.get("/", SupplierTransactionController.getAllSupplierTransactions);
router.post(
  "/",
  validateRequest(SupplierTransactionValidation.createSupplierTransactionZodSchema),
  SupplierTransactionController.createSupplierTransaction,
);

router.get("/:id", SupplierTransactionController.getSupplierTransactionById);
router.patch(
  "/:id",
  validateRequest(SupplierTransactionValidation.updateSupplierTransactionZodSchema),
  SupplierTransactionController.updateSupplierTransaction,
);
// Reversing a posted payment is an admin action.
router.delete(
  "/:id",
  checkAuth(Role.AGENCY_ADMIN),
  SupplierTransactionController.deleteSupplierTransaction,
);

export const SupplierTransactionRoutes = router;
