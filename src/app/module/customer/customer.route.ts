import { Router } from "express";
import { Role } from "../../../generated/prisma/enums.js";
import { checkAuth } from "../../middleware/checkAuth.js";
import { requireActiveSubscription } from "../../middleware/tenantGuards.js";
import { validateRequest } from "../../middleware/validateRequest.js";
import { CustomerController } from "./customer.controller.js";
import { CustomerValidation } from "./customer.validation.js";

const router = Router();

// Customers are a base feature — every plan gets them, because every other
// module books against a customer.
router.use(checkAuth(Role.AGENCY_ADMIN, Role.AGENCY_STAFF), requireActiveSubscription);

// Static segments before /:id.
router.get("/dashboard", CustomerController.getCustomerDashboard);

router.get("/", CustomerController.getAllCustomers);
router.post(
  "/",
  validateRequest(CustomerValidation.createCustomerZodSchema),
  CustomerController.createCustomer,
);

router.get("/:id", CustomerController.getCustomerById);
router.get("/:id/ledger", CustomerController.getCustomerLedger);
router.patch(
  "/:id",
  validateRequest(CustomerValidation.updateCustomerZodSchema),
  CustomerController.updateCustomer,
);
router.delete("/:id", CustomerController.deleteCustomer);

export const CustomerRoutes = router;
