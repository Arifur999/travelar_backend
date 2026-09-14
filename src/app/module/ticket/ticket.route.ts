import { Router } from "express";
import { PlanFeature, Role } from "../../../generated/prisma/enums.js";
import { checkAuth } from "../../middleware/checkAuth.js";
import { checkFeatureAccess, requireActiveSubscription } from "../../middleware/tenantGuards.js";
import { validateRequest } from "../../middleware/validateRequest.js";
import { InvoiceController } from "../invoice/invoice.controller.js";
import { TicketController } from "./ticket.controller.js";
import { TicketValidation } from "./ticket.validation.js";

const router = Router();

router.use(
  checkAuth(Role.AGENCY_ADMIN, Role.AGENCY_STAFF),
  requireActiveSubscription,
  checkFeatureAccess(PlanFeature.TICKETING),
);

router.get("/", TicketController.getAllTickets);
router.post("/", validateRequest(TicketValidation.createTicketZodSchema), TicketController.createTicket);

// Printable invoice. Same gates as the rest of ticketing, so a locked module
// cannot be read out through its PDF.
router.get("/:id/invoice", InvoiceController.getTicketInvoice);
router.get("/:id", TicketController.getTicketById);
router.patch("/:id", validateRequest(TicketValidation.updateTicketZodSchema), TicketController.updateTicket);

// Status has its own route — the generic update deliberately cannot set it, so
// the lifecycle can only be moved through the transition check.
router.patch(
  "/:id/status",
  validateRequest(TicketValidation.changeStatusZodSchema),
  TicketController.changeTicketStatus,
);

router.patch(
  "/:id/date-change",
  validateRequest(TicketValidation.dateChangeZodSchema),
  TicketController.recordDateChange,
);

router.post(
  "/:id/payments",
  validateRequest(TicketValidation.recordPaymentZodSchema),
  TicketController.recordPayment,
);
// Reversing a posted payment is an admin action.
router.delete("/:id/payments/:paymentId", checkAuth(Role.AGENCY_ADMIN), TicketController.deletePayment);

router.delete("/:id", checkAuth(Role.AGENCY_ADMIN), TicketController.deleteTicket);

export const TicketRoutes = router;
