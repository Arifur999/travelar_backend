import { Router } from "express";
import { PlanFeature, Role } from "../../../generated/prisma/enums.js";
import { checkAuth } from "../../middleware/checkAuth.js";
import { checkFeatureAccess, requireActiveSubscription } from "../../middleware/tenantGuards.js";
import { validateRequest } from "../../middleware/validateRequest.js";
import { AirlineMasterController } from "./airlineMaster.controller.js";
import { AirlineMasterValidation } from "./airlineMaster.validation.js";

const router = Router();

router.use(
  checkAuth(Role.AGENCY_ADMIN, Role.AGENCY_STAFF),
  requireActiveSubscription,
  checkFeatureAccess(PlanFeature.TICKETING),
);

router.get("/", AirlineMasterController.getAllAirlines);
router.post(
  "/",
  validateRequest(AirlineMasterValidation.createAirlineZodSchema),
  AirlineMasterController.createAirline,
);
router.get("/:id", AirlineMasterController.getAirlineById);
router.patch(
  "/:id",
  validateRequest(AirlineMasterValidation.updateAirlineZodSchema),
  AirlineMasterController.updateAirline,
);
router.delete("/:id", AirlineMasterController.deleteAirline);

export const AirlineMasterRoutes = router;
