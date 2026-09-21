import { Router } from "express";
import { PlanFeature, Role } from "../../../generated/prisma/enums.js";
import { checkAuth } from "../../middleware/checkAuth.js";
import { checkFeatureAccess, requireActiveSubscription } from "../../middleware/tenantGuards.js";
import { validateRequest } from "../../middleware/validateRequest.js";
import { InvoiceController } from "../invoice/invoice.controller.js";
import { HotelController } from "./hotel.controller.js";
import { HotelValidation } from "./hotel.validation.js";

const router = Router();

router.use(
  checkAuth(Role.AGENCY_ADMIN, Role.AGENCY_STAFF),
  requireActiveSubscription,
  checkFeatureAccess(PlanFeature.HOTEL),
);

// Declared before /:id so "summary" is not mistaken for a booking id.
router.get("/summary", HotelController.getSummary);

router.get("/", HotelController.getAllBookings);
router.post(
  "/",
  validateRequest(HotelValidation.createBookingZodSchema),
  HotelController.createBooking,
);

router.get("/:id/invoice", InvoiceController.getHotelInvoice);
router.get("/:id", HotelController.getBookingById);
router.patch(
  "/:id",
  validateRequest(HotelValidation.updateBookingZodSchema),
  HotelController.updateBooking,
);
router.patch(
  "/:id/status",
  validateRequest(HotelValidation.changeStatusZodSchema),
  HotelController.changeBookingStatus,
);

router.post(
  "/:id/payments",
  validateRequest(HotelValidation.recordPaymentZodSchema),
  HotelController.recordPayment,
);
router.delete(
  "/:id/payments/:paymentId",
  checkAuth(Role.AGENCY_ADMIN),
  HotelController.deletePayment,
);

router.delete("/:id", checkAuth(Role.AGENCY_ADMIN), HotelController.deleteBooking);

export const HotelRoutes = router;
