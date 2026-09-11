import { Router } from "express";
import { PlanFeature, Role } from "../../../generated/prisma/enums.js";
import { checkAuth } from "../../middleware/checkAuth.js";
import { checkFeatureAccess, requireActiveSubscription } from "../../middleware/tenantGuards.js";
import { validateRequest } from "../../middleware/validateRequest.js";
import { HajjController } from "./hajj.controller.js";
import { HajjValidation } from "./hajj.validation.js";

const router = Router();

router.use(
  checkAuth(Role.AGENCY_ADMIN, Role.AGENCY_STAFF),
  requireActiveSubscription,
  checkFeatureAccess(PlanFeature.HAJJ_UMRAH),
);

// Packages
router.get("/packages", HajjController.getAllPackages);
router.post("/packages", validateRequest(HajjValidation.createPackageZodSchema), HajjController.createPackage);
router.patch("/packages/:id", validateRequest(HajjValidation.updatePackageZodSchema), HajjController.updatePackage);
router.delete("/packages/:id", HajjController.deletePackage);

// Batches
router.get("/batches", HajjController.getAllBatches);
router.post("/batches", validateRequest(HajjValidation.createBatchZodSchema), HajjController.createBatch);
router.get("/batches/:id/summary", HajjController.getBatchSummary);
router.patch("/batches/:id", validateRequest(HajjValidation.updateBatchZodSchema), HajjController.updateBatch);
router.delete("/batches/:id", HajjController.deleteBatch);

// Rooms
router.get("/rooms", HajjController.getRoomsByBatch);
router.post("/rooms", validateRequest(HajjValidation.createRoomZodSchema), HajjController.createRoom);
router.delete("/rooms/:id", HajjController.deleteRoom);

// Bookings
router.get("/bookings", HajjController.getAllBookings);
router.post("/bookings", validateRequest(HajjValidation.createBookingZodSchema), HajjController.createBooking);
router.get("/bookings/:id", HajjController.getBookingById);
router.patch("/bookings/:id/status", validateRequest(HajjValidation.changeStatusZodSchema), HajjController.changeBookingStatus);
router.patch("/bookings/:id/room", validateRequest(HajjValidation.assignRoomZodSchema), HajjController.assignRoom);
router.patch("/bookings/:id/documents/:documentId", validateRequest(HajjValidation.setDocumentStatusZodSchema), HajjController.setDocumentStatus);
router.post("/bookings/:id/payments", validateRequest(HajjValidation.recordPaymentZodSchema), HajjController.recordPayment);
router.delete("/bookings/:id/payments/:paymentId", checkAuth(Role.AGENCY_ADMIN), HajjController.deletePayment);
router.delete("/bookings/:id", checkAuth(Role.AGENCY_ADMIN), HajjController.deleteBooking);

export const HajjRoutes = router;
