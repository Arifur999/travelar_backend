import { Router } from "express";
import { PlanFeature, Role } from "../../../generated/prisma/enums.js";
import { checkAuth } from "../../middleware/checkAuth.js";
import { checkFeatureAccess, requireActiveSubscription } from "../../middleware/tenantGuards.js";
import { validateRequest } from "../../middleware/validateRequest.js";
import { RouteMasterController } from "./routeMaster.controller.js";
import { RouteMasterValidation } from "./routeMaster.validation.js";

const router = Router();

router.use(
  checkAuth(Role.AGENCY_ADMIN, Role.AGENCY_STAFF),
  requireActiveSubscription,
  checkFeatureAccess(PlanFeature.TICKETING),
);

router.get("/", RouteMasterController.getAllRoutes);
router.post(
  "/",
  validateRequest(RouteMasterValidation.createRouteZodSchema),
  RouteMasterController.createRoute,
);
router.get("/:id", RouteMasterController.getRouteById);
router.patch(
  "/:id",
  validateRequest(RouteMasterValidation.updateRouteZodSchema),
  RouteMasterController.updateRoute,
);
router.delete("/:id", RouteMasterController.deleteRoute);

export const RouteMasterRoutes = router;
