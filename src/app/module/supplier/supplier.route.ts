import { Router } from "express";
import { PlanFeature, Role } from "../../../generated/prisma/enums.js";
import { checkAuth } from "../../middleware/checkAuth.js";
import { checkFeatureAccess, requireActiveSubscription } from "../../middleware/tenantGuards.js";
import { validateRequest } from "../../middleware/validateRequest.js";
import { SupplierController } from "./supplier.controller.js";
import { SupplierValidation } from "./supplier.validation.js";

const router = Router();

router.use(
  checkAuth(Role.AGENCY_ADMIN, Role.AGENCY_STAFF),
  requireActiveSubscription,
  checkFeatureAccess(PlanFeature.EXPENSE),
);

// Static segments before /:id.
router.get("/dashboard", SupplierController.getSupplierDashboard);

router.get("/", SupplierController.getAllSuppliers);
router.post(
  "/",
  validateRequest(SupplierValidation.createSupplierZodSchema),
  SupplierController.createSupplier,
);

router.get("/:id", SupplierController.getSupplierById);
router.get("/:id/ledger", SupplierController.getSupplierLedger);
router.patch(
  "/:id",
  validateRequest(SupplierValidation.updateSupplierZodSchema),
  SupplierController.updateSupplier,
);
router.delete("/:id", SupplierController.deleteSupplier);

export const SupplierRoutes = router;
