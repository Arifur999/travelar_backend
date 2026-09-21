import { Router } from "express";
import { PlanFeature, Role } from "../../../generated/prisma/enums.js";
import { checkAuth } from "../../middleware/checkAuth.js";
import { checkFeatureAccess, requireActiveSubscription } from "../../middleware/tenantGuards.js";
import { validateRequest } from "../../middleware/validateRequest.js";
import { InvoiceController } from "../invoice/invoice.controller.js";
import { TourController } from "./tour.controller.js";
import { TourValidation } from "./tour.validation.js";

const router = Router();

router.use(
  checkAuth(Role.AGENCY_ADMIN, Role.AGENCY_STAFF),
  requireActiveSubscription,
  checkFeatureAccess(PlanFeature.TOURS),
);

// Bookings and the summary are declared before /:id so neither word is
// mistaken for a tour id.
router.get("/summary", TourController.getSummary);

router.get("/bookings", TourController.getAllBookings);
router.post(
  "/bookings",
  validateRequest(TourValidation.createBookingZodSchema),
  TourController.createBooking,
);
router.get("/bookings/:id/invoice", InvoiceController.getTourInvoice);
router.get("/bookings/:id", TourController.getBookingById);
router.patch(
  "/bookings/:id",
  validateRequest(TourValidation.updateBookingZodSchema),
  TourController.updateBooking,
);
router.patch(
  "/bookings/:id/status",
  validateRequest(TourValidation.changeStatusZodSchema),
  TourController.changeBookingStatus,
);
router.post(
  "/bookings/:id/payments",
  validateRequest(TourValidation.recordPaymentZodSchema),
  TourController.recordPayment,
);
router.delete(
  "/bookings/:id/payments/:paymentId",
  checkAuth(Role.AGENCY_ADMIN),
  TourController.deletePayment,
);
router.delete("/bookings/:id", checkAuth(Role.AGENCY_ADMIN), TourController.deleteBooking);

router.get("/", TourController.getAllPackages);
router.post(
  "/",
  validateRequest(TourValidation.createPackageZodSchema),
  TourController.createPackage,
);
router.get("/:id", TourController.getPackageById);
router.patch(
  "/:id",
  validateRequest(TourValidation.updatePackageZodSchema),
  TourController.updatePackage,
);
router.delete("/:id", checkAuth(Role.AGENCY_ADMIN), TourController.deletePackage);

export const TourRoutes = router;
