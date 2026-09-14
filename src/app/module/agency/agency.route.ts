import { Router } from "express";
import { Role } from "../../../generated/prisma/enums.js";
import { checkAuth } from "../../middleware/checkAuth.js";
import { requireActiveSubscription } from "../../middleware/tenantGuards.js";
import { validateRequest } from "../../middleware/validateRequest.js";
import { AgencyController } from "./agency.controller.js";
import { AgencyValidation } from "./agency.validation.js";

const router = Router();

router.get("/profile", checkAuth(Role.AGENCY_ADMIN, Role.AGENCY_STAFF), AgencyController.getProfile);
router.patch(
  "/profile",
  checkAuth(Role.AGENCY_ADMIN),
  requireActiveSubscription,
  validateRequest(AgencyValidation.updateAgencyProfileZodSchema),
  AgencyController.updateProfile,
);

export const AgencyRoutes = router;
