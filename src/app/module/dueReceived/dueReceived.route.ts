import { Router } from "express";
import { Role } from "../../../generated/prisma/enums.js";
import { checkAuth } from "../../middleware/checkAuth.js";
import { requireActiveSubscription } from "../../middleware/tenantGuards.js";
import { validateRequest } from "../../middleware/validateRequest.js";
import { DueReceivedController } from "./dueReceived.controller.js";
import { DueReceivedValidation } from "./dueReceived.validation.js";

const router = Router();

// Base feature, like customers — collecting money owed is not an upsell.
router.use(checkAuth(Role.AGENCY_ADMIN, Role.AGENCY_STAFF), requireActiveSubscription);

router.get("/", DueReceivedController.getAllDueReceived);
router.post(
  "/",
  validateRequest(DueReceivedValidation.createDueReceivedZodSchema),
  DueReceivedController.createDueReceived,
);

router.get("/:id", DueReceivedController.getDueReceivedById);
router.patch(
  "/:id",
  validateRequest(DueReceivedValidation.updateDueReceivedZodSchema),
  DueReceivedController.updateDueReceived,
);
// Reversing a posted receipt is an admin action.
router.delete("/:id", checkAuth(Role.AGENCY_ADMIN), DueReceivedController.deleteDueReceived);

export const DueReceivedRoutes = router;
