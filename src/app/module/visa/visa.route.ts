import { Router } from "express";
import { PlanFeature, Role } from "../../../generated/prisma/enums.js";
import { checkAuth } from "../../middleware/checkAuth.js";
import { checkFeatureAccess, requireActiveSubscription } from "../../middleware/tenantGuards.js";
import { validateRequest } from "../../middleware/validateRequest.js";
import { VisaController } from "./visa.controller.js";
import { VisaValidation } from "./visa.validation.js";

const router = Router();

router.use(
  checkAuth(Role.AGENCY_ADMIN, Role.AGENCY_STAFF),
  requireActiveSubscription,
  checkFeatureAccess(PlanFeature.VISA),
);

// Agents are their own collection, declared before /:id so "agents" is not
// mistaken for a case id.
router.get("/agents", VisaController.getAllVisaAgents);
router.post(
  "/agents",
  validateRequest(VisaValidation.createVisaAgentZodSchema),
  VisaController.createVisaAgent,
);
router.patch(
  "/agents/:id",
  validateRequest(VisaValidation.updateVisaAgentZodSchema),
  VisaController.updateVisaAgent,
);
router.delete("/agents/:id", VisaController.deleteVisaAgent);

router.get("/", VisaController.getAllVisaCases);
router.post(
  "/",
  validateRequest(VisaValidation.createVisaCaseZodSchema),
  VisaController.createVisaCase,
);

router.get("/:id", VisaController.getVisaCaseById);
router.patch(
  "/:id",
  validateRequest(VisaValidation.updateVisaCaseZodSchema),
  VisaController.updateVisaCase,
);
router.patch(
  "/:id/status",
  validateRequest(VisaValidation.changeStatusZodSchema),
  VisaController.changeVisaStatus,
);

router.post(
  "/:id/documents",
  validateRequest(VisaValidation.addDocumentZodSchema),
  VisaController.addDocument,
);
router.patch(
  "/:id/documents/:documentId",
  validateRequest(VisaValidation.setDocumentStatusZodSchema),
  VisaController.setDocumentStatus,
);
router.delete("/:id/documents/:documentId", VisaController.deleteDocument);

router.post(
  "/:id/payments",
  validateRequest(VisaValidation.recordPaymentZodSchema),
  VisaController.recordPayment,
);
router.delete("/:id/payments/:paymentId", checkAuth(Role.AGENCY_ADMIN), VisaController.deletePayment);

router.delete("/:id", checkAuth(Role.AGENCY_ADMIN), VisaController.deleteVisaCase);

export const VisaRoutes = router;
